-- Staging checkpoint for the specific HTTP test request below.
-- Run before finalization or authorized cleanup changes its expected state.
with prepared as (
  select u.*
  from eacsc_private.upload_requests u
  join public.app_users p
    on p.user_id = u.actor_user_id
  where u.request_id =
    '96cc9940-c91b-4ea2-a51a-a0d8c5c0eed1'::uuid
    and u.record_id = 'EACSC-2099-HTTP-9601'
    and p.email = 'batch4-author@example.invalid'
),
checks(check_name, passed) as (
  values
    (
      'Exactly one upload request exists',
      (select count(*) = 1 from prepared)
    ),
    (
      'Exactly one matching preparation audit exists',
      (
        select count(*) = 1
        from public.audit_events a
        join prepared p
          on p.preparation_event_uuid = a.event_uuid
        where a.request_id = p.request_id
          and a.actor_user_id = p.actor_user_id
          and a.record_id = p.record_id
          and a.action_type = 'version.upload_prepared'
          and a.version_id is null
          and a.new_state ->> 'upload_id' = p.upload_id::text
      )
    ),
    (
      'Exactly one matching preparation receipt exists',
      (
        select count(*) = 1
        from eacsc_private.mutation_receipts r
        join prepared p
          on r.actor_user_id = p.actor_user_id
          and r.request_id = p.request_id
        where r.command_name = 'prepare_version_upload'
          and r.audit_event_uuid = p.preparation_event_uuid
          and r.response_payload ->> 'upload_id' = p.upload_id::text
      )
    ),
    (
      'Exactly one staged Storage object exists',
      (
        select count(*) = 1
        from storage.objects o
        join prepared p
          on o.bucket_id = p.bucket_id
          and o.name = p.staging_key
      )
    ),
    (
      'No object exists at the proposed final destination',
      not exists (
        select 1
        from storage.objects o
        join prepared p
          on o.bucket_id = p.bucket_id
          and o.name = p.destination_key
      )
    ),
    (
      'The proposed official version has not been created',
      not exists (
        select 1
        from public.record_versions v
        join prepared p
          on v.version_id = p.proposed_version_id
      )
    ),
    (
      'The master record revision remains unchanged',
      (
        select count(*) = 1
        from public.master_records m
        join prepared p on p.record_id = m.record_id
        where m.revision_counter = p.expected_record_revision
      )
    ),
    (
      'Both planned buckets remain private',
      (
        select count(*) = 2
        from storage.buckets
        where id in (
          'internal-council-records',
          'verified-council-releases'
        )
          and public is false
      )
    ),
    (
      'No direct Storage access policies were added',
      not exists (
        select 1
        from pg_catalog.pg_policies
        where schemaname = 'storage'
          and tablename in ('buckets', 'objects')
      )
    )
)
select
  check_name,
  case when passed is true then 'PASS' else 'FAIL' end as result
from checks
order by check_name;
