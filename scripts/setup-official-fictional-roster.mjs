import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), 'package.json'))
const { Client } = require('pg')
const { createClient } = require('@supabase/supabase-js')

const PASSWORD = 'eacsc_1999_CEA'

const OFFICIAL_ROSTER = [
  // Executive Officers
  { email: 'president@eacsc.example', position: 'President', roles: ['approver', 'reviewer', 'author', 'custodian'] },
  { email: 'internal.vp@eacsc.example', position: 'Internal Vice President', roles: ['reviewer', 'author'] },
  { email: 'external.vp@eacsc.example', position: 'External Vice President', roles: ['reviewer', 'author'] },
  { email: 'executive.secretary@eacsc.example', position: 'Executive Secretary', roles: ['custodian', 'author', 'approver', 'reviewer'] },
  { email: 'executive.treasurer@eacsc.example', position: 'Executive Treasurer', roles: ['custodian', 'author'] },
  { email: 'executive.auditor@eacsc.example', position: 'Executive Auditor', roles: ['reviewer'] },
  { email: 'business.manager@eacsc.example', position: 'Business Manager', roles: ['author'] },
  { email: 'pro@eacsc.example', position: 'Public Relations Officer', roles: ['publisher', 'author'] },
  { email: 'board.director@eacsc.example', position: 'Board of Director', roles: ['reviewer'] },

  // Board Members
  { email: 'assistant.secretary@eacsc.example', position: 'Assistant Secretary', roles: ['custodian', 'author'] },
  { email: 'file.inventory@eacsc.example', position: 'File Inventory Manager', roles: ['custodian'] },
  { email: 'auxiliary.secretary@eacsc.example', position: 'Auxiliary Secretary', roles: ['author'] },
  { email: 'assistant.treasurer@eacsc.example', position: 'Assistant Treasurer', roles: ['author'] },
  { email: 'assistant.auditor@eacsc.example', position: 'Assistant Auditor', roles: ['reviewer'] },
  { email: 'graphic.designer@eacsc.example', position: 'Graphic Designer', roles: ['author'] },
  { email: 'editorial@eacsc.example', position: 'Editorial', roles: ['author', 'publisher'] },
  { email: 'documentary.team@eacsc.example', position: 'Documentary Team', roles: ['author'] },
  { email: 'logistics@eacsc.example', position: 'Logistics Coordinator', roles: ['author'] },
  { email: 'procurement@eacsc.example', position: 'Procurement Officer', roles: ['author'] },
  { email: 'event.chairperson@eacsc.example', position: 'Event Chairperson', roles: ['author'] },
  { email: 'event.organizer@eacsc.example', position: 'Event Organizer', roles: ['author'] },
  { email: 'assistant.organizer@eacsc.example', position: 'Assistant Organizer', roles: ['author'] },
  { email: 'ways.and.means@eacsc.example', position: 'Ways and Means', roles: ['author'] },
  { email: 'first.year.rep@eacsc.example', position: 'First Year Representative', roles: ['author'] },
  { email: 'second.year.rep@eacsc.example', position: 'Second Year Representative', roles: ['author'] },
  { email: 'third.year.rep@eacsc.example', position: 'Third Year Representative', roles: ['author'] },
  { email: 'fourth.year.rep@eacsc.example', position: 'Fourth Year Representative', roles: ['author'] },

  // Advisory & System Administration
  { email: 'adviser@eacsc.example', position: 'Adviser', roles: ['reviewer', 'approver'] },
  { email: 'admin@eacsc.example', position: 'Technical Administrator', roles: ['technical_admin', 'custodian'] },
]

