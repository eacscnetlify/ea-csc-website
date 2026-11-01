-- Development fixture only. Create the confirmed Auth user first.
begin;

do $$
declare
  reviewer_id uuid;
  custodian_id uuid;
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;

  select id into strict reviewer_id
  from auth.users
  where lower(email) = 'batch6-reviewer@example.invalid'
    and email_confirmed_at is not null
    and is_anonymous is false
    and deleted_at is null
    and (banned_until is null or banned_until <= clock_timestamp());

  select p.user_id into strict custodian_id
  from public.app_users p
  join public.record_assignments a on a.user_id = p.user_id
  where p.email = 'batch4-custodian@example.invalid'
    and p.is_active
    and 'custodian' = any(p.functional_roles)
    and a.record_id = 'EACSC-2099-HTTP-9601'
    and a.assignment_function = 'custodian'
    and a.is_active;

  if exists (
    select 1 from public.app_users where user_id = reviewer_id
  ) then
    if not exists (
      select 1 from public.app_users
      where user_id = reviewer_id
        and email = 'batch6-reviewer@example.invalid'
        and is_active
        and functional_roles = array['reviewer']::text[]
    ) then
      raise exception 'Existing Reviewer profile differs. Stop and inspect.';
    end if;
  else
    insert into public.app_users (
      user_id, email, full_name, functional_roles, is_active
    )
    values (
      reviewer_id,
      'batch6-reviewer@example.invalid',
      'Fictional Batch 6 Reviewer',
      array['reviewer'],
      true
    );
  end if;

  if exists (
    select 1 from public.record_assignments
    where record_id = 'EACSC-2099-HTTP-9601'
      and user_id = reviewer_id
      and assignment_function = 'reviewer'
  ) then
    if not exists (
      select 1 from public.record_assignments
      where record_id = 'EACSC-2099-HTTP-9601'
        and user_id = reviewer_id
        and assignment_function = 'reviewer'
        and is_active
        and not allow_restricted
    ) then
      raise exception 'Existing Reviewer assignment differs. Stop and inspect.';
    end if;
  else
    insert into public.record_assignments (
      record_id, user_id, assignment_function,
      is_active, allow_restricted, assigned_by
    )
    values (
      'EACSC-2099-HTTP-9601',
      reviewer_id,
      'reviewer',
      true,
      false,
      custodian_id
    );
  end if;
end;
$$;

commit;

select
  p.email,
  a.record_id,
  a.assignment_function,
  a.is_active,
  a.allow_restricted
from public.app_users p
join public.record_assignments a on a.user_id = p.user_id
where p.email = 'batch6-reviewer@example.invalid'
  and a.record_id = 'EACSC-2099-HTTP-9601'
  and a.assignment_function = 'reviewer';
