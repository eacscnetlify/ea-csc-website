-- Batch 10, part 1: Corrective migration for Revalidation Defects D-01 through D-04.
-- Repairs:
--   D-01: eacsc_private.issue_bulletin (master_records summary column, cutoff guard, server-side source_snapshot verification, corrected issue v2+ chain)
--   D-02: Scoped storage.objects RLS policy for verified-council-releases/bulletins/ staging + effective_from filter in list_bulletin_candidates
--   D-03: eacsc_private.publish_version (activated_at, superseded_by_version_id, effective_until), protect_record_release trigger, scheduled activation RPC, public_release_file activation check, withdrawal notice insertion
--   D-04: public.eacsc_public_record_detail RPC for real public metadata & superseded public version history

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;

  if to_regprocedure('public.eacsc_issue_bulletin(text,integer,text,date,date,timestamptz,text,jsonb,text,bigint,text,text,uuid,uuid,text)') is null then
    raise exception 'Apply 20261114000200_bulletin_issuance.sql first.';
  end if;
end;
$$;

-- =========================================================================
-- D-02: Scoped storage staging authorization for official bulletin PDFs
-- =========================================================================

create or replace function eacsc_private.can_stage_bulletin_pdf(
  p_bucket_id text,
  p_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  roles text[];
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    return false;
  end if;

  if p_bucket_id is distinct from 'verified-council-releases'
    or p_object_name is null
    or p_object_name !~ '^bulletins/EACSC-[1-9][0-9]{3}-BUL-[0-9]{4}/v[1-9][0-9]*_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$' then
    return false;
  end if;

  select functional_roles into roles
  from public.app_users
  where user_id = actor_id and is_active;

  if not found or not (roles && array['publisher', 'custodian']::text[]) then
    return false;
  end if;

  return exists (
    select 1 from auth.users
    where id = actor_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  );
end;
$$;

revoke all on function eacsc_private.can_stage_bulletin_pdf(text, text)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.can_stage_bulletin_pdf(text, text)
  to authenticated;

drop policy if exists bulletin_pdf_stage_insert on storage.objects;
create policy bulletin_pdf_stage_insert
  on storage.objects
  for insert
  to authenticated
  with check (eacsc_private.can_stage_bulletin_pdf(bucket_id, name));

drop policy if exists bulletin_pdf_stage_select on storage.objects;
create policy bulletin_pdf_stage_select
  on storage.objects
  for select
  to authenticated
  using (eacsc_private.can_stage_bulletin_pdf(bucket_id, name));

-- Exclude future-scheduled releases from bulletin candidate compilation
create or replace function eacsc_private.list_bulletin_candidates(
  p_audience text,
  p_coverage_start date,
  p_cutoff_at timestamptz
)
returns table (
  release_id uuid,
  record_id text,
  version_id uuid,
  version_number integer,
  public_title text,
  public_category text,
  audience text,
  released_at timestamptz,
  effective_from timestamptz,
  approved_at timestamptz,
  summary_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  roles text[];
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Bulletin preparation is not permitted.';
  end if;

  if p_audience not in ('public', 'internal')
    or p_coverage_start is null
    or p_cutoff_at is null then
    raise exception using errcode = '22023', message = 'Provide valid audience, coverage start date, and cutoff timestamp.';
  end if;

  select functional_roles into roles
  from public.app_users
  where user_id = actor_id and is_active;

  if not found or not (roles && array['publisher', 'custodian']::text[]) or not exists (
    select 1 from auth.users
    where id = actor_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'Bulletin preparation is not permitted.';
  end if;

  if p_audience = 'public' then
    return query
    select
      r.release_id,
      m.record_id::text,
      v.version_id,
      v.version_number,
      r.public_title::text,
      r.public_category::text,
      r.audience::text,
      r.released_at,
      r.effective_from,
      v.approved_at,
      'Authorized public release'::text as summary_note
    from public.record_releases r
    join public.master_records m
      on m.record_id = r.record_id
    join public.record_versions v
      on v.record_id = r.record_id
      and v.version_id = r.version_id
    where m.access_class = 'public'
      and r.audience = 'public'
      and v.state in ('Approved', 'Superseded')
      and r.withdrawn_at is null
      and r.released_at <= p_cutoff_at
      and r.effective_from <= p_cutoff_at
      and (r.released_at at time zone 'Asia/Manila')::date >= p_coverage_start
      and (r.effective_until is null or r.effective_until > p_cutoff_at)
    order by r.released_at desc, m.record_id asc;
  else
    return query
    select
      r.release_id,
      m.record_id::text,
      v.version_id,
      v.version_number,
      r.public_title::text,
      r.public_category::text,
      r.audience::text,
      r.released_at,
      r.effective_from,
      v.approved_at,
      v.change_summary::text as summary_note
    from public.record_releases r
    join public.master_records m
      on m.record_id = r.record_id
    join public.record_versions v
      on v.record_id = r.record_id
      and v.version_id = r.version_id
    where v.state in ('Approved', 'Superseded')
      and r.withdrawn_at is null
      and r.released_at <= p_cutoff_at
      and r.effective_from <= p_cutoff_at
      and (r.released_at at time zone 'Asia/Manila')::date >= p_coverage_start
      and (r.effective_until is null or r.effective_until > p_cutoff_at)
      and exists (
        select 1 from public.record_assignments a
        where a.record_id = m.record_id
          and a.user_id = actor_id
          and a.is_active
          and a.assignment_function = any(roles)
          and (m.access_class <> 'restricted' or a.allow_restricted)
      )
    order by r.released_at desc, m.record_id asc;
  end if;
end;
$$;

-- =========================================================================
-- D-01: Repair eacsc_private.issue_bulletin
-- =========================================================================

create or replace function eacsc_private.issue_bulletin(
  p_bulletin_id text,
  p_issue_version integer,
  p_title text,
  p_coverage_start date,
  p_coverage_end date,
  p_cutoff_at timestamptz,
  p_audience text,
  p_source_snapshot jsonb,
  p_pdf_storage_key text,
  p_pdf_size_bytes bigint,
  p_pdf_sha256 text,
  p_publication_reference text,
  p_issuance_request_id uuid,
  p_corrects_issue_uuid uuid default null,
  p_correction_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  roles text[];
  prior_issue public.update_bulletins%rowtype;
  receipt eacsc_private.mutation_receipts%rowtype;

  archive_ver_id uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  now_ts timestamptz := clock_timestamp();
  saved_at timestamptz;
  title_val text := nullif(btrim(p_title), '');
  pub_ref_val text := nullif(btrim(p_publication_reference), '');
  corr_reason_val text := nullif(btrim(p_correction_reason), '');
  snapshot_count integer;
  verified_count integer;
  expected_key_prefix text;
  payload jsonb;
  response jsonb;
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Bulletin issuance is not permitted.';
  end if;

  if p_bulletin_id is null
    or p_bulletin_id !~ '^EACSC-[1-9][0-9]{3}-BUL-[0-9]{4}$'
    or right(p_bulletin_id, 4) = '0000'
    or p_issue_version is null or p_issue_version < 1
    or title_val is null or char_length(title_val) > 240
    or p_coverage_start is null
    or p_coverage_end is null
    or p_coverage_end < p_coverage_start
    or p_cutoff_at is null
    or (p_cutoff_at at time zone 'Asia/Manila')::date < p_coverage_end
    or p_audience not in ('public', 'internal')
    or p_source_snapshot is null or jsonb_typeof(p_source_snapshot) <> 'array'
    or jsonb_array_length(p_source_snapshot) = 0
    or p_pdf_storage_key is null or char_length(btrim(p_pdf_storage_key)) = 0
    or p_pdf_size_bytes is null or p_pdf_size_bytes not between 1 and 10000000
    or p_pdf_sha256 is null or p_pdf_sha256 !~ '^[0-9a-f]{64}$'
    or pub_ref_val is null
    or p_issuance_request_id is null
    or (p_issue_version = 1 and p_corrects_issue_uuid is not null)
    or (p_issue_version > 1 and (p_corrects_issue_uuid is null or corr_reason_val is null))
    or (p_corrects_issue_uuid is not null and corr_reason_val is null) then
    raise exception using errcode = '22023', message = 'Invalid bulletin issuance parameters.';
  end if;

  expected_key_prefix := 'bulletins/' || p_bulletin_id || '/v' || p_issue_version::text || '_';
  if left(p_pdf_storage_key, char_length(expected_key_prefix)) <> expected_key_prefix
    or right(p_pdf_storage_key, 4) <> '.pdf' then
    raise exception using errcode = '22023', message = 'Invalid bulletin archive storage key.';
  end if;

  if p_cutoff_at > now_ts + interval '5 seconds' then
    raise exception using errcode = '22023', message = 'Cutoff timestamp cannot be in the future when issuing an official bulletin.';
  end if;
  saved_at := greatest(now_ts, p_cutoff_at);

  payload := jsonb_build_object(
    'bulletin_id', p_bulletin_id,
    'issue_version', p_issue_version,
    'title', title_val,
    'coverage_start', p_coverage_start,
    'coverage_end', p_coverage_end,
    'cutoff_at', p_cutoff_at,
    'audience', p_audience,
    'source_snapshot', p_source_snapshot,
    'pdf_storage_key', p_pdf_storage_key,
    'pdf_sha256', p_pdf_sha256,
    'publication_reference', pub_ref_val,
    'corrects_issue_uuid', p_corrects_issue_uuid,
    'correction_reason', corr_reason_val
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'eacsc-mutation:' || actor_id::text || ':' || p_issuance_request_id::text, 0
  ));

  select functional_roles into roles
  from public.app_users
  where user_id = actor_id and is_active;

  if not found or not (roles && array['publisher', 'custodian']::text[]) or not exists (
    select 1 from auth.users
    where id = actor_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'Bulletin issuance is not permitted.';
  end if;

  select * into receipt
  from eacsc_private.mutation_receipts r
  where r.actor_user_id = actor_id
    and r.request_id = p_issuance_request_id;

  if found then
    if receipt.command_name <> 'issue_bulletin'
      or receipt.request_payload is distinct from payload then
      raise exception using errcode = '22023', message = 'Request ID was used for a different operation.';
    end if;
    return receipt.response_payload;
  end if;

  if exists (
    select 1 from public.update_bulletins
    where bulletin_id = p_bulletin_id
      and issue_version = p_issue_version
  ) then
    raise exception using errcode = 'PT409', message = 'This bulletin issue version already exists.';
  end if;

  -- Verify corrected prior bulletin issue when issuing v2+
  if p_corrects_issue_uuid is not null then
    select * into prior_issue
    from public.update_bulletins
    where issue_uuid = p_corrects_issue_uuid
      and bulletin_id = p_bulletin_id
    for update;

    if not found then
      raise exception using errcode = '22023', message = 'Corrected bulletin issue was not found for this bulletin ID.';
    end if;
  end if;

  -- Server-side verification of frozen source snapshot (prevents spoofing internal/withdrawn/future sources)
  snapshot_count := jsonb_array_length(p_source_snapshot);

  if exists (
    select 1
    from jsonb_array_elements(p_source_snapshot) as elem
    where jsonb_typeof(elem) <> 'object'
      or nullif(elem->>'release_id', '') is null
      or (elem->>'release_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or nullif(elem->>'record_id', '') is null
  ) then
    raise exception using errcode = '22023', message = 'Each bulletin source entry must reference a valid release and record ID.';
  end if;

  select count(distinct (elem->>'release_id')::uuid)
  into verified_count
  from jsonb_array_elements(p_source_snapshot) as elem
  join public.record_releases r
    on r.release_id = (elem->>'release_id')::uuid
    and r.record_id = (elem->>'record_id')
  join public.master_records m
    on m.record_id = r.record_id
  join public.record_versions v
    on v.record_id = r.record_id
    and v.version_id = r.version_id
  where v.state in ('Approved', 'Superseded')
    and r.withdrawn_at is null
    and r.released_at <= p_cutoff_at
    and r.effective_from <= p_cutoff_at
    and (r.released_at at time zone 'Asia/Manila')::date >= p_coverage_start
    and (r.effective_until is null or r.effective_until > p_cutoff_at)
    and (
      (p_audience = 'public' and m.access_class = 'public' and r.audience = 'public')
      or (
        p_audience = 'internal'
        and exists (
          select 1 from public.record_assignments a
          where a.record_id = m.record_id
            and a.user_id = actor_id
            and a.is_active
            and a.assignment_function = any(roles)
            and (m.access_class <> 'restricted' or a.allow_restricted)
        )
      )
    );

  if verified_count <> snapshot_count then
    raise exception using errcode = '22023', message = 'Bulletin sources include ineligible, duplicate, future-effective, or audience-mismatched releases.';
  end if;

  -- Verify private storage PDF exists before final transaction
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'verified-council-releases'
      and name = p_pdf_storage_key
  ) then
    raise exception using errcode = '55000', message = 'Preserved bulletin PDF object is not present in storage.';
  end if;

  -- 1. Ensure master record exists for the bulletin archive (fixed 9-col / 9-val alignment)
  if not exists (select 1 from public.master_records where record_id = p_bulletin_id) then
    insert into public.master_records (
      record_id, title, summary, category, document_type,
      originating_office, custodian_position, access_class, revision_counter
    )
    values (
      p_bulletin_id,
      title_val,
      'Official EA-CSC Update Bulletin issue archive for institutional traceability.',
      'Forms and official information',
      'Update bulletin',
      'EA-CSC Secretariat',
      'Council Secretary',
      case when p_audience = 'public' then 'public' else 'internal' end,
      1
    );
  else
    update public.master_records
    set title = title_val,
      revision_counter = revision_counter + 1,
      updated_at = greatest(saved_at, updated_at)
    where record_id = p_bulletin_id;
  end if;

  -- 2. Insert archive record version for the PDF
  insert into public.record_versions (
    version_id, record_id, version_number, revision_counter, state,
    previous_version_id, change_summary, correction_classification,
    storage_key, original_filename, mime_type,
    file_size_bytes, sha256, approved_at, approval_basis,
    approval_evidence_reference, approval_recorded_by
  )
  values (
    archive_ver_id,
    p_bulletin_id,
    p_issue_version,
    1,
    'Approved',
    case when p_corrects_issue_uuid is not null then prior_issue.archive_version_id else null end,
    case when p_corrects_issue_uuid is not null then 'Corrected issue: ' || corr_reason_val else 'Official issue: ' || title_val end,
    case when p_corrects_issue_uuid is not null then 'legitimate_change' else 'initial_capture' end,
    p_pdf_storage_key,
    p_bulletin_id || '_v' || p_issue_version::text || '.pdf',
    'application/pdf',
    p_pdf_size_bytes,
    p_pdf_sha256,
    saved_at,
    'Official bulletin issuance and publication check',
    pub_ref_val,
    actor_id
  );

  if p_corrects_issue_uuid is not null and prior_issue.archive_version_id is not null then
    update public.record_versions
    set state = 'Superseded',
      superseded_by_version_id = archive_ver_id,
      successor_version_id = archive_ver_id,
      revision_counter = revision_counter + 1,
      updated_at = greatest(saved_at, updated_at)
    where version_id = prior_issue.archive_version_id
      and state = 'Approved';
  end if;

  -- 3. Insert official update_bulletins record
  insert into public.update_bulletins (
    bulletin_id, issue_version, title, coverage_start, coverage_end, cutoff_at,
    audience, issue_status, source_snapshot, archive_record_id, archive_version_id,
    pdf_storage_key, pdf_size_bytes, pdf_sha256, prepared_by, issued_by, issued_at,
    publication_reference, issuance_request_id, corrects_issue_uuid, correction_reason,
    created_at, updated_at
  )
  values (
    p_bulletin_id,
    p_issue_version,
    title_val,
    p_coverage_start,
    p_coverage_end,
    p_cutoff_at,
    p_audience,
    'Issued',
    p_source_snapshot,
    p_bulletin_id,
    archive_ver_id,
    p_pdf_storage_key,
    p_pdf_size_bytes,
    p_pdf_sha256,
    actor_id,
    actor_id,
    saved_at,
    pub_ref_val,
    p_issuance_request_id,
    p_corrects_issue_uuid,
    corr_reason_val,
    saved_at,
    saved_at
  );

  -- 4. Audit event
  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id,
    action_type, action_summary, new_state, request_id
  )
  values (
    event_id,
    p_bulletin_id,
    archive_ver_id,
    actor_id,
    'bulletin.issued',
    'Issued official Update Bulletin ' || p_bulletin_id || ' v' || p_issue_version::text || '.',
    jsonb_build_object(
      'bulletin_id', p_bulletin_id,
      'issue_version', p_issue_version,
      'audience', p_audience,
      'issued_at', saved_at,
      'sources_count', snapshot_count,
      'corrects_issue_uuid', p_corrects_issue_uuid,
      'pdf_sha256', p_pdf_sha256
    ),
    p_issuance_request_id
  );

  response := jsonb_build_object(
    'request_id', p_issuance_request_id,
    'bulletin_id', p_bulletin_id,
    'issue_version', p_issue_version,
    'issue_uuid', (
      select b.issue_uuid from public.update_bulletins b
      where b.bulletin_id = p_bulletin_id and b.issue_version = p_issue_version
    ),
    'archive_version_id', archive_ver_id,
    'issued_at', saved_at,
    'audit_event_uuid', event_id
  );

  insert into eacsc_private.mutation_receipts (
    actor_user_id, request_id, command_name,
    request_payload, response_payload, audit_event_uuid
  )
  values (
    actor_id, p_issuance_request_id, 'issue_bulletin',
    payload, response, event_id
  );

  return response;
end;
$$;

-- =========================================================================
-- D-03: Repair publication activation, supersession chain, release protection, and withdrawal notice
-- =========================================================================

create or replace function eacsc_private.protect_record_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception using errcode = '55000', message = 'Release history cannot be deleted or truncated.';
  end if;

  if (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawal_reason' - 'activated_at' - 'effective_until')
     is distinct from
     (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawal_reason' - 'activated_at' - 'effective_until') then
    raise exception using errcode = '55000', message = 'Immutable release facts cannot be changed.';
  end if;

  if old.withdrawn_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception using errcode = '55000', message = 'A withdrawn release cannot be changed.';
  end if;

  if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
    raise exception using errcode = '55000', message = 'An activated release cannot be reactivated.';
  end if;

  if new.activated_at is not null and new.activated_at < new.effective_from then
    raise exception using errcode = '55000', message = 'Activation before effective time is forbidden.';
  end if;

  if old.effective_until is not null and new.effective_until is distinct from old.effective_until then
    raise exception using errcode = '55000', message = 'Release end time cannot be changed once closed.';
  end if;

  if new.effective_until is not null and new.effective_until <= new.effective_from then
    raise exception using errcode = '55000', message = 'Release end time must follow effective start time.';
  end if;

  return new;
end;
$$;

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
        if prior_release.effective_until is null then
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

-- Controlled scheduled release activation once effective_from is reached
create or replace function eacsc_private.activate_scheduled_release(
  p_release_id uuid,
  p_expected_record_revision integer,
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
  prior_release public.record_releases%rowtype;
  master_row public.master_records%rowtype;
  version_row public.record_versions%rowtype;
  receipt eacsc_private.mutation_receipts%rowtype;
  saved_at timestamptz;
  event_id uuid := gen_random_uuid();
  superseded_version_id uuid;
  payload jsonb;
  response jsonb;
begin
  if actor_id is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Scheduled activation is not permitted.';
  end if;

  if p_release_id is null or p_expected_record_revision is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'Provide release ID, expected record revision, and request ID.';
  end if;

  payload := jsonb_build_object(
    'release_id', p_release_id,
    'expected_record_revision', p_expected_record_revision
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'eacsc-mutation:' || actor_id::text || ':' || p_request_id::text, 0
  ));

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
    raise exception using errcode = '42501', message = 'Scheduled activation is not permitted.';
  end if;

  select * into rel_row
  from public.record_releases
  where release_id = p_release_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Scheduled activation is not permitted.';
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
    and assignment_function = 'publisher'
    and (master_row.access_class <> 'restricted' or allow_restricted)
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Scheduled activation is not permitted.';
  end if;

  select * into receipt
  from eacsc_private.mutation_receipts r
  where r.actor_user_id = actor_id
    and r.request_id = p_request_id;

  if found then
    if receipt.command_name <> 'activate_scheduled_release'
      or receipt.request_payload is distinct from payload then
      raise exception using errcode = '22023', message = 'Request ID was used for a different operation.';
    end if;
    return receipt.response_payload;
  end if;

  if rel_row.audience <> 'public' or master_row.access_class <> 'public' then
    raise exception using errcode = '22023', message = 'Only public scheduled releases can be activated for public catalog access.';
  end if;

  if rel_row.withdrawn_at is not null then
    raise exception using errcode = '55000', message = 'A withdrawn scheduled release cannot be activated.';
  end if;

  if rel_row.activated_at is not null then
    raise exception using errcode = '55000', message = 'This scheduled release is already activated.';
  end if;

  if rel_row.effective_from > clock_timestamp() then
    raise exception using errcode = '55000', message = 'Scheduled release effective time has not been reached yet.';
  end if;

  if master_row.revision_counter <> p_expected_record_revision then
    raise exception using errcode = 'PT409', message = 'Record changed. Reload before activating.';
  end if;

  select * into version_row
  from public.record_versions
  where version_id = rel_row.version_id
    and record_id = master_row.record_id
  for update;

  if not found or version_row.state <> 'Approved' then
    raise exception using errcode = '55000', message = 'Target version is no longer Approved for activation.';
  end if;

  saved_at := greatest(clock_timestamp(), rel_row.released_at, rel_row.effective_from, master_row.updated_at);

  if master_row.current_public_release_id is not null then
    select * into prior_release
    from public.record_releases
    where release_id = master_row.current_public_release_id
      and record_id = master_row.record_id
    for update;

    if found then
      if prior_release.effective_until is null then
        update public.record_releases
        set effective_until = greatest(saved_at, prior_release.effective_from + interval '1 millisecond')
        where release_id = prior_release.release_id;
      end if;

      if prior_release.version_id <> rel_row.version_id then
        update public.record_versions
        set state = 'Superseded',
          superseded_by_version_id = rel_row.version_id,
          successor_version_id = rel_row.version_id,
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

  update public.record_releases
  set activated_at = saved_at
  where release_id = p_release_id;

  update public.master_records
  set current_public_release_id = p_release_id,
    revision_counter = master_row.revision_counter + 1,
    updated_at = saved_at
  where record_id = master_row.record_id;

  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id,
    action_type, action_summary, previous_revision, new_revision,
    previous_state, new_state, request_id
  )
  values (
    event_id, master_row.record_id, rel_row.version_id, actor_id,
    'release.activated', 'Activated scheduled public release upon effective date.',
    master_row.revision_counter, master_row.revision_counter + 1,
    jsonb_build_object('current_public_release_id', master_row.current_public_release_id),
    jsonb_build_object('release_id', p_release_id, 'activated_at', saved_at, 'superseded_version_id', superseded_version_id),
    p_request_id
  );

  response := jsonb_build_object(
    'request_id', p_request_id,
    'release_id', p_release_id,
    'record_id', master_row.record_id,
    'version_id', rel_row.version_id,
    'activated_at', saved_at,
    'superseded_version_id', superseded_version_id,
    'record_revision', master_row.revision_counter + 1,
    'audit_event_uuid', event_id
  );

  insert into eacsc_private.mutation_receipts (
    actor_user_id, request_id, command_name,
    request_payload, response_payload, audit_event_uuid
  )
  values (
    actor_id, p_request_id, 'activate_scheduled_release',
    payload, response, event_id
  );

  return response;
end;
$$;

revoke all on function eacsc_private.activate_scheduled_release(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.activate_scheduled_release(uuid, integer, uuid)
  to authenticated;

create or replace function public.eacsc_activate_scheduled_release(
  p_release_id uuid,
  p_expected_record_revision integer,
  p_request_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select eacsc_private.activate_scheduled_release(
    p_release_id, p_expected_record_revision, p_request_id
  );
$$;

revoke all on function public.eacsc_activate_scheduled_release(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_activate_scheduled_release(uuid, integer, uuid)
  to authenticated;

-- Enforce activated_at check in public_release_file to match public_catalog
create or replace function eacsc_private.public_release_file(p_record_id text)
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
    and r.activated_at is not null
    and r.activated_at <= now()
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

-- Record safe public withdrawal notice when withdrawing an activated public release
create or replace function eacsc_private.withdraw_release(
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
    or p_expected_record_revision is null
    or reason_val is null
    or p_request_id is null then
    raise exception using errcode = '22023', message = 'Provide release ID, expected revision, withdrawal reason, and request ID.';
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

  if master_row.access_class = 'public'
    and rel_row.audience = 'public'
    and rel_row.release_id = master_row.current_public_release_id then
    insert into public.record_withdrawal_notices (
      release_id, record_id, notice, posted_at, posted_by
    )
    values (
      rel_row.release_id,
      master_row.record_id,
      left('Withdrawn from public release: ' || reason_val, 500),
      saved_at,
      actor_id
    )
    on conflict (release_id) do nothing;
  end if;

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

-- Safe backfill if any current public release was already issued without activated_at
do $$
begin
  update public.record_releases r
  set activated_at = greatest(r.released_at, r.effective_from)
  from public.master_records m
  where m.current_public_release_id = r.release_id
    and m.access_class = 'public'
    and r.audience = 'public'
    and r.withdrawn_at is null
    and r.activated_at is null
    and r.effective_from <= clock_timestamp();
end;
$$;

-- =========================================================================
-- D-04: Real public record detail and version history RPC
-- =========================================================================

create or replace function eacsc_private.public_record_detail(p_record_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m_row public.master_records%rowtype;
  cur_row jsonb;
  hist_rows jsonb;
  notice_row jsonb;
begin
  if p_record_id is null
    or p_record_id !~ '^EACSC-[1-9][0-9]{3}-[A-Z]{2,10}-[0-9]{4}$' then
    return null;
  end if;

  select * into m_row
  from public.master_records
  where record_id = p_record_id
    and access_class = 'public';

  if not found or m_row.current_public_release_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'record_id', m_row.record_id,
    'title', coalesce(r.public_title, m_row.title),
    'summary', m_row.summary,
    'category', coalesce(r.public_category, m_row.category),
    'document_type', m_row.document_type,
    'originating_office', m_row.originating_office,
    'public_contact', coalesce(m_row.public_contact, 'EA-CSC Secretariat'),
    'release_id', r.release_id,
    'version_id', v.version_id,
    'version_number', v.version_number,
    'state', v.state,
    'approved_at', v.approved_at,
    'released_at', coalesce(r.activated_at, r.released_at),
    'effective_at', r.effective_from,
    'change_summary', v.change_summary
  )
  into cur_row
  from public.record_releases r
  join public.record_versions v
    on v.record_id = r.record_id
    and v.version_id = r.version_id
  where r.release_id = m_row.current_public_release_id
    and r.record_id = m_row.record_id
    and r.audience = 'public'
    and v.state in ('Approved', 'Superseded')
    and r.withdrawn_at is null
    and r.activated_at is not null
    and r.activated_at <= now()
    and r.effective_from <= now()
    and (r.effective_until is null or now() < r.effective_until);

  if cur_row is null then
    select jsonb_build_object(
      'record_id', n.record_id,
      'notice', n.notice,
      'posted_at', n.posted_at
    )
    into notice_row
    from public.record_releases r
    join public.record_withdrawal_notices n
      on n.release_id = r.release_id
    where r.release_id = m_row.current_public_release_id
      and r.record_id = m_row.record_id
      and r.audience = 'public'
      and r.withdrawn_at is not null;

    if notice_row is null then
      return null;
    end if;

    return jsonb_build_object(
      'current', null,
      'history', '[]'::jsonb,
      'withdrawal_notice', notice_row
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'record_id', m_row.record_id,
        'title', coalesce(r.public_title, m_row.title),
        'summary', m_row.summary,
        'category', coalesce(r.public_category, m_row.category),
        'document_type', m_row.document_type,
        'originating_office', m_row.originating_office,
        'public_contact', coalesce(m_row.public_contact, 'EA-CSC Secretariat'),
        'release_id', r.release_id,
        'version_id', v.version_id,
        'version_number', v.version_number,
        'state', v.state,
        'approved_at', v.approved_at,
        'released_at', coalesce(r.activated_at, r.released_at),
        'effective_at', r.effective_from,
        'change_summary', v.change_summary
      )
      order by v.version_number desc, coalesce(r.activated_at, r.released_at) desc
    ),
    '[]'::jsonb
  )
  into hist_rows
  from public.record_releases r
  join public.record_versions v
    on v.record_id = r.record_id
    and v.version_id = r.version_id
  where r.record_id = m_row.record_id
    and r.audience = 'public'
    and r.withdrawn_at is null
    and r.activated_at is not null
    and r.release_id <> m_row.current_public_release_id
    and v.state = 'Superseded';

  return jsonb_build_object(
    'current', cur_row,
    'history', hist_rows,
    'withdrawal_notice', null
  );
end;
$$;

revoke all on function eacsc_private.public_record_detail(text)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.public_record_detail(text)
  to anon, authenticated;

create or replace function public.eacsc_public_record_detail(p_record_id text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select eacsc_private.public_record_detail(p_record_id);
$$;

revoke all on function public.eacsc_public_record_detail(text)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_public_record_detail(text)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
