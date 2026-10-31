-- Read-only checks for the initial Batch 5 bucket setup.
-- Run before adding upload policies or uploading fixtures.

with planned as (
  select *
  from storage.buckets
  where id in (
    'internal-council-records',
    'verified-council-releases'
  )
),
checks(check_name,passed) as (
  values
    (
      'Both planned buckets exist',
      (
        select count(*) = 2
        from planned
      )
    ),
    (
      'Both buckets are private and have the expected names',
      (
        select
          count(*) = 2
          and bool_and(public is false and name = id)
        from planned
      )
    ),
    (
      'Both bucket limits are exactly 10000000 bytes',
      (
        select
          count(*) = 2
          and bool_and(file_size_limit = 10000000)
        from planned
      )
    ),
    (
      'Only the four approved MIME types are configured',
      (
        select
          count(*) = 2
          and bool_and(
            cardinality(allowed_mime_types) = 4
            and allowed_mime_types @> array[
              'application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'image/jpeg',
              'image/png'
            ]::text[]
          )
        from planned
      )
    ),
    (
      'Storage objects have RLS enabled',
      exists (
        select 1
        from pg_catalog.pg_class
        where oid = 'storage.objects'::regclass
          and relrowsecurity
      )
    ),
    (
      'Storage buckets have RLS enabled',
      exists (
        select 1
        from pg_catalog.pg_class
        where oid = 'storage.buckets'::regclass
          and relrowsecurity
      )
    ),
    (
      'No Storage access policies have been added',
      not exists (
        select 1
        from pg_catalog.pg_policies
        where schemaname = 'storage'
          and tablename in ('buckets','objects')
      )
    ),
    (
      'Both buckets are empty',
      not exists (
        select 1
        from storage.objects
        where bucket_id in (
          'internal-council-records',
          'verified-council-releases'
        )
      )
    )
)
select
  check_name,
  case when passed is true then 'PASS' else 'FAIL' end as result
from checks
order by check_name;
