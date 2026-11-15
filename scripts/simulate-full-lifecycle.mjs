import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { jsPDF } from 'jspdf'
import pg from 'pg'

const PASSWORD = 'eacsc_1999_CEA'

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}

function makePdfBuffer(titleText) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setFontSize(16)
  doc.text('CatSU EA-CSC Official Record', 48, 72)
  doc.setFontSize(12)
  doc.text(titleText, 48, 108)
  doc.setFontSize(10)
  doc.text(`Generated: ${new Date().toISOString()}`, 48, 138)
  const arrBuf = doc.output('arraybuffer')
  return Buffer.from(arrBuf)
}

function buildChecklist() {
  return {
    identity_version: { status: 'Confirmed', reason: null },
    dates_deadlines: { status: 'Confirmed', reason: null },
    location_link: { status: 'Confirmed', reason: null },
    audience_requirements: { status: 'Confirmed', reason: null },
    authority_disclosure: { status: 'Confirmed', reason: null },
    contact_reference: { status: 'Confirmed', reason: null },
  }
}

async function stageUpload(
  supabaseUrl,
  anonKey,
  token,
  { recordId, expectedRecordRevision, notes, classification = 'initial_capture', pdfBuffer, filename },
) {
  const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex')
  const headers = {
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
  }

  // 1. Prepare upload
  const prepRes = await fetch(`${supabaseUrl}/rest/v1/rpc/eacsc_prepare_version_upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_record_id: recordId,
      p_expected_record_revision: expectedRecordRevision,
      p_original_filename: filename,
      p_mime_type: 'application/pdf',
      p_file_size_bytes: pdfBuffer.length,
      p_sha256: sha256,
      p_change_summary: notes,
      p_correction_classification: classification,
      p_request_id: crypto.randomUUID(),
    }),
  })
  const prep = await prepRes.json().catch(() => ({}))
  if (!prepRes.ok || !prep.upload_id) {
    throw new Error(`Prepare upload failed (${prepRes.status}): ${JSON.stringify(prep)}`)
  }

  // 2. Stage binary PDF
  const stageRes = await fetch(`${supabaseUrl}/functions/v1/ea-csc-stage-upload?upload_id=${prep.upload_id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
    body: pdfBuffer,
  })
  const staged = await stageRes.json().catch(() => ({}))
  if (!stageRes.ok || staged.status !== 'staged') {
    throw new Error(`Stage binary failed (${stageRes.status}): ${JSON.stringify(staged)}`)
  }

  // 3. Accept upload -> creates Draft record_version
  const accRes = await fetch(
    `${supabaseUrl}/functions/v1/ea-csc-stage-upload?action=accept&upload_id=${prep.upload_id}&request_id=${crypto.randomUUID()}`,
    {
      method: 'POST',
      headers,
      body: '',
    },
  )
  const accepted = await accRes.json().catch(() => ({}))
  if (!accRes.ok || accepted.status !== 'accepted') {
    throw new Error(`Accept upload failed (${accRes.status}): ${JSON.stringify(accepted)}`)
  }
  return { ...accepted, sha256 }
}

