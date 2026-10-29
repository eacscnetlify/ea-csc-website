-- Batch 3: manual bulletin integrity tests.
-- Run the complete script in the Supabase SQL Editor.
-- All file, approval, and release references are fictional.
-- No file is uploaded and all application fixtures are rolled back.

begin;

do $test$
declare
  test_email text := 'batch3-integrity@example.invalid';
  test_actor_id uuid;
  missing_profile_id uuid := gen_random_uuid();

  test_bulletin_id text := 'EACSC-2099-BUL-9201';
  archive_record_id text := 'EACSC-2099-BUL-9201';
  source_record_id text := 'EACSC-2099-TEST-9202';

  archive_version_id uuid := gen_random_uuid();
  source_version_id uuid := gen_random_uuid();

  first_issue_uuid uuid := gen_random_uuid();
  correction_issue_uuid uuid := gen_random_uuid();
  issuance_request uuid := gen_random_uuid();

  archive_key text;
  source_key text;

  checks_passed integer := 0;
  operation_rejected boolean;

  test_case record;
  actual_state text;
  actual_constraint text;
begin
  select id
  into strict test_actor_id
  from auth.users
  where lower(email) = test_email
    and email_confirmed_at is not null;

  if exists (
    select 1
    from public.app_users
    where user_id = test_actor_id
      or lower(email) = test_email
  ) then
    raise exception
      'A reserved test profile already exists. Stop and review it.';
  end if;

  if exists (
    select 1
    from public.master_records
    where record_id in (
      archive_record_id,
      source_record_id
    )
  ) then
    raise exception
      'A reserved test record ID already exists. Stop and review it.';
  end if;

  if exists (
    select 1
    from public.update_bulletins
    where bulletin_id = test_bulletin_id
  ) then
    raise exception
      'The reserved test bulletin ID already exists. Stop and review it.';
  end if;

  while exists (
    select 1
    from public.app_users
    where user_id = missing_profile_id
  )
  loop
    missing_profile_id := gen_random_uuid();
  end loop;

  archive_key :=
    'batch3-fixtures/' || archive_version_id::text || '.pdf';

  source_key :=
    'batch3-fixtures/' || source_version_id::text || '.pdf';

  insert into public.app_users (
    user_id,
    email,
    full_name
  )
  values (
    test_actor_id,
    test_email,
    'Fictional Bulletin Test Officer'
  );

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
      archive_record_id,
      'Fictional bulletin archive fixture',
      'Forms and official information',
      'Update bulletin',
      'Fictional test office',
      'Fictional test custodian'
    ),
    (
      source_record_id,
      'Fictional bulletin source fixture',
      'Forms and official information',
      'Test document',
      'Fictional test office',
      'Fictional test custodian'
    );

  -- These are schema fixtures, not actual approved documents.
  insert into public.record_versions (
    version_id,
    record_id,
    version_number,
    state,
    change_summary,
    storage_key,
    original_filename,
    mime_type,
    file_size_bytes,
    sha256,
    approval_basis,
    approval_evidence_reference,
    approval_not_required_reason,
    approval_recorded_by
  )
  values
    (
      archive_version_id,
      archive_record_id,
      1,
      'Approved',
      'Fictional bulletin archive fixture.',
      archive_key,
      'fictional-bulletin.pdf',
      'application/pdf',
      128,
      repeat('a', 64),
      'Fictional schema verification only.',
      'fixture:archive-verification',
      'Fictional fixture; no institutional decision is represented.',
      test_actor_id
    ),
    (
      source_version_id,
      source_record_id,
      1,
      'Approved',
      'Fictional source document fixture.',
      source_key,
      'fictional-source.pdf',
      'application/pdf',
      128,
      repeat('b', 64),
      'Fictional schema verification only.',
      'fixture:source-verification',
      'Fictional fixture; no institutional decision is represented.',
      test_actor_id
    );

  -- Check 1: valid Draft and its defaults.
  insert into public.update_bulletins (
    bulletin_id,
    issue_uuid,
    title,
    coverage_start,
    coverage_end,
    cutoff_at,
    prepared_by
  )
  values (
    test_bulletin_id,
    first_issue_uuid,
    'Fictional bulletin integrity fixture',
    '2026-01-01'::date,
    '2026-01-31'::date,
    '2026-01-31 23:59:59+08'::timestamptz,
    test_actor_id
  );

  if not exists (
    select 1
    from public.update_bulletins
    where issue_uuid = first_issue_uuid
      and issue_version = 1
      and revision_counter = 1
      and issue_status = 'Draft'
      and audience = 'internal'
      and source_snapshot = '[]'::jsonb
      and pdf_storage_key is null
  ) then
    raise exception 'FAIL: Draft bulletin defaults were incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Check 2: complete fictional Issued metadata.
  update public.update_bulletins
  set
    issue_status = 'Issued',
    source_snapshot = jsonb_build_array(
      jsonb_build_object(
        'record_id', source_record_id,
        'version_id', source_version_id,
        'release_id', gen_random_uuid(),
        'summary', 'Fictional source selection.'
      )
    ),
    archive_record_id = 'EACSC-2099-BUL-9201',
