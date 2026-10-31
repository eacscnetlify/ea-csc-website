-- Batch 5: trusted-backend acceptance of verified original file bytes.
-- This migration performs no Storage writes and accepts no existing upload.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $owner$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this migration as postgres.';
  end if;
end;
$owner$;

-- One terminal decision per upload. Future cleanup must claim this row first.
create table eacsc_private.upload_dispositions (
  upload_id uuid primary key references eacsc_private.upload_requests(upload_id),
  disposition text not null,
  accepted_version_id uuid unique references public.record_versions(version_id),
  acceptance_request_id uuid,
  audit_event_uuid uuid unique references public.audit_events(event_uuid),
  decided_at timestamptz not null default now(),
  constraint upload_dispositions_shape check (
    (disposition = 'accepted' and accepted_version_id is not null
      and acceptance_request_id is not null and audit_event_uuid is not null)
    or (disposition = 'cleanup_authorized' and accepted_version_id is null
      and acceptance_request_id is null and audit_event_uuid is null)
  )
);
alter table eacsc_private.upload_dispositions enable row level security;
revoke all on eacsc_private.upload_dispositions
  from public, anon, authenticated, service_role;

create function eacsc_private.protect_upload_disposition()
returns trigger language plpgsql security invoker set search_path = ''
as $protect$
begin
  raise exception using errcode = '55000',
    message = 'Upload terminal decisions are immutable.';
end;
$protect$;
revoke all on function eacsc_private.protect_upload_disposition()
  from public, anon, authenticated, service_role;
create trigger upload_dispositions_protect_changes
before update or delete or truncate on eacsc_private.upload_dispositions
for each statement execute function eacsc_private.protect_upload_disposition();

