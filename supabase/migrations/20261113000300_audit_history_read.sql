-- Batch 7: scoped audit history read RPC (keeps direct audit_events SELECT denied).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;
end;
$$;

create function eacsc_private.get_record_audit_history(p_record_id text)
returns table (
  event_uuid uuid,
  record_id text,
  version_id uuid,
  actor_name text,
  actor_position text,
  action_type text,
  action_summary text,
  previous_revision integer,
  new_revision integer,
  server_occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_record_id is null or not eacsc_private.can_read_record(p_record_id, null, null) then
    raise exception using
      errcode = '42501',
      message = 'Audit history is not permitted for this record.';
  end if;

  return query
  select
    a.event_uuid,
    a.record_id::text,
    a.version_id,
    u.full_name::text as actor_name,
    coalesce(u.council_position, 'Council officer')::text as actor_position,
    a.action_type::text,
    a.action_summary::text,
    a.previous_revision,
    a.new_revision,
    a.server_occurred_at
  from public.audit_events a
  join public.app_users u
    on u.user_id = a.actor_user_id
  where a.record_id = p_record_id
  order by a.server_occurred_at desc, a.event_id desc
  limit 100;
end;
$$;

revoke all on function eacsc_private.get_record_audit_history(text)
  from public, anon, authenticated, service_role;
grant execute on function eacsc_private.get_record_audit_history(text)
  to authenticated;

create function public.eacsc_get_record_audit_history(p_record_id text)
returns table (
  event_uuid uuid,
  record_id text,
  version_id uuid,
  actor_name text,
  actor_position text,
  action_type text,
  action_summary text,
  previous_revision integer,
  new_revision integer,
  server_occurred_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from eacsc_private.get_record_audit_history(p_record_id);
$$;

revoke all on function public.eacsc_get_record_audit_history(text)
  from public, anon, authenticated, service_role;
grant execute on function public.eacsc_get_record_audit_history(text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
