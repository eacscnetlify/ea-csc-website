-- Batch 4: conservative, explicitly assigned record reads.
-- Run once as postgres in the development project's SQL Editor.
-- Does not create assignments, write commands, or public releases.
begin;

create schema eacsc_private;
revoke all on schema eacsc_private from public, anon, authenticated, service_role;
grant usage on schema eacsc_private to authenticated;

create table public.record_assignments (
  record_id varchar(50) not null
    references public.master_records (record_id) on delete restrict,
  user_id uuid not null
    references public.app_users (user_id) on delete restrict,
  assignment_function varchar(20) not null,
  is_active boolean not null default false,
  allow_restricted boolean not null default false,
  assigned_by uuid not null
    references public.app_users (user_id) on delete restrict,
  revision_counter integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (record_id, user_id, assignment_function),
  constraint record_assignments_function_allowed check (
    assignment_function in ('author', 'custodian', 'reviewer', 'approver', 'publisher')
  ),
  constraint record_assignments_revision_positive check (revision_counter >= 1),
  constraint record_assignments_timestamp_order check (updated_at >= created_at)
);

create index record_assignments_user_index
  on public.record_assignments (user_id, record_id);
create index record_assignments_assigner_index
  on public.record_assignments (assigned_by);

alter table public.record_assignments enable row level security;
alter table public.master_records enable row level security;
alter table public.record_versions enable row level security;

-- Membership checks run as the migration owner to avoid recursive RLS.
-- No caller-supplied user ID is accepted; identity comes from auth.uid().
create function eacsc_private.can_read_record(
  requested_record_id text,
  requested_version_state text default null,
  requested_function text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and (select auth.jwt() ->> 'is_anonymous') = 'false'
    and exists (
      select 1
      from public.record_assignments as assignment
      join public.app_users as officer
        on officer.user_id = assignment.user_id
      join public.master_records as master
        on master.record_id = assignment.record_id
      where assignment.record_id = requested_record_id
        and assignment.user_id = (select auth.uid())
        and assignment.is_active
        and officer.is_active
        and assignment.assignment_function = any (officer.functional_roles)
        and (
          requested_function is null
          or assignment.assignment_function = requested_function
        )
        and (
          master.access_class <> 'restricted'
          or assignment.allow_restricted
        )
        and (
          requested_version_state is null
          or assignment.assignment_function <> 'author'
          or requested_version_state = 'Draft'
        )
    );
$function$;

revoke all on function eacsc_private.can_read_record(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.can_read_record(text, text, text)
  to authenticated;

-- Explicit columns: no blanket table SELECT and no application writes.
revoke all on table public.record_assignments, public.master_records,
  public.record_versions from public, anon, authenticated, service_role;

grant select (
  record_id, user_id, assignment_function, is_active,
  allow_restricted, revision_counter
) on public.record_assignments to authenticated;

grant select (
  record_id, title, summary, category, document_type,
  originating_office, custodian_position, access_class, public_contact,
  record_date, retention_category, retention_review_on, retention_rule,
  revision_counter, created_at, updated_at
) on public.master_records to authenticated;

grant select (
  version_id, record_id, version_number, revision_counter, state,
  previous_version_id, change_summary, correction_classification,
  approved_at, created_at, updated_at
) on public.record_versions to authenticated;

create policy record_assignments_select_own
on public.record_assignments for select to authenticated
using (
  user_id = (select auth.uid())
  and is_active
  and eacsc_private.can_read_record(record_id, null, assignment_function)
);

create policy master_records_select_assigned
on public.master_records for select to authenticated
using (eacsc_private.can_read_record(record_id, null));

create policy record_versions_select_assigned
on public.record_versions for select to authenticated
using (eacsc_private.can_read_record(record_id, state));

comment on table public.record_assignments is
'Explicit per-record functional assignments. New assignments default inactive and cannot be written by application roles. This read foundation grants no editing, substantive approval, publication, or file access. Future assignment-management commands must authorize and audit changes.';
comment on column public.record_assignments.allow_restricted is
'Additional explicit permission required for restricted records; never inferred from a global role or custodian position.';
comment on function eacsc_private.can_read_record(text, text, text) is
'Private read-policy helper. Requires a permanent authenticated identity, a currently active profile, a currently active matching functional assignment, and restricted permission when applicable. Author-only version access is limited to Draft at this stage.';

notify pgrst, 'reload schema';
commit;
