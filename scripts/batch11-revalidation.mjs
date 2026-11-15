import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import pg from 'pg'
import crypto from 'crypto'

const PASSWORD = 'eacsc_1999_CEA'

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const anonKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_BACKUP_KEY

  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw new Error('Missing SUPABASE_URL, VITE_SUPABASE_ANON_KEY, or SUPABASE_BACKUP_KEY')
  }

  const adminSb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const pgClient = new pg.Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
  })
  await pgClient.connect()

  const results = []
  const runCheck = async (name, fn) => {
    try {
      await fn()
      console.log(`PASS: ${name}`)
      results.push({ name, status: 'PASS' })
    } catch (err) {
      console.error(`FAIL: ${name} -> ${err.message}`)
      results.push({ name, status: 'FAIL', error: err.message })
      throw err
    }
  }

  let testStudentEmail = `b11test.${Date.now()}@eacsc.example`
  let testStudentUid = null
  let createdDocId = null
  let createdFolderId = null

  try {
    await runCheck('1. Logo & Favicon Assets Present', async () => {
      assert(fs.existsSync('public/eacsc-logo-2026.jpg'), 'public/eacsc-logo-2026.jpg missing')
      const html = fs.readFileSync('index.html', 'utf8')
      assert(html.includes('eacsc-logo-2026.jpg'), 'index.html favicon not updated')
    })

    await runCheck('2. Clean 2026 Public Catalog Populated (No Old 2099 Test Records)', async () => {
      const anonSb = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
      })
      const { data, error } = await anonSb.rpc('eacsc_public_catalog')
      assert(!error, error?.message)
      assert(Array.isArray(data), 'Expected array')
      const ids = data.map((r) => r.record_id)
      assert(ids.includes('EACSC-2026-GOV-0001'), 'Missing EACSC-2026-GOV-0001')
      assert(ids.includes('EACSC-2026-SEC-0001'), 'Missing EACSC-2026-SEC-0001')
      assert(!ids.some((id) => id.startsWith('EACSC-2099-')), 'Old EACSC-2099 records still present!')
    })

    await runCheck('3. Observer Sign-Up & Default Observer Profile Creation', async () => {
      const { data: userData, error: createErr } = await adminSb.auth.admin.createUser({
        email: testStudentEmail,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Batch 11 Test Student', student_id: '2026-99999', degree_program: 'BS Civil Engineering' },
      })
      assert(!createErr, createErr?.message)
      testStudentUid = userData.user.id

      const studentSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
      const { error: signInErr } = await studentSb.auth.signInWithPassword({
        email: testStudentEmail,
        password: PASSWORD,
      })
      assert(!signInErr, signInErr?.message)

      const { data: profile, error: profErr } = await studentSb.rpc('eacsc_ensure_observer_profile', {
        p_full_name: 'Batch 11 Test Student',
        p_student_id: '2026-99999',
        p_degree_program: 'BS Civil Engineering',
      })
      assert(!profErr, profErr?.message)
      assert(Array.isArray(profile.functional_roles) && profile.functional_roles.length === 0, 'New user must start with 0 roles')
      assert(profile.is_active === true, 'Observer profile must be active')
    })

    await runCheck('4. Observer Access Gate Blocks Officer Actions', async () => {
      const studentSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
      await studentSb.auth.signInWithPassword({ email: testStudentEmail, password: PASSWORD })

      const { error: folderErr } = await studentSb.rpc('eacsc_create_folder', { p_name: 'Unauthorized Folder' })
      assert(Boolean(folderErr), 'Observer should not be able to create folder')

      const { error: docErr } = await studentSb.rpc('eacsc_create_document', {
        p_title: 'Unauthorized Doc',
        p_category: 'Governance and legislation',
      })
      assert(Boolean(docErr), 'Observer should not be able to create document')
    })

    let roleReqId = null
    await runCheck('5. Observer Submits Officer Role Application', async () => {
      const studentSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
      await studentSb.auth.signInWithPassword({ email: testStudentEmail, password: PASSWORD })

      const { data, error } = await studentSb.rpc('eacsc_submit_role_request', {
        p_desired_position: 'Committee Chairperson (Author)',
        p_requested_roles: ['author'],
        p_student_id: '2026-99999',
        p_degree_program: 'BS Civil Engineering',
        p_justification: 'Batch 11 automated verification request',
      })
      assert(!error, error?.message)
      assert(data?.status === 'pending', 'Expected pending status')
      roleReqId = data.request_id
    })

    await runCheck('6. President Approves Role Application & Upgrades Student to Author', async () => {
      const presSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
      const { error: loginErr } = await presSb.auth.signInWithPassword({
        email: 'president@eacsc.example',
        password: PASSWORD,
      })
      assert(!loginErr, loginErr?.message)

      const { data: list, error: listErr } = await presSb.rpc('eacsc_list_role_requests')
      assert(!listErr, listErr?.message)
      assert(list.some((r) => r.request_id === roleReqId), 'Request not visible to President')

      const { data: decision, error: decErr } = await presSb.rpc('eacsc_decide_role_request', {
        p_request_id: roleReqId,
        p_decision: 'approved',
        p_review_note: 'Approved in Batch 11 automated test',
      })
      assert(!decErr, decErr?.message)
      assert(decision.status === 'approved', 'Decision should be approved')
    })

    await runCheck('7. Newly Approved Author Creates Folder & Document (Auto-Assigned)', async () => {
      const authorSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
      await authorSb.auth.signInWithPassword({ email: testStudentEmail, password: PASSWORD })

      const { data: folder, error: fErr } = await authorSb.rpc('eacsc_create_folder', {
        p_name: `B11 Folder ${Date.now()}`,
        p_description: 'Automated test folder',
      })
      assert(!fErr, fErr?.message)
      createdFolderId = folder.folder_id

      const { data: doc, error: dErr } = await authorSb.rpc('eacsc_create_document', {
        p_title: 'Batch 11 Automated Resolution',
        p_category: 'Governance and legislation',
        p_document_type: 'Resolution',
        p_access_class: 'public',
        p_summary: 'Automated verification document',
        p_folder_id: createdFolderId,
      })
      assert(!dErr, dErr?.message)
      assert(doc.record_id.startsWith('EACSC-2026-GOV-'), 'Expected canonical 2026 GOV ID')
      createdDocId = doc.record_id
    })

    await runCheck('8. Executive Fast-Track Self-Approval by President', async () => {
      const verId = crypto.randomUUID()
      const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'utf8')
      const sha = crypto.createHash('sha256').update(pdfBytes).digest('hex')
      await pgClient.query(
        `insert into public.record_versions (version_id, record_id, version_number, state, change_summary, correction_classification, storage_key, original_filename, mime_type, file_size_bytes, sha256)
         values ($1, $2, 1, 'Draft', 'Urgent executive test draft', 'initial_capture', $3, 'test.pdf', 'application/pdf', $4, $5)`,
        [verId, createdDocId, `records/${createdDocId}/v1/test.pdf`, pdfBytes.length, sha],
      )

      const presSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
      await presSb.auth.signInWithPassword({ email: 'president@eacsc.example', password: PASSWORD })

      const { data: res, error: execErr } = await presSb.rpc('eacsc_executive_self_approve', {
        p_version_id: verId,
        p_expected_revision: 1,
        p_rationale: 'Urgent council directive verified by President',
      })
      assert(!execErr, execErr?.message)
      assert(res.state === 'Approved', 'Version should be Approved after executive fast-track')
    })

    await runCheck('9. Global Council Activity & History RPC', async () => {
      const presSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
      await presSb.auth.signInWithPassword({ email: 'president@eacsc.example', password: PASSWORD })

      const { data, error } = await presSb.rpc('eacsc_list_global_audit_history', { p_limit: 20 })
      assert(!error, error?.message)
      assert(Array.isArray(data) && data.length > 0, 'Expected global audit events')
      assert(data.some((e) => e.action_type === 'version.executive_self_approved'), 'Missing executive self-approval event')
    })

    await runCheck('10. Officer Profile Select (with student_id, degree_program) & 4 Degree Programs', async () => {
      const presSb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
      const { data: authData, error: signErr } = await presSb.auth.signInWithPassword({
        email: 'president@eacsc.example',
        password: PASSWORD,
      })
      assert(!signErr && authData?.user?.id, signErr?.message || 'Sign-in failed')

      const { data: prof, error: profErr } = await presSb
        .from('app_users')
        .select('user_id,full_name,council_position,functional_roles,is_active,revision_counter,updated_at,student_id,degree_program')
        .eq('user_id', authData.user.id)
        .maybeSingle()
      assert(!profErr, `getOfficerProfile query failed: ${profErr?.message}`)
      assert(prof && prof.full_name, 'Profile returned null or missing full_name')

      const signupSrc = fs.readFileSync('src/features/auth/SignUpPage.tsx', 'utf8')
      assert(!signupSrc.includes('BS Electrical Engineering'), 'BS Electrical Engineering must be removed')
      assert(!signupSrc.includes('BS Mechanical Engineering'), 'BS Mechanical Engineering must be removed')
      assert(signupSrc.includes('BS Civil Engineering'), 'BS Civil Engineering missing')
      assert(signupSrc.includes('BS Electronics Engineering'), 'BS Electronics Engineering missing')
      assert(signupSrc.includes('BS Computer Engineering'), 'BS Computer Engineering missing')
      assert(signupSrc.includes('BS Architecture'), 'BS Architecture missing')
    })

    console.log('\nALL 10 BATCH 11 AUTOMATED CHECKS PASSED!')
  } finally {
    // Cleanup temporary test data
    console.log('Cleaning up temporary Batch 11 test artifacts...')
    await pgClient.query('begin')
    await pgClient.query('alter table public.audit_events disable trigger user')
    await pgClient.query('alter table public.version_verifications disable trigger user')
    await pgClient.query('alter table public.record_versions disable trigger user')

    if (createdDocId) {
      await pgClient.query('delete from public.version_verifications where record_id = $1', [createdDocId])
      await pgClient.query('delete from public.audit_events where record_id = $1', [createdDocId])
      await pgClient.query('delete from public.record_assignments where record_id = $1', [createdDocId])
      await pgClient.query('delete from public.record_versions where record_id = $1', [createdDocId])
      await pgClient.query('delete from public.master_records where record_id = $1', [createdDocId])
    }
    if (createdFolderId) {
      await pgClient.query('delete from public.document_folders where folder_id = $1', [createdFolderId])
    }
    if (testStudentUid) {
      await pgClient.query('delete from public.audit_events where actor_user_id = $1', [testStudentUid])
      await pgClient.query('delete from public.role_requests where applicant_user_id = $1', [testStudentUid])
      await pgClient.query('delete from public.app_users where user_id = $1', [testStudentUid])
    }

    await pgClient.query('alter table public.audit_events enable trigger user')
    await pgClient.query('alter table public.version_verifications enable trigger user')
    await pgClient.query('alter table public.record_versions enable trigger user')
    await pgClient.query('commit')

    if (testStudentUid) {
      await adminSb.auth.admin.deleteUser(testStudentUid).catch(() => {})
    }
    await pgClient.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
