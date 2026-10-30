-- Correct application edit conflicts: PT409 maps to HTTP 409 without declaring
-- a database serialization failure. Some PostgREST versions retry 40001 forever.
-- Apply ONCE after 20261030000400. Preserve all existing records/audits/receipts.
-- Stop any abandoned retrying API request before applying this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $prerequisite$
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres in the development project.'; end if;
  if to_regprocedure('eacsc_private.update_draft_notes(uuid,integer,text,uuid)') is null then
    raise exception 'Apply the original Draft notes command migration first.';
  end if;
end;
$prerequisite$;

create or replace function eacsc_private.update_draft_notes(
  p_version_id uuid,
  p_expected_revision integer,
  p_change_summary text,
  p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_roles text[];
  parent_id text;
  classification text;
  matched_function text;
  normalized_summary text;
  payload jsonb;
  prior_receipt eacsc_private.mutation_receipts%rowtype;
  prior_version public.record_versions%rowtype;
  saved_revision integer;
  saved_at timestamptz;
  created_event_uuid uuid := pg_catalog.gen_random_uuid();
  response jsonb;
begin
  if actor_id is null
    or (auth.jwt() ->> 'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Draft update is not permitted.';
  end if;

  if p_version_id is null or p_request_id is null
    or p_expected_revision is null or p_expected_revision < 1
    or p_expected_revision >= 2147483647
    or p_change_summary is null
    or char_length(p_change_summary) > 2000
    or p_change_summary !~ '[^[:space:]]' then
    raise exception using errcode = '22023',
      message = 'Provide a version, positive edit revision, request ID and nonblank notes of at most 2000 characters.';
  end if;

  normalized_summary := pg_catalog.btrim(p_change_summary);
  payload := pg_catalog.jsonb_build_object(
    'version_id', p_version_id,
    'expected_revision', p_expected_revision,
    'change_summary', normalized_summary
  );

  -- Serialize the same actor/request pair; a hash collision only adds waiting.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'eacsc-mutation:' || actor_id::text || ':' || p_request_id::text, 0
  ));

  -- Lock order: profile -> master -> matching assignment -> version.
  -- Recheck current database permissions even when returning a retry receipt.
  select profile.functional_roles into actor_roles
  from public.app_users as profile
  where profile.user_id = actor_id and profile.is_active
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Draft update is not permitted.';
  end if;

  select version.record_id into parent_id
  from public.record_versions as version where version.version_id = p_version_id;
  if not found then
    raise exception using errcode = '42501', message = 'Draft update is not permitted.';
  end if;

  select master.access_class into classification
  from public.master_records as master where master.record_id = parent_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Draft update is not permitted.';
  end if;

  select assignment.assignment_function into matched_function
  from public.record_assignments as assignment
  where assignment.record_id = parent_id
    and assignment.user_id = actor_id
    and assignment.is_active
    and assignment.assignment_function in ('author', 'custodian')
    and assignment.assignment_function = any(actor_roles)
    and (classification <> 'restricted' or assignment.allow_restricted)
  order by assignment.assignment_function
  limit 1 for share;
  if not found then
    raise exception using errcode = '42501', message = 'Draft update is not permitted.';
  end if;

  select version.* into prior_version
  from public.record_versions as version
  where version.version_id = p_version_id and version.record_id = parent_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Draft update is not permitted.';
  end if;
  if prior_version.state <> 'Draft' then
    raise exception using errcode = '55000', message = 'Only Draft version notes can be edited.';
  end if;
  select receipt.* into prior_receipt
  from eacsc_private.mutation_receipts as receipt
  where receipt.actor_user_id = actor_id and receipt.request_id = p_request_id;
  if found then
    if prior_receipt.command_name <> 'update_draft_notes'
      or prior_receipt.request_payload is distinct from payload then
      raise exception using errcode = '22023',
        message = 'This request ID has already been used for a different operation.';
    end if;
    return prior_receipt.response_payload;
  end if;

  if prior_version.revision_counter <> p_expected_revision then
    raise exception using errcode = 'PT409',
      message = 'Edit conflict. Reload this version before making another change.';
  end if;
  if prior_version.change_summary = normalized_summary then
    raise exception using errcode = '22023', message = 'The notes have not changed.';
  end if;

  update public.record_versions as version
  set change_summary = normalized_summary,
    revision_counter = prior_version.revision_counter + 1,
    updated_at = greatest(pg_catalog.clock_timestamp(), prior_version.updated_at)
  where version.version_id = p_version_id and version.record_id = parent_id
    and version.state = 'Draft' and version.revision_counter = p_expected_revision
  returning version.revision_counter, version.updated_at into saved_revision, saved_at;
  if not found then
    raise exception using errcode = 'PT409',
      message = 'Edit conflict. Reload this version before making another change.';
  end if;

  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id, action_type, action_summary,
    previous_revision, new_revision, previous_state, new_state, request_id
  ) values (
    created_event_uuid, parent_id, p_version_id, actor_id,
    'draft.notes_updated', 'Updated Draft version notes.',
    prior_version.revision_counter, saved_revision,
    pg_catalog.jsonb_build_object(
      'version_id', p_version_id, 'record_id', parent_id,
      'state', prior_version.state, 'change_summary', prior_version.change_summary,
      'revision_counter', prior_version.revision_counter, 'updated_at', prior_version.updated_at
    ),
    pg_catalog.jsonb_build_object(
      'version_id', p_version_id, 'record_id', parent_id,
      'state', 'Draft', 'change_summary', normalized_summary,
      'revision_counter', saved_revision, 'updated_at', saved_at
    ),
    p_request_id
  );

  response := pg_catalog.jsonb_build_object(
    'version_id', p_version_id, 'record_id', parent_id,
    'state', 'Draft', 'change_summary', normalized_summary,
    'revision_counter', saved_revision, 'updated_at', saved_at,
    'audit_event_uuid', created_event_uuid, 'request_id', p_request_id
  );
  insert into eacsc_private.mutation_receipts (
    actor_user_id, request_id, command_name, request_payload, response_payload, audit_event_uuid
  ) values (
    actor_id, p_request_id, 'update_draft_notes', payload, response, created_event_uuid
  );
  return response;
end;
$function$;

revoke all on function eacsc_private.update_draft_notes(uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.update_draft_notes(uuid, integer, text, uuid)
  to authenticated;

comment on function public.eacsc_update_draft_notes(uuid, integer, text, uuid) is
'Updates assigned Draft notes with current active author/custodian scope, expected revision, audit and immutable retry receipt. Application revision conflicts return PT409 / HTTP 409; no actor, approval, state, file or publication input is accepted.';

notify pgrst, 'reload schema';
commit;
