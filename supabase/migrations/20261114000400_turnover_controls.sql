-- Slice 9A backend correction. Apply ONCE after 20261114000300_turnover_system.sql.
-- Existing packages/history are retained. Old unsafe write APIs are retired.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres.'; end if;
  if to_regclass('public.turnover_packages') is null
    or to_regclass('eacsc_private.mutation_receipts') is null then
    raise exception 'Apply the existing Batch 9 migration first.';
  end if;
end;
$$;

alter table public.turnover_packages
  add column outgoing_confirmed_at timestamptz,
  add column access_transferred_at timestamptz,
  add column inventory_snapshot jsonb not null default '[]'::jsonb,
  add constraint turnover_positive_revision check (revision_counter > 0),
  add constraint turnover_snapshot_array check (jsonb_typeof(inventory_snapshot) = 'array'),
  add constraint turnover_different_people check (
    incoming_officer_id is null or incoming_officer_id <> outgoing_officer_id
  );

-- A helper used only inside trusted commands. Never trust a cached JWT role.
create function eacsc_private.turnover_actor()
returns public.app_users language plpgsql security definer set search_path = ''
as $$
declare p public.app_users%rowtype;
begin
  if auth.uid() is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Permanent officer account required.';
  end if;
  select * into p from public.app_users
  where user_id = auth.uid() and is_active and cardinality(functional_roles) > 0
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Active officer profile required.';
  end if;
  return p;
end;
$$;
revoke all on function eacsc_private.turnover_actor() from public, anon, authenticated, service_role;

-- Preserve the old read API name, but enforce the original per-record policy.
create or replace function eacsc_private.get_position_inventory(p_position text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor public.app_users%rowtype; items jsonb;
begin
  actor := eacsc_private.turnover_actor();
  if nullif(btrim(p_position), '') is null then
    raise exception using errcode = '22023', message = 'Choose an exact council position.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'record_id', m.record_id, 'title', m.title, 'category', m.category,
    'document_type', m.document_type, 'access_class', m.access_class,
    'custodian_position', m.custodian_position, 'revision', m.revision_counter,
    'versions_count', (select count(*) from public.record_versions v
      where v.record_id = m.record_id and eacsc_private.can_read_record(m.record_id, v.state)),
    'current_state', coalesce((select v.state from public.record_versions v
      where v.record_id = m.record_id and eacsc_private.can_read_record(m.record_id, v.state)
      order by v.version_number desc limit 1), 'No permitted version'),
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
      'version_id', v.version_id, 'version_number', v.version_number, 'state', v.state
    ) order by v.version_number) from public.record_versions v
      where v.record_id = m.record_id and eacsc_private.can_read_record(m.record_id, v.state)), '[]'::jsonb)
  ) order by m.record_id), '[]'::jsonb) into items
  from public.master_records m
  where lower(btrim(m.custodian_position)) = lower(btrim(p_position))
    and eacsc_private.can_read_record(m.record_id, null);
  return jsonb_build_object('position_queried', btrim(p_position), 'inventory', items);
end;
$$;

-- Access to packages is now through explicit, currently-authorized commands.
revoke all on public.turnover_packages, public.turnover_acknowledgments
  from public, anon, authenticated, service_role;

create function eacsc_private.list_turnover_packages()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor public.app_users%rowtype; result jsonb;
begin
  actor := eacsc_private.turnover_actor();
  select coalesce(jsonb_agg(jsonb_build_object(
    'package_id', p.package_id, 'position_title', p.position_title,
    'term_covered', p.term_covered, 'status', p.status,
    'revision_counter', p.revision_counter,
    'outgoing_officer_id', p.outgoing_officer_id, 'incoming_officer_id', p.incoming_officer_id,
    'outgoing_confirmed_at', p.outgoing_confirmed_at,
    'access_transferred_at', p.access_transferred_at, 'updated_at', p.updated_at,
    'outgoing_profile_revision', o.revision_counter,
    'incoming_profile_revision', i.revision_counter
  ) order by p.updated_at desc, p.package_id), '[]'::jsonb) into result
  from public.turnover_packages p
  join public.app_users o on o.user_id = p.outgoing_officer_id
  left join public.app_users i on i.user_id = p.incoming_officer_id
  where p.outgoing_officer_id = actor.user_id or p.incoming_officer_id = actor.user_id
    or 'technical_admin' = any(actor.functional_roles);
  return result;
