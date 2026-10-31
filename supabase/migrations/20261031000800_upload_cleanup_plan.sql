-- Maintenance-only preview/claim. File deletion must use the Storage API.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $owner$
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres.'; end if;
end;
$owner$;

create function eacsc_private.plan_upload_cleanup(
  p_upload_id uuid,
  p_claim boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $cleanup$
declare
  item eacsc_private.upload_requests%rowtype;
  decision eacsc_private.upload_dispositions%rowtype;
  extension text;
  paths text[];
  existing_paths jsonb;
  expired boolean;
begin
  if p_upload_id is null or p_claim is null then
    raise exception using errcode = '22023',
      message = 'Provide an upload ID and explicit claim choice.';
  end if;

  select * into item
  from eacsc_private.upload_requests
  where upload_id = p_upload_id;

  if not found then
    raise exception using errcode = '22023',
      message = 'Upload request was not found.';
  end if;

  if p_claim then
    -- Same order as acceptance: parent lock before upload advisory lock.
    perform 1 from public.master_records
    where record_id = item.record_id
    for update;

    if not found then raise exception 'Upload parent is missing.'; end if;

    perform pg_advisory_xact_lock(
      hashtextextended('eacsc-upload:' || p_upload_id::text, 0)
    );
  end if;

  select * into decision
  from eacsc_private.upload_dispositions
  where upload_id = p_upload_id;

  extension := lower(substring(item.original_filename from '\.([^.]+)$'));

  if item.bucket_id <> 'internal-council-records'
    or extension is null
    or not (
      (extension = 'pdf' and item.mime_type = 'application/pdf')
      or (
        extension = 'docx'
        and item.mime_type =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
      or (extension in ('jpg','jpeg') and item.mime_type = 'image/jpeg')
      or (extension = 'png' and item.mime_type = 'image/png')
    )
    or item.staging_key <>
      'quarantine/' || item.actor_user_id::text || '/'
      || item.upload_id::text || '.' || extension
    or split_part(item.destination_key, '/', 1) not in (
      'governance','secretariat','activities','financial','forms','turnover'
    )
    or item.destination_key <>
      split_part(item.destination_key, '/', 1) || '/' || item.record_id
      || '/' || item.proposed_version_number::text
      || '_' || item.upload_id::text || '.' || extension then
    raise exception using errcode = '55000',
      message = 'Upload paths require inspection; cleanup is refused.';
  end if;

  if decision.disposition = 'accepted' then
    if decision.accepted_version_id is distinct from item.proposed_version_id
      or not exists(
        select 1 from public.record_versions
        where version_id = decision.accepted_version_id
          and record_id = item.record_id
          and version_number = item.proposed_version_number
          and storage_key = item.destination_key
      ) then
      raise exception using errcode = '55000',
        message = 'Accepted version facts require inspection; cleanup is refused.';
    end if;

    -- An accepted final object is never a cleanup candidate.
    paths := array[item.staging_key];
  else
    if decision.disposition is not null
      and decision.disposition <> 'cleanup_authorized' then
      raise exception using errcode = '55000',
        message = 'Unsupported terminal decision.';
    end if;

    if exists(
      select 1 from public.record_versions
      where version_id = item.proposed_version_id
    ) then
      raise exception using errcode = '55000',
        message = 'An official version exists; cleanup is refused.';
    end if;

    paths := array[item.staging_key, item.destination_key];
  end if;

  if exists(
    select 1 from public.record_versions
    where storage_key = any(paths)
  ) then
    raise exception using errcode = '55000',
      message = 'A cleanup path is referenced by an official version.';
  end if;

  expired := item.expires_at <= clock_timestamp();

  if p_claim then
    if not expired then
      raise exception using errcode = '55000',
        message = 'Preparation has not expired; cleanup is not authorized.';
    end if;

    if decision.disposition is null then
      insert into eacsc_private.upload_dispositions(upload_id, disposition)
      values(p_upload_id, 'cleanup_authorized');

      decision.disposition := 'cleanup_authorized';
    end if;
  end if;

  select coalesce(jsonb_agg(o.name order by o.name), '[]'::jsonb)
  into existing_paths
  from storage.objects o
  where o.bucket_id = item.bucket_id and o.name = any(paths);

  return jsonb_build_object(
    'upload_id', item.upload_id,
    'preparation_request_id', item.request_id,
    'record_id', item.record_id,
    'bucket_id', item.bucket_id,
    'terminal_decision', coalesce(decision.disposition, 'none'),
    'expires_at', item.expires_at,
    'eligible', expired,
    'deletion_authorized', p_claim and expired,
    'candidate_paths', to_jsonb(paths),
    'existing_candidates', existing_paths,
    'preserved_final_key',
      case when decision.disposition = 'accepted'
        then item.destination_key else null end
  );
end;
$cleanup$;

revoke all on function eacsc_private.plan_upload_cleanup(uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.plan_upload_cleanup(uuid,boolean)
  to service_role;

create function public.eacsc_plan_upload_cleanup(
  p_upload_id uuid,
  p_claim boolean default false
)
returns jsonb language sql security invoker set search_path = ''
as $entry$
  select eacsc_private.plan_upload_cleanup(p_upload_id, p_claim);
$entry$;

revoke all on function public.eacsc_plan_upload_cleanup(uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_plan_upload_cleanup(uuid,boolean)
  to service_role;

comment on function public.eacsc_plan_upload_cleanup(uuid,boolean) is
'Maintenance only. False previews without data changes. True rechecks expiry and references, serializes with acceptance, and terminally blocks unaccepted uploads before Storage deletion. Accepted final objects are always preserved; only their staging copy may be cleaned. Never deletes Storage metadata, files, versions, audits or receipts. Repeat cleanup can collect late in-flight orphan writes.';

notify pgrst, 'reload schema';
commit;
