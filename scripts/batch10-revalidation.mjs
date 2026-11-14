import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { jsPDF } from 'jspdf'
import pg from 'pg'
import {
  PROJECT_REF,
  createBackupContext,
  loadBackupConfig,
} from './backup-common.mjs'

const RESULTS_PATH = resolve('docs/batch10/batch10-revalidation-results.json')
const ORIGIN = 'http://localhost:5173'

const B10_USERS = {
  author: {
    email: 'batch10-author@example.invalid',
    fullName: 'Batch 10 Revalidation Author',
    position: 'Fictional Batch10 Author',
    roles: ['author'],
  },
  reviewer: {
    email: 'batch10-reviewer@example.invalid',
    fullName: 'Batch 10 Revalidation Reviewer',
    position: 'Fictional Batch10 Reviewer',
    roles: ['reviewer'],
  },
  approver: {
    email: 'batch10-approver@example.invalid',
    fullName: 'Batch 10 Revalidation Approver',
    position: 'Fictional Batch10 Vice President',
    roles: ['approver'],
  },
  custodian: {
    email: 'batch10-custodian@example.invalid',
    fullName: 'Batch 10 Revalidation Custodian',
    position: 'Fictional Batch10 Secretary',
    roles: ['custodian'],
  },
  publisher: {
    email: 'batch10-publisher@example.invalid',
    fullName: 'Batch 10 Revalidation Publisher',
    position: 'Fictional Batch10 Publisher',
    roles: ['publisher'],
  },
  unassigned: {
    email: 'batch10-unassigned@example.invalid',
    fullName: 'Batch 10 Revalidation Unassigned',
    position: 'Fictional Batch10 Observer',
    roles: ['author'],
  },
}

const checks = []

function recordCheck(phase, id, title, passed, detail) {
  const entry = {
    phase,
    id,
    title,
    status: passed ? 'PASS' : 'FAIL',
    detail,
  }
  checks.push(entry)
  console.log(`[${entry.status}] ${phase} ${id}: ${title} — ${detail}`)
  if (!passed) {
    throw new Error(`Check failed (${phase} ${id}): ${detail}`)
  }
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function makePdfBytes(label) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setFontSize(14)
  doc.text('EA-CSC Batch 10 Revalidation Fixture', 48, 64)
  doc.setFontSize(11)
  doc.text(label, 48, 92)
  doc.text(`Generated: ${new Date().toISOString()}`, 48, 114)
  return new Uint8Array(doc.output('arraybuffer'))
}

function makePngBytes() {
  // Valid 1x1 RGBA PNG generated cleanly via zlib-compatible fixed deflate block
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
}

function makeJpegBytes() {
  // Complete valid 1x1 grayscale baseline JPEG ending with 0xFF 0xD9 (EOI)
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
    'base64',
  )
}

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeZipStore(entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const dataBuf = Buffer.from(data, 'utf8')
    const crc = crc32(dataBuf)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dataBuf.length, 18)
    local.writeUInt32LE(dataBuf.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(dataBuf.length, 20)
    central.writeUInt32LE(dataBuf.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)

    locals.push(local, dataBuf)
    centrals.push(central)
    offset += local.length + dataBuf.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return new Uint8Array(Buffer.concat([...locals, centralBuf, eocd]))
}

function makeDocxBytes(text) {
  return makeZipStore([
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    },
  ])
}

async function ensureUserAndSignIn(admin, anonKey, baseUrl, spec) {
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  let user = list.data?.users?.find((u) => u.email === spec.email)
  if (!user) {
    const created = await admin.auth.admin.createUser({
      email: spec.email,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName },
    })
    if (created.error || !created.data.user) {
      throw new Error(
        `createUser failed for ${spec.email}: ${created.error?.message}`,
      )
    }
    user = created.data.user
  }

  const link = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: spec.email,
  })
  if (link.error || !link.data?.properties?.hashed_token) {
    throw new Error(
      `generateLink failed for ${spec.email}: ${link.error?.message}`,
    )
  }

  const client = createClient(baseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const verified = await client.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.data.properties.hashed_token,
  })
  if (verified.error || !verified.data.session) {
    throw new Error(
      `verifyOtp failed for ${spec.email}: ${verified.error?.message}`,
    )
  }

  return {
    userId: user.id,
    token: verified.data.session.access_token,
    client,
  }
}

async function signInExisting(admin, anonKey, baseUrl, email) {
  const link = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (link.error || !link.data?.properties?.hashed_token) {
    throw new Error(`generateLink failed for ${email}: ${link.error?.message}`)
  }
  const client = createClient(baseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const verified = await client.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.data.properties.hashed_token,
  })
  if (verified.error || !verified.data.session) {
    throw new Error(`verifyOtp failed for ${email}: ${verified.error?.message}`)
  }
  return {
    userId: verified.data.user.id,
    token: verified.data.session.access_token,
    client,
  }
}