end;
$$;

create function eacsc_private.get_turnover_package(p_package_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor public.app_users%rowtype; pkg public.turnover_packages%rowtype; acks jsonb;
begin
  actor := eacsc_private.turnover_actor();
  select * into pkg from public.turnover_packages where package_id = p_package_id;
  if not found or not (pkg.outgoing_officer_id = actor.user_id
    or (pkg.incoming_officer_id = actor.user_id and pkg.access_transferred_at is not null)) then
    raise exception using errcode = '42501',
      message = 'Package unavailable. Receiving access must be transferred before review.';
  end if;
  if exists (select 1 from jsonb_array_elements(pkg.inventory_snapshot) x
    where not eacsc_private.can_read_record(x->>'record_id', null)) then
    raise exception using errcode = '42501',
      message = 'Inventory access changed. Ask the custodian to reconcile this package before opening it.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.acknowledged_at), '[]'::jsonb)
    into acks from public.turnover_acknowledgments a where a.package_id = pkg.package_id;
  return to_jsonb(pkg) || jsonb_build_object('acknowledgments', acks);
end;
$$;

create function eacsc_private.turnover_directory()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor public.app_users%rowtype; result jsonb;
begin
  actor := eacsc_private.turnover_actor();
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', u.user_id, 'full_name', u.full_name, 'council_position', u.council_position
  ) order by u.full_name, u.user_id), '[]'::jsonb) into result
  from public.app_users u
  where u.is_active and cardinality(u.functional_roles) > 0;
  return result;
end;
$$;

-- Every mutation uses the shared retry-receipt namespace from Batch 4.
create function eacsc_private.turnover_retry(p_request_id uuid, p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare receipt eacsc_private.mutation_receipts%rowtype;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Request ID required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'eacsc-mutation:' || auth.uid()::text || ':' || p_request_id::text, 0));
  select * into receipt from eacsc_private.mutation_receipts
    where actor_user_id = auth.uid() and request_id = p_request_id;
  if not found then return null; end if;
  if receipt.command_name <> p_command or receipt.request_payload is distinct from p_payload then
    raise exception using errcode = '22023', message = 'Request ID already used for a different operation.';
  end if;
  return receipt.response_payload;
end;
$$;

