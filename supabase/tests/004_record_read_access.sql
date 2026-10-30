-- Batch 4 read authorization tests, revision 2 (single-block harness).
-- Run the ENTIRE file as postgres after applying migration 20261030000300.
-- No migration changes are needed. Do not rerun the successful migration.
-- This single DO statement creates its own temporary helpers and runs all checks.
-- An intentionally caught private exception rolls back all test fixtures, helper
-- objects, grants and temporary profile changes before verifying cleanup.
-- Unexpected errors propagate and also roll back this statement's changes.
-- Database roles and request claims are simulated; this is not an HTTP/JWT test.
-- Expected: Success. No rows returned. A PASS notice is also emitted if displayed.

do $batch4_single_block$
declare
  author_id uuid;
  custodian_id uuid;
  inactive_id uuid;
  no_profile_id uuid;
  author_claims text;
  custodian_claims text;
  completed_checks integer := 0;
  original_profiles jsonb;
  observed_profiles jsonb;
  completion_token text := gen_random_uuid()::text;
  caught_detail text;
begin
  if current_user <> 'postgres' then
    raise exception 'Run this development test using the postgres SQL Editor role.';
  end if;

  begin
create temporary table batch4_read_results_v2 (
  check_name text primary key,
  passed boolean not null check (passed)
) on commit drop;
grant select, insert on pg_temp.batch4_read_results_v2 to anon, authenticated;
  execute format('grant usage on schema %I to anon, authenticated',
    pg_my_temp_schema()::regnamespace::text);

    execute $define_assert$
create function pg_temp.assert_read_v2(check_name text, actual boolean)
returns void language plpgsql security invoker set search_path = ''
as $assert$
begin
  if actual is not true then
    raise exception 'FAIL: %', check_name;
  end if;
  insert into pg_temp.batch4_read_results_v2 values (check_name, true);
end;
$assert$;
$define_assert$;

    execute $define_denial$
create function pg_temp.expect_read_denial_v2(check_name text, statement_sql text)
returns void language plpgsql security invoker set search_path = ''
as $deny$
declare
  denied boolean := false;
begin
  begin
    execute statement_sql;
  exception when insufficient_privilege then
    denied := true;
  end;
  perform pg_temp.assert_read_v2(check_name, denied);
