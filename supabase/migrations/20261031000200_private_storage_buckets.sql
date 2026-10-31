-- Batch 5 step 1: private bucket configuration only.
-- Apply once as postgres in ea-csc-website-dev.
-- No files, versions, release records or application access policies are created.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $storage_setup$
begin
  if current_user <> 'postgres' then
    raise exception
      'Run this migration using the postgres SQL Editor role.';
  end if;

  if to_regclass('storage.buckets') is null
    or to_regclass('storage.objects') is null then
    raise exception
      'Supabase Storage tables are unavailable. Stop and inspect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'storage.objects'::regclass
      and relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'storage.buckets'::regclass
      and relrowsecurity
  ) then
    raise exception
      'Expected Storage RLS is not enabled. Stop and inspect.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename in ('buckets','objects')
  ) then
    raise exception
      'Storage already has access policies. Inspect them before adding these buckets.';
  end if;

  if exists (
    select 1
    from storage.buckets
    where id in (
      'internal-council-records',
      'verified-council-releases'
    )
      or name in (
        'internal-council-records',
        'verified-council-releases'
      )
  ) then
    raise exception
      'A planned bucket already exists. Inspect it before rerunning setup.';
  end if;

  insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  )
  select
    bucket_name,
    bucket_name,
    false,
    10000000,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    ]::text[]
  from (
    values
      ('internal-council-records'),
      ('verified-council-releases')
  ) as planned(bucket_name);
end;
$storage_setup$;

commit;
