-- Batch 3: manual profile and audit integrity tests.
-- Run the entire script in the Supabase SQL Editor.
-- Requires the confirmed fictional Auth user created earlier.
-- Fixture rows are rolled back; the Auth identity remains.

begin;

do $test$
declare
  test_email text := 'batch3-integrity@example.invalid';
  orphan_email text := 'batch3-orphan@example.invalid';

  test_actor_id uuid;
  missing_user_id uuid := gen_random_uuid();

  test_record_a text := 'EACSC-2099-TEST-9101';
  test_record_b text := 'EACSC-2099-TEST-9102';

  version_a uuid := gen_random_uuid();
  version_b uuid := gen_random_uuid();
  test_event_uuid uuid := gen_random_uuid();

  block_message text :=
    'Audit events are append-only. Record a new event instead of changing existing history.';

  checks_passed integer := 0;
  operation_rejected boolean;

  test_case record;
  actual_state text;
  actual_constraint text;
  actual_message text;
begin
  select id
  into strict test_actor_id
  from auth.users
  where lower(email) = test_email
    and email_confirmed_at is not null;

  -- This schema-stage test requires an empty audit table.
  -- Stop rather than clear any existing history.
  if exists (
    select 1 from public.audit_events
  ) then
    raise exception
      'Audit history already exists. Stop and review it; do not clear the table.';
  end if;

  if exists (
    select 1
    from public.app_users
    where user_id = test_actor_id
      or lower(email) in (test_email, orphan_email)
  ) then
    raise exception
      'A reserved test profile already exists. Stop and review it.';
  end if;

  if exists (
    select 1
    from public.master_records
    where record_id in (test_record_a, test_record_b)
  ) then
    raise exception
      'A reserved test record ID already exists. Stop and review it.';
  end if;

  while exists (
    select 1
    from auth.users
    where id = missing_user_id
  ) or exists (
    select 1
    from public.app_users
    where user_id = missing_user_id
  )
  loop
    missing_user_id := gen_random_uuid();
  end loop;

  -- Check 1: valid profile with safe defaults.
  insert into public.app_users (
    user_id,
    email,
    full_name,
    council_position
  )
  values (
    test_actor_id,
    test_email,
    'Batch 3 Fictional Test Officer',
    'Fictional test position'
  );

  if not exists (
    select 1
    from public.app_users
    where user_id = test_actor_id
      and is_active = false
      and functional_roles = '{}'::text[]
      and revision_counter = 1
  ) then
    raise exception 'FAIL: profile defaults were incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Supporting fictional records and Draft versions.
  insert into public.master_records (
    record_id,
    title,
    category,
    document_type,
    originating_office,
    custodian_position
  )
  values
    (
      test_record_a,
      'Fictional audit test record A',
      'Forms and official information',
      'Test form',
      'Fictional test office',
      'Fictional test custodian'
    ),
    (
      test_record_b,
      'Fictional audit test record B',
      'Forms and official information',
      'Test form',
      'Fictional test office',
      'Fictional test custodian'
    );

  insert into public.record_versions (
    version_id,
    record_id,
    version_number,
    change_summary
  )
  values
    (
      version_a,
      test_record_a,
      1,
      'Initial fictional audit-test capture A.'
    ),
    (
      version_b,
      test_record_b,
      1,
      'Initial fictional audit-test capture B.'
    );

  -- Check 2: valid audit event and relationships.
  insert into public.audit_events (
    event_uuid,
    record_id,
    version_id,
    actor_user_id,
    action_type,
    action_summary,
    new_revision,
    new_state,
    client_occurred_at,
    server_occurred_at
  )
  values (
    test_event_uuid,
    test_record_a,
    version_a,
    test_actor_id,
    'batch3.integrity_fixture',
    'Fictional audit event for integrity testing.',
    1,
    jsonb_build_object(
      'record_id', test_record_a,
      'version_id', version_a,
      'revision_counter', 1
    ),
    '2099-01-01 00:00:00+00'::timestamptz,
    '2000-01-01 00:00:00+00'::timestamptz
  );

  if not exists (
    select 1
    from public.audit_events as event
    join public.app_users as actor
      on actor.user_id = event.actor_user_id
    join public.record_versions as version
      on version.record_id = event.record_id
      and version.version_id = event.version_id
    where event.event_uuid = test_event_uuid
      and actor.user_id = test_actor_id
      and version.version_id = version_a
      and event.new_state ->> 'record_id' = test_record_a
  ) then
    raise exception 'FAIL: valid audit relationships were incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Check 3: server time replaces the supplied value.
  -- Client time remains supporting, non-authoritative data.
  if not exists (
    select 1
    from public.audit_events
    where event_uuid = test_event_uuid
      and server_occurred_at = now()
      and server_occurred_at <>
        '2000-01-01 00:00:00+00'::timestamptz
      and client_occurred_at =
        '2099-01-01 00:00:00+00'::timestamptz
  ) then
    raise exception 'FAIL: authoritative audit timestamp was incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Checks 4-14: expected rejections.
  for test_case in
    select *
    from (
      values
        (
          'Profile without Auth identity',
          '23503',
          'app_users_user_id_fkey',
          null::text,
          format(
            $sql$
              insert into public.app_users (
                user_id, email, full_name
              )
              values (
                %L::uuid,
                %L,
                'Fictional orphan profile'
              )
            $sql$,
            missing_user_id,
            orphan_email
          )
        ),
        (
          'Blank profile name',
          '23514',
          'app_users_full_name_not_blank',
          null::text,
          format(
            $sql$
              update public.app_users
              set full_name = '   '
              where user_id = %L::uuid
            $sql$,
            test_actor_id
          )
        ),
        (
          'Unknown functional role',
          '23514',
          'app_users_roles_allowed',
          null::text,
          format(
            $sql$
              update public.app_users
              set functional_roles = array['superuser']::text[]
              where user_id = %L::uuid
            $sql$,
            test_actor_id
          )
        ),
        (
          'Malformed profile email',
          '23514',
          'app_users_email_format',
          null::text,
          format(
            $sql$
              update public.app_users
              set email = 'not-an-email'
              where user_id = %L::uuid
            $sql$,
            test_actor_id
          )
        ),
        (
          'Audit event without valid actor',
          '23503',
          'audit_events_actor_fk',
          null::text,
          format(
            $sql$
              insert into public.audit_events (
                actor_user_id,
                action_type,
                action_summary
              )
              values (
                %L::uuid,
                'batch3.integrity_fixture',
                'Attempted event with nonexistent actor.'
              )
            $sql$,
            missing_user_id
          )
        ),
        (
          'Audit version from another record',
          '23503',
          'audit_events_version_same_record_fk',
          null::text,
          format(
            $sql$
              insert into public.audit_events (
                record_id,
                version_id,
                actor_user_id,
                action_type,
                action_summary
              )
              values (
                %L,
                %L::uuid,
                %L::uuid,
                'batch3.integrity_fixture',
                'Attempted mismatched record/version reference.'
              )
            $sql$,
            test_record_a,
            version_b,
            test_actor_id
          )
        ),
        (
          'Audit snapshot with array instead of object',
          '23514',
          'audit_events_snapshots_are_objects',
          null::text,
          format(
            $sql$
              insert into public.audit_events (
                actor_user_id,
                action_type,
                action_summary,
                new_state
              )
              values (
                %L::uuid,
                'batch3.integrity_fixture',
                'Attempted invalid snapshot shape.',
                '[]'::jsonb
              )
            $sql$,
            test_actor_id
          )
        ),
        (
          'Duplicate audit event UUID',
          '23505',
          'audit_events_event_uuid_unique',
          null::text,
          format(
            $sql$
              insert into public.audit_events (
                event_uuid,
                actor_user_id,
                action_type,
                action_summary
              )
              values (
                %L::uuid,
                %L::uuid,
                'batch3.integrity_fixture',
                'Attempted duplicate event UUID.'
              )
            $sql$,
            test_event_uuid,
            test_actor_id
          )
        ),
        (
          'Audit UPDATE',
          '55000',
          null::text,
          block_message,
          format(
            $sql$
              update public.audit_events
              set action_summary = 'Attempted history alteration.'
              where event_uuid = %L::uuid
            $sql$,
            test_event_uuid
          )
        ),
        (
          'Audit DELETE',
          '55000',
          null::text,
          block_message,
          format(
            $sql$
              delete from public.audit_events
              where event_uuid = %L::uuid
            $sql$,
            test_event_uuid
          )
        ),
        (
          'Audit TRUNCATE',
          '55000',
          null::text,
          block_message,
          'truncate table public.audit_events'
        )
    ) as cases (
      test_name,
      expected_state,
      expected_constraint,
      expected_message,
      statement_sql
    )
  loop
    operation_rejected := false;

    begin
      execute test_case.statement_sql;

    exception
      when others then
        get stacked diagnostics
          actual_state = returned_sqlstate,
          actual_constraint = constraint_name,
          actual_message = message_text;

        if actual_state is distinct from
            test_case.expected_state
          or (
            test_case.expected_constraint is not null
            and actual_constraint is distinct from
              test_case.expected_constraint
          )
          or (
            test_case.expected_message is not null
            and actual_message is distinct from
              test_case.expected_message
          )
        then
          raise exception
            'FAIL: % received unexpected error: % / % / %.',
            test_case.test_name,
            actual_state,
            actual_constraint,
            actual_message;
        end if;

        operation_rejected := true;
    end;

    if not operation_rejected then
      raise exception
        'FAIL: % was unexpectedly accepted.',
        test_case.test_name;
    end if;

    checks_passed := checks_passed + 1;
  end loop;

  if checks_passed <> 14 then
    raise exception
      'FAIL: expected 14 checks, received %.',
      checks_passed;
  end if;

  if not exists (
    select 1
    from public.audit_events
    where event_uuid = test_event_uuid
      and action_summary =
        'Fictional audit event for integrity testing.'
  ) then
    raise exception 'FAIL: original audit fixture was not preserved.';
  end if;
end;
$test$;

-- Remove the fictional application rows.
-- The separately created Auth identity remains.
rollback;

with remaining as (
  select
    (
      select count(*)
      from public.app_users
      where lower(email) in (
        'batch3-integrity@example.invalid',
        'batch3-orphan@example.invalid'
      )
    ) as profiles,
    (
      select count(*)
      from public.master_records
      where record_id in (
        'EACSC-2099-TEST-9101',
        'EACSC-2099-TEST-9102'
      )
    ) as records,
    (
      select count(*)
      from public.record_versions
      where record_id in (
        'EACSC-2099-TEST-9101',
        'EACSC-2099-TEST-9102'
      )
    ) as versions,
    (
      select count(*)
      from public.audit_events
      where action_type = 'batch3.integrity_fixture'
    ) as events,
    (
      select count(*)
      from auth.users
      where lower(email) =
        'batch3-integrity@example.invalid'
    ) as auth_users
)
select
  case
    when profiles + records + versions + events = 0
      and auth_users = 1
      then 'PASS'
    else 'FAIL: unexpected cleanup result'
  end as result,
  14 as checks_completed,
  profiles + records + versions + events
    as remaining_fixture_rows,
  auth_users as remaining_auth_users
from remaining;
