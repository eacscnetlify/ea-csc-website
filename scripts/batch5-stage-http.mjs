import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { makeTransport, validateConfig } from './batch4-http.mjs'

const config = validateConfig(process.env)
const request = makeTransport(config)
const requestId = randomUUID()
const reportPath = `batch5-stage-${requestId}.local`
const report = {
  request_id: requestId,
  record_id: 'EACSC-2099-HTTP-9601',
  checks: [],
}

const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function fictionalPdf() {
  const text = 'BT /F1 12 Tf 40 100 Td (FICTIONAL EA-CSC STORAGE TEST) Tj ET\n'

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
  }

  const xref = Buffer.byteLength(pdf)
  pdf += 'xref\n0 6\n0000000000 65535 f \n'

  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }

  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

async function check(name, response, ok) {
  report.checks.push({
    name,
    http: response.status,
    result: ok ? 'PASS' : 'FAIL',
  })

  await save()

  if (!ok) {
    const code = String(response.data?.code || '')
    const safeCode = /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'unavailable'

    throw new Error(
      `${name}: HTTP ${response.status}; code ${safeCode}. Stop and keep the report.`,
    )
  }

  console.log(`PASS ${name} (HTTP ${response.status})`)
}

async function main() {
  let password = process.env.BATCH5_AUTHOR_PASSWORD
  delete process.env.BATCH5_AUTHOR_PASSWORD

  if (!password) {
    throw new Error(
      'Enter the fictional Author password through PowerShell first.',
    )
  }

  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  })
  console.log(`Report: ${reportPath}`)

  const signedIn = await request({
    path: '/auth/v1/token?grant_type=password',
    method: 'POST',
    body: { email: 'batch4-author@example.invalid', password },
  })
  password = undefined

  await check(
    'Fictional Author sign-in',
    signedIn,
    signedIn.status === 200 &&
      typeof signedIn.data?.access_token === 'string' &&
      signedIn.data?.user?.email === 'batch4-author@example.invalid' &&
      signedIn.data?.user?.is_anonymous === false,
  )

  const token = signedIn.data.access_token
  const master = await request({
    path: '/rest/v1/master_records?record_id=eq.EACSC-2099-HTTP-9601&select=record_id,revision_counter',
    token,
  })

  await check(
    'Assigned test record is readable',
    master,
    master.status === 200 &&
      Array.isArray(master.data) &&
      master.data.length === 1 &&
      Number.isInteger(master.data[0].revision_counter),
  )

  const bytes = fictionalPdf()
  const hash = sha256(bytes)
  const payload = {
    p_record_id: report.record_id,
    p_expected_record_revision: master.data[0].revision_counter,
    p_original_filename: 'fictional-batch5-stage-test.pdf',
    p_mime_type: 'application/pdf',
    p_file_size_bytes: bytes.length,
    p_sha256: hash,
    p_change_summary:
      'Fictional Batch 5 staging verification; acceptance pending.',
    p_correction_classification: 'legitimate_change',
    p_request_id: requestId,
  }

  report.preparation_payload = payload
  await save()

  const prepared = await request({
    path: '/rest/v1/rpc/eacsc_prepare_version_upload',
    method: 'POST',
    token,
    body: payload,
  })

  const item = prepared.data
  const expectedKey = `quarantine/${signedIn.data.user.id}/${item?.upload_id}.pdf`

  await check(
    'Prepare one private upload request',
    prepared,
    prepared.status === 200 &&
      /^[0-9a-f-]{36}$/.test(item?.upload_id || '') &&
      item?.bucket_id === 'internal-council-records' &&
      item?.staging_key === expectedKey &&
      item?.sha256 === hash &&
      item?.file_size_bytes === bytes.length,
  )

  report.upload_id = item.upload_id
  report.staging_key = item.staging_key
  await save()

  const replay = await request({
    path: '/rest/v1/rpc/eacsc_prepare_version_upload',
    method: 'POST',
    token,
    body: payload,
  })

  await check(
    'Identical preparation returns original acknowledgment',
    replay,
    replay.status === 200 &&
      replay.data?.upload_id === item.upload_id &&
      replay.data?.preparation_event_uuid === item.preparation_event_uuid &&
      replay.data?.expires_at === item.expires_at,
  )

  async function stage(body) {
    const response = await fetch(
      `${config.origin}/functions/v1/ea-csc-stage-upload?upload_id=${item.upload_id}`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(90000),
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/pdf',
        },
        body,
      },
    )

    return {
      status: response.status,
      data: await response.json().catch(() => null),
    }
  }

  const short = await stage(bytes.subarray(0, bytes.length - 1))
  await check(
    'Incorrect byte count is rejected',
    short,
    short.status === 400 && short.data?.code === 'SIZE_MISMATCH',
  )

  const changed = Buffer.from(bytes)
  changed[changed.length - 2] ^= 1

  const wrongHash = await stage(changed)
  await check(
    'Incorrect SHA-256 is rejected',
    wrongHash,
    wrongHash.status === 422 && wrongHash.data?.code === 'CHECKSUM_MISMATCH',
  )

  const isStaged = (r) =>
    r.status === 200 &&
    r.data?.upload_id === item.upload_id &&
    r.data?.status === 'staged' &&
    r.data?.byte_size === bytes.length &&
    r.data?.sha256 === hash &&
    r.data?.accepted_version === false

  const staged = await stage(bytes)
  await check('Valid PDF bytes are staged privately', staged, isStaged(staged))

  const retry = await stage(bytes)
  await check('Identical staging retry succeeds', retry, isStaged(retry))

  const publicPath = item.staging_key
    .split('/')
    .map(encodeURIComponent)
    .join('/')

  const publicResponse = await fetch(
    `${config.origin}/storage/v1/object/public/internal-council-records/${publicPath}`,
    { redirect: 'error', signal: AbortSignal.timeout(20000) },
  )
  await publicResponse.body?.cancel()

  await check(
    'Public URL cannot retrieve the staged object',
    { status: publicResponse.status },
    [400, 401, 403, 404].includes(publicResponse.status),
  )

  report.completed = true
  await save()
  console.log(
    'PASS staging checks completed. No official version was accepted.',
  )
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Test stopped.')
  console.error(`Keep ${reportPath}; do not rerun after an uncertain write.`)
  process.exitCode = 1
} finally {
  if (report.checks.length) await save()
}
