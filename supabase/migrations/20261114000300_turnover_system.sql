-- Batch 9, part 1: turnover packages, continuity memorandum, acknowledgments, and role transfer.
-- Apply once as postgres in ea-csc-website-dev.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;

  if to_regprocedure('public.eacsc_issue_bulletin(text,integer,text,date,date,timestamptz,text,jsonb,text,bigint,text,text,uuid,uuid,text)') is null then
    raise exception 'Apply Batch 8 migrations first.';
  end if;
end;
$$;

create table public.turnover_packages (
  package_id uuid primary key default gen_random_uuid(),
  position_title varchar(160) not null,
  term_covered varchar(120) not null,
  outgoing_officer_id uuid not null references public.app_users(user_id),
  incoming_officer_id uuid references public.app_users(user_id),
  status varchar(20) not null default 'draft' check (status in ('draft', 'acknowledged', 'archived')),

  -- Institutional Continuity Memorandum contents (Proposal Section 3.5.1 / Appendix C)
  ongoing_projects text not null default '',
  critical_deadlines text not null default '',
  official_contacts text not null default '',
  operational_lessons text not null default '',
  known_exceptions text not null default '',

  revision_counter integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint turnover_packages_position_not_blank check (char_length(btrim(position_title)) > 0),
  constraint turnover_packages_term_not_blank check (char_length(btrim(term_covered)) > 0)
);

create table public.turnover_acknowledgments (
  ack_id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.turnover_packages(package_id) on delete restrict,
  outgoing_officer_id uuid not null references public.app_users(user_id),
  incoming_officer_id uuid not null references public.app_users(user_id),
  exceptions_summary text not null default '',
  acknowledged_at timestamptz not null default clock_timestamp(),
  audit_event_uuid uuid not null unique references public.audit_events(event_uuid),
  request_id uuid not null unique
);

alter table public.turnover_packages enable row level security;
alter table public.turnover_acknowledgments enable row level security;

revoke all on public.turnover_packages, public.turnover_acknowledgments
  from public, anon, authenticated, service_role;
grant select on public.turnover_packages, public.turnover_acknowledgments
  to authenticated;

create policy turnover_packages_select on public.turnover_packages
  for select to authenticated
  using (
    outgoing_officer_id = auth.uid()
    or incoming_officer_id = auth.uid()
    or exists (
      select 1 from public.app_users u
      where u.user_id = auth.uid()
        and u.is_active
        and 'technical_admin' = any(u.functional_roles)
    )
  );

create policy turnover_ack_select on public.turnover_acknowledgments
  for select to authenticated
  using (
    outgoing_officer_id = auth.uid()
    or incoming_officer_id = auth.uid()
    or exists (
      select 1 from public.app_users u
      where u.user_id = auth.uid()
        and u.is_active
        and 'technical_admin' = any(u.functional_roles)
    )
  );

-- 1. Aggregate position inventory
create function eacsc_private.get_position_inventory(p_position text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  records_json jsonb;
begin
  if actor_id is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'record_id', m.record_id,
      'title', m.title,
      'category', m.category,
      'document_type', m.document_type,
      'access_class', m.access_class,
      'custodian_position', m.custodian_position,
      'revision', m.revision_counter,
      'versions_count', (
        select count(*) from public.record_versions v where v.record_id = m.record_id
      ),
      'current_state', coalesce((
        select v.state from public.record_versions v
        where v.record_id = m.record_id
        order by v.version_number desc limit 1
      ), 'Draft')
    ) order by m.record_id
  ), '[]'::jsonb)
  into records_json
  from public.master_records m
  where m.custodian_position ilike '%' || btrim(p_position) || '%'
    or p_position is null or btrim(p_position) = '';

  return jsonb_build_object(
    'position_queried', coalesce(p_position, 'All positions'),
    'inventory', records_json
  );
end;
$$;

revoke all on function eacsc_private.get_position_inventory(text) from public, anon, authenticated, service_role;
grant execute on function eacsc_private.get_position_inventory(text) to authenticated;

create function public.eacsc_get_position_inventory(p_position text)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.get_position_inventory(p_position);
$$;

revoke all on function public.eacsc_get_position_inventory(text) from public, anon, authenticated, service_role;
grant execute on function public.eacsc_get_position_inventory(text) to authenticated;

