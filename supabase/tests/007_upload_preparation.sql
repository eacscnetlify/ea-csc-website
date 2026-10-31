-- Run the ENTIRE file as postgres.
-- No file bytes or Storage metadata are created.
-- All fixtures, temporary profile changes and injected failures roll back.

do $upload_tests$
declare
  author_id uuid;
  custodian_id uuid;
  inactive_id uuid;
  no_profile_id uuid;
  claims text;
  original_state jsonb;
  response jsonb;
  retry_response jsonb;
  saved_upload uuid;
  completed integer := 0;
  marker text := gen_random_uuid()::text;
  caught_detail text;
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;

  select id into strict author_id
  from auth.users
  where lower(email)='batch4-author@example.invalid'
    and email_confirmed_at is not null;

  select id into strict custodian_id
  from auth.users
  where lower(email)='batch4-custodian@example.invalid'
    and email_confirmed_at is not null;

  select id into strict inactive_id
  from auth.users
  where lower(email)='batch4-inactive@example.invalid'
    and email_confirmed_at is not null;

  select id into strict no_profile_id
  from auth.users
  where lower(email)='batch4-no-profile@example.invalid'
    and email_confirmed_at is not null;

  if not exists(
      select 1 from public.app_users
      where user_id=author_id and is_active
        and functional_roles=array['author']::text[]
    )
    or not exists(
      select 1 from public.app_users
      where user_id=custodian_id and is_active
        and functional_roles=array['custodian']::text[]
    )
    or not exists(
      select 1 from public.app_users
      where user_id=inactive_id and not is_active
    )
    or exists(
      select 1 from public.app_users
      where user_id=no_profile_id
    ) then
    raise exception
      'Expected the original Batch 4 test profiles. Stop and inspect.';
  end if;

  if exists(
    select 1 from public.master_records
    where record_id between
      'EACSC-2099-UPLOAD-9801' and 'EACSC-2099-UPLOAD-9804'
  ) then
    raise exception
      'Reserved upload-test records already exist. Stop and inspect.';
  end if;

  original_state := jsonb_build_object(
    'profiles',(
      select jsonb_agg(to_jsonb(t) order by user_id)
      from public.app_users t
    ),
    'masters',(
      select jsonb_agg(to_jsonb(t) order by record_id)
      from public.master_records t
    ),
    'versions',(
      select jsonb_agg(to_jsonb(t) order by version_id)
      from public.record_versions t
    ),
    'assignments',(
      select jsonb_agg(
        to_jsonb(t) order by record_id,user_id,assignment_function
      )
      from public.record_assignments t
    ),
    'audits',(
      select jsonb_agg(to_jsonb(t) order by event_uuid)
      from public.audit_events t
    ),
    'receipts',(
      select jsonb_agg(to_jsonb(t) order by actor_user_id,request_id)
      from eacsc_private.mutation_receipts t
    ),
    'uploads',(
      select jsonb_agg(to_jsonb(t) order by upload_id)
      from eacsc_private.upload_requests t
    )
  );

  begin
    create temporary table upload_test_results(
      label text primary key,
      passed boolean not null check(passed)
    ) on commit drop;

    grant select,insert on pg_temp.upload_test_results
      to anon,authenticated,service_role;

    execute format(
      'grant usage on schema %I to anon,authenticated,service_role',
      pg_my_temp_schema()::regnamespace::text
    );

    execute $define_assert$
      create function pg_temp.check_upload(
        label text,actual boolean
      )
      returns void
      language plpgsql
      security invoker
      set search_path=''
      as $f$
      begin
        if actual is not true then
          raise exception 'FAIL: %',label;
        end if;
        insert into pg_temp.upload_test_results
        values(label,true);
      end;
      $f$;
    $define_assert$;

    execute $define_error$
      create function pg_temp.expect_upload_error(
        label text,statement_sql text,expected text
      )
      returns void
      language plpgsql
      security invoker
      set search_path=''
      as $f$
      declare
        actual text;
      begin
        begin
          execute statement_sql;
        exception when others then
          get stacked diagnostics actual=returned_sqlstate;
        end;
        perform pg_temp.check_upload(label,actual=expected);
      end;
      $f$;
    $define_error$;

    execute $define_call$
      create function pg_temp.prepare_upload(
        r text,q uuid,o jsonb default '{}'::jsonb
      )
      returns jsonb
      language sql
      security invoker
      set search_path=''
      as $f$
        select public.eacsc_prepare_version_upload(
          r,
          coalesce((o->>'revision')::integer,1),
          coalesce(o->>'name','fictional.pdf'),
          coalesce(o->>'mime','application/pdf'),
          coalesce((o->>'size')::bigint,128),
          coalesce(o->>'hash',repeat('a',64)),
          coalesce(o->>'notes','Fictional upload preparation.'),
          coalesce(o->>'classification','legitimate_change'),
          q
        );
      $f$;
    $define_call$;

    grant execute on function
      pg_temp.check_upload(text,boolean),
      pg_temp.expect_upload_error(text,text,text),
      pg_temp.prepare_upload(text,uuid,jsonb)
      to anon,authenticated,service_role;

    insert into public.master_records(
      record_id,title,category,document_type,
      originating_office,custodian_position,access_class
    )
    select
      'EACSC-2099-UPLOAD-'||n,
      'Fictional upload test',
      'Forms and official information',
      'Test form',
      'Fictional office',
      'Fictional custodian',
      case when n=9802 then 'restricted' else 'internal' end
    from generate_series(9801,9804) n;

    insert into public.record_versions(
      record_id,version_number,change_summary
    )
    select record_id,1,'Unchanged prior Draft.'
    from public.master_records
    where record_id between
      'EACSC-2099-UPLOAD-9801' and 'EACSC-2099-UPLOAD-9803';

    insert into public.record_assignments(
      record_id,user_id,assignment_function,
      is_active,allow_restricted,assigned_by
    ) values
      ('EACSC-2099-UPLOAD-9801',author_id,'author',true,false,custodian_id),
      ('EACSC-2099-UPLOAD-9801',custodian_id,'custodian',true,false,custodian_id),
      ('EACSC-2099-UPLOAD-9801',inactive_id,'author',true,false,custodian_id),
      ('EACSC-2099-UPLOAD-9802',author_id,'author',true,false,custodian_id),
      ('EACSC-2099-UPLOAD-9802',custodian_id,'custodian',true,true,custodian_id),
      ('EACSC-2099-UPLOAD-9804',author_id,'author',true,false,custodian_id);

    claims:=jsonb_build_object(
      'sub',author_id,'is_anonymous',false
    )::text;

    perform set_config('request.jwt.claims',claims,true);
    execute 'set local role authenticated';

    response:=pg_temp.prepare_upload(
      'EACSC-2099-UPLOAD-9801',
      'a5000000-0000-4000-8000-000000000001'
    );
    saved_upload:=(response->>'upload_id')::uuid;

    retry_response:=pg_temp.prepare_upload(
      'EACSC-2099-UPLOAD-9801',
      'a5000000-0000-4000-8000-000000000001'
    );

    perform pg_temp.check_upload(
      'Prepared request targets the existing assigned record',
      response->>'record_id'='EACSC-2099-UPLOAD-9801'
        and response->>'bucket_id'='internal-council-records'
    );

    perform pg_temp.check_upload(
      'New version number is server planned',
      response->>'proposed_version_number'='2'
    );

    perform pg_temp.check_upload(
      'Staging key is unique and server generated',
      response->>'staging_key'=
        'quarantine/'||author_id::text||'/'||saved_upload::text||'.pdf'
    );

    perform pg_temp.check_upload(
      'Destination follows category record version naming',
      response->>'destination_key'=
        'forms/EACSC-2099-UPLOAD-9801/2_'||saved_upload::text||'.pdf'
    );

    perform pg_temp.check_upload(
      'Preparation has a fixed thirty minute lifetime',
      (response->>'expires_at')::timestamptz=
        now()+interval '30 minutes'
    );

    perform pg_temp.check_upload(
      'Identical retry returns the original acknowledgment',
      response=retry_response
    );

    perform pg_temp.expect_upload_error(
      'Changed payload cannot reuse a request ID',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000001',
          '{"notes":"Changed payload"}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Zero size rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"size":0}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Oversized file rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"size":10000001}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Invalid checksum rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"hash":"abc"}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Executable rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"name":"bad.exe","mime":"application/octet-stream"}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Mismatched type rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"mime":"image/png"}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Path in filename rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"name":"../fictional.pdf"}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Blank notes rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"notes":"   "}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Unknown classification rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"classification":"approve"}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Later version cannot claim initial capture',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"classification":"initial_capture"}'::jsonb
        )
      $sql$,'22023'
    );

    perform pg_temp.expect_upload_error(
      'Stale record revision rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099',
          '{"revision":2}'::jsonb
        )
      $sql$,'PT409'
    );

    perform pg_temp.expect_upload_error(
      'Unassigned record rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9803',
          'a5000000-0000-4000-8000-000000000099'
        )
      $sql$,'42501'
    );

    perform pg_temp.expect_upload_error(
      'Restricted record without explicit permission rejected',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9802',
          'a5000000-0000-4000-8000-000000000099'
        )
      $sql$,'42501'
    );

    response:=pg_temp.prepare_upload(
      'EACSC-2099-UPLOAD-9804',
      'a5000000-0000-4000-8000-000000000004',
      '{"classification":"initial_capture"}'
    );

    perform pg_temp.check_upload(
      'First planned version accepts initial capture',
      response->>'proposed_version_number'='1'
    );

    execute 'reset role';

    perform pg_temp.check_upload(
      'Identical retry creates one preparation audit and receipt',
      (
        select count(*)=1
        from eacsc_private.upload_requests
        where actor_user_id=author_id
          and request_id='a5000000-0000-4000-8000-000000000001'
      )
      and (
        select count(*)=1
        from public.audit_events
        where actor_user_id=author_id
          and request_id='a5000000-0000-4000-8000-000000000001'
      )
      and (
        select count(*)=1
        from eacsc_private.mutation_receipts
        where actor_user_id=author_id
          and request_id='a5000000-0000-4000-8000-000000000001'
      )
    );

    perform pg_temp.check_upload(
      'Preparation creates no accepted version or master revision change',
      (
        select count(*)=3 and bool_and(
          revision_counter=1
          and change_summary='Unchanged prior Draft.'
          and storage_key is null
        )
        from public.record_versions
        where record_id between
          'EACSC-2099-UPLOAD-9801' and 'EACSC-2099-UPLOAD-9804'
      )
      and (
        select bool_and(revision_counter=1)
        from public.master_records
        where record_id between
          'EACSC-2099-UPLOAD-9801' and 'EACSC-2099-UPLOAD-9804'
      )
    );

    perform pg_temp.expect_upload_error(
      'Preparation facts reject direct changes',
      $sql$
        update eacsc_private.upload_requests
        set original_filename=original_filename
        where false
      $sql$,'55000'
    );

    execute 'set local role anon';

    perform pg_temp.expect_upload_error(
      'anon cannot read preparation table',
      $sql$select * from eacsc_private.upload_requests$sql$,
      '42501'
    );

    perform pg_temp.expect_upload_error(
      'anon cannot insert preparation facts',
      $sql$insert into eacsc_private.upload_requests default values$sql$,
      '42501'
    );

    perform pg_temp.expect_upload_error(
      'anon cannot call the preparation RPC',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099'
        )
      $sql$,'42501'
    );

    execute 'reset role';
    execute 'set local role authenticated';

    perform pg_temp.expect_upload_error(
      'authenticated cannot read preparation table',
      $sql$select * from eacsc_private.upload_requests$sql$,
      '42501'
    );

    perform pg_temp.expect_upload_error(
      'authenticated cannot insert preparation facts',
      $sql$insert into eacsc_private.upload_requests default values$sql$,
      '42501'
    );

    execute 'reset role';
    execute 'set local role service_role';

    perform pg_temp.expect_upload_error(
      'service_role cannot read preparation table',
      $sql$select * from eacsc_private.upload_requests$sql$,
      '42501'
    );

    perform pg_temp.expect_upload_error(
      'service_role cannot insert preparation facts',
      $sql$insert into eacsc_private.upload_requests default values$sql$,
      '42501'
    );

    perform pg_temp.expect_upload_error(
      'service_role cannot call the preparation RPC',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099'
        )
      $sql$,'42501'
    );

    execute 'reset role';

    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub',inactive_id,'is_anonymous',false
      )::text,
      true
    );
    execute 'set local role authenticated';

    perform pg_temp.expect_upload_error(
      'Inactive profile is denied',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099'
        )
      $sql$,'42501'
    );

    execute 'reset role';

    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub',no_profile_id,'is_anonymous',false
      )::text,
      true
    );
    execute 'set local role authenticated';

    perform pg_temp.expect_upload_error(
      'Missing profile is denied',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099'
        )
      $sql$,'42501'
    );

    execute 'reset role';

    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub',author_id,'is_anonymous',true
      )::text,
      true
    );
    execute 'set local role authenticated';

    perform pg_temp.expect_upload_error(
      'Anonymous identity is denied',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099'
        )
      $sql$,'42501'
    );

    execute 'reset role';
    perform set_config('request.jwt.claims',claims,true);

    update public.app_users
    set is_active=false
    where user_id=author_id;

    execute 'set local role authenticated';

    perform pg_temp.expect_upload_error(
      'Deactivation denies new preparation',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000099'
        )
      $sql$,'42501'
    );

    perform pg_temp.expect_upload_error(
      'Deactivation also denies replaying the old receipt',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000001'
        )
      $sql$,'42501'
    );

    execute 'reset role';

    update public.app_users
    set is_active=true
    where user_id=author_id;

    update public.record_assignments
    set is_active=false
    where record_id='EACSC-2099-UPLOAD-9801'
      and user_id=author_id;

    execute 'set local role authenticated';

    perform pg_temp.expect_upload_error(
      'Revoked assignment denies old receipt',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000001'
        )
      $sql$,'42501'
    );

    execute 'reset role';

    update public.record_assignments
    set is_active=true
    where record_id='EACSC-2099-UPLOAD-9801'
      and user_id=author_id;

    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub',custodian_id,'is_anonymous',false
      )::text,
      true
    );
    execute 'set local role authenticated';

    response:=pg_temp.prepare_upload(
      'EACSC-2099-UPLOAD-9802',
      'a5000000-0000-4000-8000-000000000002'
    );

    perform pg_temp.check_upload(
      'Explicitly permitted restricted Custodian can prepare',
      response->>'record_id'='EACSC-2099-UPLOAD-9802'
    );

    execute 'reset role';
    perform set_config('request.jwt.claims',claims,true);

    alter table public.audit_events
    add constraint batch5_prepare_audit_failure
      check(action_type<>'version.upload_prepared')
      not valid;

    execute 'set local role authenticated';

    perform pg_temp.expect_upload_error(
      'Audit failure rejects preparation',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000091'
        )
      $sql$,'23514'
    );

    execute 'reset role';

    alter table public.audit_events
    drop constraint batch5_prepare_audit_failure;

    perform pg_temp.check_upload(
      'Audit failure leaves no request or receipt',
      not exists(
        select 1 from eacsc_private.upload_requests
        where request_id='a5000000-0000-4000-8000-000000000091'
      )
      and not exists(
        select 1 from eacsc_private.mutation_receipts
        where request_id='a5000000-0000-4000-8000-000000000091'
      )
    );

    alter table eacsc_private.mutation_receipts
    add constraint batch5_prepare_receipt_failure
      check(command_name<>'prepare_version_upload')
      not valid;

    execute 'set local role authenticated';

    perform pg_temp.expect_upload_error(
      'Late receipt failure rejects preparation',
      $sql$
        select pg_temp.prepare_upload(
          'EACSC-2099-UPLOAD-9801',
          'a5000000-0000-4000-8000-000000000092'
        )
      $sql$,'23514'
    );

    execute 'reset role';

    alter table eacsc_private.mutation_receipts
    drop constraint batch5_prepare_receipt_failure;

    perform pg_temp.check_upload(
      'Late receipt failure rolls back request and audit',
      not exists(
        select 1 from eacsc_private.upload_requests
        where request_id='a5000000-0000-4000-8000-000000000092'
      )
      and not exists(
        select 1 from public.audit_events
        where request_id='a5000000-0000-4000-8000-000000000092'
      )
    );

    select count(*) into completed
    from pg_temp.upload_test_results;

    if completed<>42 then
      raise exception 'Unexpected upload-test check count.';
    end if;

    raise exception using
      errcode='ZB507',
      message='Roll back completed preparation tests.',
      detail=marker;

  exception when sqlstate 'ZB507' then
    get stacked diagnostics caught_detail=pg_exception_detail;

    if caught_detail is distinct from marker
      or completed<>42 then
      raise exception 'Unexpected completion marker.';
    end if;
  end;

  if current_user<>'postgres' then
    raise exception 'FAIL: role was not restored.';
  end if;

  if jsonb_build_object(
    'profiles',(
      select jsonb_agg(to_jsonb(t) order by user_id)
      from public.app_users t
    ),
    'masters',(
      select jsonb_agg(to_jsonb(t) order by record_id)
      from public.master_records t
    ),
    'versions',(
      select jsonb_agg(to_jsonb(t) order by version_id)
      from public.record_versions t
    ),
    'assignments',(
      select jsonb_agg(
        to_jsonb(t) order by record_id,user_id,assignment_function
      )
      from public.record_assignments t
    ),
    'audits',(
      select jsonb_agg(to_jsonb(t) order by event_uuid)
      from public.audit_events t
    ),
    'receipts',(
      select jsonb_agg(to_jsonb(t) order by actor_user_id,request_id)
      from eacsc_private.mutation_receipts t
    ),
    'uploads',(
      select jsonb_agg(to_jsonb(t) order by upload_id)
      from eacsc_private.upload_requests t
    )
  ) is distinct from original_state then
    raise exception 'FAIL: existing records or history changed.';
  end if;

  if to_regclass('pg_temp.upload_test_results') is not null
    or to_regprocedure(
      'pg_temp.check_upload(text,boolean)'
    ) is not null
    or to_regprocedure(
      'pg_temp.expect_upload_error(text,text,text)'
    ) is not null
    or to_regprocedure(
      'pg_temp.prepare_upload(text,uuid,jsonb)'
    ) is not null
    or exists(
      select 1 from pg_catalog.pg_constraint
      where conname in (
        'batch5_prepare_audit_failure',
        'batch5_prepare_receipt_failure'
      )
    ) then
    raise exception 'FAIL: temporary helpers or constraints remain.';
  end if;

  raise notice
    'PASS: % upload preparation checks; cleanup passed; existing rows unchanged.',
    completed;
end;
$upload_tests$;
