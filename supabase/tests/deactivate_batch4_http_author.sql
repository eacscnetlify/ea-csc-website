-- Run ONLY when the HTTP runner pauses at STEP A. Fictional author only.
do $deactivate$
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres.'; end if;
  update public.app_users set is_active=false, revision_counter=revision_counter+1, updated_at=clock_timestamp()
  where user_id=(select id from auth.users where lower(email)='batch4-author@example.invalid')
    and email='batch4-author@example.invalid' and functional_roles=array['author']::text[] and is_active;
  if not found then raise exception 'Expected the active fictional author. Stop and inspect.'; end if;
end;
$deactivate$;
select email,is_active,revision_counter from public.app_users where email='batch4-author@example.invalid';
