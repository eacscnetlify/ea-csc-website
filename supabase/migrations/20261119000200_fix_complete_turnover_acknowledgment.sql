-- Fix eacsc_complete_turnover_acknowledgment column alignment with turnover_acknowledgments
-- and mark turnover_packages.status = 'acknowledged'
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

create or replace function public.eacsc_complete_turnover_acknowledgment(
  p_package_id uuid,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pkg public.turnover_packages%rowtype;
  v_ack public.turnover_acknowledgments%rowtype;
  v_event_uuid uuid := gen_random_uuid();
  v_req_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_pkg from public.turnover_packages where package_id = p_package_id for update;
  if not found then
    raise exception 'Turnover package not found.' using errcode = 'P0002';
  end if;

  if v_pkg.incoming_officer_id <> v_uid then
    raise exception 'Only the designated incoming officer can accept and acknowledge this package.' using errcode = '42501';
  end if;

  if v_pkg.access_transferred_at is null then
    raise exception 'Administrative access transfer must be executed before acknowledgment.' using errcode = '55000';
  end if;

  select * into v_ack from public.turnover_acknowledgments where package_id = p_package_id and incoming_officer_id = v_uid;
  if not found then
    insert into public.audit_events (
      event_uuid, actor_user_id, action_type, action_summary, new_state, request_id
    ) values (
      v_event_uuid,
      v_uid,
      'turnover.completed',
      format('Incoming officer accepted and acknowledged turnover package %s (%s). Handover marked Done.', p_package_id, v_pkg.position_title),
      jsonb_build_object('package_id', p_package_id, 'incoming_officer_id', v_uid, 'outgoing_officer_id', v_pkg.outgoing_officer_id),
      v_req_id
    );

    insert into public.turnover_acknowledgments (
      package_id, outgoing_officer_id, incoming_officer_id,
      exceptions_summary, acknowledged_at, audit_event_uuid, request_id
    ) values (
      p_package_id, v_pkg.outgoing_officer_id, v_uid,
      coalesce(btrim(p_notes), ''), greatest(v_now, v_pkg.access_transferred_at),
      v_event_uuid, v_req_id
    )
    returning * into v_ack;
  end if;

  update public.turnover_packages
  set status = 'acknowledged',
      revision_counter = revision_counter + 1,
      updated_at = greatest(v_now, updated_at)
  where package_id = p_package_id
    and status = 'draft';

  update public.app_users
  set is_active = true, updated_at = greatest(v_now, updated_at)
  where user_id = v_uid;

  if v_pkg.outgoing_officer_id is not null and v_pkg.outgoing_officer_id <> v_uid then
    update public.app_users
    set is_active = false, updated_at = greatest(v_now, updated_at)
    where user_id = v_pkg.outgoing_officer_id;
  end if;

  return jsonb_build_object(
    'package_id', p_package_id,
    'acknowledged_at', v_ack.acknowledged_at,
    'completed', true
  );
end;
$$;

revoke all on function public.eacsc_complete_turnover_acknowledgment(uuid, text) from public, anon;
grant execute on function public.eacsc_complete_turnover_acknowledgment(uuid, text) to authenticated;

commit;
