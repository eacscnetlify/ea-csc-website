begin;

-- Grant authenticated users read access to their own student_id and degree_program columns
-- so getOfficerProfile() succeeds for all signed-in observers and officers.
grant select (
  student_id,
  degree_program
)
on table public.app_users
to authenticated;

notify pgrst, 'reload schema';

commit;
