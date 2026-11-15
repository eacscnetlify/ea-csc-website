import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import crypto from 'crypto'

const PASSWORD = 'eacsc_1999_CEA'

const COUNCIL_ROSTER = [
  {
    email: 'president@eacsc.example',
    full_name: 'Rafael Santos',
    council_position: 'Council President',
    functional_roles: ['approver', 'reviewer'],
    student_id: '2023-10001',
    degree_program: 'BS Civil Engineering',
  },
  {
    email: 'secretary@eacsc.example',
    full_name: 'Roxan Mariz Icaro',
    council_position: 'Executive Secretary',
    functional_roles: ['custodian', 'author'],
    student_id: '2023-10002',
    degree_program: 'BS Architecture',
  },
  {
    email: 'vp.internal@eacsc.example',
    full_name: 'Alyssa Tan',
    council_position: 'Vice President Internal',
    functional_roles: ['reviewer'],
    student_id: '2023-10003',
    degree_program: 'BS Electrical Engineering',
  },
  {
    email: 'vp.external@eacsc.example',
    full_name: 'Mark Joseph Rivera',
    council_position: 'Vice President External',
    functional_roles: ['reviewer', 'author'],
    student_id: '2023-10004',
    degree_program: 'BS Mechanical Engineering',
  },
  {
    email: 'author@eacsc.example',
    full_name: 'Marco Reyes',
    council_position: 'Committee Chairperson (Academics)',
    functional_roles: ['author'],
    student_id: '2024-20001',
    degree_program: 'BS Computer Engineering',
  },
  {
    email: 'activities@eacsc.example',
    full_name: 'Patricia Mae Gomez',
    council_position: 'Committee Chairperson (Activities & CBO)',
    functional_roles: ['author'],
    student_id: '2024-20002',
    degree_program: 'BS Architecture',
  },
  {
    email: 'finance@eacsc.example',
    full_name: 'Kevin Dave Alcantara',
    council_position: 'Council Treasurer & Auditor',
    functional_roles: ['custodian', 'author'],
    student_id: '2024-20003',
    degree_program: 'BS Civil Engineering',
  },
  {
    email: 'pio@eacsc.example',
    full_name: 'Camille Cruz',
    council_position: 'Public Information Officer (PIO)',
    functional_roles: ['publisher'],
    student_id: '2024-20004',
    degree_program: 'BS Electronics Engineering',
  },
  {
    email: 'admin@eacsc.example',
    full_name: 'Daniel Lim',
    council_position: 'Lead Technical Administrator',
    functional_roles: ['technical_admin', 'custodian'],
    student_id: '2023-10009',
    degree_program: 'BS Computer Engineering',
  },
  {
    email: 'observer@eacsc.example',
    full_name: 'Sunny Daniel Soneja',
    council_position: 'Student Observer',
    functional_roles: [],
    student_id: '2024-71909',
    degree_program: 'BS Electronics Engineering',
  },
]

