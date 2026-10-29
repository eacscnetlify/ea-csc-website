-- Batch 3: manual records and versions integrity tests.
-- Run the entire script in the Supabase SQL Editor.
-- Fictional fixture rows are rolled back.

begin;

do $test$
declare
  test_record_a text := 'EACSC-2099-TEST-9001';
  test_record_b text := 'EACSC-2099-TEST-9002';
  missing_record text := 'EACSC-2099-TEST-9999';

  version_a1 uuid := gen_random_uuid();
  version_a2 uuid := gen_random_uuid();
  version_b1 uuid := gen_random_uuid();

  checks_passed integer := 0;

  test_case record;
  actual_state text;
  actual_constraint text;
begin
  -- Stop rather than reuse any existing record with a fixture ID.
  if exists (
    select 1
    from public.master_records
    where record_id in (
      test_record_a,
      test_record_b,
      missing_record
    )
  ) then
    raise exception
      'A reserved test record ID already exists. Stop and review it before continuing.';
  end if;

  -- Check 1: valid records and their defaults.
  insert into public.master_records (
    record_id,
    title,
    summary,
    category,
    document_type,
    originating_office,
    custodian_position
  )
  values
    (
      test_record_a,
      'Fictional integrity test record A',
      'Temporary fictional data for Batch 3 testing.',
      'Forms and official information',
      'Test form',
      'Fictional test office',
      'Fictional test custodian'
    ),
    (
      test_record_b,
      'Fictional integrity test record B',
      'Temporary fictional data for Batch 3 testing.',
      'Forms and official information',
      'Test form',
      'Fictional test office',
      'Fictional test custodian'
    );

  if (
    select count(*)
    from public.master_records
    where record_id in (test_record_a, test_record_b)
      and access_class = 'internal'
      and revision_counter = 1
  ) <> 2 then
    raise exception 'FAIL: valid records or defaults were incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Check 2: valid Draft versions.
  insert into public.record_versions (
    version_id,
    record_id,
    version_number,
    change_summary
  )
  values
    (
      version_a1,
      test_record_a,
      1,
      'Initial fictional capture for record A.'
    ),
    (
      version_b1,
      test_record_b,
      1,
      'Initial fictional capture for record B.'
    );

  if (
    select count(*)
    from public.record_versions
    where version_id in (version_a1, version_b1)
      and state = 'Draft'
      and revision_counter = 1
      and storage_key is null
  ) <> 2 then
    raise exception 'FAIL: valid Draft versions or defaults were incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Check 3: valid predecessor within the same master record.
  insert into public.record_versions (
    version_id,
    record_id,
    version_number,
    previous_version_id,
    change_summary
  )
  values (
    version_a2,
    test_record_a,
    2,
    version_a1,
    'Fictional second version linked to the first.'
  );

  if not exists (
    select 1
    from public.record_versions as current_version
    join public.record_versions as predecessor
      on predecessor.version_id =
        current_version.previous_version_id
      and predecessor.record_id = current_version.record_id
    where current_version.version_id = version_a2
      and predecessor.version_id = version_a1
      and current_version.version_number = 2
      and predecessor.version_number = 1
  ) then
    raise exception 'FAIL: valid predecessor relationship was incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Checks 4-9: each operation must fail for the expected reason.
  for test_case in
    select *
    from (
      values
        (
          'Malformed record ID',
          '23514',
          'master_records_id_format',
          format(
            $sql$
              insert into public.master_records (
                record_id,
                title,
                summary,
                category,
                document_type,
                originating_office,
                custodian_position
              )
              select
                'INVALID-ID',
                title,
                summary,
                category,
                document_type,
                originating_office,
                custodian_position
              from public.master_records
              where record_id = %L
            $sql$,
            test_record_a
          )
        ),
        (
          'Invalid category',
          '23514',
          'master_records_category_allowed',
          format(
            $sql$
              update public.master_records
              set category = 'Invalid category'
              where record_id = %L
            $sql$,
            test_record_a
          )
        ),
        (
          'Duplicate version number',
          '23505',
          'record_versions_record_number_unique',
          format(
            $sql$
              insert into public.record_versions (
                record_id,
                version_number,
                change_summary
              )
              values (%L, 1, 'Attempted duplicate version.')
            $sql$,
            test_record_a
          )
        ),
        (
          'Version without master record',
          '23503',
          'record_versions_record_fk',
          format(
            $sql$
              insert into public.record_versions (
                record_id,
                version_number,
                change_summary
              )
              values (%L, 1, 'Attempted orphan version.')
            $sql$,
            missing_record
          )
        ),
        (
          'Predecessor from another record',
          '23503',
          'record_versions_previous_same_record_fk',
          format(
            $sql$
              update public.record_versions
              set previous_version_id = %L::uuid
              where version_id = %L::uuid
            $sql$,
            version_b1,
            version_a2
          )
        ),
        (
          'Review without file metadata',
          '23514',
          'record_versions_file_required_for_review',
          format(
            $sql$
              update public.record_versions
              set state = 'For Review'
              where version_id = %L::uuid
            $sql$,
            version_a1
          )
        )
    ) as cases (
      test_name,
      expected_state,
      expected_constraint,
      statement_sql
    )
  loop
    begin
      execute test_case.statement_sql;

      raise exception
        'FAIL: % was unexpectedly accepted.',
        test_case.test_name;

    exception
      when check_violation
        or foreign_key_violation
        or unique_violation
      then
        get stacked diagnostics
          actual_state = returned_sqlstate,
          actual_constraint = constraint_name;

        if actual_state is distinct from
            test_case.expected_state
          or actual_constraint is distinct from
            test_case.expected_constraint
        then
          raise exception
            'FAIL: % expected % / %, but received % / %.',
            test_case.test_name,
            test_case.expected_state,
            test_case.expected_constraint,
            actual_state,
            actual_constraint;
        end if;
    end;

    checks_passed := checks_passed + 1;
  end loop;

  if checks_passed <> 9 then
    raise exception
      'FAIL: expected 9 completed checks, received %.',
      checks_passed;
  end if;
end;
$test$;

-- Cancel all fictional inserts made above.
rollback;

-- This summary is reached after the assertions and rollback succeed.
with remaining as (
  select
    (
      select count(*)
      from public.master_records
      where record_id in (
        'EACSC-2099-TEST-9001',
        'EACSC-2099-TEST-9002',
        'EACSC-2099-TEST-9999'
      )
    ) as remaining_test_records,
    (
      select count(*)
      from public.record_versions
      where record_id in (
        'EACSC-2099-TEST-9001',
        'EACSC-2099-TEST-9002',
        'EACSC-2099-TEST-9999'
      )
    ) as remaining_test_versions
)
select
  case
    when remaining_test_records = 0
      and remaining_test_versions = 0
      then 'PASS'
    else 'FAIL: test rows remain'
  end as result,
  9 as checks_completed,
  remaining_test_records,
  remaining_test_versions
from remaining;
