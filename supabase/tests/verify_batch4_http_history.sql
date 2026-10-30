-- Read-only verification AFTER the real HTTP runner completes successfully.
-- Retains all fictional records, audit events and retry receipts.
with fixtures as (
  select v.* from public.record_versions v
  where v.record_id in ('EACSC-2099-HTTP-9601','EACSC-2099-HTTP-9602',
    'EACSC-2099-HTTP-9603','EACSC-2099-HTTP-9604','EACSC-2099-HTTP-9605')
), history as (
  select a.*,lag(a.new_state) over(partition by a.version_id order by a.new_revision) as preceding_snapshot
  from public.audit_events a join fixtures v on v.version_id=a.version_id
), receipts as (
  select r.* from eacsc_private.mutation_receipts r
  join history a on a.event_uuid=r.audit_event_uuid
), checks(check_name,passed) as (values
  ('All five persistent HTTP fixtures exist', (select count(*)=5 from fixtures)),
  ('Main Draft has at least four committed HTTP edits', exists(
    select 1 from fixtures where record_id='EACSC-2099-HTTP-9601' and state='Draft' and revision_counter>=5)),
  ('Restricted Draft has a committed authorized HTTP edit', exists(
    select 1 from fixtures where record_id='EACSC-2099-HTTP-9605' and state='Draft' and revision_counter>=2)),
  ('Denied and For Review fixtures remain unchanged', (select count(*)=3 and bool_and(
    revision_counter=1 and change_summary='Original fictional HTTP notes.'
    and state=case when record_id='EACSC-2099-HTTP-9604' then 'For Review' else 'Draft' end)
    from fixtures where record_id not in ('EACSC-2099-HTTP-9601','EACSC-2099-HTTP-9605'))),
  ('Each revision increment has exactly one audit event', not exists(
    select 1 from fixtures v left join history a on a.version_id=v.version_id
    group by v.version_id,v.revision_counter
    having count(a.event_uuid)<>v.revision_counter-1
      or count(distinct a.new_revision)<>count(a.event_uuid)
      or (count(a.event_uuid)>0 and (min(a.previous_revision)<>1 or max(a.new_revision)<>v.revision_counter)))),
  ('Audit revisions and before/after snapshots form an unbroken chain', not exists(
    select 1 from history a where a.action_type<>'draft.notes_updated'
      or a.new_revision<>a.previous_revision+1
      or a.previous_state->>'revision_counter' is distinct from a.previous_revision::text
      or a.new_state->>'revision_counter' is distinct from a.new_revision::text
      or a.previous_state->>'state' is distinct from 'Draft'
      or a.new_state->>'state' is distinct from 'Draft'
      or a.new_state->>'version_id' is distinct from a.version_id::text
      or a.new_state->>'record_id' is distinct from a.record_id
      or a.new_state->>'change_summary' not like 'HTTP/%'
      or (a.previous_revision=1 and a.previous_state->>'change_summary' is distinct from 'Original fictional HTTP notes.')
      or (a.previous_revision>1 and a.previous_state is distinct from a.preceding_snapshot))),
  ('Latest audited notes and timestamps equal stored versions', not exists(
    select 1 from fixtures v join history a on a.version_id=v.version_id and a.new_revision=v.revision_counter
    where a.new_state->>'change_summary' is distinct from v.change_summary
      or (a.new_state->>'updated_at')::timestamptz is distinct from v.updated_at)),
  ('Every audit has exactly one matching immutable retry receipt', not exists(
    select 1 from history a left join receipts r on r.audit_event_uuid=a.event_uuid
    where r.audit_event_uuid is null or r.actor_user_id<>a.actor_user_id or r.request_id is distinct from a.request_id
      or r.command_name<>'update_draft_notes'
      or r.request_payload->>'version_id' is distinct from a.version_id::text
      or r.request_payload->>'expected_revision' is distinct from a.previous_revision::text
      or r.request_payload->>'change_summary' is distinct from a.new_state->>'change_summary'
      or r.response_payload->>'audit_event_uuid' is distinct from a.event_uuid::text
      or r.response_payload->>'request_id' is distinct from a.request_id::text
      or r.response_payload->>'revision_counter' is distinct from a.new_revision::text
      or r.response_payload->>'change_summary' is distinct from a.new_state->>'change_summary')),
  ('Successful actors are the assigned fictional officers', not exists(
    select 1 from history a join public.app_users p on p.user_id=a.actor_user_id
    where (a.record_id='EACSC-2099-HTTP-9601' and p.email not in ('batch4-author@example.invalid','batch4-custodian@example.invalid'))
      or (a.record_id='EACSC-2099-HTTP-9605' and p.email<>'batch4-custodian@example.invalid')
      or a.record_id not in ('EACSC-2099-HTTP-9601','EACSC-2099-HTTP-9605'))),
  ('Draft edits did not add files or substantive approval', not exists(
    select 1 from fixtures where state='Draft' and (storage_key is not null or original_filename is not null
      or mime_type is not null or file_size_bytes is not null or sha256 is not null
      or approved_at is not null or approval_basis is not null or approval_evidence_reference is not null
      or approval_recorded_by is not null or approval_not_required_reason is not null))),
  ('Master classifications, titles and revisions remain unchanged', (
    select count(*)=5 and bool_and(revision_counter=1 and title='FICTIONAL HTTP TEST '||right(record_id,4)
      and access_class=case when right(record_id,4) in ('9602','9605') then 'restricted' else 'internal' end)
    from public.master_records where record_id in (select record_id from fixtures))),
  ('Fictional author was restored to active status', exists(
    select 1 from public.app_users p join auth.users u on u.id=p.user_id
    where p.email='batch4-author@example.invalid' and lower(u.email)=p.email
      and p.is_active and p.functional_roles=array['author']::text[]))
)
select check_name,case when passed is true then 'PASS' else 'FAIL' end as result
from checks order by check_name;
