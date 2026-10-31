-- Setup-stage checks: no operational public releases have been issued yet.
with checks(check_name, passed) as (
  values
    (
      'Release table has RLS and no access policies',
      (
        select
          c.relrowsecurity
          and not exists (
            select 1
            from pg_catalog.pg_policy p
            where p.polrelid = c.oid
          )
        from pg_catalog.pg_class c
        where c.oid = 'public.record_releases'::regclass
      )
    ),
    (
      'Public RPC uses caller privileges and a fixed search path',
      (
        select
          not p.prosecdef
          and p.provolatile = 's'
          and p.proconfig @> array['search_path=""']
        from pg_catalog.pg_proc p
        where p.oid =
          'public.eacsc_public_catalog(integer,integer)'::regprocedure
      )
    ),
    (
      'Private helper pins definer privileges and search path',
      (
        select
          p.prosecdef
          and p.provolatile = 's'
          and p.proconfig @> array['search_path=""']
        from pg_catalog.pg_proc p
        where p.oid =
          'eacsc_private.public_catalog(integer,integer)'::regprocedure
      )
    ),
    (
      'Catalog callable by public clients without release-table reads',
      (
        has_function_privilege(
          'anon',
          'public.eacsc_public_catalog(integer,integer)',
          'EXECUTE'
        )
        and has_function_privilege(
          'authenticated',
          'public.eacsc_public_catalog(integer,integer)',
          'EXECUTE'
        )
        and not has_table_privilege(
          'anon', 'public.record_releases', 'SELECT'
        )
        and not has_table_privilege(
          'authenticated', 'public.record_releases', 'SELECT'
        )
      )
    ),
    (
      'No release rows were created',
      (select count(*) = 0 from public.record_releases)
    ),
    (
      'No record was assigned a public release',
      (
        select count(*) = 0
        from public.master_records
        where current_public_release_id is not null
      )
    )
)
select
  check_name,
  case when passed is true then 'PASS' else 'FAIL' end as result
from checks
order by check_name;