create function eacsc_private.accept_version_upload(
  p_actor_user_id uuid, p_upload_id uuid, p_request_id uuid,
  p_storage_object_id uuid, p_verified_mime_type text,
  p_verified_file_size_bytes bigint, p_verified_sha256 text,
  p_verifier_version text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  item eacsc_private.upload_requests%rowtype;
  master_row public.master_records%rowtype;
  prior eacsc_private.mutation_receipts%rowtype;
  actor_roles text[];
  matched_function text;
  predecessor_id uuid;
  next_number bigint;
  payload jsonb;
  response jsonb;
  event_id uuid := gen_random_uuid();
begin
  if p_actor_user_id is null or p_upload_id is null or p_request_id is null
    or p_storage_object_id is null then
    raise exception using errcode = '22023', message = 'Provide all acceptance identifiers.';
  end if;
  -- This proof is trusted server input, never a browser verification claim.
  payload := jsonb_build_object(
    'upload_id', p_upload_id, 'storage_object_id', p_storage_object_id,
    'verified_mime_type', p_verified_mime_type,
    'verified_file_size_bytes', p_verified_file_size_bytes,
    'verified_sha256', p_verified_sha256, 'verifier_version', p_verifier_version
  );
  perform pg_advisory_xact_lock(hashtextextended(
    'eacsc-mutation:' || p_actor_user_id::text || ':' || p_request_id::text, 0
  ));

  select functional_roles into actor_roles from public.app_users
  where user_id = p_actor_user_id and is_active for share;
  if not found then
    raise exception using errcode = '42501', message = 'Upload acceptance is not permitted.';
  end if;
  if not exists (select 1 from auth.users where id = p_actor_user_id
    and is_anonymous is false and deleted_at is null
    and (banned_until is null or banned_until <= clock_timestamp())) then
    raise exception using errcode = '42501', message = 'Upload acceptance is not permitted.';
  end if;
  select * into item from eacsc_private.upload_requests
  where upload_id = p_upload_id and actor_user_id = p_actor_user_id;
  if not found then
    raise exception using errcode = '42501', message = 'Upload acceptance is not permitted.';
  end if;
  -- All version-creation commands must serialize on this parent row.
  select * into master_row from public.master_records
  where record_id = item.record_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'Upload acceptance is not permitted.';
  end if;
  select assignment_function into matched_function from public.record_assignments
  where record_id = item.record_id and user_id = p_actor_user_id and is_active
    and assignment_function in ('author', 'custodian')
    and assignment_function = any(actor_roles)
    and (master_row.access_class <> 'restricted' or allow_restricted)
  order by assignment_function limit 1 for share;
  if not found then
    raise exception using errcode = '42501', message = 'Upload acceptance is not permitted.';
  end if;

  -- Authority is checked even for a previously completed request.
  select * into prior from eacsc_private.mutation_receipts
  where actor_user_id = p_actor_user_id and request_id = p_request_id;
  if found then
    if prior.command_name <> 'accept_version_upload'
      or prior.request_payload is distinct from payload then
      raise exception using errcode = '22023',
        message = 'This request ID has already been used for a different operation.';
    end if;
    -- Authors may only recover the acknowledgement while they can read this version.
    if matched_function = 'author' and not exists (
      select 1 from public.record_versions where version_id = item.proposed_version_id
        and state = 'Draft'
    ) then
      perform 1 from public.record_assignments where record_id = item.record_id
        and user_id = p_actor_user_id and is_active
        and assignment_function = 'custodian' and 'custodian' = any(actor_roles)
        and (master_row.access_class <> 'restricted' or allow_restricted) for share;
      if not found then
        raise exception using errcode = '42501', message = 'Upload acceptance is not permitted.';
      end if;
    end if;
    return prior.response_payload;
  end if;

  -- Coordinates with a future cleanup command using the same upload lock.
  perform pg_advisory_xact_lock(hashtextextended('eacsc-upload:' || p_upload_id::text, 0));
  if exists (select 1 from eacsc_private.upload_dispositions where upload_id = p_upload_id) then
    raise exception using errcode = 'PT409', message = 'This upload already has a terminal decision.';
  end if;
  if item.expires_at <= clock_timestamp() then
    raise exception using errcode = '55000', message = 'Upload preparation expired. Prepare a new request.';
  end if;
  if master_row.revision_counter <> item.expected_record_revision then
    raise exception using errcode = 'PT409', message = 'Record changed. Reload and prepare a new upload.';
  end if;
  select coalesce(max(version_number)::bigint, 0) + 1 into next_number
  from public.record_versions where record_id = item.record_id;
  if next_number <> item.proposed_version_number
    or exists (select 1 from public.record_versions where version_id = item.proposed_version_id) then
    raise exception using errcode = 'PT409', message = 'The planned version is no longer available.';
  end if;
  if p_verified_mime_type is distinct from item.mime_type
    or p_verified_file_size_bytes is distinct from item.file_size_bytes
    or p_verified_sha256 is distinct from item.sha256
    or p_verifier_version is distinct from (case item.mime_type
      when 'application/pdf' then 'eacsc-pdf-structure-v1'
      when 'image/jpeg' then 'eacsc-image-structure-v1'
      when 'image/png' then 'eacsc-image-structure-v1'
      when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        then 'eacsc-docx-structure-v1' end) then
    raise exception using errcode = '22023', message = 'Verified file facts do not match the preparation.';
  end if;
  -- Read-only metadata check; bytes must already have been verified by the backend.
  if not exists (select 1 from storage.objects where id = p_storage_object_id
    and bucket_id = item.bucket_id and name = item.destination_key) then
    raise exception using errcode = '55000', message = 'The verified destination object is not present.';
  end if;
  select version_id into predecessor_id from public.record_versions
  where record_id = item.record_id order by version_number desc limit 1;

  insert into public.record_versions (
    version_id, record_id, version_number, revision_counter, state, previous_version_id,
    change_summary, correction_classification, storage_key, original_filename,
    mime_type, file_size_bytes, sha256
  ) values (
    item.proposed_version_id, item.record_id, item.proposed_version_number, 1, 'Draft', predecessor_id,
    item.change_summary, item.correction_classification, item.destination_key, item.original_filename,
    item.mime_type, item.file_size_bytes, item.sha256
  );
  update public.master_records set revision_counter = revision_counter + 1,
    updated_at = greatest(clock_timestamp(), updated_at) where record_id = item.record_id;
  response := jsonb_build_object(
    'upload_id', p_upload_id, 'request_id', p_request_id, 'record_id', item.record_id,
    'version_id', item.proposed_version_id, 'version_number', item.proposed_version_number,
    'version_revision', 1, 'state', 'Draft',
    'record_revision', master_row.revision_counter + 1,
    'accepted_version', true, 'audit_event_uuid', event_id
  );
  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id, action_type, action_summary,
    previous_revision, new_revision, previous_state, new_state, request_id
  ) values (
    event_id, item.record_id, item.proposed_version_id, p_actor_user_id,
    'version.upload_accepted', 'Accepted a verified private attachment as a new Draft version.',
    master_row.revision_counter, master_row.revision_counter + 1,
    jsonb_build_object('record_revision', master_row.revision_counter),
    jsonb_build_object('record_revision', master_row.revision_counter + 1,
      'upload_id', p_upload_id, 'version_number', item.proposed_version_number,
      'state', 'Draft', 'authorized_function', matched_function,
      'storage_object_id', p_storage_object_id, 'mime_type', item.mime_type,
      'file_size_bytes', item.file_size_bytes, 'sha256', item.sha256,
      'verifier_version', p_verifier_version), p_request_id
  );
  insert into eacsc_private.mutation_receipts (
    actor_user_id, request_id, command_name, request_payload, response_payload, audit_event_uuid
  ) values (p_actor_user_id, p_request_id, 'accept_version_upload', payload, response, event_id);
  insert into eacsc_private.upload_dispositions (
    upload_id, disposition, accepted_version_id, acceptance_request_id, audit_event_uuid
  ) values (p_upload_id, 'accepted', item.proposed_version_id, p_request_id, event_id);
  return response;
