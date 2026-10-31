-- Current authorization for the trusted staging handler.
-- Does not grant direct access to the preparation table.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $owner$
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;
end;
$owner$;

create function eacsc_private.get_upload_request(p_upload_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $access$
declare
  actor_id uuid := auth.uid();
  roles text[];
  item eacsc_private.upload_requests%rowtype;
  master_row public.master_records%rowtype;
  matching_function text;
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using
      errcode='42501',
      message='Upload access is not permitted.';
  end if;

  select functional_roles
  into roles
  from public.app_users
  where user_id=actor_id and is_active
  for share;

  if not found then
    raise exception using
      errcode='42501',
      message='Upload access is not permitted.';
  end if;

  select *
  into item
  from eacsc_private.upload_requests
  where upload_id=p_upload_id
    and actor_user_id=actor_id;

  if not found then
    raise exception using
      errcode='42501',
      message='Upload access is not permitted.';
  end if;

  select *
  into master_row
  from public.master_records
  where record_id=item.record_id
  for share;

  if not found then
    raise exception using
      errcode='42501',
      message='Upload access is not permitted.';
  end if;

  select assignment_function
  into matching_function
  from public.record_assignments
  where record_id=item.record_id
    and user_id=actor_id
    and is_active
    and assignment_function in ('author','custodian')
    and assignment_function=any(roles)
    and (
      master_row.access_class<>'restricted'
      or allow_restricted
    )
  order by assignment_function
  limit 1
  for share;

  if not found then
    raise exception using
      errcode='42501',
      message='Upload access is not permitted.';
  end if;

  if item.expires_at <= clock_timestamp() then
    raise exception using
      errcode='55000',
      message='Upload preparation expired. Prepare a new request.';
  end if;

  if master_row.revision_counter<>item.expected_record_revision then
    raise exception using
      errcode='PT409',
      message='Record changed. Prepare a new upload after reloading.';
  end if;

  if exists(
    select 1
    from public.record_versions
    where version_id=item.proposed_version_id
  ) then
    raise exception using
      errcode='55000',
      message='This upload has already been finalized.';
  end if;

  return jsonb_build_object(
    'upload_id',item.upload_id,
    'actor_user_id',actor_id,
    'record_id',item.record_id,
    'bucket_id',item.bucket_id,
    'staging_key',item.staging_key,
    'original_filename',item.original_filename,
    'mime_type',item.mime_type,
    'file_size_bytes',item.file_size_bytes,
    'sha256',item.sha256,
    'expires_at',item.expires_at
  );
end;
$access$;

revoke all on function eacsc_private.get_upload_request(uuid)
  from public,anon,authenticated,service_role;

grant execute on function eacsc_private.get_upload_request(uuid)
  to authenticated;

create function public.eacsc_get_upload_request(p_upload_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $entry$
  select eacsc_private.get_upload_request(p_upload_id);
$entry$;

revoke all on function public.eacsc_get_upload_request(uuid)
  from public,anon,authenticated,service_role;

grant execute on function public.eacsc_get_upload_request(uuid)
  to authenticated;

comment on function public.eacsc_get_upload_request(uuid) is
'Own prepared upload only. Rechecks current permanent identity, active profile and author/custodian assignment, restricted permission, record revision and expiry. Returns expected metadata, not a Storage upload capability.';

notify pgrst,'reload schema';
commit;
