-- Read-only Batch 5 checkpoint after the browser-created Versions 3 through 6.
-- Versions 2 through 6 must remain private, accepted Drafts. No data is changed.
with inputs as (
  select 'EACSC-2099-HTTP-9601'::text as record_id,
    'batch4-author@example.invalid'::text as author_email
), expected(version_number, mime_type, notes) as (
  values
    (2, 'application/pdf', null::text),
    (3, 'application/pdf', 'Fictional browser upload verification.'),
    (4, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Fictional DOCX browser verification.'),
    (5, 'image/jpeg', 'Fictional JPEG browser verification.'),
    (6, 'image/png', 'Fictional PNG browser verification.')
), versions as (
  select v.*, e.mime_type as expected_mime, e.notes as expected_notes
  from inputs i
  join public.record_versions v on v.record_id = i.record_id
  join expected e on e.version_number = v.version_number
), accepted as (
  select v.*, u.upload_id, u.actor_user_id,
    u.request_id as prepare_request_id,
    u.expected_record_revision, u.preparation_event_uuid,
    u.bucket_id, u.destination_key,
    u.original_filename as prepared_filename,
    u.mime_type as prepared_mime, u.file_size_bytes as prepared_size,
    u.sha256 as prepared_sha, u.change_summary as prepared_notes,
    u.correction_classification as prepared_classification,
    d.acceptance_request_id, d.audit_event_uuid as acceptance_audit
  from versions v
  join eacsc_private.upload_dispositions d
    on d.accepted_version_id = v.version_id and d.disposition = 'accepted'
  join eacsc_private.upload_requests u
    on u.upload_id = d.upload_id
    and u.proposed_version_id = v.version_id
    and u.record_id = v.record_id
    and u.proposed_version_number = v.version_number
  join public.app_users a on a.user_id = u.actor_user_id
  join inputs i on a.email = i.author_email
), historical as (
  select u.*
  from eacsc_private.upload_requests u
  join public.app_users a on a.user_id = u.actor_user_id
  join inputs i on i.record_id = u.record_id and i.author_email = a.email
  where u.request_id in (
    '96cc9940-c91b-4ea2-a51a-a0d8c5c0eed1'::uuid,
    '4f678b00-8ffa-4afc-9aeb-6a6ddc1ee60c'::uuid,
    '50ef7a84-1e71-4f97-8483-0725b39b0800'::uuid
  )
), checks(check_name, passed) as (
  values
    ('All five expected versions have the tested formats and notes',
      (select count(*) from versions) = 5
      and not exists(select 1 from versions
        where mime_type is distinct from expected_mime
          or (expected_notes is not null
            and change_summary is distinct from expected_notes))),

    ('All five versions have matching acceptance decisions and Author preparations',
      (select count(*) from accepted) = 5),

    ('All accepted file metadata and version notes match preparation',
      (select count(*) from accepted) = 5
      and not exists(select 1 from accepted
        where storage_key is distinct from destination_key
          or original_filename is distinct from prepared_filename
          or mime_type is distinct from prepared_mime
          or file_size_bytes is distinct from prepared_size
          or sha256 is distinct from prepared_sha
          or change_summary is distinct from prepared_notes
          or correction_classification is distinct from prepared_classification)),

    ('All five accepted versions remain Drafts without approval',
      (select count(*) from versions) = 5
      and not exists(select 1 from versions
        where state is distinct from 'Draft' or revision_counter <> 1
          or approved_at is not null or approval_recorded_by is not null
          or approval_basis is not null or approval_evidence_reference is not null
          or approval_not_required_reason is not null)),

    ('Each accepted version links to its preceding version of the same record',
      (select count(*) from versions v
        join public.record_versions previous
          on previous.version_id = v.previous_version_id
          and previous.record_id = v.record_id
          and previous.version_number = v.version_number - 1) = 5),

    ('Each preparation retains its matching audit and immutable receipt',
      (select count(*) from accepted s where
        (select count(*) from public.audit_events a
          where a.event_uuid = s.preparation_event_uuid
            and a.actor_user_id = s.actor_user_id and a.record_id = s.record_id
            and a.request_id = s.prepare_request_id
            and a.action_type = 'version.upload_prepared') = 1
        and (select count(*) from eacsc_private.mutation_receipts r
          where r.actor_user_id = s.actor_user_id
            and r.request_id = s.prepare_request_id
            and r.command_name = 'prepare_version_upload'
            and r.audit_event_uuid = s.preparation_event_uuid
            and r.response_payload->>'upload_id' = s.upload_id::text) = 1) = 5),

    ('Each acceptance retains its matching audit and immutable receipt',
      (select count(*) from accepted s where
        (select count(*) from public.audit_events a
          where a.event_uuid = s.acceptance_audit
            and a.actor_user_id = s.actor_user_id and a.record_id = s.record_id
            and a.version_id = s.version_id and a.request_id = s.acceptance_request_id
            and a.action_type = 'version.upload_accepted') = 1
        and (select count(*) from eacsc_private.mutation_receipts r
          where r.actor_user_id = s.actor_user_id
            and r.request_id = s.acceptance_request_id
            and r.command_name = 'accept_version_upload'
            and r.audit_event_uuid = s.acceptance_audit
            and r.response_payload->>'version_id' = s.version_id::text
            and r.response_payload->>'audit_event_uuid' = s.acceptance_audit::text) = 1) = 5),

    ('All five final objects retain the Storage identities in their receipts',
      (select count(*) from accepted s where
        (select count(*) from storage.objects o
          where o.bucket_id = s.bucket_id and o.name = s.destination_key) = 1
        and exists(select 1 from storage.objects o
          join eacsc_private.mutation_receipts r
            on r.actor_user_id = s.actor_user_id
            and r.request_id = s.acceptance_request_id
            and r.command_name = 'accept_version_upload'
          where o.bucket_id = s.bucket_id and o.name = s.destination_key
            and r.request_payload->>'storage_object_id' = o.id::text)) = 5),

    ('Master revision matches the latest accepted version',
      exists(select 1 from accepted s
        join public.master_records m on m.record_id = s.record_id
        where s.version_number = 6
          and m.revision_counter = s.expected_record_revision + 1
          and not exists(select 1 from public.record_versions v
            where v.record_id = s.record_id and v.version_number > 6))),

    ('No public release exists or is selected for the fixture',
      not exists(select 1 from public.record_releases r
        join inputs i on i.record_id = r.record_id)
      and exists(select 1 from public.master_records m
        join inputs i on i.record_id = m.record_id
        where m.current_public_release_id is null)),

    ('Both managed buckets remain private without direct Storage policies',
      (select count(*) from storage.buckets
        where id in ('internal-council-records', 'verified-council-releases')
          and public is false) = 2
      and not exists(select 1 from pg_catalog.pg_policy
        where polrelid in ('storage.objects'::regclass, 'storage.buckets'::regclass))),

    ('Both abandoned test uploads remain blocked without official versions or final objects',
      (select count(*) from historical u
        join eacsc_private.upload_dispositions d on d.upload_id = u.upload_id
        where u.request_id in (
          '96cc9940-c91b-4ea2-a51a-a0d8c5c0eed1'::uuid,
          '4f678b00-8ffa-4afc-9aeb-6a6ddc1ee60c'::uuid
        ) and d.disposition = 'cleanup_authorized'
        and not exists(select 1 from public.record_versions v
          where v.version_id = u.proposed_version_id or v.storage_key = u.destination_key)
        and not exists(select 1 from storage.objects o
          where o.bucket_id = u.bucket_id and o.name = u.destination_key)) = 2),

    ('The three previously cleaned staging objects remain absent',
      (select count(*) from historical) = 3
      and not exists(select 1 from historical u
        join storage.objects o on o.bucket_id = u.bucket_id and o.name = u.staging_key))
)
select check_name,
  case when passed is true then 'PASS' else 'FAIL' end as result
from checks
order by check_name;