create function eacsc_private.turnover_event(
  p_request_id uuid, p_command text, p_payload jsonb, p_response jsonb,
  p_before jsonb, p_after jsonb, p_old_revision integer, p_new_revision integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare event_id uuid := gen_random_uuid(); result jsonb;
begin
  insert into public.audit_events (
    event_uuid, actor_user_id, action_type, action_summary, request_id,
    previous_state, new_state, previous_revision, new_revision
  ) values (
    event_id, auth.uid(), p_command, 'Turnover operation: ' || p_command, p_request_id,
    p_before, p_after, p_old_revision, p_new_revision
  );
  result := p_response || jsonb_build_object('audit_event_uuid', event_id, 'request_id', p_request_id);
  insert into eacsc_private.mutation_receipts (
    actor_user_id, request_id, command_name, request_payload, response_payload, audit_event_uuid
  ) values (auth.uid(), p_request_id, p_command, p_payload, result, event_id);
  return result;
end;
$$;

create function eacsc_private.save_turnover_package_v2(
  p_package_id uuid, p_expected_revision integer, p_position_title text,
  p_term_covered text, p_incoming_officer_id uuid, p_ongoing_projects text,
  p_critical_deadlines text, p_official_contacts text, p_operational_lessons text,
  p_known_exceptions text, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor public.app_users%rowtype; old_pkg public.turnover_packages%rowtype;
  pkg public.turnover_packages%rowtype; payload jsonb; response jsonb;
begin
  actor := eacsc_private.turnover_actor();
  if nullif(btrim(actor.council_position), '') is null
    or lower(btrim(p_position_title)) is distinct from lower(btrim(actor.council_position))
    or not (actor.functional_roles && array['author','custodian','publisher']) then
    raise exception using errcode = '42501', message = 'Prepare a package only for your assigned council position.';
  end if;
  if nullif(btrim(p_term_covered), '') is null or length(btrim(p_term_covered)) > 120
    or (p_package_id is null and p_expected_revision is distinct from 0)
    or (p_package_id is not null and (p_expected_revision is null or p_expected_revision < 1))
    or greatest(length(coalesce(p_ongoing_projects,'')), length(coalesce(p_critical_deadlines,'')),
      length(coalesce(p_official_contacts,'')), length(coalesce(p_operational_lessons,'')),
      length(coalesce(p_known_exceptions,''))) > 20000 then
    raise exception using errcode = '22023', message = 'Provide a term, expected revision, and memo fields of at most 20000 characters each.';
  end if;
  if p_incoming_officer_id = actor.user_id or (p_incoming_officer_id is not null and not exists (
    select 1 from public.app_users u where u.user_id = p_incoming_officer_id
      and u.is_active and cardinality(u.functional_roles) > 0
  )) then
    raise exception using errcode = '22023', message = 'Choose a different active incoming officer.';
  end if;
  payload := jsonb_build_object(
    'package_id',p_package_id,'expected_revision',p_expected_revision,
    'position_title',actor.council_position,'term_covered',btrim(p_term_covered),
    'incoming_officer_id',p_incoming_officer_id,'ongoing_projects',coalesce(p_ongoing_projects,''),
    'critical_deadlines',coalesce(p_critical_deadlines,''),'official_contacts',coalesce(p_official_contacts,''),
    'operational_lessons',coalesce(p_operational_lessons,''),'known_exceptions',coalesce(p_known_exceptions,'')
  );
  if p_package_id is not null then
    select * into old_pkg from public.turnover_packages where package_id = p_package_id for update;
    if not found or old_pkg.outgoing_officer_id <> actor.user_id then
      raise exception using errcode = '42501', message = 'Package unavailable.';
    end if;
  end if;
  response := eacsc_private.turnover_retry(p_request_id, 'turnover.memo_saved', payload);
  if response is not null then return response; end if;
  if p_package_id is not null then
    if old_pkg.revision_counter <> p_expected_revision then
      raise exception using errcode = 'PT409', message = 'Memo changed. Keep your edits and reload the latest package.';
    end if;
    if old_pkg.status <> 'draft' or old_pkg.outgoing_confirmed_at is not null
      or old_pkg.access_transferred_at is not null then
      raise exception using errcode = '55000', message = 'Confirmed packages are frozen. Create a new package for a correction.';
    end if;
    update public.turnover_packages set
      position_title = actor.council_position, term_covered = btrim(p_term_covered),
      incoming_officer_id = p_incoming_officer_id, ongoing_projects = coalesce(p_ongoing_projects,''),
      critical_deadlines = coalesce(p_critical_deadlines,''), official_contacts = coalesce(p_official_contacts,''),
      operational_lessons = coalesce(p_operational_lessons,''), known_exceptions = coalesce(p_known_exceptions,''),
      revision_counter = revision_counter + 1, updated_at = greatest(clock_timestamp(), updated_at)
    where package_id = p_package_id returning * into pkg;
  else
    insert into public.turnover_packages (
      position_title,term_covered,outgoing_officer_id,incoming_officer_id,ongoing_projects,
      critical_deadlines,official_contacts,operational_lessons,known_exceptions
    ) values (
      actor.council_position,btrim(p_term_covered),actor.user_id,p_incoming_officer_id,
      coalesce(p_ongoing_projects,''),coalesce(p_critical_deadlines,''),coalesce(p_official_contacts,''),
      coalesce(p_operational_lessons,''),coalesce(p_known_exceptions,'')
    ) returning * into pkg;
  end if;
  return eacsc_private.turnover_event(p_request_id,'turnover.memo_saved',payload,
    jsonb_build_object('package_id',pkg.package_id,'revision_counter',pkg.revision_counter),
    case when old_pkg.package_id is null then null else to_jsonb(old_pkg) end,
    to_jsonb(pkg),old_pkg.revision_counter,pkg.revision_counter);
end;
$$;

-- Outgoing confirmation freezes the memo and the inventory reviewed for transfer.
create function eacsc_private.confirm_turnover_outgoing(
  p_package_id uuid, p_expected_revision integer, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor public.app_users%rowtype; pkg public.turnover_packages%rowtype;
  payload jsonb; response jsonb; snapshot jsonb; old_revision integer;
begin
  actor := eacsc_private.turnover_actor();
  select * into pkg from public.turnover_packages where package_id = p_package_id for update;
  if not found or pkg.outgoing_officer_id <> actor.user_id
    or pkg.position_title is distinct from actor.council_position then
    raise exception using errcode='42501', message='Outgoing position holder required.';
  end if;
  payload := jsonb_build_object('package_id',p_package_id,'expected_revision',p_expected_revision);
  response := eacsc_private.turnover_retry(p_request_id,'turnover.outgoing_confirmed',payload);
  if response is not null then return response; end if;
  if pkg.revision_counter is distinct from p_expected_revision then
    raise exception using errcode='PT409', message='Package changed. Reload before confirming.';
  end if;
  if pkg.status <> 'draft' or pkg.outgoing_confirmed_at is not null or pkg.incoming_officer_id is null then
    raise exception using errcode='55000', message='An unconfirmed Draft and a designated incoming officer are required.';
  end if;
  snapshot := (eacsc_private.get_position_inventory(pkg.position_title))->'inventory';
  if jsonb_array_length(snapshot) = 0 then
    raise exception using errcode='22023', message='No assigned position records found. Check exact position and assignments first.';
  end if;
  -- Include only the exact functional assignments the outgoing officer may transfer.
  select jsonb_agg(item || jsonb_build_object('assignments', (
    select jsonb_agg(jsonb_build_object('function',a.assignment_function,
      'allow_restricted',a.allow_restricted,'revision_counter',a.revision_counter)
      order by a.assignment_function)
    from public.record_assignments a
    where a.record_id = item->>'record_id' and a.user_id = actor.user_id and a.is_active
      and a.assignment_function = any(actor.functional_roles)
      and ((item->>'access_class') <> 'restricted' or a.allow_restricted)
  )) order by item->>'record_id') into snapshot from jsonb_array_elements(snapshot) item;
  old_revision := pkg.revision_counter;
  update public.turnover_packages set inventory_snapshot=snapshot, outgoing_confirmed_at=clock_timestamp(),
    revision_counter=revision_counter+1, updated_at=greatest(clock_timestamp(),updated_at)
    where package_id=p_package_id returning * into pkg;
  return eacsc_private.turnover_event(p_request_id,'turnover.outgoing_confirmed',payload,
    jsonb_build_object('package_id',p_package_id,'revision_counter',pkg.revision_counter),
    null,to_jsonb(pkg),old_revision,pkg.revision_counter);
end;
$$;

-- Admin transfer is limited to the confirmed package's existing authority.
-- It does NOT grant technical_admin or unrelated approval assignments.
create function eacsc_private.transfer_position_role_v2(
  p_package_id uuid, p_expected_revision integer,
  p_expected_outgoing_revision integer, p_expected_incoming_revision integer, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor public.app_users%rowtype; pkg public.turnover_packages%rowtype;
  outgoing public.app_users%rowtype; incoming public.app_users%rowtype;
  payload jsonb; response jsonb; item jsonb; assignment_item jsonb;
  old_assignment public.record_assignments%rowtype; existing_assignment public.record_assignments%rowtype;
  master_row public.master_records%rowtype; new_roles text[]; count_transferred integer:=0;
  old_revision integer; transfer_snapshot jsonb; saved_at timestamptz:=clock_timestamp();
begin
  -- Acquire the admin profile exclusively before other profile locks; serializes admin transfers.
  perform pg_advisory_xact_lock(hashtextextended('eacsc-turnover-admin-transfer',0));
  actor := eacsc_private.turnover_actor();
  if not ('technical_admin'=any(actor.functional_roles)) then
    raise exception using errcode='42501', message='Technical administrator required.';
  end if;
  select * into pkg from public.turnover_packages where package_id=p_package_id for update;
  if not found or actor.user_id in (pkg.outgoing_officer_id,pkg.incoming_officer_id) then
    raise exception using errcode='42501', message='A separate technical administrator must execute this transfer.';
  end if;
  payload:=jsonb_build_object('package_id',p_package_id,'expected_revision',p_expected_revision,
    'expected_outgoing_revision',p_expected_outgoing_revision,'expected_incoming_revision',p_expected_incoming_revision);
  response:=eacsc_private.turnover_retry(p_request_id,'turnover.access_transferred',payload);
  if response is not null then return response; end if;
  if pkg.revision_counter is distinct from p_expected_revision then
    raise exception using errcode='PT409', message='Package changed. Reload before transfer.';
  end if;
  if pkg.outgoing_confirmed_at is null or pkg.access_transferred_at is not null or pkg.status<>'draft' then
    raise exception using errcode='55000', message='Outgoing confirmation required; transfer must not already be complete.';
  end if;
  perform 1 from public.app_users where user_id in (pkg.outgoing_officer_id,pkg.incoming_officer_id)
    order by user_id for update;
  select * into outgoing from public.app_users where user_id=pkg.outgoing_officer_id;
  select * into incoming from public.app_users where user_id=pkg.incoming_officer_id;
  if outgoing.user_id is null or incoming.user_id is null or not outgoing.is_active or not incoming.is_active
    or outgoing.council_position is distinct from pkg.position_title then
    raise exception using errcode='42501', message='Check the active outgoing position holder and incoming profile.';
  end if;
  if outgoing.revision_counter is distinct from p_expected_outgoing_revision
    or incoming.revision_counter is distinct from p_expected_incoming_revision then
    raise exception using errcode='PT409', message='An officer profile changed. Reload before transfer.';
  end if;
  if incoming.council_position is distinct from pkg.position_title
    and exists (select 1 from public.record_assignments a where a.user_id=incoming.user_id and a.is_active) then
    raise exception using errcode='55000',
      message='Incoming officer already has another position with active assignments. Reconcile responsibilities before transfer.';
  end if;
  -- Do not deactivate an officer who still has another position's assignments.
  if exists (select 1 from public.record_assignments a where a.user_id=outgoing.user_id and a.is_active
    and not exists (select 1 from jsonb_array_elements(pkg.inventory_snapshot) x
      where x->>'record_id'=a.record_id and exists (
        select 1 from jsonb_array_elements(x->'assignments') y where y->>'function'=a.assignment_function))) then
    raise exception using errcode='55000', message='Outgoing officer has assignments outside this package. Reconcile them before transfer.';
  end if;
  select array_agg(distinct y->>'function' order by y->>'function') into new_roles
    from jsonb_array_elements(pkg.inventory_snapshot) x,
      lateral jsonb_array_elements(x->'assignments') y;
  if new_roles is null or not (new_roles <@ outgoing.functional_roles) then
    raise exception using errcode='42501', message='Confirmed functional authority is no longer available.';
  end if;
  -- Deterministic locking; preserve the exact record/assignment scope reviewed by outgoing.
  for item in select value from jsonb_array_elements(pkg.inventory_snapshot) order by value->>'record_id' loop
    select * into master_row from public.master_records where record_id=item->>'record_id' for share;
    if not found or master_row.revision_counter <> (item->>'revision')::integer
      or master_row.custodian_position is distinct from item->>'custodian_position'
      or master_row.access_class is distinct from item->>'access_class' then
      raise exception using errcode='PT409', message='A confirmed inventory record changed. Create a refreshed package.';
    end if;
    for assignment_item in select value from jsonb_array_elements(item->'assignments') order by value->>'function' loop
      select * into old_assignment from public.record_assignments
        where record_id=item->>'record_id' and user_id=outgoing.user_id
          and assignment_function=assignment_item->>'function' for update;
      if not found or not old_assignment.is_active
        or old_assignment.revision_counter<>(assignment_item->>'revision_counter')::integer
        or old_assignment.allow_restricted is distinct from (assignment_item->>'allow_restricted')::boolean then
        raise exception using errcode='PT409', message='A confirmed assignment changed. Create a refreshed package.';
      end if;
      select * into existing_assignment from public.record_assignments
        where record_id=old_assignment.record_id and user_id=incoming.user_id
          and assignment_function=old_assignment.assignment_function for update;
      if found and existing_assignment.is_active then
        -- Existing independent grants remain unchanged, never broadened or removed.
        if old_assignment.allow_restricted and not existing_assignment.allow_restricted then
          update public.record_assignments set allow_restricted=true,assigned_by=actor.user_id,
            revision_counter=revision_counter+1,updated_at=greatest(saved_at,updated_at)
            where record_id=old_assignment.record_id and user_id=incoming.user_id
              and assignment_function=old_assignment.assignment_function;
        end if;
      else
        insert into public.record_assignments(record_id,user_id,assignment_function,is_active,
          allow_restricted,assigned_by,created_at,updated_at)
        values(old_assignment.record_id,incoming.user_id,old_assignment.assignment_function,true,
          old_assignment.allow_restricted,actor.user_id,saved_at,saved_at)
        on conflict(record_id,user_id,assignment_function) do update set
          is_active=true,allow_restricted=excluded.allow_restricted,assigned_by=excluded.assigned_by,
          revision_counter=public.record_assignments.revision_counter+1,
          updated_at=greatest(saved_at,public.record_assignments.updated_at);
      end if;
      update public.record_assignments set is_active=false,revision_counter=revision_counter+1,
        updated_at=greatest(saved_at,updated_at) where record_id=old_assignment.record_id
        and user_id=outgoing.user_id and assignment_function=old_assignment.assignment_function;
      count_transferred:=count_transferred+1;
    end loop;
  end loop;
  -- Retain independent incoming functions; add only existing outgoing assignment functions.
  select array_agg(distinct role order by role) into new_roles
    from unnest(incoming.functional_roles || new_roles) role;
  update public.app_users set council_position=pkg.position_title,functional_roles=new_roles,
    revision_counter=revision_counter+1,updated_at=greatest(saved_at,updated_at) where user_id=incoming.user_id;
  update public.app_users set is_active=false,revision_counter=revision_counter+1,
    updated_at=greatest(saved_at,updated_at) where user_id=outgoing.user_id;
  old_revision:=pkg.revision_counter;
  update public.turnover_packages set access_transferred_at=saved_at,revision_counter=revision_counter+1,
    updated_at=greatest(saved_at,updated_at) where package_id=p_package_id returning * into pkg;
  transfer_snapshot:=jsonb_build_object('package_id',p_package_id,'outgoing_user_id',outgoing.user_id,
    'incoming_user_id',incoming.user_id,'position_title',pkg.position_title,
    'assignments',pkg.inventory_snapshot,'incoming_roles',new_roles);
  return eacsc_private.turnover_event(p_request_id,'turnover.access_transferred',payload,
    jsonb_build_object('package_id',p_package_id,'revision_counter',pkg.revision_counter,
      'assignments_transferred',count_transferred),
    jsonb_build_object('outgoing_profile',to_jsonb(outgoing)-'email',
      'incoming_profile',to_jsonb(incoming)-'email'),transfer_snapshot,old_revision,pkg.revision_counter);
end;
$$;

create function eacsc_private.sign_turnover_acknowledgment_v2(
  p_package_id uuid, p_expected_revision integer, p_exceptions_summary text, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor public.app_users%rowtype; pkg public.turnover_packages%rowtype;
  payload jsonb; response jsonb; old_revision integer; item jsonb;
begin
  actor:=eacsc_private.turnover_actor();
  select * into pkg from public.turnover_packages where package_id=p_package_id for update;
  if not found or pkg.incoming_officer_id is distinct from actor.user_id then
    raise exception using errcode='42501', message='Designated incoming officer required.';
  end if;
  if length(coalesce(p_exceptions_summary,''))>20000 then
    raise exception using errcode='22023', message='Exceptions summary is too long.';
  end if;
  payload:=jsonb_build_object('package_id',p_package_id,'expected_revision',p_expected_revision,
    'exceptions_summary',coalesce(p_exceptions_summary,''));
  response:=eacsc_private.turnover_retry(p_request_id,'turnover.acknowledged_v2',payload);
  if response is not null then return response; end if;
  if pkg.revision_counter is distinct from p_expected_revision then
    raise exception using errcode='PT409', message='Package changed. Reload before acknowledgment.';
  end if;
  if pkg.status<>'draft' or pkg.outgoing_confirmed_at is null or pkg.access_transferred_at is null then
    raise exception using errcode='55000', message='Outgoing confirmation and access transfer required before receipt.';
  end if;
  for item in select value from jsonb_array_elements(pkg.inventory_snapshot) loop
    if not eacsc_private.can_read_record(item->>'record_id',null) then
      raise exception using errcode='42501', message='A required inventory record is inaccessible. Resolve access before receipt.';
    end if;
  end loop;
  old_revision:=pkg.revision_counter;
  update public.turnover_packages set status='acknowledged',revision_counter=revision_counter+1,
    updated_at=greatest(clock_timestamp(),updated_at) where package_id=p_package_id returning * into pkg;
  response:=eacsc_private.turnover_event(p_request_id,'turnover.acknowledged_v2',payload,
    jsonb_build_object('package_id',p_package_id,'revision_counter',pkg.revision_counter),
    null,jsonb_build_object('package_id',p_package_id,'exceptions_summary',coalesce(p_exceptions_summary,''),
      'outgoing_confirmed_at',pkg.outgoing_confirmed_at,'access_transferred_at',pkg.access_transferred_at),
    old_revision,pkg.revision_counter);
  insert into public.turnover_acknowledgments (
    package_id,outgoing_officer_id,incoming_officer_id,exceptions_summary,audit_event_uuid,request_id
  ) values (p_package_id,pkg.outgoing_officer_id,actor.user_id,coalesce(p_exceptions_summary,''),
    (response->>'audit_event_uuid')::uuid,p_request_id);
  return response;
end;
$$;

-- Disable the legacy mutation paths. The next frontend update uses only v2.
revoke all on function public.eacsc_save_turnover_package(uuid,text,text,uuid,text,text,text,text,text,uuid),
  eacsc_private.save_turnover_package(uuid,text,text,uuid,text,text,text,text,text,uuid),
  public.eacsc_sign_turnover_acknowledgment(uuid,text,uuid),
  eacsc_private.sign_turnover_acknowledgment(uuid,text,uuid),
  public.eacsc_transfer_position_role(text,uuid,uuid,text[],uuid),
  eacsc_private.transfer_position_role(text,uuid,uuid,text[],uuid)
  from public,anon,authenticated,service_role;

-- Explicit public invoker wrappers; all authorization occurs in private commands.
create function public.eacsc_list_turnover_packages()
returns jsonb language sql security invoker set search_path='' as $$select eacsc_private.list_turnover_packages();$$;
create function public.eacsc_get_turnover_package(p_package_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select eacsc_private.get_turnover_package(p_package_id);$$;
create function public.eacsc_turnover_directory()
returns jsonb language sql security invoker set search_path='' as $$select eacsc_private.turnover_directory();$$;
create function public.eacsc_save_turnover_package_v2(
  p_package_id uuid,p_expected_revision integer,p_position_title text,p_term_covered text,
  p_incoming_officer_id uuid,p_ongoing_projects text,p_critical_deadlines text,p_official_contacts text,
  p_operational_lessons text,p_known_exceptions text,p_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select eacsc_private.save_turnover_package_v2(p_package_id,p_expected_revision,p_position_title,p_term_covered,
    p_incoming_officer_id,p_ongoing_projects,p_critical_deadlines,p_official_contacts,p_operational_lessons,
    p_known_exceptions,p_request_id);$$;
create function public.eacsc_confirm_turnover_outgoing(p_package_id uuid,p_expected_revision integer,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select eacsc_private.confirm_turnover_outgoing(p_package_id,p_expected_revision,p_request_id);$$;
create function public.eacsc_transfer_position_role_v2(p_package_id uuid,p_expected_revision integer,
  p_expected_outgoing_revision integer,p_expected_incoming_revision integer,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select eacsc_private.transfer_position_role_v2(p_package_id,p_expected_revision,
    p_expected_outgoing_revision,p_expected_incoming_revision,p_request_id);$$;
create function public.eacsc_sign_turnover_acknowledgment_v2(p_package_id uuid,p_expected_revision integer,
  p_exceptions_summary text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select eacsc_private.sign_turnover_acknowledgment_v2(p_package_id,p_expected_revision,p_exceptions_summary,p_request_id);$$;

-- Grant only the named wrapper implementations, not internal helpers.
do $$
declare fn record;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','eacsc_private') and p.proname in (
      'eacsc_list_turnover_packages','list_turnover_packages','eacsc_get_turnover_package','get_turnover_package',
      'eacsc_turnover_directory','turnover_directory','eacsc_save_turnover_package_v2','save_turnover_package_v2',
      'eacsc_confirm_turnover_outgoing','confirm_turnover_outgoing',
      'eacsc_transfer_position_role_v2','transfer_position_role_v2',
      'eacsc_sign_turnover_acknowledgment_v2','sign_turnover_acknowledgment_v2') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
    execute format('grant execute on function %s to authenticated',fn.signature);
  end loop;
end;
$$;
revoke all on function eacsc_private.turnover_retry(uuid,text,jsonb),
  eacsc_private.turnover_event(uuid,text,jsonb,jsonb,jsonb,jsonb,integer,integer)
  from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
