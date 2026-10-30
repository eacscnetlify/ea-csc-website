-- Manual development fixture setup.
-- Run through the administrative SQL Editor in ea-csc-website-dev.
-- Create the four confirmed fictional Auth accounts first.
-- This file contains no passwords and grants no record assignments.

begin;

do $setup$
declare
  confirmed_accounts integer;
  inserted_profiles integer;
begin
  select count(*)
  into confirmed_accounts
  from auth.users
  where lower(email) in (
    'batch4-author@example.invalid',
    'batch4-custodian@example.invalid',
    'batch4-inactive@example.invalid',
    'batch4-no-profile@example.invalid'
  )
    and email_confirmed_at is not null;

  if confirmed_accounts <> 4 then
    raise exception
      'Create and confirm all four Batch 4 fictional Auth accounts first.';
  end if;

  if exists (
    select 1
    from public.app_users as profiles
    where lower(profiles.email) in (
      'batch4-author@example.invalid',
      'batch4-custodian@example.invalid',
      'batch4-inactive@example.invalid',
      'batch4-no-profile@example.invalid'
    )
      or profiles.user_id in (
        select users.id
        from auth.users as users
        where lower(users.email) in (
          'batch4-author@example.invalid',
          'batch4-custodian@example.invalid',
          'batch4-inactive@example.invalid',
          'batch4-no-profile@example.invalid'
        )
      )
  ) then
    raise exception
      'A Batch 4 fixture profile already exists. Inspect it before rerunning setup.';
  end if;

  insert into public.app_users (
    user_id,
    email,
    full_name,
    council_position,
    functional_roles,
    is_active
  )
  select
    users.id,
    fixtures.email,
    fixtures.full_name,
    fixtures.council_position,
    fixtures.functional_roles,
    fixtures.is_active
  from (
    values
      (
        'batch4-author@example.invalid',
        'Batch 4 Author Fixture',
        'Fictional Author',
        array['author']::text[],
        true
      ),
      (
        'batch4-custodian@example.invalid',
        'Batch 4 Custodian Fixture',
        'Fictional Executive Secretary',
        array['custodian']::text[],
        true
      ),
      (
        'batch4-inactive@example.invalid',
        'Batch 4 Inactive Fixture',
        'Fictional Author',
        array['author']::text[],
        false
      )
  ) as fixtures (
    email,
    full_name,
    council_position,
    functional_roles,
    is_active
  )
  join auth.users as users
    on lower(users.email) = fixtures.email;

  get diagnostics inserted_profiles = row_count;

  if inserted_profiles <> 3 then
    raise exception
      'Expected three fictional profiles, but inserted %.',
      inserted_profiles;
  end if;
end;
$setup$;

commit;
