import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { makeTransport, validateConfig } from './batch4-http.mjs'

const config = validateConfig(process.env)
const request = makeTransport(config)
const versionId = '7d507bee-4635-476f-85ce-ab836f7c6c60'
const reportPath = `batch5-download-${randomUUID()}.local`
const report = { version_id: versionId, checks: [] }

const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function check(name, response, passed) {
  report.checks.push({
    name,
    http: response.status,
    result: passed ? 'PASS' : 'FAIL',
  })
  await save()

  if (!passed) {
    throw new Error(`${name}: HTTP ${response.status}. Keep the report.`)
  }
  console.log(`PASS ${name} (HTTP ${response.status})`)
}

async function download(id, token, origin) {
  const response = await fetch(
    `${config.origin}/functions/v1/ea-csc-download-file?version_id=${id}`,
    {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(90000),
      headers: {
        apikey: config.key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
    },
  )

  return {
    status: response.status,
    headers: response.headers,
    bytes: Buffer.from(await response.arrayBuffer()),
  }
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

  const signedOut = await download(versionId)
  await check(
    'Signed-out download is denied',
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
    '/rest/v1/master_records?record_id=eq.EACSC-2099-HTTP-9601&select=revision_counter'

  const before = await request({ path: masterPath, token })

  await check(
    'Assigned fixture revision is readable',
    before,
    before.status === 200 &&
      Array.isArray(before.data) &&
      before.data.length === 1 &&
      Number.isInteger(before.data[0].revision_counter),
  )

  const facts = await request({
    path: '/rest/v1/rpc/eacsc_get_version_file',
    method: 'POST',
    token,
    body: { p_version_id: versionId },
  })

  await check(
    'Authorized accepted-file metadata is available',
    facts,
    facts.status === 200 &&
      facts.data?.version_id === versionId &&
      facts.data?.mime_type === 'application/pdf' &&
      facts.data?.bucket_id === 'internal-council-records' &&
      Number.isInteger(facts.data?.file_size_bytes) &&
      /^[0-9a-f]{64}$/.test(facts.data?.sha256 ?? ''),
  )

  const received = await download(versionId, token, 'http://localhost:5173')

  await check(
    'Assigned Author downloads the exact accepted PDF bytes',
    received,
    received.status === 200 &&
      received.bytes.length === facts.data.file_size_bytes &&
      hash(received.bytes) === facts.data.sha256 &&
      received.headers.get('content-type') === 'application/pdf',
  )

  await check(
    'Download is an attachment with caching disabled',
    received,
    received.headers.get('content-disposition')?.startsWith('attachment;') &&
      received.headers.get('cache-control')?.includes('no-store') &&
      received.headers.get('x-content-type-options') === 'nosniff' &&
      received.headers.get('x-content-sha256') === facts.data.sha256 &&
      received.headers.get('access-control-allow-origin') ===
        'http://localhost:5173',
  )

  const repeat = await download(versionId, token)

  await check(
    'Repeated authorized download preserves the same bytes',
    repeat,
    repeat.status === 200 && repeat.bytes.equals(received.bytes),
  )

  const invalidToken = await download(versionId, 'fictional-invalid-token')

  await check(
    'Invalid sign-in token is denied',
    invalidToken,
    invalidToken.status === 401,
  )

  for (const [name, id, expected] of [
    ['Unassigned record', 'b4000000-0000-4000-8000-000000009603', 403],
    [
      'Restricted record without permission',
      'b4000000-0000-4000-8000-000000009602',
      403,
    ],
    [
      'For Review version outside Author scope',
      'b4000000-0000-4000-8000-000000009604',
      403,
    ],
    [
      'Draft without an accepted attachment',
      'b4000000-0000-4000-8000-000000009601',
      409,
    ],
    ['Unknown version', 'd5900000-0000-4000-8000-000000000099', 403],
  ]) {
    const denied = await download(id, token)

    await check(
      `${name} is denied`,
      denied,
      denied.status === expected &&
        denied.headers.get('content-type')?.includes('application/json'),
    )
  }

  const wrongOrigin = await download(
    versionId,
    token,
    'https://unapproved.invalid',
  )

  await check(
    'Unapproved browser origin is denied',
    wrongOrigin,
    wrongOrigin.status === 403,
  )

  const path = facts.data.storage_key
    .split('/')
    .map(encodeURIComponent)
    .join('/')

  const direct = await fetch(
    `${config.origin}/storage/v1/object/authenticated/internal-council-records/${path}`,
    {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${token}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    },
  )
  await direct.body?.cancel()

  await check(
    'Direct Storage download remains denied',
    { status: direct.status },
    [400, 401, 403, 404].includes(direct.status),
  )

  const after = await request({ path: masterPath, token })

  await check(
    'Downloads do not change the master revision',
    after,
    after.status === 200 &&
      after.data?.[0]?.revision_counter === before.data[0].revision_counter,
  )

  report.completed = true
  await save()

  console.log(
    'PASS officer download checks completed. No content mutation was requested.',
  )
  console.log(`Report: ${reportPath}`)
}

try {
  await main()
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Download test stopped.',
  )
  process.exitCode = 1
}
