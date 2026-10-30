-- Read-only retained HTTP fixture counts. Run after the 12-check verifier.
-- Additional evidence: main revision 5 and restricted revision 2 on a clean first
-- complete run; later successful reruns legitimately increase both.
select v.record_id,v.state,v.revision_counter,
  (select count(*) from public.audit_events a where a.version_id=v.version_id) as audit_rows,
  (select count(*) from eacsc_private.mutation_receipts r join public.audit_events a
    on a.event_uuid=r.audit_event_uuid where a.version_id=v.version_id) as receipt_rows
from public.record_versions v where v.record_id like 'EACSC-2099-HTTP-%'
order by v.record_id;
