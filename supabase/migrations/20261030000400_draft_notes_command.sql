-- Batch 4: one controlled Draft mutation with OCC, audit and retry receipts.
-- Apply once as postgres after 20261030000300_record_read_access.sql.
begin;

create table eacsc_private.mutation_receipts (
  actor_user_id uuid not null references public.app_users(user_id) on delete restrict,
  request_id uuid not null,
  command_name varchar(80) not null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  audit_event_uuid uuid not null unique
    references public.audit_events(event_uuid) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, request_id),
  constraint mutation_receipts_command_not_blank
    check (char_length(btrim(command_name)) > 0),
  constraint mutation_receipts_payloads_are_objects
    check (jsonb_typeof(request_payload) = 'object'
      and jsonb_typeof(response_payload) = 'object')
);

alter table eacsc_private.mutation_receipts enable row level security;
revoke all on table eacsc_private.mutation_receipts
  from public, anon, authenticated, service_role;

create function eacsc_private.block_receipt_changes()
returns trigger language plpgsql security invoker set search_path = ''
as $function$
begin
  raise exception using errcode = '55000',
    message = 'Mutation receipts are immutable. Use a new request for a new operation.';
end;
$function$;
revoke all on function eacsc_private.block_receipt_changes()
  from public, anon, authenticated, service_role;

create trigger mutation_receipts_block_changes
before update or delete or truncate on eacsc_private.mutation_receipts
for each statement execute function eacsc_private.block_receipt_changes();

create function eacsc_private.update_draft_notes(
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
    raise exception using errcode = '40001',
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
    raise exception using errcode = '40001',
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

-- Public API entry point has caller privileges. All elevation is private and
-- the private implementation performs the complete authorization checks itself.
create function public.eacsc_update_draft_notes(
  p_version_id uuid,
  p_expected_revision integer,
  p_change_summary text,
  p_request_id uuid
)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
begin
  return eacsc_private.update_draft_notes(
    p_version_id, p_expected_revision, p_change_summary, p_request_id
  );
end;
$function$;

revoke all on function public.eacsc_update_draft_notes(uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_update_draft_notes(uuid, integer, text, uuid)
  to authenticated;

comment on table eacsc_private.mutation_receipts is
'Immutable successful-command receipts, keyed by actor and request ID. No direct application access. A retry must carry the same command and normalized payload; current authorization is checked before replay.';
comment on function public.eacsc_update_draft_notes(uuid, integer, text, uuid) is
'Updates only assigned Draft version notes. Requires current active author/custodian scope, expected edit revision and a request UUID. Revision increment, audit event and immutable retry receipt commit atomically. No actor, state, approval, file or publication input is accepted.';

notify pgrst, 'reload schema';
commit;
