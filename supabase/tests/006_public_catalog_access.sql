-- Batch 4 public catalog isolation test. Run the ENTIRE file as postgres.
-- Simulates database roles; it does not create public HTTP fixtures.
-- All fixtures and temporary helpers roll back inside this single DO statement.
-- Do not run another test runner or edit records while this test is running.
-- Expected: Success. No rows returned; a PASS notice may also be displayed.

do $catalog_test$
declare
  actor_id uuid;
  n integer;
  fixture_record text;
  fixture_version uuid;
  fixture_release uuid;
  fixture_state text;
  visible_rows jsonb;
  anonymous_rows jsonb;
  original_state jsonb;
  completed_checks integer := 0;
  completion_token text := gen_random_uuid()::text;
  caught_detail text;
begin
  if current_user <> 'postgres' then
    raise exception 'Run this test using the postgres SQL Editor role.';
  end if;

  select user_id into strict actor_id
  from public.app_users
  where email = 'batch4-custodian@example.invalid'
    and is_active
    and functional_roles = array['custodian']::text[];

  if exists (
    select 1
    from public.master_records
    where record_id between
      'EACSC-2099-PUB-9701' and 'EACSC-2099-PUB-9714'
  ) then
    raise exception 'Reserved public-test IDs already exist. Stop and inspect.';
  end if;

  original_state := jsonb_build_object(
    'profiles', (
      select jsonb_agg(to_jsonb(t) order by user_id)
      from public.app_users t
    ),
    'masters', (
      select jsonb_agg(to_jsonb(t) order by record_id)
      from public.master_records t
    ),
    'versions', (
      select jsonb_agg(to_jsonb(t) order by version_id)
      from public.record_versions t
    ),
    'assignments', (
      select jsonb_agg(
        to_jsonb(t) order by record_id,user_id,assignment_function
      )
      from public.record_assignments t
    ),
    'releases', (
      select jsonb_agg(to_jsonb(t) order by release_id)
      from public.record_releases t
    ),
    'audits', (
      select jsonb_agg(to_jsonb(t) order by event_uuid)
      from public.audit_events t
    ),
    'receipts', (
      select jsonb_agg(to_jsonb(t) order by actor_user_id,request_id)
      from eacsc_private.mutation_receipts t
    )
  );

  begin
    create temporary table catalog_test_results (
      check_name text primary key,
      passed boolean not null check (passed)
    ) on commit drop;

    grant select, insert on pg_temp.catalog_test_results
      to anon, authenticated, service_role;

    execute format(
      'grant usage on schema %I to anon, authenticated, service_role',
      pg_my_temp_schema()::regnamespace::text
    );

    execute $define_assert$
      create function pg_temp.assert_catalog(label text, actual boolean)
      returns void
      language plpgsql
      security invoker
      set search_path = ''
      as $assert$
      begin
        if actual is not true then
          raise exception 'FAIL: %', label;
        end if;
        insert into pg_temp.catalog_test_results values (label, true);
      end;
      $assert$;
    $define_assert$;

    execute $define_error$
      create function pg_temp.expect_catalog_error(
        label text,
        statement_sql text,
        expected text
      )
      returns void
      language plpgsql
      security invoker
      set search_path = ''
      as $error$
      declare
        actual text;
      begin
        begin
          execute statement_sql;
        exception when others then
          get stacked diagnostics actual = returned_sqlstate;
        end;
        perform pg_temp.assert_catalog(label, actual = expected);
      end;
      $error$;
    $define_error$;

    revoke all on function
      pg_temp.assert_catalog(text,boolean),
      pg_temp.expect_catalog_error(text,text,text)
      from public;

    grant execute on function
      pg_temp.assert_catalog(text,boolean),
      pg_temp.expect_catalog_error(text,text,text)
      to anon, authenticated, service_role;

    for n in 9701..9714 loop
      fixture_record := 'EACSC-2099-PUB-' || n;
      fixture_version :=
        ('b4000000-0000-4000-8000-00000000' || n)::uuid;
      fixture_release :=
        ('c4000000-0000-4000-8000-00000000' || n)::uuid;

      fixture_state := case n
        when 9703 then 'Draft'
        when 9704 then 'For Review'
        when 9710 then 'Superseded'
        else 'Approved'
      end;

      insert into public.master_records (
        record_id,title,category,document_type,
        originating_office,custodian_position,access_class
      ) values (
        fixture_record,
        'PRIVATE MASTER LABEL',
        'Forms and official information',
        'Fictional form',
        'Fictional office',
        'Fictional custodian',
        case n
          when 9705 then 'restricted'
          when 9706 then 'internal'
          else 'public'
        end
      );

      -- Fictional file identities only. No files are uploaded or published.
      insert into public.record_versions (
        version_id,record_id,version_number,state,change_summary,
        storage_key,original_filename,mime_type,file_size_bytes,sha256,
        approved_at,approval_basis,approval_evidence_reference,
        approval_recorded_by,approval_not_required_reason
      ) values (
        fixture_version,
        fixture_record,
        1,
        fixture_state,
        'PRIVATE NOTES',
        'private-key-' || n,
        'private-name.pdf',
        'application/pdf',
        128,
        repeat('a',64),
        case
          when fixture_state in ('Approved','Superseded')
            and n <> 9714 then now()
        end,
        'PRIVATE BASIS',
        'PRIVATE EVIDENCE',
        actor_id,
        case when n = 9714 then
          'Fictional approval exception; no real decision represented.'
        end
      );

      if n = 9702 then
        continue;
      end if;

      insert into public.record_releases (
        release_id,record_id,version_id,audience,
        public_title,public_category,
        authorization_basis,authorization_reference,
        released_by,released_at,effective_from,effective_until,
        withdrawn_at,withdrawn_by,withdrawal_reason
      ) values (
        fixture_release,
        fixture_record,
        fixture_version,
        case when n = 9711 then 'internal' else 'public' end,
        'Safe public title ' || n,
        'Forms and official information',
        'PRIVATE PUB BASIS',
        'PRIVATE PUB REF',
        actor_id,
        case
          when n = 9712 then now() + interval '1 day'
          else now()
        end,
        case
          when n = 9708 then now() + interval '1 day'
          else now() - interval '1 day'
        end,
        case when n = 9707 then now() - interval '1 hour' end,
        case when n = 9709 then now() end,
        case when n = 9709 then actor_id end,
        case when n = 9709 then 'PRIVATE WITHDRAW REASON' end
      );

      if n <> 9713 then
        update public.master_records
        set current_public_release_id = fixture_release
        where record_id = fixture_record;
      end if;
    end loop;

    insert into public.record_versions (
      version_id,record_id,version_number,state,change_summary,
      storage_key,original_filename,mime_type,file_size_bytes,sha256,
      approved_at,approval_basis,approval_evidence_reference,
      approval_recorded_by
    ) values (
      'b4000000-0000-4000-8000-000000019701',
      'EACSC-2099-PUB-9701',
      2,
      'Approved',
      'PRIVATE V2 NOTES',
      'private-v2-key',
      'private-v2.pdf',
      'application/pdf',
      128,
      repeat('b',64),
      now(),
      'PRIVATE BASIS',
      'PRIVATE EVIDENCE',
      actor_id
    );

    -- Older valid release must not replace the withdrawn current release.
    insert into public.record_releases (
      release_id,record_id,version_id,audience,
      public_title,public_category,
      authorization_basis,authorization_reference,released_by
    ) values (
      'c4000000-0000-4000-8000-000000019709',
      'EACSC-2099-PUB-9709',
      'b4000000-0000-4000-8000-000000009709',
      'public',
      'Older valid release',
      'Forms and official information',
      'PRIVATE BASIS',
      'PRIVATE REF',
      actor_id
    );

    perform set_config('request.jwt.claims','{}',true);
    execute 'set local role anon';

    select coalesce(
      jsonb_agg(to_jsonb(c) order by record_id),'[]'::jsonb
    )
    into visible_rows
    from public.eacsc_public_catalog(100,0) c;

    anonymous_rows := visible_rows;

    perform pg_temp.assert_catalog(
      'Only three explicitly selected eligible releases are returned',
      (
        select array_agg(c.record_id order by c.record_id) =
          array[
            'EACSC-2099-PUB-9701',
            'EACSC-2099-PUB-9710',
            'EACSC-2099-PUB-9714'
          ]::text[]
        from public.eacsc_public_catalog(100,0) c
      )
    );

    perform pg_temp.assert_catalog(
      'Released v1 stays selected despite newer Approved v2',
      visible_rows->0->>'version_number' = '1'
    );

    perform pg_temp.assert_catalog(
      'Public projection has exactly seven safe fields',
      (
        select array_agg(k order by k) =
          array[
            'approved_at','category','record_id','released_at',
            'title','version_id','version_number'
          ]::text[]
        from jsonb_object_keys(visible_rows->0) k
      )
    );

    perform pg_temp.assert_catalog(
      'Public title uses the frozen release label',
      visible_rows->0->>'title' = 'Safe public title 9701'
    );

    perform pg_temp.assert_catalog(
      'Public data contains no private fixture values',
      visible_rows::text not like '%PRIVATE%'
        and visible_rows::text not like '%private-%'
    );

    perform pg_temp.assert_catalog(
      'Approved without release stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9702'
      )
    );

    perform pg_temp.assert_catalog(
      'Draft stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9703'
      )
    );

    perform pg_temp.assert_catalog(
      'For Review stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9704'
      )
    );

    perform pg_temp.assert_catalog(
      'Restricted stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9705'
      )
    );

    perform pg_temp.assert_catalog(
      'Internal stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9706'
      )
    );

    perform pg_temp.assert_catalog(
      'Expired stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9707'
      )
    );

    perform pg_temp.assert_catalog(
      'Future effective stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9708'
      )
    );

    perform pg_temp.assert_catalog(
      'Withdrawn current with older valid release stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9709'
      )
    );

    perform pg_temp.assert_catalog(
      'Internal release audience stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9711'
      )
    );

    perform pg_temp.assert_catalog(
      'Future issued stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9712'
      )
    );

    perform pg_temp.assert_catalog(
      'Release without selected pointer stays hidden',
      not exists (
        select 1 from public.eacsc_public_catalog(100,0)
        where record_id = 'EACSC-2099-PUB-9713'
      )
    );

    perform pg_temp.assert_catalog(
      'Selected Superseded version remains applicable',
      visible_rows->1->>'record_id' = 'EACSC-2099-PUB-9710'
    );

    perform pg_temp.assert_catalog(
      'Approval exception does not invent an approval date',
      visible_rows->2->>'record_id' = 'EACSC-2099-PUB-9714'
        and visible_rows->2->'approved_at' = 'null'::jsonb
    );

    perform pg_temp.assert_catalog(
      'Pagination has deterministic ordering',
      (
        select record_id = 'EACSC-2099-PUB-9710'
        from public.eacsc_public_catalog(1,1)
      )
    );

    perform pg_temp.expect_catalog_error(
      'Invalid paging 0,0',
      $sql$select * from public.eacsc_public_catalog(0,0)$sql$,
      '22023'
    );

    perform pg_temp.expect_catalog_error(
      'Invalid paging 101,0',
      $sql$select * from public.eacsc_public_catalog(101,0)$sql$,
      '22023'
    );

    perform pg_temp.expect_catalog_error(
      'Invalid paging null,0',
      $sql$select * from public.eacsc_public_catalog(null,0)$sql$,
      '22023'
    );

    perform pg_temp.expect_catalog_error(
      'Invalid paging 20,-1',
      $sql$select * from public.eacsc_public_catalog(20,-1)$sql$,
      '22023'
    );

    perform pg_temp.expect_catalog_error(
      'Invalid paging 20,100001',
      $sql$select * from public.eacsc_public_catalog(20,100001)$sql$,
      '22023'
    );

    perform pg_temp.expect_catalog_error(
      'Invalid paging 20,null',
      $sql$select * from public.eacsc_public_catalog(20,null)$sql$,
      '22023'
    );

    perform pg_temp.expect_catalog_error(
      'Anonymous cannot read master rows',
      $sql$select record_id from public.master_records$sql$,
      '42501'
    );

    perform pg_temp.expect_catalog_error(
      'Anonymous cannot read version rows',
      $sql$select version_id from public.record_versions$sql$,
      '42501'
    );

    perform pg_temp.expect_catalog_error(
      'Anonymous cannot call officer read helper',
      $sql$
        select eacsc_private.can_read_record(
          'EACSC-2099-PUB-9701',null,null
        )
      $sql$,
      '42501'
    );

    perform pg_temp.expect_catalog_error(
      'Anonymous cannot call edit command',
      $sql$
        select eacsc_private.update_draft_notes(null,null,null,null)
      $sql$,
      '42501'
    );

    execute 'reset role';
    execute 'set local role anon';

    perform pg_temp.expect_catalog_error(
      'anon cannot read private release facts',
      $sql$select * from public.record_releases$sql$,
      '42501'
    );

    perform pg_temp.expect_catalog_error(
      'anon cannot insert release facts',
      $sql$insert into public.record_releases default values$sql$,
      '42501'
    );

    execute 'reset role';
    execute 'set local role authenticated';

    perform pg_temp.expect_catalog_error(
      'authenticated cannot read private release facts',
      $sql$select * from public.record_releases$sql$,
      '42501'
    );

    perform pg_temp.expect_catalog_error(
      'authenticated cannot insert release facts',
      $sql$insert into public.record_releases default values$sql$,
      '42501'
    );

    select coalesce(
      jsonb_agg(to_jsonb(c) order by record_id),'[]'::jsonb
    )
    into visible_rows
    from public.eacsc_public_catalog(100,0) c;

    perform pg_temp.assert_catalog(
      'Authenticated receives the same public projection',
      visible_rows = anonymous_rows
    );

    perform pg_temp.expect_catalog_error(
      'Authenticated cannot directly read release pointer',
      $sql$
        select current_public_release_id from public.master_records
      $sql$,
      '42501'
    );

    execute 'reset role';
    execute 'set local role service_role';

    perform pg_temp.expect_catalog_error(
      'service_role cannot read private release facts',
      $sql$select * from public.record_releases$sql$,
      '42501'
    );

    perform pg_temp.expect_catalog_error(
      'service_role cannot insert release facts',
      $sql$insert into public.record_releases default values$sql$,
      '42501'
    );

    execute 'reset role';

    perform pg_temp.expect_catalog_error(
      'A release cannot refer to another records version',
      $sql$
        insert into public.record_releases (
          record_id,version_id,public_title,public_category,
          authorization_basis,authorization_reference,released_by
        )
        select
          'EACSC-2099-PUB-9701',
          'b4000000-0000-4000-8000-000000009702',
          'Safe',
          'Forms and official information',
          'basis',
          'ref',
          released_by
        from public.record_releases
        where release_id = 'c4000000-0000-4000-8000-000000009701'
      $sql$,
      '23503'
    );

    perform pg_temp.expect_catalog_error(
      'Current pointer cannot refer to another records release',
      $sql$
        update public.master_records
        set current_public_release_id =
          'c4000000-0000-4000-8000-000000009710'
        where record_id = 'EACSC-2099-PUB-9701'
      $sql$,
      '23503'
    );

    perform pg_temp.expect_catalog_error(
      'Issued public title is immutable',
      $sql$
        update public.record_releases
        set public_title = 'Changed'
        where record_id = 'EACSC-2099-PUB-9701'
      $sql$,
      '55000'
    );

    perform pg_temp.expect_catalog_error(
      'Release history cannot be deleted',
      $sql$delete from public.record_releases where false$sql$,
      '55000'
    );

    perform pg_temp.assert_catalog(
      'Release removal trigger covers both DELETE and TRUNCATE',
      exists (
        select 1
        from pg_catalog.pg_trigger
        where tgrelid = 'public.record_releases'::regclass
          and tgname = 'record_releases_protect_removal'
          and tgenabled = 'O'
          and (tgtype::integer & 40) = 40
      )
    );

    update public.record_releases
    set withdrawn_at = now(),
        withdrawn_by = actor_id,
        withdrawal_reason = 'Fictional test withdrawal'
    where release_id = 'c4000000-0000-4000-8000-000000009701';

    execute 'set local role anon';

    perform pg_temp.assert_catalog(
      'Withdrawal removes the selected public metadata',
      (
        select count(*) = 2
        from public.eacsc_public_catalog(100,0)
      )
    );

    execute 'reset role';

    perform pg_temp.expect_catalog_error(
      'A withdrawn release cannot be reinstated',
      $sql$
        update public.record_releases
        set withdrawn_at = null,
            withdrawn_by = null,
            withdrawal_reason = null
        where release_id = 'c4000000-0000-4000-8000-000000009701'
      $sql$,
      '55000'
    );

    select count(*) into completed_checks
    from pg_temp.catalog_test_results;

    if completed_checks <> 44 then
      raise exception 'Unexpected test check count.';
    end if;

    raise exception using
      errcode = 'ZB406',
      message = 'Roll back completed public catalog test.',
      detail = completion_token;

  exception when sqlstate 'ZB406' then
    get stacked diagnostics caught_detail = pg_exception_detail;

    if caught_detail is distinct from completion_token
      or completed_checks <> 44 then
      raise exception 'Unexpected public-test completion marker.';
    end if;
  end;

  if current_user <> 'postgres' then
    raise exception 'FAIL: database role was not restored.';
  end if;

  if jsonb_build_object(
    'profiles', (
      select jsonb_agg(to_jsonb(t) order by user_id)
      from public.app_users t
    ),
    'masters', (
      select jsonb_agg(to_jsonb(t) order by record_id)
      from public.master_records t
    ),
    'versions', (
      select jsonb_agg(to_jsonb(t) order by version_id)
      from public.record_versions t
    ),
    'assignments', (
      select jsonb_agg(
        to_jsonb(t) order by record_id,user_id,assignment_function
      )
      from public.record_assignments t
    ),
    'releases', (
      select jsonb_agg(to_jsonb(t) order by release_id)
      from public.record_releases t
    ),
    'audits', (
      select jsonb_agg(to_jsonb(t) order by event_uuid)
      from public.audit_events t
    ),
    'receipts', (
      select jsonb_agg(to_jsonb(t) order by actor_user_id,request_id)
      from eacsc_private.mutation_receipts t
    )
  ) is distinct from original_state then
    raise exception 'FAIL: existing records, profiles or audit/receipt history changed.';
  end if;

  if to_regclass('pg_temp.catalog_test_results') is not null
    or to_regprocedure('pg_temp.assert_catalog(text,boolean)') is not null
    or to_regprocedure(
      'pg_temp.expect_catalog_error(text,text,text)'
    ) is not null then
    raise exception 'FAIL: temporary public-test helpers remain.';
  end if;

  raise notice
    'PASS: % public catalog checks; fixtures rolled back; existing rows unchanged.',
    completed_checks;
end;
$catalog_test$;