-- 2. Save/Update continuity memorandum
create function eacsc_private.save_turnover_package(
  p_package_id uuid,
  p_position_title text,
  p_term_covered text,
  p_incoming_officer_id uuid,
  p_ongoing_projects text,
  p_critical_deadlines text,
  p_official_contacts text,
  p_operational_lessons text,
  p_known_exceptions text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  pkg_id uuid := coalesce(p_package_id, gen_random_uuid());
  existing_row public.turnover_packages%rowtype;
  saved_at timestamptz := clock_timestamp();
begin
  if actor_id is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_position_title is null or char_length(btrim(p_position_title)) = 0
    or p_term_covered is null or char_length(btrim(p_term_covered)) = 0 then
    raise exception using errcode = '22023', message = 'Position title and term covered are required.';
  end if;

  if p_package_id is not null then
    select * into existing_row from public.turnover_packages where package_id = p_package_id for update;
    if not found or existing_row.outgoing_officer_id <> actor_id then
      raise exception using errcode = '42501', message = 'Package not found or permission denied.';
    end if;

    update public.turnover_packages
    set position_title = btrim(p_position_title),
      term_covered = btrim(p_term_covered),
      incoming_officer_id = p_incoming_officer_id,
      ongoing_projects = coalesce(p_ongoing_projects, ''),
      critical_deadlines = coalesce(p_critical_deadlines, ''),
      official_contacts = coalesce(p_official_contacts, ''),
      operational_lessons = coalesce(p_operational_lessons, ''),
      known_exceptions = coalesce(p_known_exceptions, ''),
      revision_counter = revision_counter + 1,
      updated_at = saved_at
    where package_id = p_package_id;
  else
    insert into public.turnover_packages (
      package_id, position_title, term_covered, outgoing_officer_id,
      incoming_officer_id, ongoing_projects, critical_deadlines,
      official_contacts, operational_lessons, known_exceptions,
      created_at, updated_at
    )
    values (
      pkg_id, btrim(p_position_title), btrim(p_term_covered), actor_id,
      p_incoming_officer_id, coalesce(p_ongoing_projects, ''),
      coalesce(p_critical_deadlines, ''), coalesce(p_official_contacts, ''),
      coalesce(p_operational_lessons, ''), coalesce(p_known_exceptions, ''),
      saved_at, saved_at
    );
  end if;

  return jsonb_build_object(
    'package_id', pkg_id,
    'status', 'saved',
    'updated_at', saved_at
  );
end;
$$;

revoke all on function eacsc_private.save_turnover_package(uuid, text, text, uuid, text, text, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function eacsc_private.save_turnover_package(uuid, text, text, uuid, text, text, text, text, text, uuid) to authenticated;

create function public.eacsc_save_turnover_package(
  p_package_id uuid,
  p_position_title text,
  p_term_covered text,
  p_incoming_officer_id uuid,
  p_ongoing_projects text,
  p_critical_deadlines text,
  p_official_contacts text,
  p_operational_lessons text,
  p_known_exceptions text,
  p_request_id uuid
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.save_turnover_package(
    p_package_id, p_position_title, p_term_covered, p_incoming_officer_id,
    p_ongoing_projects, p_critical_deadlines, p_official_contacts,
    p_operational_lessons, p_known_exceptions, p_request_id
  );
$$;

revoke all on function public.eacsc_save_turnover_package(uuid, text, text, uuid, text, text, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.eacsc_save_turnover_package(uuid, text, text, uuid, text, text, text, text, text, uuid) to authenticated;

-- 3. Formal handover sign-off acknowledgment
create function eacsc_private.sign_turnover_acknowledgment(
  p_package_id uuid,
  p_exceptions_summary text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  pkg public.turnover_packages%rowtype;
  ack_uuid uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  saved_at timestamptz := clock_timestamp();
begin
  if actor_id is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select * into pkg from public.turnover_packages where package_id = p_package_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'Package not found.';
  end if;

  if pkg.incoming_officer_id is distinct from actor_id then
    raise exception using errcode = '42501', message = 'Only the designated incoming officer may sign this acknowledgment.';
  end if;

  if pkg.status = 'acknowledged' then
    raise exception using errcode = 'PT409', message = 'This package has already been acknowledged.';
  end if;

  update public.turnover_packages
  set status = 'acknowledged', updated_at = saved_at
  where package_id = p_package_id;

  insert into public.audit_events (
    event_uuid, actor_user_id, action_type, action_summary, new_state, request_id
  )
  values (
    event_id, actor_id, 'turnover.acknowledged',
    'Signed administrative handover acknowledgment for ' || pkg.position_title || '.',
    jsonb_build_object(
      'package_id', pkg.package_id,
      'position_title', pkg.position_title,
      'outgoing_officer_id', pkg.outgoing_officer_id,
      'incoming_officer_id', actor_id,
      'exceptions_summary', coalesce(p_exceptions_summary, '')
    ),
    p_request_id
  );

  insert into public.turnover_acknowledgments (
    ack_id, package_id, outgoing_officer_id, incoming_officer_id,
    exceptions_summary, acknowledged_at, audit_event_uuid, request_id
  )
  values (
    ack_uuid, pkg.package_id, pkg.outgoing_officer_id, actor_id,
    coalesce(p_exceptions_summary, ''), saved_at, event_id, p_request_id
  );

  return jsonb_build_object(
    'ack_id', ack_uuid,
    'package_id', pkg.package_id,
    'acknowledged_at', saved_at,
    'audit_event_uuid', event_id
  );
end;
$$;

revoke all on function eacsc_private.sign_turnover_acknowledgment(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function eacsc_private.sign_turnover_acknowledgment(uuid, text, uuid) to authenticated;

create function public.eacsc_sign_turnover_acknowledgment(
  p_package_id uuid,
  p_exceptions_summary text,
  p_request_id uuid
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.sign_turnover_acknowledgment(p_package_id, p_exceptions_summary, p_request_id);
$$;

revoke all on function public.eacsc_sign_turnover_acknowledgment(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.eacsc_sign_turnover_acknowledgment(uuid, text, uuid) to authenticated;

-- 4. Administrative role transfer automation (technical_admin only)
create function eacsc_private.transfer_position_role(
  p_position_title text,
  p_outgoing_user_id uuid,
  p_incoming_user_id uuid,
  p_functional_roles text[],
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_roles text[];
  event_id uuid := gen_random_uuid();
  saved_at timestamptz := clock_timestamp();
begin
  if actor_id is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select functional_roles into actor_roles from public.app_users
  where user_id = actor_id and is_active;
  if not found or not ('technical_admin' = any(actor_roles)) then
    raise exception using errcode = '42501', message = 'Technical administration authority required.';
  end if;

  if p_outgoing_user_id = p_incoming_user_id then
    raise exception using errcode = '22023', message = 'Incoming and outgoing officers must be different.';
  end if;

  -- 1. Archive outgoing officer roles and deactivate profile
  update public.app_users
  set is_active = false,
    revision_counter = revision_counter + 1,
    updated_at = saved_at
  where user_id = p_outgoing_user_id;

  -- Deactivate outgoing record assignments
  update public.record_assignments
  set is_active = false,
    revision_counter = revision_counter + 1,
    updated_at = saved_at
  where user_id = p_outgoing_user_id and is_active;

  -- 2. Activate incoming officer and grant position/roles
  update public.app_users
  set is_active = true,
    council_position = btrim(p_position_title),
    functional_roles = p_functional_roles,
    revision_counter = revision_counter + 1,
    updated_at = saved_at
  where user_id = p_incoming_user_id;

  insert into public.audit_events (
    event_uuid, actor_user_id, action_type, action_summary, new_state, request_id
  )
  values (
    event_id, actor_id, 'admin.role_transfer',
    'Transferred ' || p_position_title || ' responsibilities and archived predecessor permissions.',
    jsonb_build_object(
      'position_title', p_position_title,
      'outgoing_user_id', p_outgoing_user_id,
      'incoming_user_id', p_incoming_user_id,
      'granted_roles', p_functional_roles
    ),
    p_request_id
  );

  return jsonb_build_object(
    'status', 'completed',
    'position_title', p_position_title,
    'outgoing_user_id', p_outgoing_user_id,
    'incoming_user_id', p_incoming_user_id,
    'transferred_at', saved_at,
    'audit_event_uuid', event_id
  );
end;
$$;

revoke all on function eacsc_private.transfer_position_role(text, uuid, uuid, text[], uuid) from public, anon, authenticated, service_role;
grant execute on function eacsc_private.transfer_position_role(text, uuid, uuid, text[], uuid) to authenticated;

create function public.eacsc_transfer_position_role(
  p_position_title text,
  p_outgoing_user_id uuid,
  p_incoming_user_id uuid,
  p_functional_roles text[],
  p_request_id uuid
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.transfer_position_role(
    p_position_title, p_outgoing_user_id, p_incoming_user_id, p_functional_roles, p_request_id
  );
$$;

revoke all on function public.eacsc_transfer_position_role(text, uuid, uuid, text[], uuid) from public, anon, authenticated, service_role;
grant execute on function public.eacsc_transfer_position_role(text, uuid, uuid, text[], uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
