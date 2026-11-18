-- Batch 20: Fix transfer_position_role_v2 non-package assignment deactivation,
-- allow technical_admin to prepare turnover packages for designated position,
-- and add creator-only eacsc_delete_turnover_package.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

create or replace function eacsc_private.save_turnover_package_v2(
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
  v_pos text;
begin
  actor := eacsc_private.turnover_actor();
  v_pos := nullif(btrim(p_position_title), '');
  if nullif(btrim(actor.council_position), '') is null
    or (
      not ('technical_admin' = any(actor.functional_roles))
      and lower(coalesce(v_pos, '')) is distinct from lower(btrim(actor.council_position))
    )
    or v_pos is null
    or not (actor.functional_roles && array['author','custodian','publisher','reviewer','approver','technical_admin']::text[]) then
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
    'position_title',v_pos,'term_covered',btrim(p_term_covered),
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
      position_title = v_pos, term_covered = btrim(p_term_covered),
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
      v_pos,btrim(p_term_covered),actor.user_id,p_incoming_officer_id,
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

create or replace function eacsc_private.transfer_position_role_v2(
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

  select coalesce(array_agg(distinct y->>'function' order by y->>'function'), '{}'::text[]) into new_roles
    from jsonb_array_elements(pkg.inventory_snapshot) x,
      lateral jsonb_array_elements(x->'assignments') y;
  if not (new_roles <@ outgoing.functional_roles) then
    raise exception using errcode='42501', message='Confirmed functional authority is no longer available.';
  end if;

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

  -- Deactivate any remaining collaborator assignments held by the departing officer outside this position's inventory
  update public.record_assignments
  set is_active=false,
      revision_counter=revision_counter+1,
      updated_at=greatest(saved_at,updated_at)
  where user_id=outgoing.user_id
    and is_active=true;

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

-- Creator-only Delete Turnover Package (allowed before access transfer)
create or replace function public.eacsc_delete_turnover_package(
  p_package_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pkg public.turnover_packages%rowtype;
begin
  select * into v_pkg
  from public.turnover_packages
  where package_id = p_package_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Turnover package not found.';
  end if;

  if v_pkg.outgoing_officer_id <> v_uid then
    raise exception using errcode = '42501', message = 'Only the creator of this turnover package can delete it.';
  end if;

  if v_pkg.access_transferred_at is not null or v_pkg.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Transferred or acknowledged turnover packages cannot be deleted.';
  end if;

  delete from public.turnover_packages where package_id = p_package_id;

  return jsonb_build_object('deleted', true, 'package_id', p_package_id);
end;
$$;

revoke all on function public.eacsc_delete_turnover_package(uuid) from public, anon;
grant execute on function public.eacsc_delete_turnover_package(uuid) to authenticated;

commit;
