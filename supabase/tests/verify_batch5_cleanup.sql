-- Read-only verification after removing the three reviewed staging objects.
with inputs as (
  select
    'e1371dc5-9dc0-46f2-bf81-d9b168038b23'::uuid as accept_id,
    '7d507bee-4635-476f-85ce-ab836f7c6c60'::uuid as version_id
), uploads as (
  select u.*
  from eacsc_private.upload_requests u
  join public.app_users a on a.user_id = u.actor_user_id
  where a.email = 'batch4-author@example.invalid'
    and u.record_id = 'EACSC-2099-HTTP-9601'
    and u.request_id in (
      '96cc9940-c91b-4ea2-a51a-a0d8c5c0eed1'::uuid,
      '4f678b00-8ffa-4afc-9aeb-6a6ddc1ee60c'::uuid,
      '50ef7a84-1e71-4f97-8483-0725b39b0800'::uuid
    )
), good as (
  select * from uploads
  where request_id = '50ef7a84-1e71-4f97-8483-0725b39b0800'::uuid
), abandoned as (
  select * from uploads
  where request_id <> '50ef7a84-1e71-4f97-8483-0725b39b0800'::uuid
), receipt as (
  select r.*
  from eacsc_private.mutation_receipts r, good g, inputs i
  where r.actor_user_id = g.actor_user_id
    and r.request_id = i.accept_id
    and r.command_name = 'accept_version_upload'
), checks(check_name, passed) as (
  values
  ('All three immutable upload requests remain',
    (select count(*) from uploads) = 3),

  ('All three reviewed staging objects are gone',
    (select count(*) from uploads) = 3
    and not exists(
      select 1 from uploads u
      join storage.objects o
        on o.bucket_id = u.bucket_id and o.name = u.staging_key
    )),

  ('Both abandoned uploads are terminally blocked from acceptance',
    (select count(*) from abandoned u
      join eacsc_private.upload_dispositions d on d.upload_id = u.upload_id
      where d.disposition = 'cleanup_authorized') = 2),

  ('Abandoned uploads have no official version or final object',
    (select count(*) from abandoned) = 2
    and not exists(select 1 from abandoned u
      join public.record_versions v
        on v.version_id = u.proposed_version_id
          or v.storage_key = u.destination_key)
    and not exists(select 1 from abandoned u
      join storage.objects o
        on o.bucket_id = u.bucket_id and o.name = u.destination_key)),

  ('Accepted Draft and exact file metadata remain',
    exists(select 1 from good g, inputs i, public.record_versions v
      where v.version_id = i.version_id
        and v.version_id = g.proposed_version_id
        and v.record_id = g.record_id
        and v.version_number = g.proposed_version_number
        and v.state = 'Draft'
        and v.revision_counter = 1
        and v.storage_key = g.destination_key
        and v.sha256 = g.sha256
        and v.file_size_bytes = g.file_size_bytes
        and v.mime_type = g.mime_type
        and v.original_filename = g.original_filename
        and v.change_summary = g.change_summary
        and v.correction_classification = g.correction_classification)),

  ('Accepted final object and its original Storage identity remain',
    (select count(*) from good g
      join storage.objects o
        on o.bucket_id = g.bucket_id and o.name = g.destination_key) = 1
    and exists(select 1 from good g, receipt r, storage.objects o
      where o.bucket_id = g.bucket_id
        and o.name = g.destination_key
        and r.request_payload->>'storage_object_id' = o.id::text)),

  ('Acceptance decision still references the original version and audit',
    exists(select 1 from good g, inputs i, receipt r,
      eacsc_private.upload_dispositions d
      where d.upload_id = g.upload_id
        and d.disposition = 'accepted'
        and d.accepted_version_id = i.version_id
        and d.acceptance_request_id = i.accept_id
        and d.audit_event_uuid = r.audit_event_uuid)),

  ('All three preparation audits and receipts remain',
    (select count(*) from uploads u where
      (select count(*) from public.audit_events a
        where a.event_uuid = u.preparation_event_uuid
          and a.actor_user_id = u.actor_user_id
          and a.record_id = u.record_id
          and a.request_id = u.request_id
          and a.action_type = 'version.upload_prepared') = 1
      and (select count(*) from eacsc_private.mutation_receipts r
        where r.actor_user_id = u.actor_user_id
          and r.request_id = u.request_id
          and r.command_name = 'prepare_version_upload'
          and r.audit_event_uuid = u.preparation_event_uuid) = 1) = 3),

  ('Exactly one acceptance audit and receipt remain',
    (select count(*) from receipt) = 1
    and (select count(*) from public.audit_events a, good g, inputs i
      where a.actor_user_id = g.actor_user_id
        and a.request_id = i.accept_id) = 1
    and exists(select 1 from public.audit_events a, receipt r, inputs i
      where a.event_uuid = r.audit_event_uuid
        and a.version_id = i.version_id
        and a.action_type = 'version.upload_accepted'
        and r.response_payload->>'audit_event_uuid' = a.event_uuid::text)),

  ('Master revision remains at the accepted revision',
    exists(select 1 from good g
      join public.master_records m on m.record_id = g.record_id
      where m.revision_counter = g.expected_record_revision + 1)),

  ('Accepted version has no approval information',
    exists(select 1 from public.record_versions v, inputs i
      where v.version_id = i.version_id
        and v.approved_at is null
        and v.approval_recorded_by is null
        and v.approval_basis is null
        and v.approval_evidence_reference is null
        and v.approval_not_required_reason is null)),

  ('No public release was created or selected',
    (select count(*) from uploads) = 3
    and not exists(select 1 from uploads u
      join public.record_releases r on r.version_id = u.proposed_version_id)
    and exists(select 1 from public.master_records
      where record_id = 'EACSC-2099-HTTP-9601'
        and current_public_release_id is null)),

  ('Buckets remain private and Storage policies remain absent',
    (select count(*) from storage.buckets
      where public is false
        and id in (
          'internal-council-records',
          'verified-council-releases'
        )) = 2
    and not exists(select 1 from pg_catalog.pg_policy
      where polrelid in (
        'storage.objects'::regclass,
        'storage.buckets'::regclass
      )))
)
select
  check_name,
  case when passed is true then 'PASS' else 'FAIL' end as result
from checks
order by check_name;
