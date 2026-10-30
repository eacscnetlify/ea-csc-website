-- Read-only. Run with the runner stopped, as postgres in ea-csc-website-dev.
-- Query text/tokens are deliberately not returned.
select pid,state,query_start,wait_event_type,wait_event,
  now()-query_start as running_for
from pg_catalog.pg_stat_activity
where usename='authenticator' and backend_type='client backend'
  and state='active' and pid<>pg_backend_pid()
  and query like '%eacsc_update_draft_notes%'
order by query_start;