async function main() {
  const client = new Client()
  await client.connect()

  const adminSb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_BACKUP_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // 1. Remove old @eacsc.example accounts cleanly (preserve real users like sheilatendenilla5@gmail.com)
  const tempRes = await client.query("select id from auth.users where email like 'temp.%@eacsc.example'")
  for (const r of tempRes.rows) {
    await adminSb.auth.admin.deleteUser(r.id).catch(() => {})
  }
  const oldRes = await client.query(
    "select id, email from auth.users where email like '%@eacsc.example' order by created_at",
  )
  const oldIds = oldRes.rows.map((r) => r.id)
  console.log(`Found ${oldIds.length} old @eacsc.example accounts to replace.`)

  if (oldIds.length > 0) {
    // Also remove any previous fictional GEN/FIN documents we might re-seed
    const fkRes = await client.query(`
      select tc.table_schema, tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
        and ((ccu.table_schema = 'public' and ccu.table_name = 'app_users')
          or (ccu.table_schema = 'auth' and ccu.table_name = 'users'))
    `)

    const rank = (name) => {
      if (name === 'turnover_acknowledgments') return 0
      if (name === 'turnover_packages') return 2
      if (name === 'audit_events') return 3
      return 1
    }
    const orderedFks = fkRes.rows
      .filter((fk) => fk.table_name !== 'app_users')
      .sort((a, b) => rank(a.table_name) - rank(b.table_name))

    // Need a temporary fallback owner for existing 2026 seeded records while replacing old users
    // Actually we can delete old test records/versions or re-assign after creating new President.
    // Let's check which existing records reference oldIds!
    await client.query('begin')
    try {
      const tables = [...new Set(orderedFks.map((r) => `${r.table_schema}.${r.table_name}`))]
      for (const tbl of tables) {
        await client.query(`alter table ${tbl} disable trigger user`)
      }
      await client.query('alter table public.app_users disable trigger user')
      await client.query('alter table eacsc_private.mutation_receipts disable trigger user')
      await client.query('alter table public.master_records disable trigger user')

      // Delete the two previous fictional GEN/FIN docs if present
      for (const rid of ['EACSC-2026-GEN-0001', 'EACSC-2026-FIN-0002']) {
        await client.query('delete from public.version_verifications where record_id = $1', [rid])
        await client.query('delete from public.audit_events where record_id = $1', [rid])
        await client.query('delete from public.record_assignments where record_id = $1', [rid])
        await client.query('delete from public.record_versions where record_id = $1', [rid])
        await client.query('delete from public.master_records where record_id = $1', [rid])
      }

      // Remove old users from non-record tables or delete record_assignments/audit_events owned by oldIds
      // Wait: if existing EACSC-2026-GOV-0001 etc. reference oldIds in created_by/uploaded_by,
      // we'll first create new President & Executive Secretary BEFORE deleting oldIds,
      // OR re-point those columns after creating the new users!
      await client.query('rollback')
    } catch (e) {
      await client.query('rollback')
      throw e
    }
  }

  // Step A: Delete old @eacsc.example auth users AFTER re-pointing any seeded 2026 records to the new President
  // First, rename/delete old @eacsc.example emails by deleting oldIds cleanly?
  // Wait: email uniqueness in auth.users means we should delete old @eacsc.example users first,
  // or update existing records' actor/creator columns to NULL / temporary UUID?
  // Even simpler: clean out old records created by oldIds? No, keep EACSC-2026-GOV-0001 etc. by temporarily
  // using the real user or NULL if nullable, OR create new accounts with temp emails, re-point, delete old, rename!
  // Let's check which columns in master_records / record_versions / bulletin_snapshots reference app_users:
  const createdMap = new Map()
  for (const item of OFFICIAL_ROSTER) {
    const tempEmail = `temp.${item.email}`
    // Ensure clean slate if temp exists
    const existing = await client.query('select id from auth.users where email = $1', [tempEmail])
    if (existing.rows.length > 0) {
      await adminSb.auth.admin.deleteUser(existing.rows[0].id)
    }
    const { data, error } = await adminSb.auth.admin.createUser({
      email: tempEmail,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: item.position,
        council_position: item.position,
      },
    })
    if (error) throw new Error(`Failed creating ${item.email}: ${error.message}`)
    const uid = data.user.id
    await client.query(
      `insert into public.app_users (user_id, email, full_name, council_position, functional_roles, is_active)
       values ($1, $2, $3, $4, $5::text[], true)
       on conflict (user_id) do update
         set email = excluded.email,
             full_name = excluded.full_name,
             council_position = excluded.council_position,
             functional_roles = excluded.functional_roles,
             is_active = true`,
      [uid, tempEmail, item.position, item.position, item.roles],
    )
    createdMap.set(item.email, uid)
  }
  console.log(`Created ${createdMap.size} new official roster accounts.`)

  const newPresidentId = createdMap.get('president@eacsc.example')
  const newSecretaryId = createdMap.get('executive.secretary@eacsc.example')
  const newProId = createdMap.get('pro@eacsc.example')
  const newIvPId = createdMap.get('internal.vp@eacsc.example')
  const newTreasurerId = createdMap.get('executive.treasurer@eacsc.example')
  const newAuditorId = createdMap.get('executive.auditor@eacsc.example')
  const newEventChairId = createdMap.get('event.chairperson@eacsc.example')

  // Step B: Re-point any existing 2026 records/folders/bulletins from oldIds to newPresidentId, then delete oldIds!
  if (oldIds.length > 0) {
    const fkRes = await client.query(`
      select tc.table_schema, tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
        and ((ccu.table_schema = 'public' and ccu.table_name = 'app_users')
          or (ccu.table_schema = 'auth' and ccu.table_name = 'users'))
    `)

    await client.query('begin')
    try {
      const tables = [...new Set(fkRes.rows.map((r) => `${r.table_schema}.${r.table_name}`))]
      for (const tbl of tables) {
        await client.query(`alter table ${tbl} disable trigger user`)
      }
      await client.query('alter table public.app_users disable trigger user')
      await client.query('alter table eacsc_private.mutation_receipts disable trigger user')

      // Delete old assignments, role_requests, turnover rows for oldIds
      await client.query('delete from public.record_assignments where user_id = any($1::uuid[]) or assigned_by = any($1::uuid[])', [oldIds])
      await client.query('delete from public.role_requests where applicant_user_id = any($1::uuid[]) or reviewed_by = any($1::uuid[])', [oldIds])
      await client.query('delete from public.turnover_acknowledgments where incoming_officer_id = any($1::uuid[])', [oldIds])
      await client.query('delete from public.turnover_packages where outgoing_officer_id = any($1::uuid[]) or incoming_officer_id = any($1::uuid[])', [oldIds])

      // Re-point remaining FK references on preserved 2026 records/versions/folders/bulletins/audit_events to newPresidentId
      for (const fk of fkRes.rows) {
        if (['app_users', 'record_assignments', 'role_requests', 'turnover_acknowledgments', 'turnover_packages'].includes(fk.table_name)) {
          continue
        }
        const tbl = `${fk.table_schema}.${fk.table_name}`
        const col = fk.column_name
        await client.query(
          `update ${tbl} set ${col} = $1 where ${col} = any($2::uuid[])`,
          [newPresidentId, oldIds],
        )
      }

      await client.query('delete from public.app_users where user_id = any($1::uuid[])', [oldIds])

      for (const tbl of tables) {
        await client.query(`alter table ${tbl} enable trigger user`)
      }
      await client.query('alter table public.app_users enable trigger user')
      await client.query('alter table eacsc_private.mutation_receipts enable trigger user')
      await client.query('commit')
    } catch (e) {
      await client.query('rollback')
      throw e
    }

    for (const oldId of oldIds) {
      const { error } = await adminSb.auth.admin.deleteUser(oldId)
      if (error) console.error('Error deleting old user:', oldId, error.message)
    }
    console.log(`Deleted ${oldIds.length} old @eacsc.example accounts.`)
  }

  // Step C: Rename temp emails to final clean @eacsc.example emails
  await client.query('alter table public.app_users disable trigger user')
  for (const item of OFFICIAL_ROSTER) {
    const uid = createdMap.get(item.email)
    const { error } = await adminSb.auth.admin.updateUserById(uid, {
      email: item.email,
      email_confirm: true,
    })
    if (error) throw new Error(`Failed renaming email for ${item.email}: ${error.message}`)
    await client.query('update public.app_users set email = $1 where user_id = $2', [item.email, uid])
  }
  await client.query('alter table public.app_users enable trigger user')
  console.log('Renamed all 29 roster emails to clean @eacsc.example addresses.')

  // Step D: Create 1 fictional folder + 2 fictional documents (1 Public, 1 Restricted) + versions + assignments
  const folderName = 'Engineering Week & Council Operations 2026'
  await client.query('delete from public.document_folders where name = $1', [folderName])
  const folderRes = await client.query(
    `insert into public.document_folders (name, description, created_by)
     values ($1, $2, $3)
     returning folder_id`,
    [
      folderName,
      'Fictional test folder containing one Public event guideline document and one Restricted internal budget document.',
      newPresidentId,
    ],
  )
  const folderId = folderRes.rows[0].folder_id

  // Clean up any prior GEN-0001 / FIN-0002
  await client.query('begin')
  await client.query('alter table public.audit_events disable trigger user')
  await client.query('alter table public.version_verifications disable trigger user')
  await client.query('alter table public.record_versions disable trigger user')
  for (const rid of ['EACSC-2026-GEN-0001', 'EACSC-2026-FIN-0002']) {
    await client.query('delete from public.version_verifications where record_id = $1', [rid])
    await client.query('delete from public.audit_events where record_id = $1', [rid])
    await client.query('delete from public.record_assignments where record_id = $1', [rid])
    await client.query('delete from public.record_versions where record_id = $1', [rid])
    await client.query('delete from public.master_records where record_id = $1', [rid])
  }
  await client.query('alter table public.audit_events enable trigger user')
  await client.query('alter table public.version_verifications enable trigger user')
  await client.query('alter table public.record_versions enable trigger user')
  await client.query('commit')

  // Public Document: EACSC-2026-GEN-0001 (v1 Published + v2 Draft)
  const pubDocId = 'EACSC-2026-GEN-0001'
  await client.query(
    `insert into public.master_records (record_id, title, category, description, is_restricted, folder_id, created_by)
     values ($1, $2, 'ACT', $3, false, $4, $5)`,
    [
      pubDocId,
      'Engineering Week 2026 General Guidelines',
      'Official public rules, schedules, and student participation guidelines for CatSU CEA Engineering Week 2026.',
      folderId,
      newEventChairId,
    ],
  )

  const pubV1Pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
  const pubV1Hash = crypto.createHash('sha256').update(pubV1Pdf).digest('hex')
  const pubV1Path = `${pubDocId}/v1-engineering-week-guidelines.pdf`
  await adminSb.storage.from('eacsc-public-releases').upload(pubV1Path, pubV1Pdf, {
    contentType: 'application/pdf',
    upsert: true,
  })

  await client.query('begin')
  await client.query('alter table public.record_versions disable trigger user')
  await client.query(
    `insert into public.record_versions (
       record_id, version_number, state, version_notes, change_classification,
       original_filename, storage_bucket, storage_object_path, content_type, byte_size, sha256_hash,
       uploaded_by, approval_recorded_by, approved_at, approval_basis, released_by, released_at, effective_from
     ) values (
       $1, 1, 'Published', 'Initial approved Engineering Week 2026 guidelines.', 'Legitimate change',
       'engineering-week-guidelines-v1.pdf', 'eacsc-public-releases', $2, 'application/pdf', $3, $4,
       $5, $6, now(), 'Approved by Council President', $7, now(), now() - interval '1 hour'
     )`,
    [pubDocId, pubV1Path, pubV1Pdf.length, pubV1Hash, newEventChairId, newPresidentId, newProId],
  )
  await client.query(
    `insert into public.record_versions (
       record_id, version_number, state, version_notes, change_classification, uploaded_by
     ) values (
       $1, 2, 'Draft', 'Draft v2 updating venue schedule for Day 2.', 'Legitimate change', $2
     )`,
    [pubDocId, newEventChairId],
  )
  await client.query('alter table public.record_versions enable trigger user')
  await client.query('commit')

  // Restricted Document: EACSC-2026-FIN-0002 (v1 Draft)
  const resDocId = 'EACSC-2026-FIN-0002'
  await client.query(
    `insert into public.master_records (record_id, title, category, description, is_restricted, folder_id, created_by)
     values ($1, $2, 'FIN', $3, true, $4, $5)`,
    [
      resDocId,
      'Internal Council Budget & Procurement Ledger (2026)',
      'Restricted financial allocation and procurement ledger accessible only to authorized executive and audit officers.',
      folderId,
      newTreasurerId,
    ],
  )
  await client.query('begin')
  await client.query('alter table public.record_versions disable trigger user')
  await client.query(
    `insert into public.record_versions (
       record_id, version_number, state, version_notes, change_classification, uploaded_by
     ) values (
       $1, 1, 'Draft', 'Initial restricted budget breakdown for Q1 2026.', 'Legitimate change', $2
     )`,
    [resDocId, newTreasurerId],
  )
  await client.query('alter table public.record_versions enable trigger user')
  await client.query('commit')

  // Assign key officers to both new documents AND all existing 2026 documents
  const allDocs = await client.query('select record_id, is_restricted from public.master_records')
  for (const doc of allDocs.rows) {
    const assignees = doc.is_restricted
      ? [
          { uid: newPresidentId, roles: ['approver', 'reviewer', 'author', 'custodian'], restricted: true },
          { uid: newSecretaryId, roles: ['custodian', 'author', 'approver', 'reviewer'], restricted: true },
          { uid: newTreasurerId, roles: ['custodian', 'author'], restricted: true },
          { uid: newAuditorId, roles: ['reviewer'], restricted: true },
        ]
      : [
          { uid: newPresidentId, roles: ['approver', 'reviewer', 'author', 'custodian'], restricted: false },
          { uid: newSecretaryId, roles: ['custodian', 'author', 'approver', 'reviewer'], restricted: false },
          { uid: newIvPId, roles: ['reviewer', 'author'], restricted: false },
          { uid: newProId, roles: ['publisher', 'author'], restricted: false },
          { uid: newEventChairId, roles: ['author'], restricted: false },
        ]
    for (const a of assignees) {
      await client.query(
        `insert into public.record_assignments (record_id, user_id, assigned_roles, allow_restricted, is_active, assigned_by)
         values ($1, $2, $3::text[], $4, true, $5)
         on conflict (record_id, user_id) do update
           set assigned_roles = excluded.assigned_roles,
               allow_restricted = excluded.allow_restricted,
               is_active = true`,
        [doc.record_id, a.uid, a.roles, a.restricted, newPresidentId],
      )
    }
  }

  console.log('Seeded folder, 2 fictional documents (Public GEN-0001 + Restricted FIN-0002), versions, and assignments!')
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
