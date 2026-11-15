begin;

create or replace function public.eacsc_check_signup_availability(
  p_full_name text,
  p_student_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := lower(btrim(coalesce(p_full_name, '')));
  v_sid text := lower(btrim(coalesce(p_student_id, '')));
  v_name_taken boolean := false;
  v_sid_taken boolean := false;
begin
  if v_name <> '' then
    select exists(
      select 1 from public.app_users
      where lower(btrim(full_name)) = v_name
    ) into v_name_taken;
  end if;

  if v_sid <> '' then
    select exists(
      select 1 from public.app_users
      where student_id is not null
        and lower(btrim(student_id)) = v_sid
    ) into v_sid_taken;
  end if;

  return jsonb_build_object(
    'name_taken', v_name_taken,
    'student_id_taken', v_sid_taken
  );
end;
$$;

revoke all on function public.eacsc_check_signup_availability(text, text) from public;
grant execute on function public.eacsc_check_signup_availability(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
