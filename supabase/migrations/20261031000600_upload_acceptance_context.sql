-- Current-user context and acknowledgement recovery for the acceptance handler.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $owner$
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres.'; end if;
end;
$owner$;

create function eacsc_private.get_upload_acceptance(
  p_upload_id uuid,
  p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $context$
declare
  actor_id uuid := auth.uid();
  roles text[];
  item eacsc_private.upload_requests%rowtype;
  master_row public.master_records%rowtype;
  matched_function text;
  prior eacsc_private.mutation_receipts%rowtype;
begin
  if actor_id is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501',
      message = 'Upload acceptance is not permitted.';
  end if;

  if p_upload_id is null or p_request_id is null then
    raise exception using errcode = '22023',
      message = 'Provide upload and acceptance request IDs.';
  end if;

  select functional_roles into roles
  from public.app_users
  where user_id = actor_id and is_active
  for share;

  if not found then
    raise exception using errcode = '42501',
      message = 'Upload acceptance is not permitted.';
  end if;

  if not exists(
    select 1 from auth.users
    where id = actor_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  ) then
    raise exception using errcode = '42501',
      message = 'Upload acceptance is not permitted.';
  end if;

  select * into item
  from eacsc_private.upload_requests
  where upload_id = p_upload_id and actor_user_id = actor_id;

  if not found then
    raise exception using errcode = '42501',
      message = 'Upload acceptance is not permitted.';
  end if;

  select * into master_row
  from public.master_records
  where record_id = item.record_id
  for share;

  if not found then
    raise exception using errcode = '42501',
      message = 'Upload acceptance is not permitted.';
  end if;

  select assignment_function into matched_function
  from public.record_assignments
  where record_id = item.record_id
    and user_id = actor_id
    and is_active
    and assignment_function in ('author', 'custodian')
    and assignment_function = any(roles)
    and (master_row.access_class <> 'restricted' or allow_restricted)
  order by assignment_function
  limit 1
  for share;

  if not found then
    raise exception using errcode = '42501',
      message = 'Upload acceptance is not permitted.';
  end if;

  select * into prior
  from eacsc_private.mutation_receipts
  where actor_user_id = actor_id and request_id = p_request_id;

  if found then
    if prior.command_name <> 'accept_version_upload'
      or (prior.request_payload->>'upload_id')
        is distinct from p_upload_id::text then
      raise exception using errcode = '22023',
        message = 'This request ID belongs to a different operation.';
    end if;

    if matched_function = 'author' and not exists(
      select 1 from public.record_versions
      where version_id = item.proposed_version_id and state = 'Draft'
    ) then
      perform 1
      from public.record_assignments
      where record_id = item.record_id
        and user_id = actor_id
        and is_active
        and assignment_function = 'custodian'
        and 'custodian' = any(roles)
        and (master_row.access_class <> 'restricted' or allow_restricted)
      for share;

      if not found then
        raise exception using errcode = '42501',
          message = 'Upload acceptance is not permitted.';
      end if;
    end if;

    return jsonb_build_object(
      'status', 'accepted',
      'acknowledgement', prior.response_payload
    );
  end if;

  if exists(
    select 1 from eacsc_private.upload_dispositions
    where upload_id = p_upload_id
  ) then
    raise exception using errcode = 'PT409',
      message = 'This upload already has a terminal decision.';
  end if;

  if item.expires_at <= clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'Upload preparation expired. Prepare a new request.';
  end if;

  if master_row.revision_counter <> item.expected_record_revision
    or exists(
      select 1 from public.record_versions
      where version_id = item.proposed_version_id
    )
    or item.proposed_version_number <> (
      select coalesce(max(version_number)::bigint, 0) + 1
      from public.record_versions
      where record_id = item.record_id
    ) then
    raise exception using errcode = 'PT409',
      message = 'Record changed. Reload and prepare a new upload.';
  end if;

  return jsonb_build_object(
    'status', 'ready',
    'upload_id', item.upload_id,
    'actor_user_id', actor_id,
    'record_id', item.record_id,
    'proposed_version_id', item.proposed_version_id,
    'proposed_version_number', item.proposed_version_number,
    'bucket_id', item.bucket_id,
    'staging_key', item.staging_key,
    'destination_key', item.destination_key,
    'mime_type', item.mime_type,
    'file_size_bytes', item.file_size_bytes,
    'sha256', item.sha256
  );
end;
$context$;

revoke all on function eacsc_private.get_upload_acceptance(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.get_upload_acceptance(uuid,uuid)
  to authenticated;

create function public.eacsc_get_upload_acceptance(
  p_upload_id uuid,
  p_request_id uuid
)
returns jsonb language sql security invoker set search_path = ''
as $entry$
  select eacsc_private.get_upload_acceptance(p_upload_id, p_request_id);
$entry$;

revoke all on function public.eacsc_get_upload_acceptance(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_get_upload_acceptance(uuid,uuid)
  to authenticated;

comment on function public.eacsc_get_upload_acceptance(uuid,uuid) is
'Own upload only, with current permanent identity, active profile and assignment. Returns server-selected preparation facts or the same acceptance acknowledgement. Completed retries do not require an unexpired preparation. No Storage capability or write is granted.';

notify pgrst, 'reload schema';
commit;