end;
$accept$;
revoke all on function eacsc_private.accept_version_upload(uuid,uuid,uuid,uuid,text,bigint,text,text)
  from public, anon, authenticated, service_role;
grant usage on schema eacsc_private to service_role;
grant execute on function eacsc_private.accept_version_upload(uuid,uuid,uuid,uuid,text,bigint,text,text)
  to service_role;

create function public.eacsc_accept_version_upload(
  p_actor_user_id uuid, p_upload_id uuid, p_request_id uuid,
  p_storage_object_id uuid, p_verified_mime_type text,
  p_verified_file_size_bytes bigint, p_verified_sha256 text,
  p_verifier_version text
)
returns jsonb language sql security invoker set search_path = ''
as $entry$
  select eacsc_private.accept_version_upload(
    p_actor_user_id, p_upload_id, p_request_id, p_storage_object_id,
    p_verified_mime_type, p_verified_file_size_bytes, p_verified_sha256, p_verifier_version
  );
$entry$;
revoke all on function public.eacsc_accept_version_upload(uuid,uuid,uuid,uuid,text,bigint,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_accept_version_upload(uuid,uuid,uuid,uuid,text,bigint,text,text)
  to service_role;

comment on function public.eacsc_accept_version_upload(uuid,uuid,uuid,uuid,text,bigint,text,text) is
'Trusted backend only. Backend must authenticate a permanent user, verify stored original bytes and persist them at the prepared final path before calling. Rechecks current authority and OCC. Atomically creates one Draft, parent revision, audit, retry receipt and terminal acceptance. Never approves or publishes.';
comment on table eacsc_private.upload_dispositions is
'Immutable terminal coordination facts. Future cleanup must take the eacsc-upload:<upload UUID> transaction advisory lock and claim cleanup_authorized only for expired, unaccepted, unreferenced uploads before any Storage deletion. Accepted final objects must never be deleted by cleanup.';
notify pgrst, 'reload schema';
commit;
