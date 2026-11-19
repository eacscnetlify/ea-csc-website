begin;

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
    from jsonb_array_elements(coalesce(nullif(pkg.inventory_snapshot, 'null'::jsonb), '[]'::jsonb)) x,
      lateral jsonb_array_elements(coalesce(nullif(x->'assignments', 'null'::jsonb), '[]'::jsonb)) y;
  if not (new_roles <@ outgoing.functional_roles) then
    raise exception using errcode='42501', message='Confirmed functional authority is no longer available.';
  end if;

  for item in select value from jsonb_array_elements(coalesce(nullif(pkg.inventory_snapshot, 'null'::jsonb), '[]'::jsonb)) order by value->>'record_id' loop
    select * into master_row from public.master_records where record_id=item->>'record_id' for share;
    if not found or master_row.revision_counter <> (item->>'revision')::integer
      or master_row.custodian_position is distinct from item->>'custodian_position'
      or master_row.access_class is distinct from item->>'access_class' then
      raise exception using errcode='PT409', message='A confirmed inventory record changed. Create a refreshed package.';
    end if;
    for assignment_item in select value from jsonb_array_elements(coalesce(nullif(item->'assignments', 'null'::jsonb), '[]'::jsonb)) order by value->>'function' loop
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

commit;
