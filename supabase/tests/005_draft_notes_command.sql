-- Revision 3: expect PT409 application conflicts and scope receipt counts to this request.
-- Batch 4: controlled Draft notes command. Run the ENTIRE file as postgres.
-- ONE self-contained DO statement; all fixtures/schema fault injections roll back.
-- Uses the four existing Batch 4 Auth identities and their original profiles.
-- Never disable audit protections or delete existing audit history.
do $draft_command_test$
declare
  author_id uuid; custodian_id uuid; inactive_id uuid; no_profile_id uuid;
  draft_id uuid := gen_random_uuid(); second_draft_id uuid := gen_random_uuid();
  restricted_id uuid := gen_random_uuid(); unassigned_id uuid := gen_random_uuid();
  review_id uuid := gen_random_uuid(); approved_id uuid := gen_random_uuid();
  permitted_restricted_id uuid := gen_random_uuid();
  request_author uuid := gen_random_uuid();
  receipt_failure_request uuid := gen_random_uuid();
  author_claims text; custodian_claims text;
  response_author jsonb; response_retry jsonb; response_custodian jsonb;
  original_profiles jsonb; observed_profiles jsonb;
  original_receipts bigint; original_audits bigint;
  audit_count_before bigint; receipts_before bigint;
  completed_checks integer := 0;
  completion_token text := gen_random_uuid()::text;
  caught_detail text;