async function uploadAndAcceptVersion(
  baseUrl,
  anonKey,
  authorClient,
  authorToken,
  recordId,
  expectedRecordRev,
  filename,
  mimeType,
  bytes,
  changeSummary,
  correctionClass,
) {
  const sha = sha256Hex(bytes)
  const prepReqId = randomUUID()
  const { data: prepData, error: prepErr } = await authorClient.rpc(
    'eacsc_prepare_version_upload',
    {
      p_record_id: recordId,
      p_expected_record_revision: expectedRecordRev,
      p_original_filename: filename,
      p_mime_type: mimeType,
      p_file_size_bytes: bytes.byteLength,
      p_sha256: sha,
      p_change_summary: changeSummary,
      p_correction_classification: correctionClass,
      p_request_id: prepReqId,
    },
  )
  if (prepErr || !prepData?.upload_id) {
    throw new Error(
      `prepare_version_upload failed (${recordId}): ${prepErr?.message}`,
    )
  }

  const stageRes = await fetch(
    `${baseUrl}/functions/v1/ea-csc-stage-upload?upload_id=${prepData.upload_id}&action=stage`,
    {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Authorization: `Bearer ${authorToken}`,
        apikey: anonKey,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
      },
      body: bytes,
    },
  )
  const stageJson = await stageRes.json()
  if (!stageRes.ok) {
    throw new Error(
      `stage-upload failed (${recordId}): ${stageRes.status} ${JSON.stringify(stageJson)}`,
    )
  }

  const acceptReqId = randomUUID()
  const acceptRes = await fetch(
    `${baseUrl}/functions/v1/ea-csc-stage-upload?upload_id=${prepData.upload_id}&action=accept&request_id=${acceptReqId}`,
    {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Authorization: `Bearer ${authorToken}`,
        apikey: anonKey,
      },
    },
  )
  const acceptJson = await acceptRes.json()
  if (!acceptRes.ok) {
    throw new Error(
      `accept-upload failed (${recordId}): ${acceptRes.status} ${JSON.stringify(acceptJson)}`,
    )
  }
  return {
    versionId: acceptJson.version_id,
    versionNumber: acceptJson.version_number,
    versionRevision: acceptJson.version_revision ?? 1,
    recordRevision: acceptJson.record_revision ?? expectedRecordRev + 1,
    sha256: sha,
  }
}

