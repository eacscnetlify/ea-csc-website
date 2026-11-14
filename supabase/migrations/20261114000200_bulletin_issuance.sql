-- Batch 8, part 2: atomic bulletin issuance, archive registration, and public access.
-- Apply once as postgres in ea-csc-website-dev.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;

  if to_regprocedure('public.eacsc_list_bulletin_candidates(text,date,timestamptz)') is null then
    raise exception 'Apply 20261114000100_bulletin_candidates.sql first.';
  end if;
end;
$$;

create function eacsc_private.issue_bulletin(
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
  existing_bulletin public.update_bulletins%rowtype;
  receipt eacsc_private.mutation_receipts%rowtype;

  archive_ver_id uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  saved_at timestamptz := clock_timestamp();
  title_val text := nullif(btrim(p_title), '');
  pub_ref_val text := nullif(btrim(p_publication_reference), '');
  corr_reason_val text := nullif(btrim(p_correction_reason), '');
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
    or (p_corrects_issue_uuid is not null and corr_reason_val is null) then
    raise exception using errcode = '22023', message = 'Invalid bulletin issuance parameters.';
  end if;

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

  -- Verify private storage PDF exists before final transaction
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'verified-council-releases'
      and name = p_pdf_storage_key
  ) then
    raise exception using errcode = '55000', message = 'Preserved bulletin PDF object is not present in storage.';
  end if;

  -- 1. Ensure master record exists for the bulletin archive
  if not exists (select 1 from public.master_records where record_id = p_bulletin_id) then
    insert into public.master_records (
      record_id, title, summary, category, document_type,
      originating_office, custodian_position, access_class, revision_counter
    )
    values (
      p_bulletin_id,
      title_val,
      'Forms and official information',
      'Update bulletin',
      'EA-CSC Secretariat',
      'Council Secretary',
      case when p_audience = 'public' then 'public' else 'internal' end,
      1
    );
  else
    update public.master_records
    set revision_counter = revision_counter + 1,
      updated_at = saved_at
    where record_id = p_bulletin_id;
  end if;

  -- 2. Insert archive record version for the PDF
  insert into public.record_versions (
    version_id, record_id, version_number, revision_counter, state,
    change_summary, storage_key, original_filename, mime_type,
    file_size_bytes, sha256, approved_at, approval_basis,
    approval_evidence_reference, approval_recorded_by
  )
  values (
    archive_ver_id,
    p_bulletin_id,
    p_issue_version,
    1,
    'Approved',
    'Official issue: ' || title_val,
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
      'sources_count', jsonb_array_length(p_source_snapshot),
      'pdf_sha256', p_pdf_sha256
    ),
    p_issuance_request_id
  );

  response := jsonb_build_object(
    'request_id', p_issuance_request_id,
    'bulletin_id', p_bulletin_id,
    'issue_version', p_issue_version,
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

revoke all on function eacsc_private.issue_bulletin(
  text, integer, text, date, date, timestamptz, text, jsonb, text, bigint, text, text, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function eacsc_private.issue_bulletin(
  text, integer, text, date, date, timestamptz, text, jsonb, text, bigint, text, text, uuid, uuid, text
) to authenticated;

create function public.eacsc_issue_bulletin(
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
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.issue_bulletin(
    p_bulletin_id, p_issue_version, p_title, p_coverage_start, p_coverage_end,
    p_cutoff_at, p_audience, p_source_snapshot, p_pdf_storage_key,
    p_pdf_size_bytes, p_pdf_sha256, p_publication_reference,
    p_issuance_request_id, p_corrects_issue_uuid, p_correction_reason
  );
$$;

revoke all on function public.eacsc_issue_bulletin(
  text, integer, text, date, date, timestamptz, text, jsonb, text, bigint, text, text, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.eacsc_issue_bulletin(
  text, integer, text, date, date, timestamptz, text, jsonb, text, bigint, text, text, uuid, uuid, text
) to authenticated;

-- Public list of issued bulletins
create function eacsc_private.public_bulletins(p_limit integer, p_offset integer)
returns table (
  bulletin_id text,
  issue_version integer,
  title text,
  coverage_start date,
  coverage_end date,
  cutoff_at timestamptz,
  issued_at timestamptz,
  sources_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Invalid limit or offset.';
  end if;

  return query
  select
    b.bulletin_id::text,
    b.issue_version,
    b.title::text,
    b.coverage_start,
    b.coverage_end,
    b.cutoff_at,
    b.issued_at,
    jsonb_array_length(b.source_snapshot)::integer as sources_count
  from public.update_bulletins b
  where b.audience = 'public'
    and b.issue_status = 'Issued'
    and b.withdrawn_at is null
  order by b.issued_at desc, b.issue_version desc
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function eacsc_private.public_bulletins(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.public_bulletins(integer, integer)
  to anon, authenticated;

create function public.eacsc_public_bulletins(
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  bulletin_id text,
  issue_version integer,
  title text,
  coverage_start date,
  coverage_end date,
  cutoff_at timestamptz,
  issued_at timestamptz,
  sources_count integer
)
language sql stable security invoker set search_path = ''
as $$
  select * from eacsc_private.public_bulletins(p_limit, p_offset);
$$;

revoke all on function public.eacsc_public_bulletins(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_public_bulletins(integer, integer)
  to anon, authenticated;

-- Look up preserved bulletin PDF facts for Edge Function download
create function eacsc_private.bulletin_file_facts(p_bulletin_id text, p_issue_version integer)
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
    'bulletin_id', b.bulletin_id,
    'issue_version', b.issue_version,
    'audience', b.audience,
    'bucket_id', 'verified-council-releases',
    'storage_key', b.pdf_storage_key,
    'file_size_bytes', b.pdf_size_bytes,
    'sha256', b.pdf_sha256,
    'withdrawn_at', b.withdrawn_at
  )
  into result
  from public.update_bulletins b
  where b.bulletin_id = p_bulletin_id
    and b.issue_version = p_issue_version
    and b.issue_status in ('Issued', 'Withdrawn');

  if result is null then
    raise exception using errcode = '55000', message = 'Bulletin artifact unavailable.';
  end if;

  return result;
end;
$$;

revoke all on function eacsc_private.bulletin_file_facts(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.bulletin_file_facts(text, integer)
  to service_role;

create function public.eacsc_bulletin_file_facts(p_bulletin_id text, p_issue_version integer)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.bulletin_file_facts(p_bulletin_id, p_issue_version);
$$;

revoke all on function public.eacsc_bulletin_file_facts(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_bulletin_file_facts(text, integer)
  to service_role;

notify pgrst, 'reload schema';
commit;
