-- Batch 5: currently authorized officer access to accepted version file facts.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $owner$
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres.'; end if;
end;
$owner$;

create function eacsc_private.get_version_file(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $file$
declare
  actor_id uuid := auth.uid();
  roles text[];
  parent_id text;
  classification text;
  matched_function text;
  version_row public.record_versions%rowtype;
  upload_row eacsc_private.upload_requests%rowtype;
begin
  if actor_id is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501',
      message = 'File access is not permitted.';
  end if;

  if p_version_id is null then
    raise exception using errcode = '22023', message = 'Provide a version ID.';
  end if;

  select functional_roles into roles
  from public.app_users
  where user_id = actor_id and is_active
  for share;

  if not found then
    raise exception using errcode = '42501',
      message = 'File access is not permitted.';
  end if;

  if not exists(
    select 1 from auth.users
    where id = actor_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  ) then
    raise exception using errcode = '42501',
      message = 'File access is not permitted.';
  end if;

  select record_id into parent_id
  from public.record_versions
  where version_id = p_version_id;

  if not found then
    raise exception using errcode = '42501',
      message = 'File access is not permitted.';
  end if;

  select access_class into classification
  from public.master_records
  where record_id = parent_id
  for share;

  if not found then
    raise exception using errcode = '42501',
      message = 'File access is not permitted.';
  end if;

  select assignment_function into matched_function
  from public.record_assignments
  where record_id = parent_id
    and user_id = actor_id
    and is_active
    and assignment_function = any(roles)
    and (classification <> 'restricted' or allow_restricted)
    and (
      assignment_function <> 'author'
      or exists(
        select 1 from public.record_versions
        where version_id = p_version_id and state = 'Draft'
      )
    )
  order by assignment_function
  limit 1
  for share;

  if not found then
    raise exception using errcode = '42501',
      message = 'File access is not permitted.';
  end if;

  select * into version_row
  from public.record_versions
  where version_id = p_version_id and record_id = parent_id
  for share;

  if not found
    or (matched_function = 'author' and version_row.state <> 'Draft') then
    raise exception using errcode = '42501',
      message = 'File access is not permitted.';
  end if;

  select u.* into upload_row
  from eacsc_private.upload_requests u
  join eacsc_private.upload_dispositions d on d.upload_id = u.upload_id
  where d.disposition = 'accepted'
    and d.accepted_version_id = p_version_id
    and u.proposed_version_id = p_version_id
    and u.record_id = parent_id
    and u.proposed_version_number = version_row.version_number
    and u.destination_key = version_row.storage_key
    and u.original_filename = version_row.original_filename
    and u.mime_type = version_row.mime_type
    and u.file_size_bytes = version_row.file_size_bytes
    and u.sha256 = version_row.sha256;

  if not found then
    raise exception using errcode = '55000',
      message = 'No accepted file is available for this version.';
  end if;

  return jsonb_build_object(
    'version_id', version_row.version_id,
    'record_id', parent_id,
    'version_number', version_row.version_number,
    'revision_counter', version_row.revision_counter,
    'state', version_row.state,
    'upload_id', upload_row.upload_id,
    'bucket_id', upload_row.bucket_id,
    'storage_key', version_row.storage_key,
    'original_filename', version_row.original_filename,
    'mime_type', version_row.mime_type,
    'file_size_bytes', version_row.file_size_bytes,
    'sha256', version_row.sha256
  );
end;
$file$;

revoke all on function eacsc_private.get_version_file(uuid)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.get_version_file(uuid)
  to authenticated;

create function public.eacsc_get_version_file(p_version_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $entry$
  select eacsc_private.get_version_file(p_version_id);
$entry$;

revoke all on function public.eacsc_get_version_file(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_get_version_file(uuid)
  to authenticated;

comment on function public.eacsc_get_version_file(uuid) is
'Current officer version-read scope only. Requires permanent identity, active profile and matching active assignment, restricted permission when needed, and an accepted file with matching preparation facts. Author-only scope is Draft. Returns metadata, not a Storage capability. No anonymous release download is provided here.';

notify pgrst, 'reload schema';
commit;
