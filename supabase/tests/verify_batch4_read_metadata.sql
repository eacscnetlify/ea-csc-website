-- Read-only metadata check after the new migration and rollback test.
select
  relation.relname as table_name,
  relation.relrowsecurity as rls_enabled,
  (select count(*) from pg_catalog.pg_policy as policy
    where policy.polrelid = relation.oid) as policies,
  has_any_column_privilege('anon', relation.oid, 'SELECT') as anon_select,
  has_table_privilege('authenticated', relation.oid, 'SELECT') as blanket_auth_select,
  has_any_column_privilege('authenticated', relation.oid, 'SELECT') as selected_auth_columns,
  (
    has_any_column_privilege('authenticated', relation.oid, 'INSERT')
    or has_any_column_privilege('authenticated', relation.oid, 'UPDATE')
    or has_table_privilege('authenticated', relation.oid, 'DELETE')
    or has_table_privilege('authenticated', relation.oid, 'TRUNCATE')
  ) as auth_write,
  case relation.relname
    when 'master_records' then (select count(*) from public.master_records)
    when 'record_versions' then (select count(*) from public.record_versions)
    when 'record_assignments' then (select count(*) from public.record_assignments)
  end as stored_rows
from pg_catalog.pg_class as relation
join pg_catalog.pg_namespace as namespace
  on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname in ('master_records', 'record_versions', 'record_assignments')
order by relation.relname;
