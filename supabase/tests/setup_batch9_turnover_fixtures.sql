-- Development fixtures only.
-- Apply ONCE as postgres after creating the three Auth users.

begin;

do $setup$
declare
  outgoing_id uuid;
  incoming_id uuid;
  admin_id uuid;
  fixture_number integer;
  new_record_id text;
  new_version_id uuid;
begin
  if current_user <> 'postgres' then
    raise exception
      'Run as postgres in the development project.';
  end if;

  if to_regprocedure(
    'public.eacsc_save_turnover_package_v2(uuid,integer,text,text,uuid,text,text,text,text,text,uuid)'
  ) is null then
    raise exception
      'The Slice 9A backend correction is required.';
  end if;

  if (
    select count(*)
    from auth.users
    where lower(email) in (
      'batch9-outgoing@example.invalid',
      'batch9-incoming@example.invalid',
      'batch9-admin@example.invalid'
    )
      and email_confirmed_at is not null
      and is_anonymous is false
  ) <> 3 then
    raise exception
      'Create and confirm the three permanent Batch 9 Auth users first.';
  end if;

  select id into strict outgoing_id
  from auth.users
  where lower(email) = 'batch9-outgoing@example.invalid';

  select id into strict incoming_id
  from auth.users
  where lower(email) = 'batch9-incoming@example.invalid';

  select id into strict admin_id
  from auth.users
  where lower(email) = 'batch9-admin@example.invalid';

  if exists (
    select 1
    from public.app_users
    where user_id in (outgoing_id, incoming_id, admin_id)
      or lower(email) in (
        'batch9-outgoing@example.invalid',
        'batch9-incoming@example.invalid',
        'batch9-admin@example.invalid'
      )
  ) or exists (
    select 1
    from public.master_records
    where record_id in (
      'EACSC-2099-TURN-9701',
      'EACSC-2099-TURN-9702'
    )
  ) then
    raise exception
      'Batch 9 fixture data already exists. Do not rerun or delete it; inspect the current state.';
  end if;

  insert into public.app_users (
    user_id,
    email,
    full_name,
    council_position,
    functional_roles,
    is_active
  )
  values
    (
      outgoing_id,
      'batch9-outgoing@example.invalid',
      'Batch 9 Outgoing Secretary',
      'Fictional Batch9 Executive Secretary',
      array['custodian']::text[],
      true
    ),
    (
      incoming_id,
      'batch9-incoming@example.invalid',
      'Batch 9 Incoming Secretary',
      'Fictional Batch9 Incoming Officer',
      array['author']::text[],
      true
    ),
    (
      admin_id,
      'batch9-admin@example.invalid',
      'Batch 9 Technical Administrator',
      'Fictional Batch9 Technical Administrator',
      array['technical_admin']::text[],
      true
    );

  insert into public.audit_events (
    actor_user_id,
    action_type,
    action_summary,
    new_state
  )
  values (
    admin_id,
    'development.batch9_profiles_created',
    'Created three dedicated fictional Batch 9 profiles through administrative test setup.',
    jsonb_build_object(
      'outgoing_user_id', outgoing_id,
      'incoming_user_id', incoming_id,
      'admin_user_id', admin_id
    )
  );

  for fixture_number in 9701..9702 loop
    new_record_id :=
      'EACSC-2099-TURN-' || fixture_number;

    new_version_id := gen_random_uuid();

    insert into public.master_records (
      record_id,
      title,
      summary,
      category,
      document_type,
      originating_office,
      custodian_position,
      access_class
    )
    values (
      new_record_id,
      'FICTIONAL Batch 9 turnover reference ' || fixture_number,
      'Dedicated development fixture. Not an actual council record.',
      'Turnover and continuity',
      'Fictional turnover reference',
      'Fictional Batch9 Secretariat',
      'Fictional Batch9 Executive Secretary',
      case
        when fixture_number = 9702 then 'restricted'
        else 'internal'
      end
    );

    insert into public.record_versions (
      version_id,
      record_id,
      version_number,
      state,
      change_summary
    )
    values (
      new_version_id,
      new_record_id,
      1,
      'Draft',
      'Initial fictional turnover fixture; no attachment uploaded yet.'
    );

    insert into public.record_assignments (
      record_id,
      user_id,
      assignment_function,
      is_active,
      allow_restricted,
      assigned_by
    )
    values (
      new_record_id,
      outgoing_id,
      'custodian',
      true,
      fixture_number = 9702,
      admin_id
    );

    insert into public.audit_events (
      record_id,
      version_id,
      actor_user_id,
      action_type,
      action_summary,
      new_state
    )
    values (
      new_record_id,
      new_version_id,
      admin_id,
      'development.batch9_record_created',
      'Created a dedicated fictional turnover record and outgoing custodian assignment.',
      jsonb_build_object(
        'record_id', new_record_id,
        'version_id', new_version_id,
        'assigned_user_id', outgoing_id,
        'assignment_function', 'custodian',
        'allow_restricted', fixture_number = 9702
      )
    );
  end loop;
end;
$setup$;

commit;

select
  u.full_name,
  u.council_position,
  u.is_active,
  u.functional_roles,
  count(a.record_id) filter (
    where a.is_active
  ) as active_assignments
from public.app_users u
left join public.record_assignments a
  on a.user_id = u.user_id
where lower(u.email) in (
  'batch9-outgoing@example.invalid',
  'batch9-incoming@example.invalid',
  'batch9-admin@example.invalid'
)
group by
  u.user_id,
  u.full_name,
  u.council_position,
  u.is_active,
  u.functional_roles
order by u.full_name;
