-- Recovery ONLY: run after inspecting matching active requests, with every
-- Batch 4 HTTP runner stopped and no other Draft notes API call in progress.
-- Terminates only active Data API backends running this exact command.
-- Their in-flight transaction rolls back; earlier committed edits remain.
select pid,pg_catalog.pg_terminate_backend(pid) as terminated
from pg_catalog.pg_stat_activity
where usename='authenticator' and backend_type='client backend'
  and state='active' and pid<>pg_backend_pid()
  and query like '%eacsc_update_draft_notes%';
