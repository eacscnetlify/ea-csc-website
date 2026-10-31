import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { makeTransport, validateConfig } from './batch4-http.mjs'

const config = validateConfig(process.env)
const request = makeTransport(config)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const args = process.argv.slice(2)

if (args.length && (args.length !== 2 || args[0] !== '--resume')) {
  throw new Error(
    'Use no arguments, or --resume followed by the existing report filename.',
  )
}

const reportPath = args[1] ?? `batch5-accept-${randomUUID()}.local`
let report

const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function fictionalPdf() {
  const text =
    'BT /F1 12 Tf 40 100 Td (FICTIONAL EA-CSC ACCEPTANCE TEST) Tj ET\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = []

  for (const [i, value] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${i + 1} 0 obj\n${value}\nendobj\n`
  }

  const xref = Buffer.byteLength(pdf)
  pdf += 'xref\n0 6\n0000000000 65535 f \n'

  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }

  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

async function check(name, response, passed) {
  report.checks.push({
    name,
    http: response.status,
    result: passed ? 'PASS' : 'FAIL',
  })

  await save()

  if (!passed) {
    const code = String(response.data?.code ?? '')
    throw new Error(
      `${name}: HTTP ${response.status}; code ${
        /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'unavailable'
      }.`,
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

  if (args.length) {
    const loaded = JSON.parse(await readFile(reportPath, 'utf8'))

    if (
      loaded.kind !== 'batch5-accept-v1' ||
      loaded.record_id !== 'EACSC-2099-HTTP-9601' ||
      !Array.isArray(loaded.checks) ||
      !loaded.jobs ||
      !['invalid', 'valid'].every(
        (k) =>
          UUID.test(loaded.jobs[k]?.prepare_id ?? '') &&
          UUID.test(loaded.jobs[k]?.accept_id ?? ''),
      )
    ) {
      throw new Error('This is not a recognized Batch 5 acceptance report.')
    }

    report = loaded
  } else {
    report = {
      kind: 'batch5-accept-v1',
      record_id: 'EACSC-2099-HTTP-9601',
      checks: [],
      jobs: {
        invalid: { prepare_id: randomUUID(), accept_id: randomUUID() },
        valid: { prepare_id: randomUUID(), accept_id: randomUUID() },
      },
    }

    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    })
  }

  console.log(`Report: ${reportPath}`)

  const signedOut = await request({
    path: `/functions/v1/ea-csc-stage-upload?action=accept&upload_id=${report.jobs.valid.prepare_id}&request_id=${report.jobs.valid.accept_id}`,
    method: 'POST',
  })

  await check(
    'Signed-out acceptance is denied',
    signedOut,
    signedOut.status === 401,
  )

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
  const masterPath =
    '/rest/v1/master_records?record_id=eq.EACSC-2099-HTTP-9601&select=record_id,revision_counter'

  const master = await request({ path: masterPath, token })

  await check(
    'Assigned fixture is readable',
    master,
    master.status === 200 &&
      Array.isArray(master.data) &&
      master.data.length === 1 &&
      Number.isInteger(master.data[0].revision_counter),
  )

  async function edge(job, action, bytes) {
    const response = await fetch(
      `${config.origin}/functions/v1/ea-csc-stage-upload?upload_id=${job.prepared.upload_id}&action=${action}&request_id=${job.accept_id}`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(90000),
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${token}`,
          ...(bytes ? { 'Content-Type': 'application/pdf' } : {}),
        },
        ...(bytes ? { body: bytes } : {}),
      },
    )

    return {
      status: response.status,
      data: await response.json().catch(() => null),
    }
  }

  async function prepare(job, bytes, label) {
    job.payload ??= {
      p_record_id: report.record_id,
      p_expected_record_revision: master.data[0].revision_counter,
      p_original_filename: `fictional-batch5-${label}.pdf`,
      p_mime_type: 'application/pdf',
      p_file_size_bytes: bytes.length,
      p_sha256: sha256(bytes),
      p_change_summary: `Fictional Batch 5 ${label} acceptance verification.`,
      p_correction_classification: 'legitimate_change',
      p_request_id: job.prepare_id,
    }

    if (
      job.payload.p_record_id !== report.record_id ||
      job.payload.p_request_id !== job.prepare_id ||
      job.payload.p_sha256 !== sha256(bytes) ||
      job.payload.p_file_size_bytes !== bytes.length
    ) {
      throw new Error(
        'Report file facts do not match this test. Keep the report for inspection.',
      )
    }

    await save()

    const response = await request({
      path: '/rest/v1/rpc/eacsc_prepare_version_upload',
      method: 'POST',
      token,
      body: job.payload,
    })

    const item = response.data

    await check(
      `${label}: preparation acknowledged`,
      response,
      response.status === 200 &&
        UUID.test(item?.upload_id ?? '') &&
        UUID.test(item?.proposed_version_id ?? '') &&
        item?.record_id === report.record_id &&
        item?.sha256 === sha256(bytes) &&
        item?.bucket_id === 'internal-council-records' &&
        item?.file_size_bytes === bytes.length,
    )

    job.prepared = item
    await save()
  }

  async function stage(job, bytes, label) {
    const response = await edge(job, 'stage', bytes)

    await check(
      `${label}: bytes staged privately`,
      response,
      response.status === 200 &&
        response.data?.status === 'staged' &&
        response.data?.accepted_version === false &&
        response.data?.sha256 === sha256(bytes),
    )
  }

  const invalid = report.jobs.invalid

  if (!invalid.rejected) {
    const bytes = Buffer.from('FICTIONAL PLAIN TEXT. THIS IS NOT A PDF.\n')

    await prepare(invalid, bytes, 'invalid-format')
    await stage(invalid, bytes, 'invalid-format')

    const rejected = await edge(invalid, 'accept')

    await check(
      'Plain text labeled PDF is rejected before acceptance',
      rejected,
      rejected.status === 422 && rejected.data?.code === 'INVALID_PDF',
    )

    invalid.rejected = true
    await save()
  }

  const valid = report.jobs.valid
  const bytes = fictionalPdf()

  await prepare(valid, bytes, 'valid-pdf')

  const context = await request({
    path: '/rest/v1/rpc/eacsc_get_upload_acceptance',
    method: 'POST',
    token,
    body: {
      p_upload_id: valid.prepared.upload_id,
      p_request_id: valid.accept_id,
    },
  })

  await check(
    'Acceptance context is ready or already completed',
    context,
    context.status === 200 &&
      ['ready', 'accepted'].includes(context.data?.status),
  )

  const direct = await request({
    path: '/rest/v1/rpc/eacsc_accept_version_upload',
    method: 'POST',
    token,
    body: {
      p_actor_user_id: signedIn.data.user.id,
      p_upload_id: valid.prepared.upload_id,
      p_request_id: valid.accept_id,
      p_storage_object_id: randomUUID(),
      p_verified_mime_type: 'application/pdf',
      p_verified_file_size_bytes: bytes.length,
      p_verified_sha256: sha256(bytes),
      p_verifier_version: 'eacsc-pdf-structure-v1',
    },
  })

  await check(
    'Browser identity cannot invoke backend acceptance directly',
    direct,
    (direct.status === 403 && direct.data?.code === '42501') ||
      (direct.status === 404 && direct.data?.code === 'PGRST202'),
  )

  if (context.data.status === 'ready') {
    await stage(valid, bytes, 'valid-pdf')
  }

  const accepted = await edge(valid, 'accept')
  const ack = accepted.data

  await check(
    'Verified PDF accepted as the proposed Draft',
    accepted,
    accepted.status === 200 &&
      ack?.accepted_version === true &&
      ack?.status === 'accepted' &&
      ack?.upload_id === valid.prepared.upload_id &&
      ack?.state === 'Draft' &&
      ack?.version_id === valid.prepared.proposed_version_id &&
      ack?.version_number === valid.prepared.proposed_version_number &&
      ack?.request_id === valid.accept_id &&
      UUID.test(ack?.audit_event_uuid ?? ''),
  )

  valid.accepted = ack
  await save()

  const retry = await edge(valid, 'accept')

  await check(
    'Identical acceptance retry returns the same version and audit',
    retry,
    retry.status === 200 &&
      retry.data?.version_id === ack.version_id &&
      retry.data?.audit_event_uuid === ack.audit_event_uuid &&
      retry.data?.record_revision === ack.record_revision &&
      retry.data?.request_id === valid.accept_id,
  )

  const version = await request({
    path: `/rest/v1/record_versions?version_id=eq.${ack.version_id}&select=version_id,record_id,version_number,state,revision_counter`,
    token,
  })

  await check(
    'Exactly one proposed Draft is readable',
    version,
    version.status === 200 &&
      Array.isArray(version.data) &&
      version.data.length === 1 &&
      version.data[0].state === 'Draft' &&
      version.data[0].revision_counter === 1,
  )

  const rejectedVersion = await request({
    path: `/rest/v1/record_versions?version_id=eq.${invalid.prepared.proposed_version_id}&select=version_id`,
    token,
  })

  await check(
    'Rejected file created no official version',
    rejectedVersion,
    rejectedVersion.status === 200 &&
      Array.isArray(rejectedVersion.data) &&
      rejectedVersion.data.length === 0,
  )

  const after = await request({ path: masterPath, token })

  await check(
    'Master revision advanced exactly once',
    after,
    after.status === 200 &&
      after.data?.[0]?.revision_counter ===
        valid.payload.p_expected_record_revision + 1,
  )

  const path = valid.prepared.destination_key
    .split('/')
    .map(encodeURIComponent)
    .join('/')

  for (const mode of ['public', 'authenticated']) {
    const response = await fetch(
      `${config.origin}/storage/v1/object/${mode}/internal-council-records/${path}`,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        ...(mode === 'authenticated'
          ? {
              headers: { apikey: config.key, Authorization: `Bearer ${token}` },
            }
          : {}),
      },
    )

    await response.body?.cancel()

    await check(
      `${mode}: direct final-file download is denied`,
      { status: response.status },
      [400, 401, 403, 404].includes(response.status),
    )
  }

  report.completed = true
  await save()

  console.log(
    'PASS acceptance checks completed. One fictional Draft was accepted; no approval or publication was requested.',
  )
  console.log(`Invalid preparation request: ${invalid.prepare_id}`)
  console.log(`Valid preparation request: ${valid.prepare_id}`)
  console.log(`Acceptance request: ${valid.accept_id}`)
  console.log(`Accepted version: ${ack.version_id}`)
  console.log(`Report: ${reportPath}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Test stopped.')
  console.error(
    `Keep ${reportPath}. Resume with --resume and this filename; do not start another fresh run.`,
  )
  process.exitCode = 1
}
