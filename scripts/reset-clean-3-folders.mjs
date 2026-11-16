// Cleanly resets mock folders/documents/simulation accounts, leaving exactly 3 folders & 3 documents.
// Usage: node --env-file=.env.local --env-file=.env.backup.local scripts/reset-clean-3-folders.mjs
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), 'package.json'))
const { Client } = require('pg')
const { createClient } = require('@supabase/supabase-js')
const { jsPDF } = require('jspdf')

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_BACKUP_KEY

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const doc = new jsPDF({ unit: 'pt', format: 'a4' })
doc.setFontSize(16)
doc.text('CatSU EA-CSC Official Record', 48, 72)
doc.setFontSize(12)
doc.text('EA-CSC General Assembly Guidelines 2026', 48, 108)
const minimalPdf = Buffer.from(doc.output('arraybuffer'))
const pdfSha = crypto.createHash('sha256').update(minimalPdf).digest('hex')

async function main() {
  const c = new Client()
  await c.connect()

  try {
    // 1. Delete simulation/batch10 test users cleanly
    const simUsers = await c.query(
      "select user_id, email from public.app_users where email like 'sim.%' or email like 'batch10-%'",
    )
    const simIds = simUsers.rows.map((r) => r.user_id)

    // 2. Clear mock records, versions, bulletins, folders, etc. (ordered for FK constraints)
    await c.query('begin')
    await c.query("set local session_replication_role = 'replica'")
    await c.query('delete from public.turnover_acknowledgments')
    await c.query('delete from public.turnover_packages')
    await c.query('delete from public.update_bulletins')
    await c.query('delete from public.record_releases')
    await c.query('delete from public.version_verifications')
    await c.query('delete from public.review_comments')
    await c.query('delete from eacsc_private.upload_dispositions')
    await c.query('delete from eacsc_private.upload_requests')
    await c.query('delete from public.audit_events')
    await c.query('delete from public.record_assignments')
    await c.query('delete from public.record_versions')
    await c.query('delete from public.master_records')
    await c.query('delete from public.document_folders')
    await c.query('delete from public.role_requests')

    if (simIds.length > 0) {
      await c.query('delete from eacsc_private.mutation_receipts where actor_user_id = any($1::uuid[])', [simIds])
      await c.query('delete from public.app_users where user_id = any($1::uuid[])', [simIds])
    }

    // 3. Normalize core official FY 2026-2027 roster titles
    const rosterUpdates = [
      ['president@eacsc.example', 'President', ['approver', 'reviewer', 'author', 'custodian']],
      ['executive.secretary@eacsc.example', 'Secretary', ['custodian', 'author', 'approver', 'reviewer']],
      ['internal.vp@eacsc.example', 'Vice President', ['reviewer', 'author']],
      ['executive.auditor@eacsc.example', 'Auditor', ['reviewer']],
      ['executive.treasurer@eacsc.example', 'Treasurer', ['custodian', 'author']],
      ['pro@eacsc.example', 'Public Information Officer', ['publisher', 'author']],
      ['adviser@eacsc.example', 'Faculty Adviser', ['reviewer', 'approver']],
      ['admin@eacsc.example', 'Technical Administrator', ['technical_admin', 'custodian']],
      ['event.chairperson@eacsc.example', 'Event Organization and Participation Committee', ['author']],
    ]
    for (const [email, pos, roles] of rosterUpdates) {
      await c.query(
        'update public.app_users set council_position = $2, functional_roles = $3, is_active = true where email = $1',
        [email, pos, roles],
      )
    }

    const { rows: presRows } = await c.query("select user_id from public.app_users where email = 'president@eacsc.example'")
    const { rows: secRows } = await c.query("select user_id from public.app_users where email = 'executive.secretary@eacsc.example'")
    const { rows: treasRows } = await c.query("select user_id from public.app_users where email = 'executive.treasurer@eacsc.example'")
    const { rows: pioRows } = await c.query("select user_id from public.app_users where email = 'pro@eacsc.example'")
    const presId = presRows[0].user_id
    const secId = secRows[0].user_id
    const treasId = treasRows[0].user_id
    const pioId = pioRows[0].user_id

    // 4. Create exactly 3 clean folders
    const f1 = (await c.query(
      "insert into public.document_folders (name, description, created_by) values ('Council Governance & Charters', 'Official EA-CSC resolutions, charters, and general assembly guidelines.', $1) returning folder_id",
      [presId],
    )).rows[0].folder_id

    const f2 = (await c.query(
      "insert into public.document_folders (name, description, created_by) values ('CEAFest 2026', 'Event plans, schedules, contests, and announcements for CEAFest 2026.', $1) returning folder_id",
      [presId],
    )).rows[0].folder_id

    const f3 = (await c.query(
      "insert into public.document_folders (name, description, created_by) values ('Financial & Executive Records (Restricted)', 'Confidential financial budgets and restricted executive plans.', $1) returning folder_id",
      [treasId],
    )).rows[0].folder_id

    // 5. Create exactly 3 clean documents (1 per folder: 1 Public Published, 1 Internal Draft, 1 Restricted Draft)
    await c.query(
      `insert into public.master_records (record_id, title, summary, category, document_type, originating_office, custodian_position, access_class, record_date, folder_id)
       values
       ('EACSC-2026-GOV-0001', 'EA-CSC General Assembly Guidelines 2026', 'Official assembly schedule, quorum rules, and council procedures.', 'Governance and legislation', 'Guidelines', 'Secretary', 'Secretary', 'public', '2026-11-17', $1),
       ('EACSC-2026-ACT-0001', 'CEAFest 2026 Event General Plan', 'Master event plan covering seminars, Amazing Race stations, and academic contests.', 'Activities and CBO records', 'Event Plan', 'Secretary', 'Secretary', 'internal', '2026-11-17', $2),
       ('EACSC-2026-FIN-0001', 'CEAFest 2026 Budget & Finance Proposal', 'Restricted itemized budget allocation and sponsorship breakdown for CEAFest 2026.', 'Financial archives', 'Financial Plan', 'Treasurer', 'Treasurer', 'restricted', '2026-11-17', $3)`,
      [f1, f2, f3],
    )

    // Assign creators & President cleanly for the 3 documents
    await c.query(
      `insert into public.record_assignments (record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted)
       values
       ('EACSC-2026-GOV-0001', $1, 'author', $1, true, false),
       ('EACSC-2026-GOV-0001', $1, 'custodian', $1, true, false),
       ('EACSC-2026-GOV-0001', $2, 'approver', $1, true, true),
       ('EACSC-2026-GOV-0001', $4, 'publisher', $1, true, false),
       ('EACSC-2026-ACT-0001', $1, 'author', $1, true, false),
       ('EACSC-2026-ACT-0001', $1, 'custodian', $1, true, false),
       ('EACSC-2026-ACT-0001', $2, 'approver', $1, true, true),
       ('EACSC-2026-FIN-0001', $3, 'author', $3, true, true),
       ('EACSC-2026-FIN-0001', $3, 'custodian', $3, true, true),
       ('EACSC-2026-FIN-0001', $2, 'approver', $3, true, true)`,
      [secId, presId, treasId, pioId],
    )

    await c.query('commit')

    // Delete auth.users for sim.* / batch10-*
    for (const id of simIds) {
      await adminSb.auth.admin.deleteUser(id).catch(() => {})
    }

    // 6. Use real RPC workflow to stage, verify, approve, and publish EACSC-2026-GOV-0001 v1
    const signIn = async (email) => {
      const sb = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { error } = await sb.auth.signInWithPassword({ email, password: 'eacsc_1999_CEA' })
      if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`)
      return sb
    }
    const secSb = await signIn('executive.secretary@eacsc.example')
    const audSb = await signIn('executive.auditor@eacsc.example')
    const presSb = await signIn('president@eacsc.example')
    const pioSb = await signIn('pro@eacsc.example')

    const { data: prep, error: prepErr } = await secSb.rpc('eacsc_prepare_version_upload', {
      p_record_id: 'EACSC-2026-GOV-0001',
      p_expected_record_revision: 1,
      p_original_filename: 'ea-csc-general-assembly-guidelines-2026.pdf',
      p_mime_type: 'application/pdf',
      p_file_size_bytes: minimalPdf.length,
      p_sha256: pdfSha,
      p_change_summary: 'Initial ratified General Assembly Guidelines for AY 2026-2027.',
      p_correction_classification: 'initial_capture',
      p_request_id: crypto.randomUUID(),
    })
    if (prepErr) throw new Error(`Prepare upload failed: ${prepErr.message}`)
    const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
    const { data: { session: secSess } } = await secSb.auth.getSession()
    const stageRes = await fetch(`${SUPABASE_URL}/functions/v1/ea-csc-stage-upload?upload_id=${prep.upload_id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        apikey: anonKey,
        Authorization: `Bearer ${secSess.access_token}`,
      },
      body: minimalPdf,
    })
    const staged = await stageRes.json().catch(() => ({}))
    if (!stageRes.ok || staged.status !== 'staged') throw new Error(`Stage binary failed: ${JSON.stringify(staged)}`)

    const accRes = await fetch(`${SUPABASE_URL}/functions/v1/ea-csc-stage-upload?action=accept&upload_id=${prep.upload_id}&request_id=${crypto.randomUUID()}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${secSess.access_token}`,
      },
      body: '',
    })
    const acc = await accRes.json().catch(() => ({}))
    if (!accRes.ok || acc.status !== 'accepted') throw new Error(`Accept upload failed: ${JSON.stringify(acc)}`)

    const { data: sub, error: subErr } = await secSb.rpc('eacsc_submit_version_for_review', {
      p_version_id: acc.version_id,
      p_expected_revision: acc.version_revision,
      p_request_id: crypto.randomUUID(),
    })
    if (subErr) throw new Error(`Submit failed: ${subErr.message}`)

    const { error: passErr } = await audSb.rpc('eacsc_reviewer_pass_version', {
      p_version_id: acc.version_id,
      p_expected_revision: sub.revision_counter,
      p_feedback: 'Verified complete.',
    })
    if (passErr) throw new Error(`Reviewer pass failed: ${passErr.message}`)

    const checklist = {
      identity_version: { status: 'Confirmed', reason: null },
      dates_deadlines: { status: 'Confirmed', reason: null },
      location_link: { status: 'Confirmed', reason: null },
      audience_requirements: { status: 'Confirmed', reason: null },
      authority_disclosure: { status: 'Confirmed', reason: null },
      contact_reference: { status: 'Confirmed', reason: null },
    }
    const { data: app, error: appErr } = await presSb.rpc('eacsc_approve_version', {
      p_version_id: acc.version_id,
      p_expected_revision: sub.revision_counter + 1,
      p_checklist: checklist,
      p_approval_kind: 'substantive_approval',
      p_approving_position: 'President',
      p_approval_date: '2026-11-17',
      p_approval_basis: 'Ratified by Council Executive Board',
      p_approval_evidence_reference: 'RES-2026-GOV-01',
      p_approval_not_required_reason: null,
      p_is_provisional: false,
      p_provisional_uncertainty: null,
      p_provisional_update_owner: null,
      p_request_id: crypto.randomUUID(),
    })
    if (appErr) throw new Error(`Approve failed: ${appErr.message}`)

    const { data: { session: pioSess } } = await pioSb.auth.getSession()
    const { data: recAfterApp } = await pioSb.from('master_records').select('revision_counter').eq('record_id', 'EACSC-2026-GOV-0001').single()
    const pubRes = await fetch(`${SUPABASE_URL}/functions/v1/ea-csc-publish-release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${pioSess.access_token}`,
      },
      body: JSON.stringify({
        version_id: acc.version_id,
        expected_version_revision: app.revision_counter,
        expected_record_revision: recAfterApp.revision_counter,
        release_id: crypto.randomUUID(),
        audience: 'public',
        public_title: 'EA-CSC General Assembly Guidelines 2026',
        public_category: 'Governance and legislation',
        authorization_basis: 'Ratified by Council Executive Board',
        authorization_reference: 'RES-2026-GOV-01',
        effective_from: new Date(Date.now() - 60_000).toISOString(),
        request_id: crypto.randomUUID(),
      }),
    })
    const pubData = await pubRes.json().catch(() => ({}))
    if (!pubRes.ok) throw new Error(`Publish failed (${pubRes.status}): ${JSON.stringify(pubData)}`)

    console.log('CLEAN RESET COMPLETE: 3 folders, 3 documents, GOV-0001 v1 published cleanly, simulation accounts removed.')
  } catch (err) {
    await c.query('rollback').catch(() => {})
    throw err
  } finally {
    await c.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