archive_version_id = (
  select version_id
  from public.record_versions
  where record_id = 'EACSC-2099-BUL-9201'
    and version_number = 1
),
    pdf_storage_key = archive_key,
    pdf_size_bytes = 128,
    pdf_sha256 = repeat('a', 64),
    issued_by = test_actor_id,
    issued_at = now(),
    publication_reference = 'fixture:bulletin-issue',
    issuance_request_id = issuance_request
  where issue_uuid = first_issue_uuid;

  if not exists (
    select 1
    from public.update_bulletins as bulletin
    join public.record_versions as version
      on version.record_id = bulletin.archive_record_id
      and version.version_id = bulletin.archive_version_id
    where bulletin.issue_uuid = first_issue_uuid
      and bulletin.issue_status = 'Issued'
      and bulletin.pdf_storage_key = version.storage_key
      and bulletin.pdf_sha256 = version.sha256
  ) then
    raise exception 'FAIL: complete bulletin/archive metadata was incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Check 3: a new Draft issue can reference the earlier issue.
  insert into public.update_bulletins (
    bulletin_id,
    issue_version,
    issue_uuid,
    title,
    coverage_start,
    coverage_end,
    cutoff_at,
    prepared_by,
    corrects_issue_uuid,
    correction_reason
  )
  values (
    test_bulletin_id,
    2,
    correction_issue_uuid,
    'Fictional corrected bulletin fixture',
    '2026-01-01'::date,
    '2026-01-31'::date,
    '2026-01-31 23:59:59+08'::timestamptz,
    test_actor_id,
    first_issue_uuid,
    'Fictional correction reference for schema testing.'
  );

  if not exists (
    select 1
    from public.update_bulletins as correction
    join public.update_bulletins as earlier
      on earlier.issue_uuid = correction.corrects_issue_uuid
    where correction.issue_uuid = correction_issue_uuid
      and correction.issue_version = 2
      and correction.issue_status = 'Draft'
      and earlier.issue_uuid = first_issue_uuid
      and earlier.issue_version = 1
  ) then
    raise exception 'FAIL: correction relationship was incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Check 4: complete withdrawal metadata preserves the PDF reference.
  update public.update_bulletins
  set
    issue_status = 'Withdrawn',
    withdrawn_by = test_actor_id,
    withdrawn_at = now(),
    withdrawal_reason = 'Fictional withdrawal for integrity testing.'
  where issue_uuid = first_issue_uuid;

  if not exists (
    select 1
    from public.update_bulletins
    where issue_uuid = first_issue_uuid
      and issue_status = 'Withdrawn'
      and withdrawn_by = test_actor_id
      and pdf_storage_key = archive_key
      and pdf_sha256 = repeat('a', 64)
  ) then
    raise exception 'FAIL: withdrawal metadata was incorrect.';
  end if;

  checks_passed := checks_passed + 1;

  -- Checks 5-20: each invalid operation must be rejected.
  for test_case in
    select *
    from (
      values
        (
          'Malformed bulletin ID',
          '23514',
          'update_bulletins_id_format',
          format(
            $sql$update public.update_bulletins
              set bulletin_id = 'INVALID-ID'
              where issue_uuid = %L::uuid$sql$,
            correction_issue_uuid
          )
        ),
        (
          'Duplicate issue version',
          '23505',
          'update_bulletins_pkey',
          format(
            $sql$update public.update_bulletins
              set issue_version = 1
              where issue_uuid = %L::uuid$sql$,
            correction_issue_uuid
          )
        ),
        (
          'Reversed coverage dates',
          '23514',
          'update_bulletins_coverage_order',
          format(
            $sql$update public.update_bulletins
              set coverage_end = coverage_start - 1
              where issue_uuid = %L::uuid$sql$,
            correction_issue_uuid
          )
        ),
        (
          'Cutoff before coverage end',
          '23514',
          'update_bulletins_cutoff_covers_period',
          format(
            $sql$update public.update_bulletins
              set cutoff_at = '2026-01-30 00:00:00+08'::timestamptz
              where issue_uuid = %L::uuid$sql$,
            correction_issue_uuid
          )
        ),
        (
          'Invalid audience',
          '23514',
          'update_bulletins_audience_allowed',
          format(
            $sql$update public.update_bulletins
              set audience = 'restricted'
              where issue_uuid = %L::uuid$sql$,
            correction_issue_uuid
          )
        ),
        (
          'Invalid issue status',
          '23514',
          null::text,
          format(
            $sql$update public.update_bulletins
              set issue_status = 'Published'
              where issue_uuid = %L::uuid$sql$,
            correction_issue_uuid
          )
        ),
        (
          'Source snapshot is not an array',
          '23514',
          'update_bulletins_sources_are_array',
          format(
            $sql$update public.update_bulletins
              set source_snapshot = '{}'::jsonb
              where issue_uuid = %L::uuid$sql$,
            correction_issue_uuid
          )
        ),
        (
          'Preparer profile does not exist',
          '23503',
          'update_bulletins_preparer_fk',
          format(
            $sql$update public.update_bulletins
              set prepared_by = %L::uuid
              where issue_uuid = %L::uuid$sql$,
            missing_profile_id,
            correction_issue_uuid
          )
        ),
        (
          'Duplicate issuance request',
          '23505',
          'update_bulletins_request_unique',
          format(
            $sql$update public.update_bulletins
              set issuance_request_id = %L::uuid
              where issue_uuid = %L::uuid$sql$,
            issuance_request,
            correction_issue_uuid
          )
        ),
        (
          'Incomplete PDF metadata',
          '23514',
          'update_bulletins_pdf_metadata_complete',
          format(
            $sql$update public.update_bulletins
              set pdf_sha256 = null
              where issue_uuid = %L::uuid$sql$,
            first_issue_uuid
          )
        ),
        (
          'Invalid PDF hash format',
          '23514',
          'update_bulletins_pdf_metadata_valid',
          format(
            $sql$update public.update_bulletins
              set pdf_sha256 = 'bad-hash'
              where issue_uuid = %L::uuid$sql$,
            first_issue_uuid
          )
        ),
        (
          'PDF exceeds provisional size limit',
          '23514',
          'update_bulletins_pdf_metadata_valid',
          format(
            $sql$update public.update_bulletins
              set pdf_size_bytes = 10000001
              where issue_uuid = %L::uuid$sql$,
            first_issue_uuid
          )
        ),
        (
          'Issued source selection is empty',
          '23514',
          'update_bulletins_issuance_metadata_complete',
          format(
            $sql$update public.update_bulletins
              set source_snapshot = '[]'::jsonb
              where issue_uuid = %L::uuid$sql$,
            first_issue_uuid
          )
        ),
        (
          'Archive version belongs to another record',
          '23503',
          'update_bulletins_archive_version_fk',
          format(
            $sql$update public.update_bulletins
              set archive_version_id = %L::uuid
              where issue_uuid = %L::uuid$sql$,
            source_version_id,
            first_issue_uuid
          )
        ),
        (
          'Withdrawal reason is missing',
          '23514',
          'update_bulletins_withdrawal_metadata_complete',
          format(
            $sql$update public.update_bulletins
              set withdrawal_reason = null
              where issue_uuid = %L::uuid$sql$,
            first_issue_uuid
          )
        ),
        (
          'Issue attempts to correct itself',
          '23514',
          'update_bulletins_correction_reference_complete',
          format(
            $sql$update public.update_bulletins
              set corrects_issue_uuid = %L::uuid
              where issue_uuid = %L::uuid$sql$,
            correction_issue_uuid,
            correction_issue_uuid
          )
        )
    ) as cases (
      test_name,
      expected_state,
      expected_constraint,
      statement_sql
    )
  loop
    operation_rejected := false;

    begin
      execute test_case.statement_sql;

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
          or (
            test_case.expected_constraint is not null
            and actual_constraint is distinct from
              test_case.expected_constraint
          )
        then
          raise exception
            'FAIL: % received unexpected error: % / %.',
            test_case.test_name,
            actual_state,
            actual_constraint;
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

  if checks_passed <> 20 then
    raise exception
      'FAIL: expected 20 checks, received %.',
      checks_passed;
  end if;
end;
$test$;

rollback;

with remaining as (
  select
    (
      select count(*)
      from public.app_users
      where lower(email) = 'batch3-integrity@example.invalid'
    ) as profiles,
    (
      select count(*)
      from public.master_records
      where record_id in (
        'EACSC-2099-BUL-9201',
        'EACSC-2099-TEST-9202'
      )
    ) as records,
    (
      select count(*)
      from public.record_versions
      where record_id in (
        'EACSC-2099-BUL-9201',
        'EACSC-2099-TEST-9202'
      )
    ) as versions,
    (
      select count(*)
      from public.update_bulletins
      where bulletin_id = 'EACSC-2099-BUL-9201'
    ) as bulletins,
    (
      select count(*)
      from auth.users
      where lower(email) = 'batch3-integrity@example.invalid'
    ) as auth_users
)
select
  case
    when profiles + records + versions + bulletins = 0
      and auth_users = 1
      then 'PASS'
    else 'FAIL: unexpected cleanup result'
  end as result,
  20 as checks_completed,
  profiles + records + versions + bulletins
    as remaining_fixture_rows,
  auth_users as remaining_auth_users
from remaining;
