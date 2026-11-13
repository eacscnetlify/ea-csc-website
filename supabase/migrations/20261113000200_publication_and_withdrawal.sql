-- Batch 6, part 3: controlled publication, supersession, withdrawal, and public download metadata.
-- Apply once as postgres in ea-csc-website-dev.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;

  if to_regprocedure('public.eacsc_approve_version(uuid,integer,jsonb,text,text,date,text,text,text,boolean,text,text,uuid)') is null then
    raise exception 'Apply 20261113000100_verification_and_approval.sql first.';
  end if;
end;
$$;

-- Add explicit successor link on record_versions for Superseded versions (V4 6.3.2).
alter table public.record_versions
  add column if not exists successor_version_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'record_versions_successor_same_record_fk'
  ) then
    alter table public.record_versions
      add constraint record_versions_successor_same_record_fk
      foreign key (record_id, successor_version_id)
      references public.record_versions (record_id, version_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'record_versions_successor_not_self'
  ) then
    alter table public.record_versions
      add constraint record_versions_successor_not_self
      check (
        successor_version_id is null
        or successor_version_id <> version_id
      );
  end if;
end;
$$;

-- Add verified private release-copy metadata to record_releases.
alter table public.record_releases
  add column if not exists release_bucket_id text,
  add column if not exists release_storage_key text,
  add column if not exists release_original_filename varchar(255),
  add column if not exists release_mime_type varchar(100),
  add column if not exists release_file_size_bytes bigint,
  add column if not exists release_sha256 varchar(64);

