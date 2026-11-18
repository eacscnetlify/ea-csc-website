-- Auto-generate next available EACSC-YYYY-BUL-NNNN ID across both public and internal bulletins
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

create or replace function public.eacsc_next_bulletin_id()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_year text := to_char((now() at time zone 'Asia/Manila'), 'YYYY');
  v_prefix text := 'EACSC-' || v_year || '-BUL-';
  v_max integer := 0;
begin
  if not exists (
    select 1 from public.app_users u
    where u.user_id = v_uid
      and u.is_active = true
      and (u.functional_roles && array['custodian', 'publisher']::text[])
  ) then
    raise exception 'Custodian or Publisher role required.' using errcode = '42501';
  end if;

  select coalesce(max(substring(b.bulletin_id from '(\d{4})$')::integer), 0)
  into v_max
  from public.update_bulletins b
  where b.bulletin_id like v_prefix || '%';

  return v_prefix || lpad((v_max + 1)::text, 4, '0');
end;
$$;

revoke all on function public.eacsc_next_bulletin_id() from public, anon;
grant execute on function public.eacsc_next_bulletin_id() to authenticated;

commit;