async function upsertAuthUser(sb, account) {
  const { data: listData, error: listErr } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (listErr) throw listErr
  const existing = listData.users.find(
    (u) => u.email?.toLowerCase() === account.email.toLowerCase(),
  )

  if (existing) {
    const { data: updated, error: updErr } = await sb.auth.admin.updateUserById(
      existing.id,
      {
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: account.full_name },
      },
    )
    if (updErr) throw updErr
    return updated.user.id
  }

  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: account.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: account.full_name },
  })
  if (createErr) throw createErr
  return created.user.id
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_BACKUP_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_BACKUP_KEY')
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const client = new pg.Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  // 1. Upsert all 10 2026 Council Roster accounts
  const uidByEmail = {}
  for (const acc of COUNCIL_ROSTER) {
    const uid = await upsertAuthUser(sb, acc)
    uidByEmail[acc.email] = uid

    await client.query(
      `
      insert into public.app_users (
        user_id, email, full_name, council_position, functional_roles,
        is_active, student_id, degree_program, updated_at
      ) values ($1, $2, $3, $4, $5, true, $6, $7, now())
      on conflict (user_id) do update set
        email = excluded.email,
        full_name = excluded.full_name,
        council_position = excluded.council_position,
        functional_roles = excluded.functional_roles,
        is_active = true,
        student_id = excluded.student_id,
        degree_program = excluded.degree_program,
        revision_counter = public.app_users.revision_counter + 1,
        updated_at = now()
      `,
      [
        uid,
        acc.email,
        acc.full_name,
        acc.council_position,
        acc.functional_roles,
        acc.student_id,
        acc.degree_program,
      ],
    )
    console.log(`Ready: ${acc.email} (${acc.council_position})`)
  }

  // 2. Purge all previous test/fictional records (EACSC-2099-* & older test records)
  console.log('Purging previous fictional test records and drafts...')
  await client.query(`
    begin;
    alter table public.audit_events disable trigger user;
    alter table public.version_verifications disable trigger user;
    alter table public.record_versions disable trigger user;
    alter table public.record_releases disable trigger user;
    alter table public.record_withdrawal_notices disable trigger user;
    alter table public.review_comments disable trigger user;
    alter table eacsc_private.mutation_receipts disable trigger user;
    alter table eacsc_private.upload_requests disable trigger user;
    alter table eacsc_private.upload_dispositions disable trigger user;
    alter table public.record_verification_checklists disable trigger user;
    alter table public.update_bulletins disable trigger user;

    delete from public.update_bulletins where bulletin_id like 'EACSC-2099-%' or bulletin_id like 'EACSC-2026-BUL-9%';
    update public.master_records set current_public_release_id = null where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from public.record_withdrawal_notices where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from public.record_releases where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from public.record_verification_checklists where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from public.version_verifications where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from public.review_comments where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from eacsc_private.upload_dispositions where upload_id in (select upload_id from eacsc_private.upload_requests where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%');
    delete from eacsc_private.upload_requests where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from eacsc_private.mutation_receipts where audit_event_uuid in (select event_uuid from public.audit_events where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%');
    delete from public.audit_events where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from public.record_assignments where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from public.record_versions where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';
    delete from public.master_records where record_id like 'EACSC-2099-%' or record_id like 'EACSC-2026-%';

    alter table public.audit_events enable trigger user;
    alter table public.version_verifications enable trigger user;
    alter table public.record_versions enable trigger user;
    alter table public.record_releases enable trigger user;
    alter table public.record_withdrawal_notices enable trigger user;
    alter table public.review_comments enable trigger user;
    alter table eacsc_private.mutation_receipts enable trigger user;
    alter table eacsc_private.upload_requests enable trigger user;
    alter table eacsc_private.upload_dispositions enable trigger user;
    alter table public.record_verification_checklists enable trigger user;
    alter table public.update_bulletins enable trigger user;
    commit;
  `)
  console.log('Purge complete.')

  // 3. Seed Clean 2026 Folders
  const presidentUid = uidByEmail['president@eacsc.example']
  const secretaryUid = uidByEmail['secretary@eacsc.example']
  const authorUid = uidByEmail['author@eacsc.example']
  const activitiesUid = uidByEmail['activities@eacsc.example']
  const financeUid = uidByEmail['finance@eacsc.example']
  const reviewerUid = uidByEmail['vp.internal@eacsc.example']
  const pioUid = uidByEmail['pio@eacsc.example']

  const folderDefs = [
    {
      name: 'AY 2026-2027 Governance & Charters',
      description: 'Constitutional bylaws, general assembly charters, and core governance documents.',
    },
    {
      name: 'Engineering Week 2026',
      description: 'Event guidelines, tournament mechanics, and committee directives for Engineering Week.',
    },
    {
      name: 'Executive Resolutions & Memos',
      description: 'Official council resolutions, calendar of activities, and secretariat advisories.',
    },
    {
      name: 'Financial Records (Restricted)',
      description: 'Council operational budget, liquidation summaries, and financial audit workpapers.',
    },
  ]

  const folderByName = {}
  for (const f of folderDefs) {
    const res = await client.query(
      `
      insert into public.document_folders (name, description, created_by)
      values ($1, $2, $3)
      on conflict ((lower(btrim(name)))) do update set description = excluded.description
      returning folder_id
      `,
      [f.name, f.description, secretaryUid],
    )
    folderByName[f.name] = res.rows[0].folder_id
  }

  // 4. Seed Clean 2026 Documents (2 Public Live Releases + 2 Active Drafts)
  const seedDocs = [
    {
      record_id: 'EACSC-2026-GOV-0001',
      title: 'EA-CSC 2026 Constitution & Operating By-Laws',
      summary: 'Official governance charter establishing council duties, student representation, and document control policies for AY 2026-2027.',
      category: 'Governance and legislation',
      document_type: 'Charter',
      originating_office: 'EA-CSC Executive Board',
      custodian_position: 'Executive Secretary',
      access_class: 'public',
      folder_id: folderByName['AY 2026-2027 Governance & Charters'],
      publish: true,
      authorUid: secretaryUid,
      versionNotes: 'Ratified 2026 Constitution and By-Laws approved by the General Assembly.',
    },
    {
      record_id: 'EACSC-2026-SEC-0001',
      title: 'General Assembly Resolution 01: AY 2026-2027 Calendar of Activities',
      summary: 'Approved schedule of major College of Engineering and Architecture student council events, assemblies, and academic initiatives.',
      category: 'Secretariat and proceedings',
      document_type: 'Resolution',
      originating_office: 'EA-CSC Secretariat',
      custodian_position: 'Executive Secretary',
      access_class: 'public',
      folder_id: folderByName['Executive Resolutions & Memos'],
      publish: true,
      authorUid: secretaryUid,
      versionNotes: 'Official Calendar of Activities for First and Second Semesters AY 2026-2027.',
    },
    {
      record_id: 'EACSC-2026-ACT-0001',
      title: 'College of Engineering & Architecture Week 2026 Guidelines',
      summary: 'Draft implementing guidelines, safety protocols, and department point systems for the annual Engineering Week celebration.',
      category: 'Activities and CBO records',
      document_type: 'Guidelines',
      originating_office: 'Committee on Student Activities',
      custodian_position: 'Committee Chairperson (Activities & CBO)',
      access_class: 'public',
      folder_id: folderByName['Engineering Week 2026'],
      publish: false,
      authorUid: activitiesUid,
      versionNotes: 'Initial committee draft for Engineering Week 2026 mechanics and scheduling.',
    },
    {
      record_id: 'EACSC-2026-FIN-0001',
      title: 'First Semester Council Operational Budget & Liquidation Plan',
      summary: 'Restricted financial allocation plan covering council operations, student aid, and activity reimbursements.',
      category: 'Financial archives',
      document_type: 'Financial Workpaper',
      originating_office: 'Office of the Treasurer',
      custodian_position: 'Council Treasurer & Auditor',
      access_class: 'restricted',
      folder_id: folderByName['Financial Records (Restricted)'],
      publish: false,
      authorUid: financeUid,
      versionNotes: 'Initial First Semester budget workpaper prepared for executive audit.',
    },
  ]

  for (const doc of seedDocs) {
    const existsRes = await client.query(
      'select 1 from public.master_records where record_id = $1',
      [doc.record_id],
    )
    if (existsRes.rowCount > 0) {
      console.log(`Seed document ${doc.record_id} already exists, skipping.`)
      continue
    }

    await client.query(
      `
      insert into public.master_records (
        record_id, title, summary, category, document_type,
        originating_office, custodian_position, access_class,
        record_date, folder_id
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, (now() at time zone 'Asia/Manila')::date, $9)
      `,
      [
        doc.record_id,
        doc.title,
        doc.summary,
        doc.category,
        doc.document_type,
        doc.originating_office,
        doc.custodian_position,
        doc.access_class,
        doc.folder_id,
      ],
    )

    // Assign author, custodian, reviewer, approver, publisher
    const assignments = [
      [doc.authorUid, 'author'],
      [secretaryUid, 'custodian'],
      [reviewerUid, 'reviewer'],
      [presidentUid, 'approver'],
      [pioUid, 'publisher'],
    ]
    if (doc.authorUid !== authorUid && doc.access_class === 'public') {
      assignments.push([authorUid, 'author'])
    }
    for (const [uid, fn] of assignments) {
      await client.query(
        `
        insert into public.record_assignments (record_id, user_id, assignment_function, assigned_by, is_active)
        values ($1, $2, $3, $4, true)
        on conflict do nothing
        `,
        [doc.record_id, uid, fn, presidentUid],
      )
    }

    const versionId = crypto.randomUUID()
    const state = doc.publish ? 'Approved' : 'Draft'

    let storageKey = null
    let originalFilename = null
    let mimeType = null
    let fileSizeBytes = null
    let sha256Hex = null

    if (doc.publish) {
      const pdfContent = `%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>endobj\n4 0 obj<< /Length 44 >>stream\nBT /F1 12 Tf 72 720 Td (${doc.record_id}) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000202 00000 n \ntrailer<< /Size 5 /Root 1 0 R >>\nstartxref\n296\n%%EOF`
      const buf = Buffer.from(pdfContent, 'utf8')
      sha256Hex = crypto.createHash('sha256').update(buf).digest('hex')
      fileSizeBytes = buf.length
      mimeType = 'application/pdf'
      originalFilename = `${doc.record_id}_v1.pdf`
      storageKey = `records/${doc.record_id}/v1/${originalFilename}`

      await sb.storage
        .from('internal-council-records')
        .upload(storageKey, buf, { contentType: 'application/pdf', upsert: true })
    }

    await client.query(
      `
      insert into public.record_versions (
        version_id, record_id, version_number, state,
        change_summary, correction_classification,
        storage_key, original_filename, mime_type, file_size_bytes, sha256,
        approved_at, approval_basis, approval_evidence_reference, approval_recorded_by
      ) values (
        $1, $2, 1, $3, $4, 'initial_capture',
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13
      )
      `,
      [
        versionId,
        doc.record_id,
        state,
        doc.versionNotes,
        storageKey,
        originalFilename,
        mimeType,
        fileSizeBytes,
        sha256Hex,
        doc.publish ? new Date().toISOString() : null,
        doc.publish ? 'General Assembly Ratification' : null,
        doc.publish ? 'EA-CSC-2026-RES-01' : null,
        doc.publish ? presidentUid : null,
      ],
    )

    if (doc.publish) {
      const releaseId = crypto.randomUUID()
      const auditUuid = crypto.randomUUID()
      const releaseObjectKey = `releases/${doc.record_id}/v1/${originalFilename}`
      const pdfContent = `%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>endobj\n4 0 obj<< /Length 44 >>stream\nBT /F1 12 Tf 72 720 Td (${doc.record_id}) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000202 00000 n \ntrailer<< /Size 5 /Root 1 0 R >>\nstartxref\n296\n%%EOF`
      const buf = Buffer.from(pdfContent, 'utf8')
      await sb.storage
        .from('verified-council-releases')
        .upload(releaseObjectKey, buf, { contentType: 'application/pdf', upsert: true })

      await client.query(
        `
        insert into public.audit_events (
          event_uuid, record_id, version_id, actor_user_id, action_type, action_summary, new_state
        ) values ($1, $2, $3, $4, 'version.released', $5, jsonb_build_object('state', 'active', 'audience', 'public'))
        `,
        [auditUuid, doc.record_id, versionId, pioUid, `Published ${doc.record_id} v1 as active public release.`],
      )

      await client.query(
        `
        insert into public.record_releases (
          release_id, record_id, version_id, released_by,
          audience, public_title, public_category,
          authorization_basis, authorization_reference, effective_from, activated_at,
          release_bucket_id, release_storage_key, release_original_filename, release_mime_type, release_file_size_bytes, release_sha256
        ) values (
          $1, $2, $3, $4,
          'public', $5, $6,
          'General Assembly Ratification', 'EA-CSC-2026-RES-01', now(), now(),
          'verified-council-releases', $7, $8, $9, $10, $11
        )
        `,
        [
          releaseId,
          doc.record_id,
          versionId,
          pioUid,
          doc.title,
          doc.category,
          releaseObjectKey,
          originalFilename,
          mimeType,
          fileSizeBytes,
          sha256Hex,
        ],
      )

      await client.query(
        'update public.master_records set current_public_release_id = $1 where record_id = $2',
        [releaseId, doc.record_id],
      )
    }

    console.log(`Seeded document: ${doc.record_id} (${state})`)
  }

  await client.end()
  console.log('Batch 11 clean purge and seed completed successfully!')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
