-- Run at STEP B, and also after an interrupted revocation test.
-- Idempotent restoration of the ORIGINAL fictional active-author status.
do $restore$
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres.'; end if;
  if not exists(select 1 from public.app_users where
    user_id=(select id from auth.users where lower(email)='batch4-author@example.invalid')
    and email='batch4-author@example.invalid' and functional_roles=array['author']::text[]) then
    raise exception 'Expected the fictional author profile. Stop and inspect.';
  end if;
  update public.app_users set is_active=true, revision_counter=revision_counter+1, updated_at=clock_timestamp()
  where email='batch4-author@example.invalid' and not is_active;
end;
$restore$;
select email,is_active,revision_counter from public.app_users where email='batch4-author@example.invalid';