async function main() {
  const config = loadBackupConfig()
  const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!anonKey) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY is required (pass --env-file=.env.local --env-file=.env.backup.local).',
    )
  }

  const admin = createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const anon = createClient(config.url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  // Direct read-write pg client ONLY for provisioning B10 test fixtures & immutability assertions
  const context = await createBackupContext(config)
  const pgRw = new pg.Client({
    host: config.host,
    port: Number(process.env.PGPORT),
    database: process.env.PGDATABASE,
    user: config.user,
    password: process.env.PGPASSWORD,
    ssl: {
      ca: context.database.connectionParameters.ssl.ca,
      rejectUnauthorized: true,
    },
    connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
  })
  await pgRw.connect()

  const runSuffix = String((Math.floor(Date.now() / 1000) % 9000) + 1000)
  const recPub1 = `EACSC-2099-BT-${runSuffix}`
  const recPub2Num = String(((Number(runSuffix) + 1) % 9000) + 1000)
  const recPub2 = `EACSC-2099-BW-${recPub2Num}`
  const recRestNum = String(((Number(runSuffix) + 2) % 9000) + 1000)
  const recRest = `EACSC-2099-BR-${recRestNum}`
  const recSchedNum = String(((Number(runSuffix) + 3) % 9000) + 1000)
  const recSched = `EACSC-2099-BS-${recSchedNum}`
  const bulPubId = `EACSC-2099-BUL-${runSuffix}`
  const bulIntId = `EACSC-2099-BUL-${recPub2Num}`

  try {
    // Provision Batch 10 test accounts
    const actors = {}
    for (const [key, spec] of Object.entries(B10_USERS)) {
      actors[key] = await ensureUserAndSignIn(admin, anonKey, config.url, spec)
      await pgRw.query(
        `insert into public.app_users (user_id, email, full_name, council_position, functional_roles, is_active)
         values ($1, $2, $3, $4, $5::text[], true)
         on conflict (user_id) do update
         set email = excluded.email,
             full_name = excluded.full_name,
             council_position = excluded.council_position,
             functional_roles = excluded.functional_roles,
             is_active = true`,
        [
          actors[key].userId,
          spec.email,
          spec.fullName,
          spec.position,
          spec.roles,
        ],
      )
    }

    // Create isolated Batch 10 master records
    for (const [recId, title, summary, cat, docType, accessClass] of [
      [
        recPub1,
        'Batch 10 Public Governance Charter',
        'Official verified public charter for Batch 10 revalidation.',
        'Governance and legislation',
        'Resolution',
        'public',
      ],
      [
        recPub2,
        'Batch 10 Withdrawal Test Notice',
        'Public release used to verify emergency withdrawal and public notice.',
        'Forms and official information',
        'Announcement',
        'public',
      ],
      [
        recRest,
        'Batch 10 Restricted Audit Workpaper',
        'Restricted internal workpaper for access isolation verification.',
        'Financial archives',
        'Report',
        'restricted',
      ],
      [
        recSched,
        'Batch 10 Scheduled Future Release',
        'Scheduled release used to test pre-effective isolation and activation.',
        'Secretariat and proceedings',
        'Minutes',
        'public',
      ],
    ]) {
      await pgRw.query(
        `insert into public.master_records (
           record_id, title, summary, category, document_type,
           originating_office, custodian_position, access_class, public_contact
         ) values ($1, $2, $3, $4, $5, 'EA-CSC Secretariat', 'Fictional Batch10 Secretary', $6, 'eacsc-secretariat@example.invalid')
         on conflict (record_id) do nothing`,
        [recId, title, summary, cat, docType, accessClass],
      )
    }

    // Assign Batch 10 roles per record (never assign 'unassigned')
    for (const recId of [recPub1, recPub2, recRest, recSched]) {
      const allowRestricted = recId === recRest
      for (const [roleKey, fnName] of [
        ['author', 'author'],
        ['reviewer', 'reviewer'],
        ['approver', 'approver'],
        ['custodian', 'custodian'],
        ['publisher', 'publisher'],
      ]) {
        await pgRw.query(
          `insert into public.record_assignments (
             record_id, user_id, assignment_function, allow_restricted, assigned_by, is_active
           ) values ($1, $2, $3, $4, 'ff465491-6092-45f4-bed7-549580fc6cd5', true)
           on conflict (record_id, user_id, assignment_function) do update
           set allow_restricted = excluded.allow_restricted, assigned_by = excluded.assigned_by, is_active = true`,
          [recId, actors[roleKey].userId, fnName, allowRestricted],
        )
      }
    }

    // ================= R1 CHECKS =================
    const connCheck = await anon.rpc('eacsc_connection_check')
    recordCheck(
      'R1',
      'D01/P03',
      'Connection check RPC',
      !connCheck.error && connCheck.data?.status === 'ok',
      JSON.stringify(connCheck.data),
    )

    const anonTable = await anon
      .from('master_records')
      .select('record_id')
      .limit(1)
    recordCheck(
      'R1',
      'D02',
      'Anonymous direct table read denied',
      Boolean(anonTable.error),
      anonTable.error?.message || 'unexpected rows',
    )

    const inactiveActor = await signInExisting(
      admin,
      anonKey,
      config.url,
      'batch4-inactive@example.invalid',
    )
    const inactiveTry = await inactiveActor.client.rpc(
      'eacsc_update_draft_notes',
      {
        p_version_id: randomUUID(),
        p_expected_revision: 1,
        p_change_summary: 'should fail',
        p_request_id: randomUUID(),
      },
    )
    recordCheck(
      'R1',
      'D02',
      'Inactive user denied protected RPC',
      Boolean(inactiveTry.error),
      inactiveTry.error?.message || 'unexpected success',
    )

    const noProfileActor = await signInExisting(
      admin,
      anonKey,
      config.url,
      'batch4-no-profile@example.invalid',
    )
    const noProfTry = await noProfileActor.client.rpc(
      'eacsc_update_draft_notes',
      {
        p_version_id: randomUUID(),
        p_expected_revision: 1,
        p_change_summary: 'should fail',
        p_request_id: randomUUID(),
      },
    )
    recordCheck(
      'R1',
      'D02',
      'Profileless user denied protected RPC',
      Boolean(noProfTry.error),
      noProfTry.error?.message || 'unexpected success',
    )

    // Restricted access check: unassigned actor denied upload prep on restricted record
    const unassTry = await actors.unassigned.client.rpc(
      'eacsc_prepare_version_upload',
      {
        p_record_id: recRest,
        p_expected_record_revision: 1,
        p_original_filename: 'unauth.pdf',
        p_mime_type: 'application/pdf',
        p_file_size_bytes: 512,
        p_sha256: 'a'.repeat(64),
        p_change_summary: 'unauthorized',
        p_correction_classification: 'initial_capture',
        p_request_id: randomUUID(),
      },
    )
    recordCheck(
      'R1',
      'D03',
      'Unassigned user denied restricted record upload',
      Boolean(unassTry.error),
      unassTry.error?.message || 'unexpected success',
    )

    // R1.4 + P04: Valid PDF, DOCX, PNG, JPEG uploads + negative spoofed file
    const pdf1 = makePdfBytes(`${recPub1} v1 initial authorized draft`)
    const pub1v1 = await uploadAndAcceptVersion(
      config.url,
      anonKey,
      actors.author.client,
      actors.author.token,
      recPub1,
      1,
      'b10-pub1-v1.pdf',
      'application/pdf',
      pdf1,
      'Initial verified v1 PDF for Batch 10 revalidation.',
      'initial_capture',
    )
    recordCheck(
      'R1',
      'D04/P04',
      'PDF upload stage & accept pipeline',
      Boolean(pub1v1.versionId),
      `version_id=${pub1v1.versionId}`,
    )

    const docxBytes = makeDocxBytes('Batch 10 DOCX fixture')
    const pub2v1 = await uploadAndAcceptVersion(
      config.url,
      anonKey,
      actors.author.client,
      actors.author.token,
      recPub2,
      1,
      'b10-pub2-v1.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docxBytes,
      'DOCX ingestion verification for withdrawal test.',
      'initial_capture',
    )
    const pngBytes = makePngBytes()
    const restv1 = await uploadAndAcceptVersion(
      config.url,
      anonKey,
      actors.author.client,
      actors.author.token,
      recRest,
      1,
      'b10-rest-v1.png',
      'image/png',
      pngBytes,
      'PNG ingestion verification on restricted record.',
      'initial_capture',
    )
    const jpgBytes = makeJpegBytes()
    const schedv1 = await uploadAndAcceptVersion(
      config.url,
      anonKey,
      actors.author.client,
      actors.author.token,
      recSched,
      1,
      'b10-sched-v1.jpg',
      'image/jpeg',
      jpgBytes,
      'JPEG ingestion verification on scheduled record.',
      'initial_capture',
    )
    recordCheck(
      'R1',
      'P04',
      'DOCX, PNG, and JPEG upload verifications',
      Boolean(pub2v1.versionId && restv1.versionId && schedv1.versionId),
      `docx=${pub2v1.versionId}, png=${restv1.versionId}, jpg=${schedv1.versionId}`,
    )

    // Negative spoofed EXE disguised as PDF
    const fakePdf = Buffer.from('MZ\x90\x00ThisIsNotAPDF')
    const fakePrep = await actors.author.client.rpc(
      'eacsc_prepare_version_upload',
      {
        p_record_id: recRest,
        p_expected_record_revision: restv1.recordRevision,
        p_original_filename: 'spoof.pdf',
        p_mime_type: 'application/pdf',
        p_file_size_bytes: fakePdf.byteLength,
        p_sha256: sha256Hex(fakePdf),
        p_change_summary: 'spoof check',
        p_correction_classification: 'legitimate_change',
        p_request_id: randomUUID(),
      },
    )
    let spoofRejected = false
    if (!fakePrep.error && fakePrep.data?.upload_id) {
      const fakeStage = await fetch(
        `${config.url}/functions/v1/ea-csc-stage-upload?upload_id=${fakePrep.data.upload_id}&action=stage`,
        {
          method: 'POST',
          headers: {
            Origin: ORIGIN,
            Authorization: `Bearer ${actors.author.token}`,
            apikey: anonKey,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(fakePdf.byteLength),
          },
          body: fakePdf,
        },
      )
      if (!fakeStage.ok) {
        spoofRejected = true
      } else {
        const fakeAccept = await fetch(
          `${config.url}/functions/v1/ea-csc-stage-upload?upload_id=${fakePrep.data.upload_id}&action=accept&request_id=${randomUUID()}`,
          {
            method: 'POST',
            headers: {
              Origin: ORIGIN,
              Authorization: `Bearer ${actors.author.token}`,
              apikey: anonKey,
            },
          },
        )
        spoofRejected = !fakeAccept.ok
      }
    }
    recordCheck(
      'R1',
      'P04',
      'Spoofed executable-as-PDF rejected',
      spoofRejected,
      `rejected=${spoofRejected}`,
    )

    // R1.5: Optimistic concurrency PT409 + Idempotency
    const idemReqId = randomUUID()
    const notes1 = await actors.author.client.rpc('eacsc_update_draft_notes', {
      p_version_id: pub1v1.versionId,
      p_expected_revision: pub1v1.versionRevision,
      p_change_summary: 'Updated notes for concurrency & idempotency check.',
      p_request_id: idemReqId,
    })
    const notesRetry = await actors.author.client.rpc(
      'eacsc_update_draft_notes',
      {
        p_version_id: pub1v1.versionId,
        p_expected_revision: pub1v1.versionRevision,
        p_change_summary: 'Updated notes for concurrency & idempotency check.',
        p_request_id: idemReqId,
      },
    )
    const notesConflict = await actors.author.client.rpc(
      'eacsc_update_draft_notes',
      {
        p_version_id: pub1v1.versionId,
        p_expected_revision: pub1v1.versionRevision, // now stale!
        p_change_summary: 'Should conflict',
        p_request_id: randomUUID(),
      },
    )
    pub1v1.versionRevision =
      notes1.data?.version_revision ??
      notes1.data?.revision_counter ??
      pub1v1.versionRevision + 1
    recordCheck(
      'R1',
      'D08/D14',
      'Retry idempotency and PT409 optimistic concurrency',
      !notes1.error &&
        !notesRetry.error &&
        notesRetry.data?.audit_event_uuid === notes1.data?.audit_event_uuid &&
        Boolean(notesConflict.error),
      `audit_uuid=${notes1.data?.audit_event_uuid}, conflict=${notesConflict.error?.code || notesConflict.error?.message}`,
    )

    // ================= R2 CHECKS =================
    // Submit -> Return -> Resubmit
    const sub1 = await actors.author.client.rpc(
      'eacsc_submit_version_for_review',
      {
        p_version_id: pub1v1.versionId,
        p_expected_revision: pub1v1.versionRevision,
        p_request_id: randomUUID(),
      },
    )
    if (sub1.error) throw new Error(`submit v1 failed: ${sub1.error.message}`)
    pub1v1.versionRevision =
      sub1.data?.version_revision ??
      sub1.data?.revision_counter ??
      pub1v1.versionRevision + 1

    const ret1 = await actors.reviewer.client.rpc(
      'eacsc_return_version_for_correction',
      {
        p_version_id: pub1v1.versionId,
        p_expected_revision: pub1v1.versionRevision,
        p_comment:
          'Please confirm formatting header before substantive approval.',
        p_request_id: randomUUID(),
      },
    )
    if (ret1.error) throw new Error(`return v1 failed: ${ret1.error.message}`)
    pub1v1.versionRevision =
      ret1.data?.version_revision ??
      ret1.data?.revision_counter ??
      pub1v1.versionRevision + 1

    const sub2 = await actors.author.client.rpc(
      'eacsc_submit_version_for_review',
      {
        p_version_id: pub1v1.versionId,
        p_expected_revision: pub1v1.versionRevision,
        p_request_id: randomUUID(),
      },
    )
    if (sub2.error) throw new Error(`resubmit v1 failed: ${sub2.error.message}`)
    pub1v1.versionRevision =
      sub2.data?.version_revision ??
      sub2.data?.revision_counter ??
      pub1v1.versionRevision + 1
    recordCheck(
      'R2',
      'D05',
      'Submit -> Return with comment -> Resubmit cycle',
      true,
      `rev=${pub1v1.versionRevision}`,
    )

    // 6-point verification negative check + substantive approval
    const badChecklist = {
      identity_version: { status: 'Confirmed' },
      dates_deadlines: { status: 'Confirmed' },
      location_link: { status: 'Correction Required', reason: 'Missing link' },
      audience_requirements: { status: 'Confirmed' },
      authority_disclosure: { status: 'Confirmed' },
      contact_reference: { status: 'Confirmed' },
    }
    const failApp = await actors.approver.client.rpc('eacsc_approve_version', {
      p_version_id: pub1v1.versionId,
      p_expected_revision: pub1v1.versionRevision,
      p_checklist: badChecklist,
      p_approval_kind: 'substantive_approval',
      p_approving_position: 'Fictional Batch10 Vice President',
      p_approval_date: '2026-11-14',
      p_approval_basis: 'Council Resolution No. B10-01',
      p_approval_evidence_reference: 'RES-B10-01',
      p_approval_not_required_reason: null,
      p_is_provisional: false,
      p_provisional_uncertainty: null,
      p_provisional_update_owner: null,
      p_request_id: randomUUID(),
    })
    const goodChecklist = {
      identity_version: { status: 'Confirmed' },
      dates_deadlines: { status: 'Confirmed' },
      location_link: { status: 'Confirmed' },
      audience_requirements: { status: 'Confirmed' },
      authority_disclosure: { status: 'Confirmed' },
      contact_reference: { status: 'Confirmed' },
    }
    const app1 = await actors.approver.client.rpc('eacsc_approve_version', {
      p_version_id: pub1v1.versionId,
      p_expected_revision: pub1v1.versionRevision,
      p_checklist: goodChecklist,
      p_approval_kind: 'substantive_approval',
      p_approving_position: 'Fictional Batch10 Vice President',
      p_approval_date: '2026-11-14',
      p_approval_basis: 'Council Resolution No. B10-01',
      p_approval_evidence_reference: 'RES-B10-01',
      p_approval_not_required_reason: null,
      p_is_provisional: true,
      p_provisional_uncertainty: 'Pending final committee annex verification',
      p_provisional_update_owner: 'EA-CSC Secretariat',
      p_request_id: randomUUID(),
    })
    if (app1.error) throw new Error(`approve v1 failed: ${app1.error.message}`)
    pub1v1.versionRevision =
      app1.data?.version_revision ??
      app1.data?.revision_counter ??
      pub1v1.versionRevision + 1
    if (app1.data?.record_revision) {
      pub1v1.recordRevision = app1.data.record_revision
    }
    recordCheck(
      'R2',
      'D06/D15',
      'Six-point verification failure rejected & substantive approval succeeded',
      Boolean(failApp.error) && app1.data?.state === 'Approved',
      `incomplete_rejected=${Boolean(failApp.error)}, state=${app1.data?.state}`,
    )

    // Publish pub1v1 via Edge Function ea-csc-publish-release
    const pub1RelId = randomUUID()
    const pub1Res = await fetch(
      `${config.url}/functions/v1/ea-csc-publish-release`,
      {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${actors.publisher.token}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version_id: pub1v1.versionId,
          expected_version_revision: pub1v1.versionRevision,
          expected_record_revision: pub1v1.recordRevision,
          release_id: pub1RelId,
          audience: 'public',
          public_title: 'Batch 10 Public Governance Charter',
          public_category: 'Governance and legislation',
          authorization_basis: 'Council Resolution No. B10-01',
          authorization_reference: 'RES-B10-01',
          effective_from: null,
          request_id: randomUUID(),
        }),
      },
    )
    const pub1Json = await pub1Res.json()
    if (!pub1Res.ok || !pub1Json.active_now) {
      throw new Error(
        `publish pub1v1 failed: ${pub1Res.status} ${JSON.stringify(pub1Json)}`,
      )
    }
    pub1v1.recordRevision = pub1Json.record_revision

    // Verify D-03 & D-04: Public catalog + public record detail + public download
    const catCheck1 = await anon.rpc('eacsc_public_catalog', {
      p_limit: 50,
      p_offset: 0,
    })
    const inCatalog1 =
      Array.isArray(catCheck1.data) &&
      catCheck1.data.some(
        (r) => r.record_id === recPub1 && r.version_number === 1,
      )
    const detailCheck1 = await anon.rpc('eacsc_public_record_detail', {
      p_record_id: recPub1,
    })
    const dl1 = await fetch(
      `${config.url}/functions/v1/ea-csc-public-download?record_id=${recPub1}`,
      {
        headers: { Origin: ORIGIN },
      },
    )
    const dl1Bytes = new Uint8Array(await dl1.arrayBuffer())
    recordCheck(
      'R2',
      'D07/P01',
      'Public release catalog, detail metadata (D-04), and public download (D-03)',
      inCatalog1 &&
        detailCheck1.data?.current?.originating_office ===
          'EA-CSC Secretariat' &&
        dl1.ok &&
        sha256Hex(dl1Bytes) === pub1v1.sha256,
      `in_catalog=${inCatalog1}, dl_status=${dl1.status}, sha_match=${sha256Hex(dl1Bytes) === pub1v1.sha256}`,
    )

    // Supersession: upload v2, submit, approve, publish -> check v1 Superseded & history
    const pdf2 = makePdfBytes(`${recPub1} v2 superseding release`)
    const pub1v2 = await uploadAndAcceptVersion(
      config.url,
      anonKey,
      actors.author.client,
      actors.author.token,
      recPub1,
      pub1v1.recordRevision,
      'b10-pub1-v2.pdf',
      'application/pdf',
      pdf2,
      'Updated governance charter v2 superseding v1.',
      'legitimate_change',
    )
    const subV2 = await actors.author.client.rpc(
      'eacsc_submit_version_for_review',
      {
        p_version_id: pub1v2.versionId,
        p_expected_revision: pub1v2.versionRevision,
        p_request_id: randomUUID(),
      },
    )
    pub1v2.versionRevision =
      subV2.data?.version_revision ??
      subV2.data?.revision_counter ??
      pub1v2.versionRevision + 1
    const appV2 = await actors.approver.client.rpc('eacsc_approve_version', {
      p_version_id: pub1v2.versionId,
      p_expected_revision: pub1v2.versionRevision,
      p_checklist: goodChecklist,
      p_approval_kind: 'substantive_approval',
      p_approving_position: 'Fictional Batch10 Vice President',
      p_approval_date: '2026-11-14',
      p_approval_basis: 'Council Resolution No. B10-02',
      p_approval_evidence_reference: 'RES-B10-02',
      p_approval_not_required_reason: null,
      p_is_provisional: false,
      p_provisional_uncertainty: null,
      p_provisional_update_owner: null,
      p_request_id: randomUUID(),
    })
    pub1v2.versionRevision =
      appV2.data?.version_revision ??
      appV2.data?.revision_counter ??
      pub1v2.versionRevision + 1
    if (appV2.data?.record_revision) {
      pub1v2.recordRevision = appV2.data.record_revision
    }

    const pub2RelId = randomUUID()
    const pub2Res = await fetch(
      `${config.url}/functions/v1/ea-csc-publish-release`,
      {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${actors.publisher.token}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version_id: pub1v2.versionId,
          expected_version_revision: pub1v2.versionRevision,
          expected_record_revision: pub1v2.recordRevision,
          release_id: pub2RelId,
          audience: 'public',
          public_title: 'Batch 10 Public Governance Charter (v2)',
          public_category: 'Governance and legislation',
          authorization_basis: 'Council Resolution No. B10-02',
          authorization_reference: 'RES-B10-02',
          effective_from: null,
          request_id: randomUUID(),
        }),
      },
    )
    const pub2Json = await pub2Res.json()
    if (!pub2Res.ok)
      throw new Error(`publish v2 failed: ${JSON.stringify(pub2Json)}`)

    const detailV2 = await anon.rpc('eacsc_public_record_detail', {
      p_record_id: recPub1,
    })
    const v1Row = await pgRw.query(
      'select state, superseded_by_version_id, successor_version_id from public.record_versions where version_id = $1',
      [pub1v1.versionId],
    )
    const r1Row = await pgRw.query(
      'select effective_until from public.record_releases where release_id = $1',
      [pub1RelId],
    )
    recordCheck(
      'R2',
      'D07/D16',
      'Supersession v1 -> v2 updates state, successor IDs, effective_until, and public history',
      v1Row.rows[0]?.state === 'Superseded' &&
        v1Row.rows[0]?.superseded_by_version_id === pub1v2.versionId &&
        v1Row.rows[0]?.successor_version_id === pub1v2.versionId &&
        Boolean(r1Row.rows[0]?.effective_until) &&
        detailV2.data?.current?.version_number === 2 &&
        detailV2.data?.history?.length === 1 &&
        detailV2.data.history[0].version_number === 1,
      `v1_state=${v1Row.rows[0]?.state}, history_count=${detailV2.data?.history?.length}`,
    )

    // Scheduled future release + activation
    const subS = await actors.author.client.rpc(
      'eacsc_submit_version_for_review',
      {
        p_version_id: schedv1.versionId,
        p_expected_revision: schedv1.versionRevision,
        p_request_id: randomUUID(),
      },
    )
    const appS = await actors.approver.client.rpc('eacsc_approve_version', {
      p_version_id: schedv1.versionId,
      p_expected_revision:
        subS.data?.version_revision ??
        subS.data?.revision_counter ??
        schedv1.versionRevision + 1,
      p_checklist: goodChecklist,
      p_approval_kind: 'substantive_approval',
      p_approving_position: 'Fictional Batch10 Vice President',
      p_approval_date: '2026-11-14',
      p_approval_basis: 'Scheduled Release Order B10-S1',
      p_approval_evidence_reference: 'ORD-B10-S1',
      p_approval_not_required_reason: null,
      p_is_provisional: false,
      p_provisional_uncertainty: null,
      p_provisional_update_owner: null,
      p_request_id: randomUUID(),
    })
    const futureEff = new Date(Date.now() + 6000).toISOString()
    const schedRelId = randomUUID()
    const schedRes = await fetch(
      `${config.url}/functions/v1/ea-csc-publish-release`,
      {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${actors.publisher.token}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version_id: schedv1.versionId,
          expected_version_revision:
            appS.data?.version_revision ??
            appS.data?.revision_counter ??
            schedv1.versionRevision + 2,
          expected_record_revision:
            appS.data?.record_revision ?? schedv1.recordRevision,
          release_id: schedRelId,
          audience: 'public',
          public_title: 'Batch 10 Scheduled Future Release',
          public_category: 'Secretariat and proceedings',
          authorization_basis: 'Scheduled Release Order B10-S1',
          authorization_reference: 'ORD-B10-S1',
          effective_from: futureEff,
          request_id: randomUUID(),
        }),
      },
    )
    const schedJson = await schedRes.json()
    if (!schedRes.ok || schedJson.active_now !== false) {
      throw new Error(
        `scheduled publish unexpected: ${JSON.stringify(schedJson)}`,
      )
    }
    const premAct = await actors.publisher.client.rpc(
      'eacsc_activate_scheduled_release',
      {
        p_release_id: schedRelId,
        p_expected_record_revision: schedJson.record_revision,
        p_request_id: randomUUID(),
      },
    )
    await new Promise((r) => setTimeout(r, 7000))
    const dueAct = await actors.publisher.client.rpc(
      'eacsc_activate_scheduled_release',
      {
        p_release_id: schedRelId,
        p_expected_record_revision: schedJson.record_revision,
        p_request_id: randomUUID(),
      },
    )
    const catAfterAct = await anon.rpc('eacsc_public_catalog', {
      p_limit: 50,
      p_offset: 0,
    })
    const schedInCat =
      Array.isArray(catAfterAct.data) &&
      catAfterAct.data.some((r) => r.record_id === recSched)
    recordCheck(
      'R2',
      'P01',
      'Scheduled future release blocked before effective_from, then activated cleanly',
      Boolean(premAct.error) && !dueAct.error && schedInCat,
      `premature_blocked=${Boolean(premAct.error)}, activated=${Boolean(dueAct.data?.activated_at)}`,
    )

    // Emergency withdrawal & public notice
    const subW = await actors.author.client.rpc(
      'eacsc_submit_version_for_review',
      {
        p_version_id: pub2v1.versionId,
        p_expected_revision: pub2v1.versionRevision,
        p_request_id: randomUUID(),
      },
    )
    const appW = await actors.custodian.client.rpc('eacsc_approve_version', {
      p_version_id: pub2v1.versionId,
      p_expected_revision:
        subW.data?.version_revision ??
        subW.data?.revision_counter ??
        pub2v1.versionRevision + 1,
      p_checklist: goodChecklist,
      p_approval_kind: 'custodian_acceptance',
      p_approving_position: 'Fictional Batch10 Secretary',
      p_approval_date: '2026-11-14',
      p_approval_basis: 'Custodian verified capture',
      p_approval_evidence_reference: 'CUS-B10-02',
      p_approval_not_required_reason:
        'Pre-approved council announcement verified by custodian.',
      p_is_provisional: false,
      p_provisional_uncertainty: null,
      p_provisional_update_owner: null,
      p_request_id: randomUUID(),
    })
    const wRelId = randomUUID()
    const wPubRes = await fetch(
      `${config.url}/functions/v1/ea-csc-publish-release`,
      {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${actors.publisher.token}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version_id: pub2v1.versionId,
          expected_version_revision:
            appW.data?.version_revision ??
            appW.data?.revision_counter ??
            pub2v1.versionRevision + 2,
          expected_record_revision:
            appW.data?.record_revision ?? pub2v1.recordRevision,
          release_id: wRelId,
          audience: 'public',
          public_title: 'Batch 10 Withdrawal Test Notice',
          public_category: 'Forms and official information',
          authorization_basis: 'Announcement Release B10-W1',
          authorization_reference: 'ANN-B10-W1',
          effective_from: null,
          request_id: randomUUID(),
        }),
      },
    )
    const wPubJson = await wPubRes.json()
    const wDraw = await actors.publisher.client.rpc('eacsc_withdraw_release', {
      p_release_id: wRelId,
      p_expected_record_revision: wPubJson.record_revision,
      p_withdrawal_reason: 'Superseded emergency test withdrawal.',
      p_request_id: randomUUID(),
    })
    const wDl = await fetch(
      `${config.url}/functions/v1/ea-csc-public-download?record_id=${recPub2}`,
      {
        headers: { Origin: ORIGIN },
      },
    )
    const wNotice = await anon.rpc('eacsc_public_withdrawal_notice', {
      p_record_id: recPub2,
    })
    recordCheck(
      'R2',
      'P01',
      'Emergency withdrawal removes public file access & posts public withdrawal notice',
      !wDraw.error &&
        wDl.status === 404 &&
        Array.isArray(wNotice.data) &&
        wNotice.data.length === 1,
      `dl_status=${wDl.status}, notice=${wNotice.data?.[0]?.notice?.slice(0, 50)}`,
    )

    // Immutability triggers on audit_events, version_verifications, review_comments, mutation_receipts
    const immutResults = []
    for (const stmt of [
      'delete from public.audit_events where event_uuid = (select event_uuid from public.audit_events limit 1)',
      'delete from public.review_comments where comment_id = (select comment_id from public.review_comments limit 1)',
      'delete from public.record_verification_checklists where verification_id = (select verification_id from public.record_verification_checklists limit 1)',
      'delete from eacsc_private.mutation_receipts where request_id = (select request_id from eacsc_private.mutation_receipts limit 1)',
    ]) {
      let blocked = false
      try {
        await pgRw.query(stmt)
      } catch {
        blocked = true
      }
      immutResults.push(blocked)
    }
    recordCheck(
      'R2',
      'D09/D17',
      'Immutability triggers block DELETE on audit_events, review_comments, checklists, and mutation_receipts',
      immutResults.every(Boolean),
      `blocked=${immutResults.join(',')}`,
    )

    // Bulletin workflow (D-01 & D-02): public v1 -> public v2 (corrected) + internal bulletin
    const todayManila = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
    }).format(new Date())
    const cutoffIso = new Date().toISOString()
    const pubCands = await actors.publisher.client.rpc(
      'eacsc_list_bulletin_candidates',
      {
        p_audience: 'public',
        p_coverage_start: todayManila,
        p_cutoff_at: cutoffIso,
      },
    )
    const validPubCands = Array.isArray(pubCands.data) ? pubCands.data : []
    const pubSnap = validPubCands.slice(0, 2).map((c) => ({
      record_id: c.record_id,
      version_id: c.version_id,
      version_number: c.version_number,
      release_id: c.release_id,
      title: c.public_title,
      summary: c.summary_note,
    }))
    const excludesWithdrawn = !validPubCands.some(
      (c) => c.record_id === recPub2,
    )
    const excludesRestricted = !validPubCands.some(
      (c) => c.record_id === recRest,
    )

    const bulV1Bytes = makePdfBytes(`Official Bulletin ${bulPubId} v1`)
    const bulV1Key = `bulletins/${bulPubId}/v1_${randomUUID()}.pdf`
    const bulUp1 = await actors.publisher.client.storage
      .from('verified-council-releases')
      .upload(bulV1Key, bulV1Bytes, {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (bulUp1.error)
      throw new Error(
        `bulletin storage upload v1 failed: ${bulUp1.error.message}`,
      )

    const bulIss1 = await actors.publisher.client.rpc('eacsc_issue_bulletin', {
      p_bulletin_id: bulPubId,
      p_issue_version: 1,
      p_title: 'Batch 10 Public Update Bulletin',
      p_coverage_start: todayManila,
      p_coverage_end: todayManila,
      p_cutoff_at: cutoffIso,
      p_audience: 'public',
      p_source_snapshot: pubSnap,
      p_pdf_storage_key: bulV1Key,
      p_pdf_size_bytes: bulV1Bytes.byteLength,
      p_pdf_sha256: sha256Hex(bulV1Bytes),
      p_publication_reference: 'Issue check: Batch 10 Revalidation Publisher',
      p_issuance_request_id: randomUUID(),
    })
    if (bulIss1.error)
      throw new Error(`issue_bulletin v1 failed: ${bulIss1.error.message}`)

    // Corrected issue v2
    const bulV2Bytes = makePdfBytes(
      `Corrected Official Bulletin ${bulPubId} v2`,
    )
    const bulV2Key = `bulletins/${bulPubId}/v2_${randomUUID()}.pdf`
    const bulUp2 = await actors.publisher.client.storage
      .from('verified-council-releases')
      .upload(bulV2Key, bulV2Bytes, {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (bulUp2.error)
      throw new Error(
        `bulletin storage upload v2 failed: ${bulUp2.error.message}`,
      )

    const bulIss2 = await actors.publisher.client.rpc('eacsc_issue_bulletin', {
      p_bulletin_id: bulPubId,
      p_issue_version: 2,
      p_title: 'Batch 10 Public Update Bulletin (Corrected)',
      p_coverage_start: todayManila,
      p_coverage_end: todayManila,
      p_cutoff_at: cutoffIso,
      p_audience: 'public',
      p_source_snapshot: pubSnap,
      p_pdf_storage_key: bulV2Key,
      p_pdf_size_bytes: bulV2Bytes.byteLength,
      p_pdf_sha256: sha256Hex(bulV2Bytes),
      p_publication_reference:
        'Corrected issue check: Batch 10 Revalidation Publisher',
      p_issuance_request_id: randomUUID(),
      p_corrects_issue_uuid: bulIss1.data.issue_uuid,
      p_correction_reason: 'Clarified effective date formatting in header.',
    })
    if (bulIss2.error)
      throw new Error(`issue_bulletin v2 failed: ${bulIss2.error.message}`)

    // Internal bulletin (must NOT leak to anon public catalog or anonymous Edge download)
    const bulIntBytes = makePdfBytes(`Internal Council Bulletin ${bulIntId} v1`)
    const bulIntKey = `bulletins/${bulIntId}/v1_${randomUUID()}.pdf`
    const bulIntUp = await actors.publisher.client.storage
      .from('verified-council-releases')
      .upload(bulIntKey, bulIntBytes, {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (bulIntUp.error)
      throw new Error(
        `internal bulletin upload failed: ${bulIntUp.error.message}`,
      )

    const bulIntIss = await actors.publisher.client.rpc(
      'eacsc_issue_bulletin',
      {
        p_bulletin_id: bulIntId,
        p_issue_version: 1,
        p_title: 'Batch 10 Internal Council Bulletin',
        p_coverage_start: todayManila,
        p_coverage_end: todayManila,
        p_cutoff_at: cutoffIso,
        p_audience: 'internal',
        p_source_snapshot: pubSnap,
        p_pdf_storage_key: bulIntKey,
        p_pdf_size_bytes: bulIntBytes.byteLength,
        p_pdf_sha256: sha256Hex(bulIntBytes),
        p_publication_reference: 'Internal issue check: Batch 10',
        p_issuance_request_id: randomUUID(),
      },
    )
    if (bulIntIss.error)
      throw new Error(
        `internal issue_bulletin failed: ${bulIntIss.error.message}`,
      )

    const pubBulList = await anon.rpc('eacsc_public_bulletins', {
      p_limit: 50,
      p_offset: 0,
    })
    const seesPublic =
      Array.isArray(pubBulList.data) &&
      pubBulList.data.some(
        (b) => b.bulletin_id === bulPubId && b.issue_version === 2,
      )
    const hidesInternal =
      Array.isArray(pubBulList.data) &&
      !pubBulList.data.some((b) => b.bulletin_id === bulIntId)

    const pubBulDl = await fetch(
      `${config.url}/functions/v1/ea-csc-bulletin-file?bulletin_id=${bulPubId}&issue_version=2`,
      { headers: { Origin: ORIGIN } },
    )
    const pubBulDlBytes = new Uint8Array(await pubBulDl.arrayBuffer())
    const intAnonDl = await fetch(
      `${config.url}/functions/v1/ea-csc-bulletin-file?bulletin_id=${bulIntId}&issue_version=1`,
      { headers: { Origin: ORIGIN } },
    )
    const intAuthDl = await fetch(
      `${config.url}/functions/v1/ea-csc-bulletin-file?bulletin_id=${bulIntId}&issue_version=1`,
      {
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${actors.publisher.token}`,
        },
      },
    )
    recordCheck(
      'R2',
      'D18',
      'Bulletin staging RLS, public v1->v2 issuance, internal isolation, and PDF download',
      excludesWithdrawn &&
        excludesRestricted &&
        seesPublic &&
        hidesInternal &&
        pubBulDl.ok &&
        sha256Hex(pubBulDlBytes) === sha256Hex(bulV2Bytes) &&
        intAnonDl.status === 401 &&
        intAuthDl.ok,
      `public_v2_dl=${pubBulDl.status}, internal_anon=${intAnonDl.status}, internal_auth=${intAuthDl.status}`,
    )

    // ================= R3 CHECKS =================
    const b9Incoming = await signInExisting(
      admin,
      anonKey,
      config.url,
      'batch9-incoming@example.invalid',
    )
    const b9Pkg = await b9Incoming.client.rpc('eacsc_get_turnover_package', {
      p_package_id: '42ad127b-7159-431b-bbc6-8613fa40bcf0',
    })
    const b9Admin = await signInExisting(
      admin,
      anonKey,
      config.url,
      'batch9-admin@example.invalid',
    )
    const negTransfer = await b9Admin.client.rpc(
      'eacsc_transfer_position_role_v2',
      {
        p_package_id: '42ad127b-7159-431b-bbc6-8613fa40bcf0',
        p_expected_revision: 1, // stale / already acknowledged
        p_expected_outgoing_revision: 1,
        p_expected_incoming_revision: 1,
        p_request_id: randomUUID(),
      },
    )
    const outgoingRow = await pgRw.query(
      "select is_active from public.app_users where user_id = 'eb0621e8-6532-43cf-b227-4bef5ca0286d'",
    )
    recordCheck(
      'R3',
      'D11/D12/D13',
      'Retained Batch 9 turnover continuity, outgoing deactivation, and transfer guard',
      !b9Pkg.error &&
        b9Pkg.data?.status === 'acknowledged' &&
        outgoingRow.rows[0]?.is_active === false &&
        Boolean(negTransfer.error),
      `pkg_status=${b9Pkg.data?.status}, outgoing_active=${outgoingRow.rows[0]?.is_active}, neg_transfer_err=${negTransfer.error?.message}`,
    )

    await mkdir(resolve('docs/batch10'), { recursive: true })
    const summary = {
      executed_at: new Date().toISOString(),
      project_ref: PROJECT_REF,
      total_checks: checks.length,
      passed: checks.filter((c) => c.status === 'PASS').length,
      failed: checks.filter((c) => c.status === 'FAIL').length,
      fixtures: {
        recPub1,
        recPub2,
        recRest,
        recSched,
        bulPubId,
        bulIntId,
        retained_batch9_package: '42ad127b-7159-431b-bbc6-8613fa40bcf0',
        retained_missing_object_fixture: 'EACSC-2099-HTTP-9604',
      },
      checks,
    }
    await writeFile(RESULTS_PATH, `${JSON.stringify(summary, null, 2)}\n`)
    console.log(
      `\nALL ${summary.passed}/${summary.total_checks} CHECKS PASSED -> ${RESULTS_PATH}`,
    )
  } finally {
    await pgRw.end().catch(() => undefined)
    await context.cleanup().catch(() => undefined)
  }
}

main().catch((err) => {
  console.error('REVALIDATION FAILED:', err)
  process.exitCode = 1
})
