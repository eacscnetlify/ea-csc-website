-- Read-only checks immediately after the migration and rollback test.
with checks(check_name, passed) as (
  values
    ('Public RPC uses caller privileges', (
      select not prosecdef and provolatile='v'
      from pg_catalog.pg_proc
      where oid='public.eacsc_update_draft_notes(uuid,integer,text,uuid)'::regprocedure
    )),
    ('Public RPC has an empty search path', (
      select proconfig @> array['search_path=""']::text[]
      from pg_catalog.pg_proc
      where oid='public.eacsc_update_draft_notes(uuid,integer,text,uuid)'::regprocedure
    )),
    ('Authenticated may call the RPC', has_function_privilege(
      'authenticated','public.eacsc_update_draft_notes(uuid,integer,text,uuid)','EXECUTE'
    )),
    ('Anonymous may not call the RPC', not has_function_privilege(
      'anon','public.eacsc_update_draft_notes(uuid,integer,text,uuid)','EXECUTE'
    )),
    ('Service role may not call the RPC', not has_function_privilege(
      'service_role','public.eacsc_update_draft_notes(uuid,integer,text,uuid)','EXECUTE'
    )),
    ('Private implementation pins owner privileges and search path', (
      select prosecdef and proconfig @> array['search_path=""']::text[]
      from pg_catalog.pg_proc
      where oid='eacsc_private.update_draft_notes(uuid,integer,text,uuid)'::regprocedure
    )),
    ('Private implementation rejects anonymous execution', not has_function_privilege(
      'anon','eacsc_private.update_draft_notes(uuid,integer,text,uuid)','EXECUTE'
    )),
    ('Receipts have RLS and no access policies', (
      select relation.relrowsecurity and not exists(
        select 1 from pg_catalog.pg_policy where polrelid=relation.oid
      ) from pg_catalog.pg_class as relation
      where relation.oid='eacsc_private.mutation_receipts'::regclass
    )),
    ('Application roles cannot directly read or modify receipts', (
      select bool_and(
        not has_any_column_privilege(role_name,'eacsc_private.mutation_receipts','SELECT,INSERT,UPDATE')
        and not has_table_privilege(role_name,'eacsc_private.mutation_receipts','DELETE,TRUNCATE')
      ) from (values ('anon'),('authenticated'),('service_role')) as roles(role_name)
    )),
    ('Authenticated still lacks direct application-table writes', (
      select bool_and(
        not has_any_column_privilege('authenticated',table_name,'INSERT,UPDATE')
        and not has_table_privilege('authenticated',table_name,'DELETE,TRUNCATE')
      ) from (values
        ('public.app_users'),('public.master_records'),('public.record_versions'),
        ('public.record_assignments'),('public.audit_events'),('public.update_bulletins')
      ) as tables(table_name)
    )),
    ('Receipt change-blocking trigger is enabled', exists(
      select 1 from pg_catalog.pg_trigger
      where tgrelid='eacsc_private.mutation_receipts'::regclass
        and tgname='mutation_receipts_block_changes' and tgenabled='O'
    )),
    ('No command test receipts remain', (select count(*)=0 from eacsc_private.mutation_receipts)),
    ('No command test audit rows remain', (
      select count(*)=0 from public.audit_events
      where record_id in (
        'EACSC-2099-TEST-9501','EACSC-2099-TEST-9502','EACSC-2099-TEST-9503',
        'EACSC-2099-TEST-9504','EACSC-2099-TEST-9505','EACSC-2099-TEST-9506'
      )
    )),
    ('No command test master records remain', (
      select count(*)=0 from public.master_records
      where record_id in (
        'EACSC-2099-TEST-9501','EACSC-2099-TEST-9502','EACSC-2099-TEST-9503',
        'EACSC-2099-TEST-9504','EACSC-2099-TEST-9505','EACSC-2099-TEST-9506'
      )
    )),
    ('Temporary fault-injection constraints were removed', not exists(
      select 1 from pg_catalog.pg_constraint
      where conname in ('batch4_test_audit_failure','batch4_test_receipt_failure')
    ))
)
select check_name, case when passed is true then 'PASS' else 'FAIL' end as result
from checks order by check_name;
