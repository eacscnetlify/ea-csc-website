-- Fix republishing a new version after the prior release was withdrawn.
-- A withdrawn release is immutable (`protect_record_release`), so publish_version
-- must not attempt to update `effective_until` on a prior release when `withdrawn_at` is already set.

create or replace function eacsc_private.publish_version(
  p_actor_user_id uuid,
  p_version_id uuid,
  p_expected_version_revision integer,
  p_expected_record_revision integer,
  p_release_id uuid,
  p_audience text,
  p_public_title text,
  p_public_category text,
  p_authorization_basis text,
  p_authorization_reference text,
  p_effective_from timestamptz,
  p_release_bucket_id text,
  p_release_storage_key text,
  p_release_sha256 text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  roles text[];
  master_row public.master_records%rowtype;
  version_row public.record_versions%rowtype;
  prior_release public.record_releases%rowtype;
  receipt eacsc_private.mutation_receipts%rowtype;

  title_val text := nullif(btrim(p_public_title), '');
  cat_val text := nullif(btrim(p_public_category), '');
  basis_val text := nullif(btrim(p_authorization_basis), '');
  ref_val text := nullif(btrim(p_authorization_reference), '');
  eff_val timestamptz := coalesce(p_effective_from, clock_timestamp());
  saved_at timestamptz;
  is_active_now boolean;
  event_id uuid := gen_random_uuid();
  superseded_version_id uuid;
  payload jsonb;
  response jsonb;
begin
  if p_actor_user_id is null
    or p_version_id is null
    or p_release_id is null
    or p_request_id is null
    or p_expected_version_revision is null
    or p_expected_record_revision is null
    or p_audience not in ('public', 'internal')
    or title_val is null or char_length(title_val) > 240
    or cat_val is null or cat_val not in (
      'Governance and legislation',
      'Secretariat and proceedings',
      'Activities and CBO records',
      'Financial archives',
      'Forms and official information',
      'Turnover and continuity'
    )
    or basis_val is null
    or ref_val is null
    or p_release_bucket_id <> 'verified-council-releases'
    or p_release_storage_key is null
    or p_release_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid publication parameters.';
  end if;

  payload := jsonb_build_object(
    'version_id', p_version_id,
    'expected_version_revision', p_expected_version_revision,
    'expected_record_revision', p_expected_record_revision,
    'audience', p_audience,
    'public_title', title_val,
    'public_category', cat_val,
    'authorization_basis', basis_val,
    'authorization_reference', ref_val,
    'effective_from', eff_val,
    'release_storage_key', p_release_storage_key,
    'release_sha256', p_release_sha256
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'eacsc-mutation:' || p_actor_user_id::text || ':' || p_request_id::text, 0
  ));

  select functional_roles into roles
  from public.app_users
  where user_id = p_actor_user_id and is_active
  for share;

  if not found or not ('publisher' = any(roles)) or not exists (
    select 1 from auth.users
    where id = p_actor_user_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'Publication is not permitted.';
  end if;

  select * into version_row
  from public.record_versions
  where version_id = p_version_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Publication is not permitted.';
  end if;

  select * into master_row
  from public.master_records
  where record_id = version_row.record_id
  for update;

  perform 1
  from public.record_assignments
  where record_id = master_row.record_id
    and user_id = p_actor_user_id
    and is_active
    and assignment_function = 'publisher'
    and (master_row.access_class <> 'restricted' or allow_restricted)
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Publication is not permitted.';
  end if;

  select * into receipt
  from eacsc_private.mutation_receipts r
  where r.actor_user_id = p_actor_user_id
    and r.request_id = p_request_id;

  if found then
    if receipt.command_name <> 'publish_version'
      or receipt.request_payload is distinct from payload then
      raise exception using errcode = '22023', message = 'Request ID was used for a different operation.';
    end if;
    return receipt.response_payload;
  end if;

  if p_audience = 'public' and master_row.access_class <> 'public' then
    raise exception using errcode = '22023', message = 'Only records classified public can have a public release.';
  end if;

  if version_row.revision_counter <> p_expected_version_revision
    or master_row.revision_counter <> p_expected_record_revision
    or version_row.state <> 'Approved' then
    raise exception using errcode = 'PT409', message = 'Record or version changed. Reload before publishing.';
  end if;

  if exists (
    select 1 from public.record_releases r
    where r.version_id = p_version_id
      and r.withdrawn_at is null
  ) then
    raise exception using errcode = '55000', message = 'This exact version already has an active or scheduled release.';
  end if;

  if p_release_sha256 is distinct from version_row.sha256 then
    raise exception using errcode = '22023', message = 'Release copy checksum does not match approved version.';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = p_release_bucket_id
      and name = p_release_storage_key
  ) then
    raise exception using errcode = '55000', message = 'Verified private release copy is missing.';
  end if;

  saved_at := greatest(clock_timestamp(), version_row.updated_at, master_row.updated_at);

  if eff_val > saved_at + interval '365 days' then
    raise exception using errcode = '22023', message = 'Scheduled effective time cannot be more than 365 days ahead.';
  end if;

  is_active_now := (p_audience = 'public' and eff_val <= saved_at);

  insert into public.record_releases (
    release_id, record_id, version_id, audience,
    public_title, public_category, authorization_basis, authorization_reference,
    released_by, released_at, effective_from, activated_at,
    release_bucket_id, release_storage_key, release_original_filename,
    release_mime_type, release_file_size_bytes, release_sha256
  )
  values (
    p_release_id, master_row.record_id, p_version_id, p_audience,
    title_val, cat_val, basis_val, ref_val,
    p_actor_user_id, saved_at, eff_val,
    case when is_active_now then saved_at else null end,
    p_release_bucket_id, p_release_storage_key, version_row.original_filename,
    version_row.mime_type, version_row.file_size_bytes, version_row.sha256
  );

  if is_active_now then
    if master_row.current_public_release_id is not null then
      select * into prior_release
      from public.record_releases
      where release_id = master_row.current_public_release_id
        and record_id = master_row.record_id
      for update;

      if found then
        if prior_release.withdrawn_at is null and prior_release.effective_until is null then
          update public.record_releases
          set effective_until = greatest(saved_at, prior_release.effective_from + interval '1 millisecond')
          where release_id = prior_release.release_id;
        end if;

        if prior_release.version_id <> p_version_id then
          update public.record_versions
          set state = 'Superseded',
            superseded_by_version_id = p_version_id,
            successor_version_id = p_version_id,
            revision_counter = revision_counter + 1,
            updated_at = greatest(saved_at, updated_at)
          where version_id = prior_release.version_id
            and state = 'Approved';

          if found then
            superseded_version_id := prior_release.version_id;
          end if;
        end if;
      end if;
    end if;

    update public.master_records
    set current_public_release_id = p_release_id,
      revision_counter = master_row.revision_counter + 1,
      updated_at = saved_at
    where record_id = master_row.record_id;
  else
    update public.master_records
    set revision_counter = master_row.revision_counter + 1,
      updated_at = saved_at
    where record_id = master_row.record_id;
  end if;

  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id,
    action_type, action_summary, previous_revision, new_revision,
    previous_state, new_state, request_id
  )
  values (
    event_id, master_row.record_id, p_version_id, p_actor_user_id,
    'version.released',
    case
      when is_active_now
        then 'Published approved version as active public release.'
      else 'Recorded authorized release (scheduled or internal).'
    end,
    master_row.revision_counter,
    master_row.revision_counter + 1,
    jsonb_build_object(
      'current_public_release_id', master_row.current_public_release_id,
      'superseded_version_id', superseded_version_id
    ),
    jsonb_build_object(
      'release_id', p_release_id,
      'audience', p_audience,
      'effective_from', eff_val,
      'active_now', is_active_now,
      'superseded_version_id', superseded_version_id
    ),
    p_request_id
  );

  response := jsonb_build_object(
    'request_id', p_request_id,
    'release_id', p_release_id,
    'record_id', master_row.record_id,
    'version_id', p_version_id,
    'audience', p_audience,
    'active_now', is_active_now,
    'superseded_version_id', superseded_version_id,
    'record_revision', master_row.revision_counter + 1,
    'audit_event_uuid', event_id,
    'released_at', saved_at
  );

  insert into eacsc_private.mutation_receipts (
    actor_user_id, request_id, command_name,
    request_payload, response_payload, audit_event_uuid
  )
  values (
    p_actor_user_id, p_request_id, 'publish_version',
    payload, response, event_id
  );

  return response;
end;
$$;