end;
$deny$;
$define_denial$;

    grant execute on function pg_temp.assert_read_v2(text, boolean),
      pg_temp.expect_read_denial_v2(text, text) to anon, authenticated;

  select id into strict author_id from auth.users
    where lower(email) = 'batch4-author@example.invalid' and email_confirmed_at is not null;
  select id into strict custodian_id from auth.users
    where lower(email) = 'batch4-custodian@example.invalid' and email_confirmed_at is not null;
  select id into strict inactive_id from auth.users
    where lower(email) = 'batch4-inactive@example.invalid' and email_confirmed_at is not null;
  select id into strict no_profile_id from auth.users
    where lower(email) = 'batch4-no-profile@example.invalid' and email_confirmed_at is not null;

  if not exists (select 1 from public.app_users where user_id = author_id
       and is_active and functional_roles = array['author']::text[])
    or not exists (select 1 from public.app_users where user_id = custodian_id
       and is_active and functional_roles = array['custodian']::text[])
    or not exists (select 1 from public.app_users where user_id = inactive_id
       and not is_active and functional_roles = array['author']::text[])
    or exists (select 1 from public.app_users where user_id = no_profile_id)
  then
    raise exception 'Expected the original Batch 4 fixture profiles. Inspect them; do not rerun fixture setup blindly.';
  end if;

  if exists (select 1 from public.master_records where record_id in (
    'EACSC-2099-TEST-9401', 'EACSC-2099-TEST-9402', 'EACSC-2099-TEST-9403',
    'EACSC-2099-TEST-9404', 'EACSC-2099-TEST-9405')) then
    raise exception 'Reserved test record ID already exists. Stop and inspect it.';
  end if;

  original_profiles := (
    select jsonb_agg(to_jsonb(profile) order by profile.user_id)
    from public.app_users as profile
    where profile.user_id in (author_id, custodian_id, inactive_id)
  );

  insert into public.master_records (
    record_id, title, category, document_type, originating_office,
    custodian_position, access_class
  ) values
    ('EACSC-2099-TEST-9401','Fictional assigned internal record','Forms and official information','Test form','Fictional office','Fictional custodian','internal'),
    ('EACSC-2099-TEST-9402','Fictional revoked assignment record','Forms and official information','Test form','Fictional office','Fictional custodian','internal'),
    ('EACSC-2099-TEST-9403','Fictional restricted finance without permission','Financial archives','Test report','Fictional office','Fictional custodian','restricted'),
    ('EACSC-2099-TEST-9404','Fictional explicitly permitted restricted finance','Financial archives','Test report','Fictional office','Fictional custodian','restricted'),
    ('EACSC-2099-TEST-9405','Fictional public classification without release','Forms and official information','Test form','Fictional office','Fictional custodian','public');

  insert into public.record_assignments (
    record_id, user_id, assignment_function, is_active, allow_restricted, assigned_by
  ) values
    ('EACSC-2099-TEST-9401',author_id,'author',true,false,custodian_id),
    ('EACSC-2099-TEST-9401',custodian_id,'custodian',true,false,custodian_id),
    ('EACSC-2099-TEST-9401',custodian_id,'author',true,false,custodian_id),
    ('EACSC-2099-TEST-9401',inactive_id,'author',true,false,custodian_id),
    ('EACSC-2099-TEST-9402',custodian_id,'custodian',false,false,custodian_id),
    ('EACSC-2099-TEST-9403',author_id,'author',true,false,custodian_id),
    ('EACSC-2099-TEST-9403',custodian_id,'custodian',true,false,custodian_id),
    ('EACSC-2099-TEST-9404',custodian_id,'custodian',true,true,custodian_id),
    ('EACSC-2099-TEST-9404',custodian_id,'author',true,false,custodian_id),
    ('EACSC-2099-TEST-9405',custodian_id,'custodian',true,false,custodian_id);

  insert into public.record_versions (record_id, version_number, change_summary)
    select record_id, 1, 'Fictional Draft for authorization testing.'
    from public.master_records where record_id in (
      'EACSC-2099-TEST-9401','EACSC-2099-TEST-9402',
      'EACSC-2099-TEST-9403','EACSC-2099-TEST-9404');

  -- Fictional file identity and evidence only; these are NOT uploaded files.
  insert into public.record_versions (
    record_id, version_number, state, change_summary, storage_key,
    original_filename, mime_type, file_size_bytes, sha256, approval_basis,
    approval_evidence_reference, approval_not_required_reason, approval_recorded_by
  ) values
    ('EACSC-2099-TEST-9401',2,'Approved','Fictional approved version without release.',
     'batch4-read-test/9401-v2.pdf','fictional.pdf','application/pdf',128,repeat('a',64),
     'Fictional schema test','fixture:read-test','No institutional decision represented.',custodian_id),
    ('EACSC-2099-TEST-9405',1,'Approved','Fictional approved version without release.',
     'batch4-read-test/9405-v1.pdf','fictional.pdf','application/pdf',128,repeat('b',64),
     'Fictional schema test','fixture:read-test','No institutional decision represented.',custodian_id);

  author_claims := jsonb_build_object('sub',author_id,'role','authenticated','is_anonymous',false)::text;
  custodian_claims := jsonb_build_object('sub',custodian_id,'role','authenticated','is_anonymous',false)::text;

  execute 'reset role';

  perform set_config('request.jwt.claims', '{}', true);

  execute 'set local role anon';

  perform pg_temp.expect_read_denial_v2('Anonymous cannot read app_users', $sql$select user_id from public.app_users$sql$);

  perform pg_temp.expect_read_denial_v2('Anonymous cannot read master_records', $sql$select record_id from public.master_records$sql$);

  perform pg_temp.expect_read_denial_v2('Anonymous cannot read record_versions', $sql$select record_id from public.record_versions$sql$);

  perform pg_temp.expect_read_denial_v2('Anonymous cannot read record_assignments', $sql$select record_id from public.record_assignments$sql$);

  perform pg_temp.expect_read_denial_v2('Anonymous cannot execute private helper', $sql$select eacsc_private.can_read_record('EACSC-2099-TEST-9401',null,null)$sql$);

  execute 'reset role';

  perform set_config('request.jwt.claims', author_claims, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Author sees only assigned internal record', (select count(*) = 1 and min(record_id) = 'EACSC-2099-TEST-9401' from public.master_records));

  perform pg_temp.assert_read_v2('Author sees only its assigned Draft version', (select count(*) = 1 and min(state) = 'Draft' from public.record_versions));

  perform pg_temp.assert_read_v2('Author sees only permitted own assignment', (select count(*) = 1 and bool_and(user_id = author_id) from public.record_assignments));

  perform pg_temp.assert_read_v2('Author cannot read another profile', (select count(*) = 0 from public.app_users where user_id = custodian_id));

  perform pg_temp.assert_read_v2('Author cannot read approved version', (select count(*) = 0 from public.record_versions where state = 'Approved'));

  perform pg_temp.assert_read_v2('Author cannot read restricted finance', (select count(*) = 0 from public.master_records where record_id in ('EACSC-2099-TEST-9403','EACSC-2099-TEST-9404')));

  perform pg_temp.expect_read_denial_v2('Author cannot select profile email', $sql$select email from public.app_users$sql$);

  perform pg_temp.expect_read_denial_v2('Author cannot select private storage key', $sql$select storage_key from public.record_versions$sql$);

  perform pg_temp.expect_read_denial_v2('Author cannot select approval evidence', $sql$select approval_evidence_reference from public.record_versions$sql$);

  perform pg_temp.expect_read_denial_v2('Author cannot assign itself more roles', $sql$update public.app_users set functional_roles = array['approver']::text[] where false$sql$);

  perform pg_temp.expect_read_denial_v2('Author cannot edit or approve a base version', $sql$update public.record_versions set state = 'Approved' where false$sql$);

  perform pg_temp.expect_read_denial_v2('Author cannot edit base record metadata', $sql$update public.master_records set title = 'Attempted change' where false$sql$);

  perform pg_temp.expect_read_denial_v2('Author cannot create its own assignment', $sql$insert into public.record_assignments(record_id,user_id,assignment_function,assigned_by) select 'EACSC-2099-TEST-9401',auth.uid(),'approver',auth.uid() where false$sql$);

  perform pg_temp.expect_read_denial_v2('Author cannot forge audit events', $sql$insert into public.audit_events(actor_user_id,action_type,action_summary) select auth.uid(),'test','Attempted audit insert' where false$sql$);

  perform pg_temp.expect_read_denial_v2('Author cannot read operational audit history', $sql$select event_id from public.audit_events$sql$);

  perform pg_temp.expect_read_denial_v2('Author cannot read unissued bulletins', $sql$select bulletin_id from public.update_bulletins$sql$);

  execute 'reset role';

  perform set_config('request.jwt.claims', custodian_claims, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Custodian sees exactly three permitted records', (select count(*) = 3 from public.master_records));

  perform pg_temp.assert_read_v2('Custodian sees four permitted version rows', (select count(*) = 4 from public.record_versions));

  perform pg_temp.assert_read_v2('Custodian sees three matching own assignments', (select count(*) = 3 and bool_and(user_id = custodian_id and assignment_function = 'custodian') from public.record_assignments));

  perform pg_temp.assert_read_v2('Custodian cannot read restricted finance without extra permission', (select count(*) = 0 from public.master_records where record_id = 'EACSC-2099-TEST-9403'));

  perform pg_temp.assert_read_v2('Custodian can read explicitly permitted restricted finance', (select count(*) = 1 from public.master_records where record_id = 'EACSC-2099-TEST-9404'));

  perform pg_temp.assert_read_v2('Revoked assignment does not authorize a read', (select count(*) = 0 from public.master_records where record_id = 'EACSC-2099-TEST-9402'));

  perform pg_temp.expect_read_denial_v2('Custodian role does not grant base approval writes', $sql$update public.record_versions set state = 'Approved' where false$sql$);

  perform pg_temp.expect_read_denial_v2('Custodian cannot change assignment permissions directly', $sql$update public.record_assignments set allow_restricted = true where false$sql$);

  execute 'reset role';

  update public.app_users set is_active = false where user_id = author_id;

  execute 'reset role';

  perform set_config('request.jwt.claims', author_claims, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Deactivation immediately denies master_records with same claims', (select count(*) = 0 from public.master_records));

  perform pg_temp.assert_read_v2('Deactivation immediately denies record_versions with same claims', (select count(*) = 0 from public.record_versions));

  perform pg_temp.assert_read_v2('Deactivation immediately denies record_assignments with same claims', (select count(*) = 0 from public.record_assignments));

  perform pg_temp.assert_read_v2('Deactivated officer can still read own inactive status', (select count(*) = 1 and bool_and(not is_active) from public.app_users));

  execute 'reset role';

  update public.app_users set is_active = true where user_id = author_id;

  execute 'reset role';

  perform set_config('request.jwt.claims', author_claims, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Reactivation restores explicit read assignment', (select count(*) = 1 from public.master_records));

  execute 'reset role';

  update public.record_assignments set is_active = false where user_id = author_id and record_id = 'EACSC-2099-TEST-9401';

  execute 'reset role';

  perform set_config('request.jwt.claims', author_claims, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Assignment revocation immediately denies master read', (select count(*) = 0 from public.master_records));

  perform pg_temp.assert_read_v2('Assignment revocation immediately denies version read', (select count(*) = 0 from public.record_versions));

  execute 'reset role';

  update public.record_assignments set is_active = true where user_id = author_id and record_id = 'EACSC-2099-TEST-9401';

  update public.app_users set functional_roles = array['technical_admin']::text[] where user_id = author_id;

  execute 'reset role';

  perform set_config('request.jwt.claims', author_claims, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Technical administration alone does not authorize master_records', (select count(*) = 0 from public.master_records));

  perform pg_temp.assert_read_v2('Technical administration alone does not authorize record_versions', (select count(*) = 0 from public.record_versions));

  perform pg_temp.assert_read_v2('Technical administration alone does not authorize record_assignments', (select count(*) = 0 from public.record_assignments));

  execute 'reset role';

  update public.app_users set functional_roles = array['author']::text[] where user_id = author_id;

  update public.app_users set functional_roles = array['custodian','author']::text[] where user_id = custodian_id;

  execute 'reset role';

  perform set_config('request.jwt.claims', custodian_claims, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Restricted flag is checked on each specific assignment', (select count(*) = 1 and min(assignment_function) = 'custodian' from public.record_assignments where record_id = 'EACSC-2099-TEST-9404'));

  execute 'reset role';

  update public.app_users set functional_roles = array['custodian']::text[] where user_id = custodian_id;

  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub',inactive_id,'role','authenticated','is_anonymous',false)::text, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Inactive fixture has no master_records access', (select count(*) = 0 from public.master_records));

  perform pg_temp.assert_read_v2('Inactive fixture has no record_versions access', (select count(*) = 0 from public.record_versions));

  perform pg_temp.assert_read_v2('Inactive fixture has no record_assignments access', (select count(*) = 0 from public.record_assignments));

  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub',no_profile_id,'role','authenticated','is_anonymous',false)::text, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Missing profile fixture has no master_records access', (select count(*) = 0 from public.master_records));

  perform pg_temp.assert_read_v2('Missing profile fixture has no record_versions access', (select count(*) = 0 from public.record_versions));

  perform pg_temp.assert_read_v2('Missing profile fixture has no record_assignments access', (select count(*) = 0 from public.record_assignments));

  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub',author_id,'role','authenticated','is_anonymous',true)::text, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Anonymous signed-in identity has no master_records access', (select count(*) = 0 from public.master_records));

  perform pg_temp.assert_read_v2('Anonymous signed-in identity has no record_versions access', (select count(*) = 0 from public.record_versions));

  perform pg_temp.assert_read_v2('Anonymous signed-in identity has no record_assignments access', (select count(*) = 0 from public.record_assignments));

  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub',author_id,'role','authenticated')::text, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Missing anonymous claim has no master_records access', (select count(*) = 0 from public.master_records));

  perform pg_temp.assert_read_v2('Missing anonymous claim has no record_versions access', (select count(*) = 0 from public.record_versions));

  perform pg_temp.assert_read_v2('Missing anonymous claim has no record_assignments access', (select count(*) = 0 from public.record_assignments));

  execute 'reset role';

  perform set_config('request.jwt.claims', '{}', true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('Missing authenticated identity has no master_records access', (select count(*) = 0 from public.master_records));

  perform pg_temp.assert_read_v2('Missing authenticated identity has no record_versions access', (select count(*) = 0 from public.record_versions));

  perform pg_temp.assert_read_v2('Missing authenticated identity has no record_assignments access', (select count(*) = 0 from public.record_assignments));

  execute 'reset role';

  perform set_config('request.jwt.claims', custodian_claims, true);

  execute 'set local role authenticated';

  perform pg_temp.assert_read_v2('No authenticated write privileges on app_users', (not has_table_privilege('authenticated','public.app_users','INSERT') and not has_table_privilege('authenticated','public.app_users','UPDATE') and not has_table_privilege('authenticated','public.app_users','DELETE') and not has_table_privilege('authenticated','public.app_users','TRUNCATE') and not has_any_column_privilege('authenticated','public.app_users','INSERT') and not has_any_column_privilege('authenticated','public.app_users','UPDATE')));

  perform pg_temp.assert_read_v2('No authenticated write privileges on record_assignments', (not has_table_privilege('authenticated','public.record_assignments','INSERT') and not has_table_privilege('authenticated','public.record_assignments','UPDATE') and not has_table_privilege('authenticated','public.record_assignments','DELETE') and not has_table_privilege('authenticated','public.record_assignments','TRUNCATE') and not has_any_column_privilege('authenticated','public.record_assignments','INSERT') and not has_any_column_privilege('authenticated','public.record_assignments','UPDATE')));

  perform pg_temp.assert_read_v2('No authenticated write privileges on master_records', (not has_table_privilege('authenticated','public.master_records','INSERT') and not has_table_privilege('authenticated','public.master_records','UPDATE') and not has_table_privilege('authenticated','public.master_records','DELETE') and not has_table_privilege('authenticated','public.master_records','TRUNCATE') and not has_any_column_privilege('authenticated','public.master_records','INSERT') and not has_any_column_privilege('authenticated','public.master_records','UPDATE')));

  perform pg_temp.assert_read_v2('No authenticated write privileges on record_versions', (not has_table_privilege('authenticated','public.record_versions','INSERT') and not has_table_privilege('authenticated','public.record_versions','UPDATE') and not has_table_privilege('authenticated','public.record_versions','DELETE') and not has_table_privilege('authenticated','public.record_versions','TRUNCATE') and not has_any_column_privilege('authenticated','public.record_versions','INSERT') and not has_any_column_privilege('authenticated','public.record_versions','UPDATE')));

  perform pg_temp.assert_read_v2('No authenticated write privileges on audit_events', (not has_table_privilege('authenticated','public.audit_events','INSERT') and not has_table_privilege('authenticated','public.audit_events','UPDATE') and not has_table_privilege('authenticated','public.audit_events','DELETE') and not has_table_privilege('authenticated','public.audit_events','TRUNCATE') and not has_any_column_privilege('authenticated','public.audit_events','INSERT') and not has_any_column_privilege('authenticated','public.audit_events','UPDATE')));

  perform pg_temp.assert_read_v2('No authenticated write privileges on update_bulletins', (not has_table_privilege('authenticated','public.update_bulletins','INSERT') and not has_table_privilege('authenticated','public.update_bulletins','UPDATE') and not has_table_privilege('authenticated','public.update_bulletins','DELETE') and not has_table_privilege('authenticated','public.update_bulletins','TRUNCATE') and not has_any_column_privilege('authenticated','public.update_bulletins','INSERT') and not has_any_column_privilege('authenticated','public.update_bulletins','UPDATE')));

  execute 'reset role';

  if (select count(*) from pg_temp.batch4_read_results_v2) <> 61 then raise exception 'Unexpected completed check count'; end if;


    select count(*) into completed_checks from pg_temp.batch4_read_results_v2;
    raise exception using
      errcode = 'ZB401',
      message = 'Batch 4 test completed: roll back test scope.',
      detail = completion_token;
  exception
    when sqlstate 'ZB401' then
      get stacked diagnostics caught_detail = pg_exception_detail;
      if caught_detail is distinct from completion_token
        or completed_checks <> 61 then
        raise exception 'Unexpected test-completion marker or check count.';
      end if;
      -- PostgreSQL has rolled back all changes made in this inner block.
  end;

  if current_user <> 'postgres' then
    raise exception 'FAIL: database role was not restored after test rollback.';
  end if;

  if exists (select 1 from public.master_records where record_id in (
    'EACSC-2099-TEST-9401','EACSC-2099-TEST-9402','EACSC-2099-TEST-9403',
    'EACSC-2099-TEST-9404','EACSC-2099-TEST-9405'))
    or exists (select 1 from public.record_versions where record_id in (
    'EACSC-2099-TEST-9401','EACSC-2099-TEST-9402','EACSC-2099-TEST-9403',
    'EACSC-2099-TEST-9404','EACSC-2099-TEST-9405'))
    or exists (select 1 from public.record_assignments where record_id in (
    'EACSC-2099-TEST-9401','EACSC-2099-TEST-9402','EACSC-2099-TEST-9403',
    'EACSC-2099-TEST-9404','EACSC-2099-TEST-9405')) then
    raise exception 'FAIL: authorization fixture rows remain after rollback.';
  end if;

  observed_profiles := (
    select jsonb_agg(to_jsonb(profile) order by profile.user_id)
    from public.app_users as profile
    where profile.user_id in (author_id, custodian_id, inactive_id)
  );
  if original_profiles is null
    or observed_profiles is distinct from original_profiles then
    raise exception 'FAIL: fixture profiles were not restored exactly.';
  end if;

  if to_regclass('pg_temp.batch4_read_results_v2') is not null
    or to_regprocedure('pg_temp.assert_read_v2(text,boolean)') is not null
    or to_regprocedure('pg_temp.expect_read_denial_v2(text,text)') is not null then
    raise exception 'FAIL: temporary test helpers were not removed.';
  end if;

  raise notice 'PASS: % authorization checks; cleanup passed; fixture profiles restored.', completed_checks;
end;
$batch4_single_block$;
