-- Read-only setup verification. This does not accept a version or change Storage.
with functions as (
  select
    to_regprocedure('public.eacsc_accept_version_upload(uuid,uuid,uuid,uuid,text,bigint,text,text)') as entry,
    to_regprocedure('eacsc_private.accept_version_upload(uuid,uuid,uuid,uuid,text,bigint,text,text)') as implementation
), checks(check_name, passed) as (
  select 'Acceptance RPC and private implementation exist',
    entry is not null and implementation is not null from functions
  union all
  select 'Only the backend API role can call the acceptance RPC',
    coalesce(has_function_privilege('service_role', entry, 'EXECUTE'), false)
    and not coalesce(has_function_privilege('anon', entry, 'EXECUTE'), true)
    and not coalesce(has_function_privilege('authenticated', entry, 'EXECUTE'), true)
  from functions
  union all
  select 'Private implementation is also denied to application roles',
    coalesce(has_function_privilege('service_role', implementation, 'EXECUTE'), false)
    and not coalesce(has_function_privilege('anon', implementation, 'EXECUTE'), true)
    and not coalesce(has_function_privilege('authenticated', implementation, 'EXECUTE'), true)
  from functions
  union all
  select 'Public RPC uses caller privileges and an empty search path',
    exists(select 1 from pg_catalog.pg_proc p, functions f
      where p.oid = f.entry and not p.prosecdef
        and 'search_path=""' = any(p.proconfig))
  union all
  select 'Private implementation pins definer privileges and an empty search path',
    exists(select 1 from pg_catalog.pg_proc p, functions f
      where p.oid = f.implementation and p.prosecdef
        and 'search_path=""' = any(p.proconfig))
  union all
  select 'Terminal decisions have RLS and no access policies',
    exists(select 1 from pg_catalog.pg_class where
      oid = to_regclass('eacsc_private.upload_dispositions') and relrowsecurity)
    and not exists(select 1 from pg_catalog.pg_policy where
      polrelid = to_regclass('eacsc_private.upload_dispositions'))
  union all
  select 'Application and backend roles have no direct terminal-table privileges',
    not exists(select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(name)
      where has_table_privilege(r.name, 'eacsc_private.upload_dispositions',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  union all
  select 'Terminal-decision protection trigger is enabled',
    exists(select 1 from pg_catalog.pg_trigger where
      tgrelid = to_regclass('eacsc_private.upload_dispositions')
      and tgname = 'upload_dispositions_protect_changes' and tgenabled = 'O')
  union all
  select 'Both managed buckets remain private',
    (select count(*) from storage.buckets where
      id in ('internal-council-records', 'verified-council-releases') and public is false) = 2
  union all
  select 'No direct Storage access policies were added',
    not exists(select 1 from pg_catalog.pg_policy where
      polrelid in ('storage.objects'::regclass, 'storage.buckets'::regclass))
)
select check_name, case when passed is true then 'PASS' else 'FAIL' end as result
from checks order by check_name;
