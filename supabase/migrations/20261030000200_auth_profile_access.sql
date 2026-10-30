begin;

-- Keep profile access protected by Row Level Security.
alter table public.app_users enable row level security;

-- Remove broad application-role privileges.
revoke all privileges on table public.app_users
from public, anon, authenticated;

-- Allow authenticated requests to select only these profile fields.
grant select (
  user_id,
  full_name,
  council_position,
  functional_roles,
  is_active,
  revision_counter,
  updated_at
)
on table public.app_users
to authenticated;

-- A permanent signed-in user may read only their own profile.
-- Missing or anonymous identity claims do not satisfy this policy.
create policy app_users_select_own_profile
on public.app_users
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (
    select (auth.jwt() ->> 'is_anonymous')::boolean
  ) is false
);

comment on policy app_users_select_own_profile
on public.app_users
is 'Allows permanent authenticated users to read selected fields from their own profile, including inactive status. Does not grant profile writes or operational record access.';

notify pgrst, 'reload schema';

commit;