async function publishRelease(
  supabaseUrl,
  anonKey,
  token,
  {
    versionId,
    expectedVersionRevision,
    expectedRecordRevision,
    releaseId,
    publicTitle,
    publicCategory = 'Activities and CBO records',
    authorizationBasis = 'Approved by Council President after 6-point verification',
    authorizationReference = `SIM-PUB-${Date.now()}`,
    effectiveFrom = new Date(Date.now() - 60_000).toISOString(),
  },
) {
  const res = await fetch(`${supabaseUrl}/functions/v1/ea-csc-publish-release`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      version_id: versionId,
      expected_version_revision: expectedVersionRevision,
      expected_record_revision: expectedRecordRevision,
      release_id: releaseId,
      audience: 'public',
      public_title: publicTitle,
      public_category: publicCategory,
      authorization_basis: authorizationBasis,
      authorization_reference: authorizationReference,
      effective_from: effectiveFrom,
      request_id: crypto.randomUUID(),
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Publish release failed (${res.status}): ${JSON.stringify(json)}`)
  }
  return json
}

async function signIn(supabaseUrl, anonKey, email) {
  const sb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
  assert(!error && data.session, `Sign-in failed for ${email}: ${error?.message}`)
  return { sb, session: data.session, user: data.user }
}

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_BACKUP_KEY

  assert(supabaseUrl && anonKey && serviceKey, 'Missing SUPABASE_URL, PUBLISHABLE_KEY, or SUPABASE_BACKUP_KEY')

  const adminSb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const pgClient = new pg.Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
  })
  await pgClient.connect()
  const { rows: clockRows } = await pgClient.query(
    "select now() as db_now, ((now() at time zone 'Asia/Manila')::date)::text as db_date",
  )
  const dbClockOffsetMs = new Date(clockRows[0].db_now).getTime() - Date.now()
  const dbNowIso = () => new Date(Date.now() + dbClockOffsetMs).toISOString()
  const dbDateStr = clockRows[0].db_date

  const ts = Date.now()
  const simStudentEmail = `sim.student.${ts}@eacsc.example`
  const outgoingEmail = `sim.outgoing.${ts}@eacsc.example`
  const incomingEmail = `sim.incoming.${ts}@eacsc.example`

  const step = async (label, fn) => {
    const res = await fn()
    console.log(`PASS: ${label}`)
    return res
  }

  try {
    // 1. Account Creation, Observer Profile, Role Request & President Approval
    const { data: stuAuth, error: stuCreateErr } = await adminSb.auth.admin.createUser({
      email: simStudentEmail,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Engr. Carlo Mendoza (Sim)', student_id: '2026-04120', degree_program: 'BS Civil Engineering' },
    })
    assert(!stuCreateErr, stuCreateErr?.message)

    await step('1. Student Sign-Up, Login, Observer Profile & Role Request', async () => {
      const { sb } = await signIn(supabaseUrl, anonKey, simStudentEmail)
      const { data: prof, error: pErr } = await sb.rpc('eacsc_ensure_observer_profile', {
        p_full_name: 'Engr. Carlo Mendoza (Sim)',
        p_student_id: '2026-04120',
        p_degree_program: 'BS Civil Engineering',
      })
      assert(!pErr, pErr?.message)
      assert(prof.functional_roles.length === 0, 'New account must start as Observer')

      const { data: req, error: rErr } = await sb.rpc('eacsc_submit_role_request', {
        p_desired_position: 'Committee Chairperson (Author)',
        p_requested_roles: ['author'],
        p_student_id: '2026-04120',
        p_degree_program: 'BS Civil Engineering',
        p_justification: 'Full lifecycle simulation author account',
      })
      assert(!rErr && req?.request_id, rErr?.message)
      return req.request_id
    }).then(async (requestId) => {
      await step('2. President Approves Role Request -> Student Upgraded to Author', async () => {
        const { sb: presSb } = await signIn(supabaseUrl, anonKey, 'president@eacsc.example')
        const { data: dec, error: dErr } = await presSb.rpc('eacsc_decide_role_request', {
          p_request_id: requestId,
          p_decision: 'approved',
          p_review_note: 'Approved in full lifecycle simulation',
        })
        assert(!dErr && dec?.status === 'approved', dErr?.message)
      })
    })

    // 2. Folder, Public Document #1, Stage Upload v1, Submit -> Return -> Resubmit -> 6-Point Approve
    const { sb: authorSb, session: authorSess } = await signIn(supabaseUrl, anonKey, simStudentEmail)
    const { sb: presSb } = await signIn(supabaseUrl, anonKey, 'president@eacsc.example')
    const { sb: audSb } = await signIn(supabaseUrl, anonKey, 'executive.auditor@eacsc.example')
    const { sb: pioSb, session: pioSess } = await signIn(supabaseUrl, anonKey, 'pro@eacsc.example')
    const { sb: secSb } = await signIn(supabaseUrl, anonKey, 'executive.secretary@eacsc.example')
    const { sb: adminOpsSb } = await signIn(supabaseUrl, anonKey, 'admin@eacsc.example')

    let folderId = null
    let doc1Id = null
    let doc1Ver1Id = null
    let doc1Ver2Id = null
    let doc1Release1Id = null
    let doc1Release2Id = null
    let doc2Id = null
    let doc2Ver1Id = null
    let doc2Release1Id = null

    await step('3. Author Creates Folder, Public Document & Stages v1 PDF', async () => {
      const { data: folder, error: fErr } = await authorSb.rpc('eacsc_create_folder', {
        p_name: `AY 2026-2027 Operations (${ts % 1000})`,
        p_description: 'Simulated council governance & assembly records',
      })
      assert(!fErr && folder?.folder_id, fErr?.message)
      folderId = folder.folder_id

      const { data: doc, error: dErr } = await authorSb.rpc('eacsc_create_document', {
        p_title: 'EA-CSC General Assembly Guidelines 2026',
        p_category: 'Activities and CBO records',
        p_document_type: 'Guidelines',
        p_access_class: 'public',
        p_summary: 'Official assembly guidelines, attendance rules, and safety protocols for CEA students.',
        p_folder_id: folderId,
      })
      assert(!dErr && doc?.record_id, dErr?.message)
      doc1Id = doc.record_id

      // Grant reviewer & publisher assignments to Auditor, President, and PRO for this simulation record
      const presUid = (await presSb.auth.getUser()).data.user.id
      const { data: officers } = await adminSb
        .from('app_users')
        .select('user_id,functional_roles')
        .in('user_id', [
          presUid,
          (await audSb.auth.getUser()).data.user.id,
          (await pioSb.auth.getUser()).data.user.id,
        ])
      for (const off of officers ?? []) {
        for (const fn of ['reviewer', 'approver', 'publisher']) {
          if (off.functional_roles.includes(fn)) {
            await pgClient.query(
              `insert into public.record_assignments (record_id, user_id, assignment_function, allow_restricted, is_active, assigned_by)
               values ($1, $2, $3, false, true, $4)
               on conflict do nothing`,
              [doc1Id, off.user_id, fn, presUid],
            )
          }
        }
      }

      const { data: recRow } = await authorSb
        .from('master_records')
        .select('revision_counter')
        .eq('record_id', doc1Id)
        .single()

      const up = await stageUpload(supabaseUrl, anonKey, authorSess.access_token, {
        recordId: doc1Id,
        expectedRecordRevision: recRow.revision_counter,
        notes: 'Initial draft v1 with assembly agenda.',
        classification: 'initial_capture',
        pdfBuffer: makePdfBuffer('EA-CSC General Assembly Guidelines 2026 - Draft v1'),
        filename: 'assembly-guidelines-v1.pdf',
      })
      doc1Ver1Id = up.version_id
      assert(doc1Ver1Id, 'Stage upload v1 failed to return version_id')
    })

    await step('4. Submit v1 -> Auditor Returns for Correction -> Author Edits & Resubmits -> President 6-Point Approves', async () => {
      const { data: vRow } = await authorSb
        .from('record_versions')
        .select('revision_counter')
        .eq('version_id', doc1Ver1Id)
        .single()

      const { data: sub1, error: subErr1 } = await authorSb.rpc('eacsc_submit_version_for_review', {
        p_version_id: doc1Ver1Id,
        p_expected_revision: vRow.revision_counter,
        p_request_id: crypto.randomUUID(),
      })
      assert(!subErr1 && sub1.state === 'For Review', `Submit 1 failed: ${subErr1?.message}`)

      // Auditor returns for correction
      const { data: ret1, error: retErr } = await audSb.rpc('eacsc_return_version_for_correction', {
        p_version_id: doc1Ver1Id,
        p_expected_revision: sub1.revision_counter,
        p_comment: 'Please specify exact Manila (UTC+8) start time and Engineering Hall room.',
        p_request_id: crypto.randomUUID(),
      })
      assert(!retErr && ret1.state === 'Draft', `Return failed: ${retErr?.message}`)

      // Author updates draft notes and resubmits
      const { data: upd, error: updErr } = await authorSb.rpc('eacsc_update_draft_notes', {
        p_version_id: doc1Ver1Id,
        p_expected_revision: ret1.revision_counter,
        p_change_summary: 'Updated: November 20, 2026 at 2:00 PM (UTC+8), Engineering Hall Room 201.',
        p_request_id: crypto.randomUUID(),
      })
      assert(!updErr, `Update draft notes failed: ${updErr?.message}`)

      const { data: sub2, error: subErr2 } = await authorSb.rpc('eacsc_submit_version_for_review', {
        p_version_id: doc1Ver1Id,
        p_expected_revision: upd.revision_counter,
        p_request_id: crypto.randomUUID(),
      })
      assert(!subErr2 && sub2.state === 'For Review', `Resubmit failed: ${subErr2?.message}`)

      // President completes 6-point verification and approves
      const { data: app1, error: appErr } = await presSb.rpc('eacsc_approve_version', {
        p_version_id: doc1Ver1Id,
        p_expected_revision: sub2.revision_counter,
        p_checklist: buildChecklist(),
        p_approval_kind: 'substantive_approval',
        p_approving_position: 'President',
        p_approval_date: '2026-11-15',
        p_approval_basis: 'Executive approval after 6-point verification',
        p_approval_evidence_reference: 'RES-2026-GA-01',
        p_approval_not_required_reason: null,
        p_is_provisional: false,
        p_provisional_uncertainty: null,
        p_provisional_update_owner: null,
        p_request_id: crypto.randomUUID(),
      })
      assert(!appErr && app1.state === 'Approved', `6-point approve v1 failed: ${appErr?.message}`)
    })

    await step('5. PIO Publishes v1 -> Emergency Withdrawal -> Author Stages v2 -> 6-Point Approve -> Republish v2 (v1 Superseded)', async () => {
      // Ensure PIO has publisher assignment on doc1Id if required
      const { data: rec1 } = await pioSb
        .from('master_records')
        .select('revision_counter')
        .eq('record_id', doc1Id)
        .single()
      const { data: ver1Row } = await pioSb
        .from('record_versions')
        .select('revision_counter')
        .eq('version_id', doc1Ver1Id)
        .single()

      doc1Release1Id = crypto.randomUUID()
      await publishRelease(supabaseUrl, anonKey, pioSess.access_token, {
        versionId: doc1Ver1Id,
        expectedVersionRevision: ver1Row.revision_counter,
        expectedRecordRevision: rec1.revision_counter,
        releaseId: doc1Release1Id,
        publicTitle: 'EA-CSC General Assembly Guidelines 2026',
        effectiveFrom: new Date(Date.now() + dbClockOffsetMs - 60_000).toISOString(),
      })

      // Emergency Withdraw v1
      const { data: recAfterPub } = await pioSb
        .from('master_records')
        .select('revision_counter')
        .eq('record_id', doc1Id)
        .single()

      const { error: wdErr } = await pioSb.rpc('eacsc_withdraw_release', {
        p_release_id: doc1Release1Id,
        p_expected_record_revision: recAfterPub.revision_counter,
        p_withdrawal_reason: 'Withdrawn to update venue capacity and add safety briefing link.',
        p_request_id: crypto.randomUUID(),
      })
      assert(!wdErr, `Withdraw failed: ${wdErr?.message}`)

      // Create Draft v2 via official 3-step upload, submit, 6-point approve, republish
      const { data: recBeforeV2 } = await authorSb
        .from('master_records')
        .select('revision_counter')
        .eq('record_id', doc1Id)
        .single()

      const up2 = await stageUpload(supabaseUrl, anonKey, authorSess.access_token, {
        recordId: doc1Id,
        expectedRecordRevision: recBeforeV2.revision_counter,
        notes: 'v2: Revised venue to CEA Auditorium (2:00 PM UTC+8) with updated safety annex.',
        classification: 'legitimate_change',
        pdfBuffer: makePdfBuffer('EA-CSC General Assembly Guidelines 2026 - Revised v2'),
        filename: 'assembly-guidelines-v2.pdf',
      })
      doc1Ver2Id = up2.version_id

      const { data: subV2, error: s2Err } = await authorSb.rpc('eacsc_submit_version_for_review', {
        p_version_id: doc1Ver2Id,
        p_expected_revision: up2.version_revision,
        p_request_id: crypto.randomUUID(),
      })
      assert(!s2Err && subV2.state === 'For Review', s2Err?.message)

      const { data: appV2, error: a2Err } = await presSb.rpc('eacsc_approve_version', {
        p_version_id: doc1Ver2Id,
        p_expected_revision: subV2.revision_counter,
        p_checklist: buildChecklist(),
        p_approval_kind: 'substantive_approval',
        p_approving_position: 'President',
        p_approval_date: '2026-11-15',
        p_approval_basis: 'Verified revised v2 assembly circular',
        p_approval_evidence_reference: 'RES-2026-GA-02',
        p_approval_not_required_reason: null,
        p_is_provisional: false,
        p_provisional_uncertainty: null,
        p_provisional_update_owner: null,
        p_request_id: crypto.randomUUID(),
      })
      assert(!a2Err && appV2.state === 'Approved', a2Err?.message)

      const { data: recBeforeRepub } = await pioSb
        .from('master_records')
        .select('revision_counter')
        .eq('record_id', doc1Id)
        .single()

      doc1Release2Id = crypto.randomUUID()
      await publishRelease(supabaseUrl, anonKey, pioSess.access_token, {
        versionId: doc1Ver2Id,
        expectedVersionRevision: appV2.revision_counter,
        expectedRecordRevision: recBeforeRepub.revision_counter,
        releaseId: doc1Release2Id,
        publicTitle: 'EA-CSC General Assembly Guidelines 2026 (Revised)',
        effectiveFrom: new Date(Date.now() + dbClockOffsetMs - 60_000).toISOString(),
      })
    })

    await step('6. Create & Publish Second Public Document (Engineering Week Safety Memo)', async () => {
      const { data: doc2, error: d2Err } = await authorSb.rpc('eacsc_create_document', {
        p_title: 'Engineering Week 2026 Safety & Logistics Circular',
        p_category: 'Activities and CBO records',
        p_document_type: 'Announcement',
        p_access_class: 'public',
        p_summary: 'Official safety, booth setup, and emergency marshal assignments for Engineering Week 2026.',
        p_folder_id: folderId,
      })
      assert(!d2Err && doc2?.record_id, d2Err?.message)
      doc2Id = doc2.record_id

      const presUid2 = (await presSb.auth.getUser()).data.user.id
      const { data: officers2 } = await adminSb
        .from('app_users')
        .select('user_id,functional_roles')
        .in('user_id', [
          presUid2,
          (await pioSb.auth.getUser()).data.user.id,
        ])
      for (const off of officers2 ?? []) {
        for (const fn of ['reviewer', 'approver', 'publisher']) {
          if (off.functional_roles.includes(fn)) {
            await pgClient.query(
              `insert into public.record_assignments (record_id, user_id, assignment_function, allow_restricted, is_active, assigned_by)
               values ($1, $2, $3, false, true, $4)
               on conflict do nothing`,
              [doc2Id, off.user_id, fn, presUid2],
            )
          }
        }
      }

      const { data: rec2Init } = await authorSb
        .from('master_records')
        .select('revision_counter')
        .eq('record_id', doc2Id)
        .single()

      const up = await stageUpload(supabaseUrl, anonKey, authorSess.access_token, {
        recordId: doc2Id,
        expectedRecordRevision: rec2Init.revision_counter,
        notes: 'Engineering Week 2026 safety & booth guidelines (Nov 25-27, 2026 UTC+8).',
        classification: 'initial_capture',
        pdfBuffer: makePdfBuffer('Engineering Week 2026 Safety and Logistics Circular'),
        filename: 'engweek-2026-safety.pdf',
      })
      doc2Ver1Id = up.version_id
      const vId = doc2Ver1Id

      const { data: sub, error: sErr } = await authorSb.rpc('eacsc_submit_version_for_review', {
        p_version_id: vId,
        p_expected_revision: up.version_revision,
        p_request_id: crypto.randomUUID(),
      })
      assert(!sErr, sErr?.message)

      const { data: app, error: aErr } = await presSb.rpc('eacsc_approve_version', {
        p_version_id: vId,
        p_expected_revision: sub.revision_counter,
        p_checklist: buildChecklist(),
        p_approval_kind: 'substantive_approval',
        p_approving_position: 'President',
        p_approval_date: '2026-11-15',
        p_approval_basis: 'Approved for Engineering Week 2026',
        p_approval_evidence_reference: 'RES-2026-EW-01',
        p_approval_not_required_reason: null,
        p_is_provisional: false,
        p_provisional_uncertainty: null,
        p_provisional_update_owner: null,
        p_request_id: crypto.randomUUID(),
      })
      assert(!aErr && app.state === 'Approved', aErr?.message)

      const { data: rec } = await pioSb
        .from('master_records')
        .select('revision_counter')
        .eq('record_id', doc2Id)
        .single()

      doc2Release1Id = crypto.randomUUID()
      await publishRelease(supabaseUrl, anonKey, pioSess.access_token, {
        versionId: vId,
        expectedVersionRevision: app.revision_counter,
        expectedRecordRevision: rec.revision_counter,
        releaseId: doc2Release1Id,
        publicTitle: 'Engineering Week 2026 Safety & Logistics Circular',
        effectiveFrom: new Date(Date.now() + dbClockOffsetMs - 60_000).toISOString(),
      })
    })

    // 7. Compile Update Bulletin v1 & Update to v2
    await step('7. Secretary Compiles Update Bulletin v1 -> Updates to v2 (v1 Superseded)', async () => {
      const bulletinId = `EACSC-2026-BUL-${String(ts).slice(-4)}`
      const pdf1 = makePdfBuffer(`${bulletinId} v1 - November 2026 Council Digest`)
      const sha1 = crypto.createHash('sha256').update(pdf1).digest('hex')
      const key1 = `bulletins/${bulletinId}/v1_${crypto.randomUUID()}.pdf`

      const { error: u1Err } = await secSb.storage.from('verified-council-releases').upload(key1, pdf1, {
        contentType: 'application/pdf',
        upsert: false,
      })
      assert(!u1Err, `Bulletin v1 upload failed: ${u1Err?.message}`)

      const snapshot = [
        {
          record_id: doc1Id,
          version_id: doc1Ver2Id,
          version_number: 2,
          release_id: doc1Release2Id,
          title: 'EA-CSC General Assembly Guidelines 2026 (Revised)',
          summary: 'Revised venue to CEA Auditorium (2:00 PM UTC+8) with updated safety annex.',
        },
        {
          record_id: doc2Id,
          version_id: doc2Ver1Id,
          version_number: 1,
          release_id: doc2Release1Id,
          title: 'Engineering Week 2026 Safety & Logistics Circular',
          summary: 'Official safety, booth setup, and emergency marshal assignments for Engineering Week 2026.',
        },
      ]

      const { data: b1Data, error: b1Err } = await secSb.rpc('eacsc_issue_bulletin', {
        p_bulletin_id: bulletinId,
        p_issue_version: 1,
        p_title: 'November 2026 General Assembly & Engineering Week Digest',
        p_coverage_start: '2026-01-01',
        p_coverage_end: dbDateStr,
        p_cutoff_at: dbNowIso(),
        p_audience: 'public',
        p_source_snapshot: snapshot,
        p_pdf_storage_key: key1,
        p_pdf_size_bytes: pdf1.length,
        p_pdf_sha256: sha1,
        p_publication_reference: 'Issued by Executive Secretary (v1)',
        p_issuance_request_id: crypto.randomUUID(),
      })
      assert(!b1Err && b1Data?.issue_uuid, `Issue bulletin v1 failed: ${b1Err?.message}`)

      // Issue v2 update
      const pdf2 = makePdfBuffer(`${bulletinId} v2 - Updated November 2026 Council Digest`)
      const sha2 = crypto.createHash('sha256').update(pdf2).digest('hex')
      const key2 = `bulletins/${bulletinId}/v2_${crypto.randomUUID()}.pdf`

      const { error: u2Err } = await secSb.storage.from('verified-council-releases').upload(key2, pdf2, {
        contentType: 'application/pdf',
        upsert: false,
      })
      assert(!u2Err, `Bulletin v2 upload failed: ${u2Err?.message}`)

      const { error: b2Err } = await secSb.rpc('eacsc_issue_bulletin', {
        p_bulletin_id: bulletinId,
        p_issue_version: 2,
        p_title: 'November 2026 General Assembly & Engineering Week Digest (Updated v2)',
        p_coverage_start: '2026-01-01',
        p_coverage_end: dbDateStr,
        p_cutoff_at: dbNowIso(),
        p_audience: 'public',
        p_source_snapshot: snapshot,
        p_pdf_storage_key: key2,
        p_pdf_size_bytes: pdf2.length,
        p_pdf_sha256: sha2,
        p_publication_reference: 'Updated edition v2 by Executive Secretary',
        p_issuance_request_id: crypto.randomUUID(),
        p_corrects_issue_uuid: b1Data.issue_uuid,
        p_correction_reason: 'Updated bulletin digest with revised summary notes.',
      })
      assert(!b2Err, `Issue bulletin v2 failed: ${b2Err?.message}`)
    })

    // 8. End-of-Term Turnover & Access Transfer (Outgoing -> Tech Admin -> Incoming)
    await step('8. Turnover & Access Transfer (Outgoing Freeze -> Tech Admin Transfer -> Incoming Acknowledgment)', async () => {
      const { data: outAuth, error: oErr } = await adminSb.auth.admin.createUser({
        email: outgoingEmail,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Engr. Marco Reyes (Outgoing Sim)', student_id: '2023-00111', degree_program: 'BS Civil Engineering' },
      })
      assert(!oErr, oErr?.message)

      const { data: inAuth, error: iErr } = await adminSb.auth.admin.createUser({
        email: incomingEmail,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Engr. Sofia Villanueva (Incoming Sim)', student_id: '2025-00222', degree_program: 'BS Architecture' },
      })
      assert(!iErr, iErr?.message)

      const simPosition = `Sim Committee Chair ${String(ts).slice(-4)}`
      await pgClient.query(
        `insert into public.app_users (user_id, email, full_name, council_position, functional_roles, is_active, student_id, degree_program)
         values
           ($1, $4, 'Engr. Marco Reyes (Outgoing Sim)', $3, array['author','custodian']::text[], true, '2023-00111', 'BS Civil Engineering'),
           ($2, $5, 'Engr. Sofia Villanueva (Incoming Sim)', 'Incoming Officer Designate', array['author']::text[], true, '2025-00222', 'BS Architecture')
         on conflict (user_id) do update set
           email = excluded.email,
           council_position = excluded.council_position,
           functional_roles = excluded.functional_roles,
           is_active = true`,
        [outAuth.user.id, inAuth.user.id, simPosition, outgoingEmail, incomingEmail],
      )

      const { sb: outSb } = await signIn(supabaseUrl, anonKey, outgoingEmail)
      const { sb: inSb } = await signIn(supabaseUrl, anonKey, incomingEmail)

      // Create an internal committee handover record owned by simPosition and assign Outgoing Officer
      const { data: trnDoc, error: trnErr } = await outSb.rpc('eacsc_create_document', {
        p_title: `Committee Handover Dossier (${simPosition})`,
        p_category: 'Turnover and continuity',
        p_document_type: 'Turnover memorandum',
        p_access_class: 'internal',
        p_summary: 'Simulated committee handover dossier for end-of-term access transfer.',
        p_folder_id: folderId,
      })
      assert(!trnErr && trnDoc?.record_id, `Create turnover dossier failed: ${trnErr?.message}`)
      await pgClient.query(
        `update public.master_records set custodian_position = $1 where record_id = $2`,
        [simPosition, trnDoc.record_id],
      )
      await pgClient.query(
        `insert into public.record_assignments (record_id, user_id, assignment_function, allow_restricted, is_active, assigned_by)
         values ($1, $2, 'custodian', false, true, $3), ($1, $2, 'author', false, true, $3)
         on conflict do nothing`,
        [trnDoc.record_id, outAuth.user.id, (await presSb.auth.getUser()).data.user.id],
      )

      // Save turnover draft
      const { data: savedPkg, error: saveErr } = await outSb.rpc('eacsc_save_turnover_package_v2', {
        p_package_id: null,
        p_expected_revision: 0,
        p_position_title: simPosition,
        p_term_covered: 'AY 2026-2027 End-of-Term Simulation',
        p_incoming_officer_id: inAuth.user.id,
        p_ongoing_projects: 'General Assembly & Engineering Week logistics completed.',
        p_critical_deadlines: 'Post-event liquidation due December 5, 2026.',
        p_official_contacts: 'eacsc.cea@catsu.edu.ph / Engineering Hall 201',
        p_operational_lessons: 'Official portal access transferred via Technical Admin.',
        p_known_exceptions: 'All active committee records verified.',
        p_request_id: crypto.randomUUID(),
      })
      assert(!saveErr && savedPkg?.package_id, `Save turnover failed: ${saveErr?.message}`)

      // Freeze / confirm outgoing
      const { data: frozenPkg, error: frzErr } = await outSb.rpc('eacsc_confirm_turnover_outgoing', {
        p_package_id: savedPkg.package_id,
        p_expected_revision: savedPkg.revision_counter,
        p_request_id: crypto.randomUUID(),
      })
      assert(!frzErr, `Freeze outgoing failed: ${frzErr?.message}`)

      // Tech Admin executes Access Transfer
      const { data: xfer, error: xErr } = await adminOpsSb.rpc('eacsc_transfer_position_role_v2', {
        p_package_id: savedPkg.package_id,
        p_expected_revision: frozenPkg.revision_counter,
        p_expected_outgoing_revision: 1,
        p_expected_incoming_revision: 1,
        p_request_id: crypto.randomUUID(),
      })
      assert(!xErr, `Access transfer failed: ${xErr?.message}`)

      // Incoming officer signs acknowledgment
      const { error: ackErr } = await inSb.rpc('eacsc_sign_turnover_acknowledgment_v2', {
        p_package_id: savedPkg.package_id,
        p_expected_revision: xfer.revision_counter,
        p_exceptions_summary: 'Verified full access to transferred records in Officer Workspace.',
        p_request_id: crypto.randomUUID(),
      })
      assert(!ackErr, `Incoming acknowledgment failed: ${ackErr?.message}`)

      // Verify Outgoing deactivated & Incoming active with roles
      const { data: outProf } = await adminSb
        .from('app_users')
        .select('is_active')
        .eq('user_id', outAuth.user.id)
        .single()
      const { data: inProf } = await adminSb
        .from('app_users')
        .select('is_active,functional_roles')
        .eq('user_id', inAuth.user.id)
        .single()
      assert(outProf.is_active === false, 'Outgoing officer must be deactivated after transfer')
      assert(inProf.is_active === true && inProf.functional_roles.includes('author'), 'Incoming officer must be active with transferred roles')
    })

    console.log('\nALL 8 FULL LIFECYCLE SIMULATION SCENARIOS PASSED!')
    console.log(`Created Public Docs: ${doc1Id} (v2 live, v1 superseded), ${doc2Id} (v1 live)`)
  } finally {
    await pgClient.end()
  }
}

main().catch((err) => {
  console.error('\nSIMULATION FAILED:', err)
  process.exit(1)
})
