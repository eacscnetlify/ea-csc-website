// READ-ONLY diagnostic for Document Workspace visibility / role issues.
// Usage: node --env-file=.env.backup.local scripts/diagnose-workspace.mjs
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), 'package.json'))
const { Client } = require('pg')

const c = new Client()
await c.connect()
await c.query('begin read only')
const q = async (label, sql) => {
  const r = await c.query(sql)
  console.log(`\n=== ${label} (${r.rowCount}) ===`)
  for (const row of r.rows) console.log(JSON.stringify(row))
}
try {
  await q('Active officers & roles', `
    select email, council_position, functional_roles, is_active
    from public.app_users where cardinality(functional_roles) > 0 order by email`)
  await q('Most recent 15 documents', `
    select record_id, left(title,40) title, access_class, custodian_position, created_at
    from public.master_records order by created_at desc limit 15`)
  await q('Assignments for 15 most recent documents', `
    select a.record_id, u.email, a.assignment_function, a.is_active, a.allow_restricted,
           (a.assignment_function = any(u.functional_roles)) as fn_matches_user_roles
    from public.record_assignments a join public.app_users u using (user_id)
    where a.record_id in (select record_id from public.master_records order by created_at desc limit 15)
    order by a.record_id desc, u.email`)
  await q('Documents visible per officer (count of readable assignments)', `
    select u.email, count(distinct a.record_id) filter (
      where a.is_active and a.assignment_function = any(u.functional_roles)
        and (m.access_class <> 'restricted' or a.allow_restricted)) visible_docs
    from public.app_users u
    left join public.record_assignments a on a.user_id = u.user_id
    left join public.master_records m on m.record_id = a.record_id
    where cardinality(u.functional_roles) > 0 group by u.email order by u.email`)
  await q('Total documents', `select count(*) from public.master_records`)
  await q('Recent role requests', `
    select r.created_at, u.email, r.desired_position, r.requested_roles, r.status, r.review_note
    from public.role_requests r join public.app_users u on u.user_id = r.applicant_user_id
    order by r.created_at desc limit 15`)
  await q('Recent audit events (errors/creates)', `
    select server_occurred_at, action_type, left(action_summary,70) summary from public.audit_events order by server_occurred_at desc limit 20`)
} finally {
  await c.query('rollback')
  await c.end()
}