begin
  if current_user <> 'postgres' then
    raise exception 'Run this development test as postgres.';
  end if;
  begin
    create temporary table batch4_draft_results (
      check_name text primary key, passed boolean not null check(passed)
    ) on commit drop;
    grant select, insert on pg_temp.batch4_draft_results to anon, authenticated;
    execute format('grant usage on schema %I to anon, authenticated',
      pg_my_temp_schema()::regnamespace::text);
    execute $define_check$
      create function pg_temp.check_draft(check_name text, actual boolean)
      returns void language plpgsql security invoker set search_path = ''
      as $check$
      begin
        if actual is not true then raise exception 'FAIL: %', check_name; end if;
        insert into pg_temp.batch4_draft_results values(check_name,true);
      end;
      $check$;
    $define_check$;
    execute $define_error$
      create function pg_temp.expect_draft_error(
        check_name text, statement_sql text, expected_code text, expected_constraint text
      ) returns void language plpgsql security invoker set search_path = ''
      as $error$
      declare
        rejected boolean := false; actual_code text; actual_constraint text;
      begin
        begin
          execute statement_sql;
        exception when others then
          get stacked diagnostics actual_code = returned_sqlstate,
            actual_constraint = constraint_name;
          if actual_code is distinct from expected_code
            or (expected_constraint is not null
              and actual_constraint is distinct from expected_constraint) then
            raise exception 'FAIL: % expected % / %, got % / %',
              check_name,expected_code,expected_constraint,actual_code,actual_constraint;
          end if;
          rejected := true;
        end;
        perform pg_temp.check_draft(check_name,rejected);
      end;
      $error$;
    $define_error$;
    grant execute on function pg_temp.check_draft(text,boolean),
      pg_temp.expect_draft_error(text,text,text,text) to anon,authenticated;

    select id into strict author_id from auth.users
      where lower(email)='batch4-author@example.invalid' and email_confirmed_at is not null;
    select id into strict custodian_id from auth.users
      where lower(email)='batch4-custodian@example.invalid' and email_confirmed_at is not null;
    select id into strict inactive_id from auth.users
      where lower(email)='batch4-inactive@example.invalid' and email_confirmed_at is not null;
    select id into strict no_profile_id from auth.users
      where lower(email)='batch4-no-profile@example.invalid' and email_confirmed_at is not null;
    if not exists(select 1 from public.app_users where user_id=author_id
        and is_active and functional_roles=array['author']::text[])
      or not exists(select 1 from public.app_users where user_id=custodian_id
        and is_active and functional_roles=array['custodian']::text[])
      or not exists(select 1 from public.app_users where user_id=inactive_id
        and not is_active and functional_roles=array['author']::text[])
      or exists(select 1 from public.app_users where user_id=no_profile_id) then
      raise exception 'Expected the original Batch 4 fixture profiles. Stop and inspect them.';
    end if;
    if exists(select 1 from public.master_records where record_id in (
      'EACSC-2099-TEST-9501','EACSC-2099-TEST-9502','EACSC-2099-TEST-9503',
      'EACSC-2099-TEST-9504','EACSC-2099-TEST-9505','EACSC-2099-TEST-9506')) then
      raise exception 'Reserved fixture record IDs already exist. Stop and inspect them.';
    end if;
    if exists(select 1 from pg_catalog.pg_constraint
      where conname in ('batch4_test_audit_failure','batch4_test_receipt_failure')) then
      raise exception 'A reserved fault-injection constraint already exists. Stop and inspect it.';
    end if;
    original_profiles := (select jsonb_agg(to_jsonb(p) order by p.user_id)
      from public.app_users p where p.user_id in(author_id,custodian_id,inactive_id));
    select count(*) into original_receipts from eacsc_private.mutation_receipts;
    select count(*) into original_audits from public.audit_events;

    insert into public.master_records (
      record_id,title,category,document_type,originating_office,custodian_position,access_class
    ) values
      ('EACSC-2099-TEST-9501','Fictional Draft edit target','Forms and official information','Test form','Fictional office','Fictional custodian','internal'),
      ('EACSC-2099-TEST-9502','Fictional denied finance Draft','Financial archives','Test report','Fictional office','Fictional custodian','restricted'),
      ('EACSC-2099-TEST-9503','Fictional unassigned Draft','Forms and official information','Test form','Fictional office','Fictional custodian','internal'),
      ('EACSC-2099-TEST-9504','Fictional For Review target','Forms and official information','Test form','Fictional office','Fictional custodian','internal'),
      ('EACSC-2099-TEST-9505','Fictional Approved target','Forms and official information','Test form','Fictional office','Fictional custodian','internal'),
      ('EACSC-2099-TEST-9506','Fictional explicitly assigned finance Draft','Financial archives','Test report','Fictional office','Fictional custodian','restricted');
    insert into public.record_assignments (
      record_id,user_id,assignment_function,is_active,allow_restricted,assigned_by
    ) values
      ('EACSC-2099-TEST-9501',author_id,'author',true,false,custodian_id),
      ('EACSC-2099-TEST-9501',custodian_id,'custodian',true,false,custodian_id),
      ('EACSC-2099-TEST-9501',inactive_id,'author',true,false,custodian_id),
      ('EACSC-2099-TEST-9502',author_id,'author',true,false,custodian_id),
      ('EACSC-2099-TEST-9504',author_id,'author',true,false,custodian_id),
      ('EACSC-2099-TEST-9505',author_id,'author',true,false,custodian_id),
      ('EACSC-2099-TEST-9506',custodian_id,'custodian',true,true,custodian_id),
      ('EACSC-2099-TEST-9501',custodian_id,'reviewer',true,false,custodian_id),
      ('EACSC-2099-TEST-9501',custodian_id,'approver',true,false,custodian_id),
      ('EACSC-2099-TEST-9501',custodian_id,'publisher',true,false,custodian_id);
    insert into public.record_versions(version_id,record_id,version_number,change_summary)
    values
      (draft_id,'EACSC-2099-TEST-9501',1,'Original Draft notes.'),
      (second_draft_id,'EACSC-2099-TEST-9501',2,'Another fictional Draft.'),
      (restricted_id,'EACSC-2099-TEST-9502',1,'Restricted fictional notes.'),
      (unassigned_id,'EACSC-2099-TEST-9503',1,'Unassigned fictional notes.'),
      (permitted_restricted_id,'EACSC-2099-TEST-9506',1,'Permitted restricted fictional notes.');
    -- File metadata below is fictional; no storage object is uploaded.
    insert into public.record_versions (
      version_id,record_id,version_number,state,change_summary,storage_key,
      original_filename,mime_type,file_size_bytes,sha256,approval_basis,
      approval_evidence_reference,approval_not_required_reason,approval_recorded_by
    ) values
      (review_id,'EACSC-2099-TEST-9504',1,'For Review','Review fixture.',
       'batch4-command-fixtures/review.pdf','fictional.pdf','application/pdf',128,repeat('a',64),null,null,null,null),
      (approved_id,'EACSC-2099-TEST-9505',1,'Approved','Approved fixture.',
       'batch4-command-fixtures/approved.pdf','fictional.pdf','application/pdf',128,repeat('b',64),
       'Fictional test only','fixture:approval','No institutional decision represented.',custodian_id);
    author_claims:=jsonb_build_object('sub',author_id,'role','authenticated','is_anonymous',false)::text;
    custodian_claims:=jsonb_build_object('sub',custodian_id,'role','authenticated','is_anonymous',false)::text;


    execute 'reset role';

    perform set_config('request.jwt.claims', author_claims, true);

    execute 'set local role authenticated';

    response_author := public.eacsc_update_draft_notes(draft_id, 1, '   Updated Draft notes.   ', request_author);

    perform pg_temp.check_draft('Successful response contains the updated revision and notes', (response_author->>'revision_counter'='2' and response_author->>'change_summary'='Updated Draft notes.' and response_author->>'state'='Draft'));

    perform pg_temp.check_draft('Response has exactly the permitted fields', (select array_agg(k order by k)=array['audit_event_uuid','change_summary','record_id','request_id','revision_counter','state','updated_at','version_id']::text[] from jsonb_object_keys(response_author) as keys(k)));

    perform pg_temp.check_draft('Authorized version read sees the saved notes', (select revision_counter=2 and change_summary='Updated Draft notes.' and state='Draft' from public.record_versions where version_id=draft_id));

    response_retry := public.eacsc_update_draft_notes(draft_id, 1, 'Updated Draft notes.', request_author);

    perform pg_temp.check_draft('Identical retry returns the exact original result', (response_retry=response_author));

    execute 'reset role';

    perform pg_temp.check_draft('Exactly one successful audit event was recorded', (select count(*)=1 from public.audit_events where version_id=draft_id and action_type='draft.notes_updated'));

    perform pg_temp.check_draft('Audit derives the actor and records both revisions', (select actor_user_id=author_id and previous_revision=1 and new_revision=2 and request_id=request_author and server_occurred_at=now() from public.audit_events where event_uuid=(response_author->>'audit_event_uuid')::uuid));

    perform pg_temp.check_draft('Audit preserves selected before and after notes', (select previous_state->>'change_summary'='Original Draft notes.' and new_state->>'change_summary'='Updated Draft notes.' and previous_state->>'state'='Draft' and new_state->>'state'='Draft' from public.audit_events where event_uuid=(response_author->>'audit_event_uuid')::uuid));

    perform pg_temp.check_draft('Successful request has one matching private receipt', (select count(*)=1 and bool_and(response_payload=response_author and command_name='update_draft_notes' and request_payload->>'change_summary'='Updated Draft notes.') from eacsc_private.mutation_receipts where actor_user_id=author_id and request_id=request_author));

    perform pg_temp.check_draft('Notes update does not attach a file or record approval', (select storage_key is null and approved_at is null and approval_recorded_by is null from public.record_versions where version_id=draft_id));

    execute 'reset role';

    perform set_config('request.jwt.claims', author_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Request reuse with changed notes is rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Different notes.', %L::uuid)$sql$, draft_id, request_author), '22023', null);

    perform pg_temp.expect_draft_error('Request reuse with changed expected revision is rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Updated Draft notes.', %L::uuid)$sql$, draft_id, request_author), '22023', null);

    perform pg_temp.expect_draft_error('Request reuse for another assigned version is rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Updated Draft notes.', %L::uuid)$sql$, second_draft_id, request_author), '22023', null);

    perform pg_temp.expect_draft_error('Stale revision is rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Stale edit.', gen_random_uuid())$sql$, draft_id), 'PT409', null);

    perform pg_temp.expect_draft_error('Unchanged notes are rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Updated Draft notes.', gen_random_uuid())$sql$, draft_id), '22023', null);

    perform pg_temp.expect_draft_error('Null version is rejected', $sql$select public.eacsc_update_draft_notes(null, 2, 'Notes.', gen_random_uuid())$sql$, '22023', null);

    perform pg_temp.expect_draft_error('Null request ID is rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Notes.', null)$sql$, draft_id), '22023', null);

    perform pg_temp.expect_draft_error('Null revision is rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, null, 'Notes.', gen_random_uuid())$sql$, draft_id), '22023', null);

    perform pg_temp.expect_draft_error('Zero revision is rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 0, 'Notes.', gen_random_uuid())$sql$, draft_id), '22023', null);

    perform pg_temp.expect_draft_error('Negative revision is rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, -1, 'Notes.', gen_random_uuid())$sql$, draft_id), '22023', null);

    perform pg_temp.expect_draft_error('Revision overflow is rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2147483647, 'Notes.', gen_random_uuid())$sql$, draft_id), '22023', null);

    perform pg_temp.expect_draft_error('Null notes are rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, null, gen_random_uuid())$sql$, draft_id), '22023', null);

    perform pg_temp.expect_draft_error('Blank notes are rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, E' \t\n ', gen_random_uuid())$sql$, draft_id), '22023', null);

    perform pg_temp.expect_draft_error('Oversized notes are rejected', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, repeat('x',2001), gen_random_uuid())$sql$, draft_id), '22023', null);

    perform pg_temp.expect_draft_error('Unassigned version is denied', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Notes.', gen_random_uuid())$sql$, unassigned_id), '42501', null);

    perform pg_temp.expect_draft_error('Restricted finance without extra permission is denied', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Notes.', gen_random_uuid())$sql$, restricted_id), '42501', null);

    perform pg_temp.expect_draft_error('Unknown version is denied', $sql$select public.eacsc_update_draft_notes(gen_random_uuid(), 1, 'Notes.', gen_random_uuid())$sql$, '42501', null);

    perform pg_temp.expect_draft_error('For Review notes cannot be edited', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Notes.', gen_random_uuid())$sql$, review_id), '55000', null);

    perform pg_temp.expect_draft_error('Approved notes cannot be edited', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Notes.', gen_random_uuid())$sql$, approved_id), '55000', null);

    perform pg_temp.expect_draft_error('Direct private call also enforces the revision check', format($sql$select eacsc_private.update_draft_notes(%L::uuid, 1, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), 'PT409', null);

    perform pg_temp.expect_draft_error('Base version writes remain denied', $sql$update public.record_versions set change_summary='Bypass' where false$sql$, '42501', null);

    perform pg_temp.expect_draft_error('Audit inserts remain denied', $sql$insert into public.audit_events(actor_user_id,action_type,action_summary) select auth.uid(),'fake','fake' where false$sql$, '42501', null);

    perform pg_temp.expect_draft_error('Private receipts cannot be read directly', $sql$select request_id from eacsc_private.mutation_receipts$sql$, '42501', null);

    execute 'reset role';

    perform pg_temp.check_draft('Rejected writes and retries leave the revision unchanged', (select revision_counter=2 from public.record_versions where version_id=draft_id));

    perform pg_temp.check_draft('Rejected writes and retries add no audit events', (select count(*)=1 from public.audit_events where version_id=draft_id));

    perform pg_temp.check_draft('Rejected writes and retries add no receipts', (select count(*)=1 from eacsc_private.mutation_receipts where actor_user_id=author_id and request_id=request_author));

    execute 'reset role';

    update public.app_users set is_active=false where user_id=author_id;

    execute 'reset role';

    perform set_config('request.jwt.claims', author_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Profile deactivation denies a new write with unchanged claims', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    perform pg_temp.expect_draft_error('Profile deactivation denies replay of an earlier receipt', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Updated Draft notes.', %L::uuid)$sql$, draft_id, request_author), '42501', null);

    execute 'reset role';

    update public.app_users set is_active=true where user_id=author_id;

    execute 'reset role';

    update public.record_assignments set is_active=false where user_id=author_id and record_id='EACSC-2099-TEST-9501';

    execute 'reset role';

    perform set_config('request.jwt.claims', author_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Assignment revocation denies a new write with unchanged claims', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    perform pg_temp.expect_draft_error('Assignment revocation denies replay of an earlier receipt', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Updated Draft notes.', %L::uuid)$sql$, draft_id, request_author), '42501', null);

    execute 'reset role';

    update public.record_assignments set is_active=true where user_id=author_id and record_id='EACSC-2099-TEST-9501';

    execute 'reset role';

    update public.app_users set functional_roles=array['technical_admin']::text[] where user_id=author_id;

    execute 'reset role';

    perform set_config('request.jwt.claims', author_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Role removal denies a new write with unchanged claims', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    perform pg_temp.expect_draft_error('Role removal denies replay of an earlier receipt', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Updated Draft notes.', %L::uuid)$sql$, draft_id, request_author), '42501', null);

    execute 'reset role';

    update public.app_users set functional_roles=array['author']::text[] where user_id=author_id;

    execute 'reset role';

    update public.master_records set access_class='restricted' where record_id='EACSC-2099-TEST-9501';

    execute 'reset role';

    perform set_config('request.jwt.claims', author_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Restricted reclassification denies a new write with unchanged claims', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    perform pg_temp.expect_draft_error('Restricted reclassification denies replay of an earlier receipt', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Updated Draft notes.', %L::uuid)$sql$, draft_id, request_author), '42501', null);

    execute 'reset role';

    update public.master_records set access_class='internal' where record_id='EACSC-2099-TEST-9501';

    execute 'reset role';

    perform set_config('request.jwt.claims', '{}', true);

    execute 'set local role anon';

    perform pg_temp.expect_draft_error('Signed-out caller cannot invoke a Draft edit', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    execute 'reset role';

    perform set_config('request.jwt.claims', jsonb_build_object('sub',author_id,'role','authenticated','is_anonymous',true)::text, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Anonymous signed-in identity cannot invoke a Draft edit', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    execute 'reset role';

    perform set_config('request.jwt.claims', jsonb_build_object('sub',author_id,'role','authenticated')::text, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Missing anonymous claim cannot invoke a Draft edit', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    execute 'reset role';

    perform set_config('request.jwt.claims', jsonb_build_object('sub',no_profile_id,'role','authenticated','is_anonymous',false)::text, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Missing profile cannot invoke a Draft edit', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    execute 'reset role';

    perform set_config('request.jwt.claims', jsonb_build_object('sub',inactive_id,'role','authenticated','is_anonymous',false)::text, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Inactive fixture cannot invoke a Draft edit', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    execute 'reset role';

    update public.app_users set functional_roles=array['reviewer']::text[] where user_id=custodian_id;

    execute 'reset role';

    perform set_config('request.jwt.claims', custodian_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('reviewer alone cannot edit Draft notes', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    execute 'reset role';

    update public.app_users set functional_roles=array['approver']::text[] where user_id=custodian_id;

    execute 'reset role';

    perform set_config('request.jwt.claims', custodian_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('approver alone cannot edit Draft notes', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    execute 'reset role';

    update public.app_users set functional_roles=array['publisher']::text[] where user_id=custodian_id;

    execute 'reset role';

    perform set_config('request.jwt.claims', custodian_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('publisher alone cannot edit Draft notes', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    execute 'reset role';

    update public.app_users set functional_roles=array['technical_admin']::text[] where user_id=custodian_id;

    execute 'reset role';

    perform set_config('request.jwt.claims', custodian_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('technical_admin alone cannot edit Draft notes', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 2, 'Another Draft note.', gen_random_uuid())$sql$, draft_id), '42501', null);

    execute 'reset role';

    update public.app_users set functional_roles=array['custodian']::text[] where user_id=custodian_id;

    execute 'reset role';

    perform set_config('request.jwt.claims', custodian_claims, true);

    execute 'set local role authenticated';

    response_custodian := public.eacsc_update_draft_notes(draft_id, 2, 'Custodian corrected Draft notes.', request_author);

    perform pg_temp.check_draft('Assigned custodian can update Draft notes without approval', (response_custodian->>'revision_counter'='3' and response_custodian->>'state'='Draft'));

    response_retry := public.eacsc_update_draft_notes(permitted_restricted_id, 1, 'Authorized restricted Draft update.', gen_random_uuid());

    perform pg_temp.check_draft('Restricted update succeeds with explicit permission', (response_retry->>'revision_counter'='2'));

    execute 'reset role';

    perform pg_temp.check_draft('Actor-scoped request IDs do not merge different officers', (select count(*)=2 from eacsc_private.mutation_receipts where request_id=request_author and actor_user_id in(author_id,custodian_id)));

    perform pg_temp.check_draft('Custodian audit actor and revision are derived correctly', (select actor_user_id=custodian_id and previous_revision=2 and new_revision=3 from public.audit_events where event_uuid=(response_custodian->>'audit_event_uuid')::uuid));

    perform pg_temp.check_draft('Master revision and classification are unaffected by notes command', (select revision_counter=1 and access_class='internal' from public.master_records where record_id='EACSC-2099-TEST-9501'));

    perform pg_temp.check_draft('Custodian cannot substantively approve through notes command', (select state='Draft' and approved_at is null and approval_recorded_by is null from public.record_versions where version_id=draft_id));

    select count(*) into audit_count_before from public.audit_events;

    select count(*) into receipts_before from eacsc_private.mutation_receipts;

    execute format('alter table public.audit_events add constraint batch4_test_audit_failure check(version_id is distinct from %L::uuid) not valid',draft_id);

    execute 'reset role';

    perform set_config('request.jwt.claims', author_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Audit failure aborts the mutation', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 3, 'Must roll back with failed audit.', gen_random_uuid())$sql$, draft_id), '23514', 'batch4_test_audit_failure');

    execute 'reset role';

    perform pg_temp.check_draft('Audit failure restores the version notes and revision', (select revision_counter=3 and change_summary='Custodian corrected Draft notes.' from public.record_versions where version_id=draft_id));

    perform pg_temp.check_draft('Audit failure leaves audit count unchanged', (select count(*)=audit_count_before from public.audit_events));

    perform pg_temp.check_draft('Audit failure leaves receipt count unchanged', (select count(*)=receipts_before from eacsc_private.mutation_receipts));

    alter table public.audit_events drop constraint batch4_test_audit_failure;

    execute format('alter table eacsc_private.mutation_receipts add constraint batch4_test_receipt_failure check(request_id <> %L::uuid) not valid',receipt_failure_request);

    execute 'reset role';

    perform set_config('request.jwt.claims', author_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Receipt failure aborts the mutation and audit insert', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 3, 'Must roll back with failed receipt.', %L::uuid)$sql$, draft_id, receipt_failure_request), '23514', 'batch4_test_receipt_failure');

    execute 'reset role';

    perform pg_temp.check_draft('Receipt failure restores the version notes and revision', (select revision_counter=3 and change_summary='Custodian corrected Draft notes.' from public.record_versions where version_id=draft_id));

    perform pg_temp.check_draft('Receipt failure also rolls back its inserted audit event', (select count(*)=audit_count_before from public.audit_events));

    perform pg_temp.check_draft('Receipt failure leaves receipts unchanged', (select count(*)=receipts_before from eacsc_private.mutation_receipts));

    alter table eacsc_private.mutation_receipts drop constraint batch4_test_receipt_failure;

    perform pg_temp.expect_draft_error('Receipt UPDATE is blocked', $sql$update eacsc_private.mutation_receipts set command_name='tamper' where false$sql$, '55000', null);

    perform pg_temp.expect_draft_error('Receipt DELETE is blocked', $sql$delete from eacsc_private.mutation_receipts where false$sql$, '55000', null);

    perform pg_temp.expect_draft_error('Receipt TRUNCATE is blocked', $sql$truncate eacsc_private.mutation_receipts$sql$, '55000', null);

    update public.record_versions set state='For Review',storage_key='batch4-command-fixtures/moved-to-review.pdf',original_filename='fictional.pdf',mime_type='application/pdf',file_size_bytes=128,sha256=repeat('c',64) where version_id=draft_id;

    execute 'reset role';

    perform set_config('request.jwt.claims', author_claims, true);

    execute 'set local role authenticated';

    perform pg_temp.expect_draft_error('Retry cannot reopen notes after Draft state ends', format($sql$select public.eacsc_update_draft_notes(%L::uuid, 1, 'Updated Draft notes.', %L::uuid)$sql$, draft_id, request_author), '55000', null);

    execute 'reset role';

    select count(*) into completed_checks from pg_temp.batch4_draft_results;
    if completed_checks <> 70 then raise exception 'Unexpected command test count'; end if;
    raise exception using errcode='ZB405',message='Completed command tests: roll back fixture scope.',detail=completion_token;
  exception when sqlstate 'ZB405' then
    get stacked diagnostics caught_detail=pg_exception_detail;
    if caught_detail is distinct from completion_token or completed_checks <> 70 then
      raise exception 'Unexpected command test completion marker.';
    end if;
  end;
  if current_user <> 'postgres' then raise exception 'FAIL: database role not restored'; end if;
  if exists(select 1 from public.master_records where record_id in (
    'EACSC-2099-TEST-9501','EACSC-2099-TEST-9502','EACSC-2099-TEST-9503',
    'EACSC-2099-TEST-9504','EACSC-2099-TEST-9505','EACSC-2099-TEST-9506')) then
    raise exception 'FAIL: command fixture records remain';
  end if;
  observed_profiles := (select jsonb_agg(to_jsonb(p) order by p.user_id)
    from public.app_users p where p.user_id in(author_id,custodian_id,inactive_id));
  if original_profiles is null or observed_profiles is distinct from original_profiles then
    raise exception 'FAIL: command test profiles were not restored exactly';
  end if;
  if (select count(*) from public.audit_events) <> original_audits
    or (select count(*) from eacsc_private.mutation_receipts) <> original_receipts then
    raise exception 'FAIL: command audit/receipt fixture rows remain';
  end if;
  if to_regclass('pg_temp.batch4_draft_results') is not null
    or to_regprocedure('pg_temp.check_draft(text,boolean)') is not null
    or to_regprocedure('pg_temp.expect_draft_error(text,text,text,text)') is not null
    or exists(select 1 from pg_catalog.pg_constraint
      where conname in('batch4_test_audit_failure','batch4_test_receipt_failure')) then
    raise exception 'FAIL: command test helpers or fault constraints remain';
  end if;
  raise notice 'PASS: % Draft command checks; cleanup passed; profiles and audit/receipt rows restored.',completed_checks;
end;
$draft_command_test$;