-- 1. Read-only context for the trusted publisher Edge Function before copying bytes.
create function eacsc_private.get_publish_context(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  roles text[];
  version_row public.record_versions%rowtype;
  master_row public.master_records%rowtype;
  upload_row eacsc_private.upload_requests%rowtype;
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Publication is not permitted.';
  end if;

  if p_version_id is null then
    raise exception using errcode = '22023', message = 'Provide a version ID.';
  end if;

  select functional_roles into roles
  from public.app_users
  where user_id = actor_id and is_active
  for share;

  if not found or not ('publisher' = any(roles)) or not exists (
    select 1 from auth.users
    where id = actor_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'Publication is not permitted.';
  end if;

  select * into version_row
  from public.record_versions
  where version_id = p_version_id
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Publication is not permitted.';
  end if;

  select * into master_row
  from public.master_records
  where record_id = version_row.record_id
  for share;

  perform 1
  from public.record_assignments
  where record_id = master_row.record_id
    and user_id = actor_id
    and is_active
    and assignment_function = 'publisher'
    and (master_row.access_class <> 'restricted' or allow_restricted)
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Publication is not permitted.';
  end if;

  if version_row.state <> 'Approved' then
    raise exception using errcode = '55000', message = 'Only Approved versions can be published.';
  end if;

  select u.* into upload_row
  from eacsc_private.upload_requests u
  join eacsc_private.upload_dispositions d on d.upload_id = u.upload_id
  where d.disposition = 'accepted'
    and d.accepted_version_id = p_version_id
    and u.proposed_version_id = p_version_id
    and u.record_id = master_row.record_id
    and u.destination_key = version_row.storage_key
    and u.sha256 = version_row.sha256;

  if not found then
    raise exception using errcode = '55000', message = 'An accepted attachment is required for release.';
  end if;

  return jsonb_build_object(
    'actor_user_id', actor_id,
    'record_id', master_row.record_id,
    'access_class', master_row.access_class,
    'default_title', master_row.title,
    'default_category', master_row.category,
    'record_revision', master_row.revision_counter,
    'version_id', version_row.version_id,
    'version_number', version_row.version_number,
    'version_revision', version_row.revision_counter,
    'source_bucket_id', upload_row.bucket_id,
    'source_storage_key', version_row.storage_key,
    'original_filename', version_row.original_filename,
    'mime_type', version_row.mime_type,
    'file_size_bytes', version_row.file_size_bytes,
    'sha256', version_row.sha256
  );
end;
$$;

revoke all on function eacsc_private.get_publish_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.get_publish_context(uuid)
  to authenticated;

create function public.eacsc_get_publish_context(p_version_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.get_publish_context(p_version_id);
$$;

revoke all on function public.eacsc_get_publish_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_get_publish_context(uuid)
  to authenticated;

-- 2. Trusted-backend atomic publication & supersession (called by Edge Function after Storage copy).
create function eacsc_private.publish_version(
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

  insert into public.record_releases (
    release_id, record_id, version_id, audience,
    public_title, public_category, authorization_basis, authorization_reference,
    released_by, released_at, effective_from,
    release_bucket_id, release_storage_key, release_original_filename,
    release_mime_type, release_file_size_bytes, release_sha256
  )
  values (
    p_release_id, master_row.record_id, p_version_id, p_audience,
    title_val, cat_val, basis_val, ref_val,
    p_actor_user_id, saved_at, eff_val,
    p_release_bucket_id, p_release_storage_key, version_row.original_filename,
    version_row.mime_type, version_row.file_size_bytes, version_row.sha256
  );

  -- Only activate public pointer & supersede predecessor when authorized effective time is reached.
  if p_audience = 'public' and eff_val <= saved_at then
    if master_row.current_public_release_id is not null then
      select * into prior_release
      from public.record_releases
      where release_id = master_row.current_public_release_id
        and record_id = master_row.record_id;

      if found and prior_release.version_id <> p_version_id then
        update public.record_versions
        set state = 'Superseded',
          successor_version_id = p_version_id,
          revision_counter = revision_counter + 1,
          updated_at = saved_at
        where version_id = prior_release.version_id
          and state = 'Approved';

        if found then
          superseded_version_id := prior_release.version_id;
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
      when p_audience = 'public' and eff_val <= saved_at
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
      'active_now', (p_audience = 'public' and eff_val <= saved_at),
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
    'active_now', (p_audience = 'public' and eff_val <= saved_at),
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

revoke all on function
  eacsc_private.publish_version(
    uuid, uuid, integer, integer, uuid, text, text, text, text, text, timestamptz, text, text, text, uuid
  )
  from public, anon, authenticated, service_role;
grant execute on function
  eacsc_private.publish_version(
    uuid, uuid, integer, integer, uuid, text, text, text, text, text, timestamptz, text, text, text, uuid
  )
  to service_role;

create function public.eacsc_publish_version(
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
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.publish_version(
    p_actor_user_id, p_version_id, p_expected_version_revision,
    p_expected_record_revision, p_release_id, p_audience,
    p_public_title, p_public_category, p_authorization_basis,
    p_authorization_reference, p_effective_from,
    p_release_bucket_id, p_release_storage_key, p_release_sha256,
    p_request_id
  );
$$;

revoke all on function
  public.eacsc_publish_version(
    uuid, uuid, integer, integer, uuid, text, text, text, text, text, timestamptz, text, text, text, uuid
  )
  from public, anon, authenticated, service_role;
grant execute on function
  public.eacsc_publish_version(
    uuid, uuid, integer, integer, uuid, text, text, text, text, text, timestamptz, text, text, text, uuid
  )
  to service_role;

-- 3. Emergency withdrawal (V4 6.3.3) by active publisher or approver.
create function eacsc_private.withdraw_release(
  p_release_id uuid,
  p_expected_record_revision integer,
  p_withdrawal_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  roles text[];
  rel_row public.record_releases%rowtype;
  master_row public.master_records%rowtype;
  receipt eacsc_private.mutation_receipts%rowtype;
  reason_val text := nullif(btrim(p_withdrawal_reason), '');
  saved_at timestamptz;
  event_id uuid := gen_random_uuid();
  payload jsonb;
  response jsonb;
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Withdrawal is not permitted.';
  end if;

  if p_release_id is null
    or p_request_id is null
    or p_expected_record_revision is null
    or reason_val is null
    or char_length(reason_val) > 1000 then
    raise exception using errcode = '22023', message = 'Provide release ID, record revision, reason, and request ID.';
  end if;

  payload := jsonb_build_object(
    'release_id', p_release_id,
    'expected_record_revision', p_expected_record_revision,
    'withdrawal_reason', reason_val
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'eacsc-mutation:' || actor_id::text || ':' || p_request_id::text, 0
  ));

  select functional_roles into roles
  from public.app_users
  where user_id = actor_id and is_active
  for share;

  if not found or not (roles && array['publisher', 'approver']::text[]) or not exists (
    select 1 from auth.users
    where id = actor_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'Withdrawal is not permitted.';
  end if;

  select * into rel_row
  from public.record_releases
  where release_id = p_release_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Withdrawal is not permitted.';
  end if;

  select * into master_row
  from public.master_records
  where record_id = rel_row.record_id
  for update;

  perform 1
  from public.record_assignments
  where record_id = master_row.record_id
    and user_id = actor_id
    and is_active
    and assignment_function in ('publisher', 'approver')
    and assignment_function = any(roles)
    and (master_row.access_class <> 'restricted' or allow_restricted)
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Withdrawal is not permitted.';
  end if;

  select * into receipt
  from eacsc_private.mutation_receipts r
  where r.actor_user_id = actor_id
    and r.request_id = p_request_id;

  if found then
    if receipt.command_name <> 'withdraw_release'
      or receipt.request_payload is distinct from payload then
      raise exception using errcode = '22023', message = 'Request ID was used for a different operation.';
    end if;
    return receipt.response_payload;
  end if;

  if rel_row.withdrawn_at is not null then
    raise exception using errcode = '55000', message = 'This release has already been withdrawn.';
  end if;

  if master_row.revision_counter <> p_expected_record_revision then
    raise exception using errcode = 'PT409', message = 'Record changed. Reload before withdrawing.';
  end if;

  saved_at := greatest(clock_timestamp(), rel_row.released_at, master_row.updated_at);

  update public.record_releases
  set withdrawn_at = saved_at,
    withdrawn_by = actor_id,
    withdrawal_reason = reason_val
  where release_id = p_release_id;

  update public.master_records
  set revision_counter = master_row.revision_counter + 1,
    updated_at = saved_at
  where record_id = master_row.record_id;

  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id,
    action_type, action_summary, previous_revision, new_revision,
    previous_state, new_state, request_id
  )
  values (
    event_id, master_row.record_id, rel_row.version_id, actor_id,
    'release.withdrawn', 'Withdrew release from public access.',
    master_row.revision_counter, master_row.revision_counter + 1,
    jsonb_build_object('release_id', p_release_id, 'withdrawn_at', null),
    jsonb_build_object('release_id', p_release_id, 'withdrawn_at', saved_at, 'withdrawal_reason', reason_val),
    p_request_id
  );

  response := jsonb_build_object(
    'request_id', p_request_id,
    'release_id', p_release_id,
    'record_id', master_row.record_id,
    'withdrawn_at', saved_at,
    'record_revision', master_row.revision_counter + 1,
    'audit_event_uuid', event_id
  );

  insert into eacsc_private.mutation_receipts (
    actor_user_id, request_id, command_name,
    request_payload, response_payload, audit_event_uuid
  )
  values (
    actor_id, p_request_id, 'withdraw_release',
    payload, response, event_id
  );

  return response;
end;
$$;

revoke all on function eacsc_private.withdraw_release(uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.withdraw_release(uuid, integer, text, uuid)
  to authenticated;

create function public.eacsc_withdraw_release(
  p_release_id uuid,
  p_expected_record_revision integer,
  p_withdrawal_reason text,
  p_request_id uuid
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.withdraw_release(
    p_release_id, p_expected_record_revision, p_withdrawal_reason, p_request_id
  );
$$;

revoke all on function public.eacsc_withdraw_release(uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_withdraw_release(uuid, integer, text, uuid)
  to authenticated;

-- 4. Safe public-release file lookup for the controlled public download Edge Function.
create function eacsc_private.public_release_file(p_record_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'record_id', m.record_id,
    'release_id', r.release_id,
    'version_id', v.version_id,
    'version_number', v.version_number,
    'bucket_id', r.release_bucket_id,
    'storage_key', r.release_storage_key,
    'original_filename', r.release_original_filename,
    'mime_type', r.release_mime_type,
    'file_size_bytes', r.release_file_size_bytes,
    'sha256', r.release_sha256
  )
  into result
  from public.master_records m
  join public.record_releases r
    on r.record_id = m.record_id
    and r.release_id = m.current_public_release_id
  join public.record_versions v
    on v.record_id = r.record_id
    and v.version_id = r.version_id
  where m.record_id = p_record_id
    and m.access_class = 'public'
    and r.audience = 'public'
    and v.state in ('Approved', 'Superseded')
    and r.withdrawn_at is null
    and r.released_at <= now()
    and r.effective_from <= now()
    and (r.effective_until is null or now() < r.effective_until)
    and r.release_bucket_id = 'verified-council-releases'
    and r.release_storage_key is not null;

  if result is null then
    raise exception using errcode = '55000', message = 'Public release file is unavailable.';
  end if;

  return result;
end;
$$;

revoke all on function eacsc_private.public_release_file(text)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.public_release_file(text)
  to service_role;

create function public.eacsc_public_release_file(p_record_id text)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.public_release_file(p_record_id);
$$;

revoke all on function public.eacsc_public_release_file(text)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_public_release_file(text)
  to service_role;

-- 5. Safe publisher-panel query returning current active public release ID per assigned record.
create function eacsc_private.list_publisher_releases()
returns table (
  record_id text,
  current_public_release_id uuid,
  release_id uuid,
  version_id uuid,
  audience text,
  public_title text,
  released_at timestamptz,
  effective_from timestamptz,
  withdrawn_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.record_id::text,
    m.current_public_release_id,
    r.release_id,
    r.version_id,
    r.audience::text,
    r.public_title::text,
    r.released_at,
    r.effective_from,
    r.withdrawn_at
  from public.master_records m
  join public.record_assignments a
    on a.record_id = m.record_id
    and a.user_id = auth.uid()
    and a.is_active
    and a.assignment_function = 'publisher'
    and (m.access_class <> 'restricted' or a.allow_restricted)
  join public.app_users u
    on u.user_id = a.user_id
    and u.is_active
    and 'publisher' = any(u.functional_roles)
  left join public.record_releases r
    on r.record_id = m.record_id
    and r.release_id = m.current_public_release_id
  where (auth.jwt()->>'is_anonymous') = 'false';
$$;

revoke all on function eacsc_private.list_publisher_releases()
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.list_publisher_releases()
  to authenticated;

create function public.eacsc_list_publisher_releases()
returns table (
  record_id text,
  current_public_release_id uuid,
  release_id uuid,
  version_id uuid,
  audience text,
  public_title text,
  released_at timestamptz,
  effective_from timestamptz,
  withdrawn_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select * from eacsc_private.list_publisher_releases();
$$;

revoke all on function public.eacsc_list_publisher_releases()
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_list_publisher_releases()
  to authenticated;

notify pgrst, 'reload schema';
commit;
