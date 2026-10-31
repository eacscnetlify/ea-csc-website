-- Read-only verification of the hosted acceptance run. Run as postgres.
with inputs as (
  select
    '4f678b00-8ffa-4afc-9aeb-6a6ddc1ee60c'::uuid as invalid_prepare_id,
    '50ef7a84-1e71-4f97-8483-0725b39b0800'::uuid as valid_prepare_id,
    'e1371dc5-9dc0-46f2-bf81-d9b168038b23'::uuid as accept_id,
    '7d507bee-4635-476f-85ce-ab836f7c6c60'::uuid as version_id
), uploads as (
  select u.*, u.request_id = i.valid_prepare_id as valid_file
  from eacsc_private.upload_requests u
  join public.app_users a on a.user_id = u.actor_user_id
  cross join inputs i
  where a.email = 'batch4-author@example.invalid'
    and u.record_id = 'EACSC-2099-HTTP-9601'
    and u.request_id in (i.invalid_prepare_id, i.valid_prepare_id)
), good as (
  select * from uploads where valid_file
), bad as (
  select * from uploads where not valid_file
), receipt as (
  select r.*
  from eacsc_private.mutation_receipts r
  join good g on g.actor_user_id = r.actor_user_id
  cross join inputs i
  where r.request_id = i.accept_id
    and r.command_name = 'accept_version_upload'
), checks(check_name, passed) as (
  values
  ('Both expected preparation requests exist for the fictional Author',
    (select count(*) from uploads) = 2),

  ('Both preparations have exactly one matching audit and receipt',
    (select count(*) from uploads u where
      (select count(*) from public.audit_events a
        where a.event_uuid = u.preparation_event_uuid
          and a.actor_user_id = u.actor_user_id
          and a.record_id = u.record_id
          and a.request_id = u.request_id
          and a.version_id is null
          and a.action_type = 'version.upload_prepared') = 1
      and (select count(*) from eacsc_private.mutation_receipts r
        where r.actor_user_id = u.actor_user_id
          and r.request_id = u.request_id
          and r.command_name = 'prepare_version_upload'
          and r.audit_event_uuid = u.preparation_event_uuid
          and r.response_payload->>'upload_id' = u.upload_id::text) = 1) = 2),

  ('Accepted Draft has the exact prepared file metadata',
    exists(select 1 from good g, inputs i, public.record_versions v
      where v.version_id = i.version_id
        and v.version_id = g.proposed_version_id
        and v.record_id = g.record_id
        and v.version_number = g.proposed_version_number
        and v.state = 'Draft'
        and v.revision_counter = 1
        and v.storage_key = g.destination_key
        and v.original_filename = g.original_filename
        and v.mime_type = g.mime_type
        and v.file_size_bytes = g.file_size_bytes
        and v.sha256 = g.sha256
        and v.change_summary = g.change_summary
        and v.correction_classification = g.correction_classification)),

  ('Accepted version points to the preceding version of the same record',
    exists(select 1 from good g, inputs i,
      public.record_versions v, public.record_versions p
      where v.version_id = i.version_id
        and p.version_id = v.previous_version_id
        and p.record_id = g.record_id
        and p.version_number = g.proposed_version_number - 1)),

  ('Master revision advanced exactly once',
    exists(select 1 from good g
      join public.master_records m on m.record_id = g.record_id
      where m.revision_counter = g.expected_record_revision + 1)),

  ('Exactly one matching acceptance audit exists',
    (select count(*) from public.audit_events a, good g, inputs i
      where a.actor_user_id = g.actor_user_id
        and a.request_id = i.accept_id) = 1
    and exists(select 1 from public.audit_events a, good g, inputs i
      where a.actor_user_id = g.actor_user_id
        and a.request_id = i.accept_id
        and a.action_type = 'version.upload_accepted'
        and a.version_id = i.version_id
        and a.record_id = g.record_id
        and a.new_state->>'upload_id' = g.upload_id::text
        and a.previous_revision = g.expected_record_revision
        and a.new_revision = g.expected_record_revision + 1)),

  ('Exactly one matching acceptance receipt exists',
    (select count(*) from receipt) = 1
    and exists(select 1 from receipt r, good g, inputs i
      where r.request_payload @> jsonb_build_object(
        'upload_id', g.upload_id,
        'verified_mime_type', g.mime_type,
        'verified_file_size_bytes', g.file_size_bytes,
        'verified_sha256', g.sha256,
        'verifier_version', 'eacsc-pdf-structure-v1')
      and r.response_payload @> jsonb_build_object(
        'upload_id', g.upload_id,
        'request_id', i.accept_id,
        'version_id', i.version_id,
        'version_number', g.proposed_version_number,
        'state', 'Draft',
        'accepted_version', true,
        'record_revision', g.expected_record_revision + 1))),

  ('Acceptance decision, receipt and audit reference the same version',
    exists(select 1 from good g, inputs i, receipt r,
      eacsc_private.upload_dispositions d, public.audit_events a
      where d.upload_id = g.upload_id
        and d.disposition = 'accepted'
        and d.accepted_version_id = i.version_id
        and d.acceptance_request_id = i.accept_id
        and d.audit_event_uuid = r.audit_event_uuid
        and a.event_uuid = r.audit_event_uuid
        and a.version_id = i.version_id
        and r.response_payload->>'audit_event_uuid' = a.event_uuid::text)),

  ('Both staged test objects exist privately',
    (select count(*) from uploads u
      join storage.objects o
        on o.bucket_id = u.bucket_id and o.name = u.staging_key) = 2),

  ('Exactly one accepted destination object matches the receipt',
    (select count(*) from good g
      join storage.objects o
        on o.bucket_id = g.bucket_id and o.name = g.destination_key) = 1
    and exists(select 1 from good g, receipt r, storage.objects o
      where o.bucket_id = g.bucket_id
        and o.name = g.destination_key
        and r.request_payload->>'storage_object_id' = o.id::text)),

  ('Rejected file has no official version or final destination object',
    exists(select 1 from bad)
    and not exists(select 1 from bad b
      join public.record_versions v
        on v.version_id = b.proposed_version_id
          or v.storage_key = b.destination_key)
    and not exists(select 1 from bad b
      join storage.objects o
        on o.bucket_id = b.bucket_id and o.name = b.destination_key)),

  ('Rejected file has no acceptance decision, audit or receipt',
    exists(select 1 from bad)
    and not exists(select 1 from bad b
      join eacsc_private.upload_dispositions d on d.upload_id = b.upload_id)
    and not exists(select 1 from bad b
      join public.audit_events a
        on a.action_type = 'version.upload_accepted'
          and (a.version_id = b.proposed_version_id
            or a.new_state->>'upload_id' = b.upload_id::text))
    and not exists(select 1 from bad b
      join eacsc_private.mutation_receipts r
        on r.command_name = 'accept_version_upload'
          and r.request_payload->>'upload_id' = b.upload_id::text)),

  ('Accepted Draft has no approval information',
    exists(select 1 from public.record_versions v, inputs i
      where v.version_id = i.version_id
        and v.approved_at is null
        and v.approval_basis is null
        and v.approval_evidence_reference is null
        and v.approval_not_required_reason is null
        and v.approval_recorded_by is null)),

  ('No release was created for either proposed version',
    (select count(*) from uploads) = 2
    and not exists(select 1 from uploads u
      join public.record_releases r on r.version_id = u.proposed_version_id)),

  ('Fixture has no selected public release',
    exists(select 1 from public.master_records
      where record_id = 'EACSC-2099-HTTP-9601'
        and current_public_release_id is null)),

  ('Both managed buckets remain private',
    (select count(*) from storage.buckets
      where public is false
        and id in ('internal-council-records', 'verified-council-releases')) = 2),

  ('No direct Storage access policies were added',
    not exists(select 1 from pg_catalog.pg_policy
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
