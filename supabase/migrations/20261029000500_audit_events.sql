begin;

create table public.audit_events (
  event_id bigint generated always as identity primary key,
  event_uuid uuid not null default gen_random_uuid(),

  record_id varchar(50),
  version_id uuid,
  actor_user_id uuid not null,

  action_type varchar(80) not null,
  action_summary text not null,

  previous_revision integer,
  new_revision integer,

  previous_state jsonb,
  new_state jsonb,

  request_id uuid,

  client_occurred_at timestamptz,
  server_occurred_at timestamptz not null default now(),

  constraint audit_events_event_uuid_unique
    unique (event_uuid),

  constraint audit_events_record_fk
    foreign key (record_id)
    references public.master_records (record_id)
    on delete restrict,

  constraint audit_events_version_same_record_fk
    foreign key (record_id, version_id)
    references public.record_versions (record_id, version_id)
    on delete restrict,

  constraint audit_events_actor_fk
    foreign key (actor_user_id)
    references public.app_users (user_id)
    on delete restrict,

  constraint audit_events_version_requires_record
    check (
      version_id is null
      or record_id is not null
    ),

  constraint audit_events_action_type_not_blank
    check (char_length(btrim(action_type)) > 0),

  constraint audit_events_action_summary_not_blank
    check (char_length(btrim(action_summary)) > 0),

  constraint audit_events_snapshots_are_objects
    check (
      (
        previous_state is null
        or jsonb_typeof(previous_state) = 'object'
      )
      and (
        new_state is null
        or jsonb_typeof(new_state) = 'object'
      )
    ),

  constraint audit_events_revisions_positive
    check (
      (
        previous_revision is null
        or previous_revision >= 1
      )
      and (
        new_revision is null
        or new_revision >= 1
      )
    )
);

create index audit_events_record_time_index
  on public.audit_events (
    record_id,
    server_occurred_at desc,
    event_id desc
  );

create index audit_events_version_index
  on public.audit_events (
    record_id,
    version_id
  );

create index audit_events_actor_time_index
  on public.audit_events (
    actor_user_id,
    server_occurred_at desc,
    event_id desc
  );

create index audit_events_request_index
  on public.audit_events (request_id)
  where request_id is not null;

alter table public.audit_events
  enable row level security;

revoke all privileges on table public.audit_events
  from public, anon, authenticated, service_role;

revoke all privileges on sequence public.audit_events_event_id_seq
  from public, anon, authenticated, service_role;

create function public.eacsc_stamp_audit_time()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.server_occurred_at := pg_catalog.now();
  return new;
end;
$function$;

create function public.eacsc_block_audit_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'Audit events are append-only. Record a new event instead of changing existing history.';
end;
$function$;

revoke all privileges
  on function public.eacsc_stamp_audit_time()
  from public, anon, authenticated, service_role;

revoke all privileges
  on function public.eacsc_block_audit_changes()
  from public, anon, authenticated, service_role;

create trigger audit_events_stamp_server_time
before insert on public.audit_events
for each row
execute function public.eacsc_stamp_audit_time();

create trigger audit_events_block_changes
before update or delete or truncate on public.audit_events
for each statement
execute function public.eacsc_block_audit_changes();

comment on table public.audit_events
is 'Append-only operational history. Protected backend commands must append each required event in the same transaction as the successful change. Direct application access is denied.';

comment on column public.audit_events.actor_user_id
is 'Named officer responsible for the operation. Future protected commands must derive and verify the actor from trusted authentication context.';

comment on column public.audit_events.previous_state
is 'Selected audit fields before the operation. Protected commands must explicitly choose the fields preserved here.';

comment on column public.audit_events.new_state
is 'Selected audit fields after the operation. Protected commands must explicitly choose the fields preserved here.';

comment on column public.audit_events.previous_revision
is 'Affected entity revision before the operation, when applicable. This field does not itself enforce concurrency control.';

comment on column public.audit_events.new_revision
is 'Affected entity revision after the operation, when applicable.';

comment on column public.audit_events.request_id
is 'Optional operation correlation ID. Multiple events may share one request ID; retry deduplication requires controlled commands and mutation receipts.';

comment on column public.audit_events.client_occurred_at
is 'Optional non-authoritative client timestamp. It must not determine official event ordering or authorization.';

comment on column public.audit_events.server_occurred_at
is 'Authoritative database transaction timestamp. The insert trigger replaces any supplied value with the database timestamp.';

comment on function public.eacsc_block_audit_changes()
is 'Rejects UPDATE, DELETE, and TRUNCATE statements against operational audit history.';

notify pgrst, 'reload schema';

commit;
