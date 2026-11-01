import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import { makeTransport, validateConfig } from './batch4-http.mjs'

export async function runReviewChecks({
  request,
  passwords,
  report,
  save,
  log = console.log,
}) {
  const tokens = {}
  const users = {}
  const record = 'EACSC-2099-HTTP-9601'

  async function check(name, response, passed) {
    report.checks.push({
      name,
      http: response.status,
      result: passed ? 'PASS' : 'FAIL',
    })
    await save()
    if (!passed)
      throw new Error(
        `${name}: HTTP ${response.status}. Stop and keep the report.`,
      )
    log(`PASS ${name} (HTTP ${response.status})`)
  }

  async function rpc(role, name, body) {
    report.commands.push({ role, name, body })
    await save() // Preserve request IDs before a write could commit.
    return request({
      path: `/rest/v1/rpc/${name}`,
      method: 'POST',
      token: tokens[role],
      body,
    })
  }

  const get = (role, path) =>
    request({ path: `/rest/v1/${path}`, token: tokens[role] })

  const denied = async (name, response, status, code) =>
    check(
      name,
      response,
      response.status === status && response.data?.code === code,
    )

  const submit = 'eacsc_submit_version_for_review'
  const back = 'eacsc_return_version_for_correction'

  for (const [role, email] of [
    ['author', 'batch4-author@example.invalid'],
    ['reviewer', 'batch6-reviewer@example.invalid'],
  ]) {
    const password = passwords[role]
    delete passwords[role]
    if (!password) throw new Error(`Missing fictional ${role} password.`)

    const r = await request({
      path: '/auth/v1/token?grant_type=password',
      method: 'POST',
      body: { email, password },
    })
    await check(
      `${role} sign-in`,
      r,
      r.status === 200 &&
        typeof r.data?.access_token === 'string' &&
        r.data.user?.email === email &&
        r.data.user?.is_anonymous === false,
    )
    tokens[role] = r.data.access_token
    users[role] = r.data.user.id
  }

  const versionPath =
    `record_versions?record_id=eq.${record}&version_number=eq.6` +
    '&select=version_id,version_number,state,revision_counter,change_summary,previous_version_id,approved_at'
  const masterPath = `master_records?record_id=eq.${record}&select=revision_counter`

  const loaded = await get('author', versionPath)
  await check(
    'Version 6 is an editable Draft',
    loaded,
    loaded.status === 200 &&
      loaded.data?.length === 1 &&
      loaded.data[0].state === 'Draft' &&
      Number.isInteger(loaded.data[0].revision_counter) &&
      loaded.data[0].approved_at === null,
  )
  const v = loaded.data[0]

  const master = await get('author', masterPath)
  await check(
    'Master revision is readable',
    master,
    master.status === 200 &&
      master.data?.length === 1 &&
      Number.isInteger(master.data[0].revision_counter),
  )

  const fileBody = { p_version_id: v.version_id }
  const file = await rpc('author', 'eacsc_get_version_file', fileBody)
  await check(
    'Accepted attachment is available before review',
    file,
    file.status === 200 &&
      file.data?.version_id === v.version_id &&
      /^[0-9a-f]{64}$/.test(file.data.sha256 ?? ''),
  )

  const a = {
    p_version_id: v.version_id,
    p_expected_revision: v.revision_counter,
    p_request_id: randomUUID(),
  }
  const b = {
    p_version_id: v.version_id,
    p_expected_revision: v.revision_counter + 1,
    p_comment:
      'Fictional review: confirm venue and contact details before resubmission.',
    p_request_id: randomUUID(),
  }

  report.baseline = {
    version: v,
    record_revision: master.data[0].revision_counter,
  }
  report.submit = a
  report.return = b
  await save()

  await denied(
    'Signed-out submission is denied',
    await rpc('signed-out', submit, a),
    401,
    '42501',
  )
  await denied(
    'Reviewer cannot submit as Author',
    await rpc('reviewer', submit, a),
    403,
    '42501',
  )
  await denied(
    'Author cannot return as Reviewer',
    await rpc('author', back, b),
    403,
    '42501',
  )
  await denied(
    'Stale submission is rejected',
    await rpc('author', submit, {
      ...a,
      p_expected_revision: v.revision_counter + 1,
      p_request_id: randomUUID(),
    }),
    409,
    'PT409',
  )

  const sent = await rpc('author', submit, a)
  await check(
    'Author submits the exact Draft',
    sent,
    sent.status === 200 &&
      sent.data?.state === 'For Review' &&
      sent.data.version_id === v.version_id &&
      sent.data.request_id === a.p_request_id &&
      sent.data.revision_counter === v.revision_counter + 1 &&
      sent.data.record_revision === master.data[0].revision_counter + 1 &&
      typeof sent.data.audit_event_uuid === 'string',
  )

  const retry = await rpc('author', submit, a)
  await check(
    'Submission retry returns the original receipt',
    retry,
    retry.status === 200 && isDeepStrictEqual(retry.data, sent.data),
  )

  const hidden = await get('author', versionPath)
  await check(
    'Author scope hides the submitted version',
    hidden,
    hidden.status === 200 && hidden.data?.length === 0,
  )
  await denied(
    'Author attachment access is denied during review',
    await rpc('author', 'eacsc_get_version_file', fileBody),
    403,
    '42501',
  )

  const reviewFile = await rpc('reviewer', 'eacsc_get_version_file', fileBody)
  await check(
    'Assigned Reviewer can inspect attachment facts',
    reviewFile,
    reviewFile.status === 200 &&
      reviewFile.data?.sha256 === file.data.sha256 &&
      reviewFile.data?.state === 'For Review',
  )

  await denied(
    'Blank return comments are rejected',
    await rpc('reviewer', back, {
      ...b,
      p_comment: '   ',
      p_request_id: randomUUID(),
    }),
    400,
    '22023',
  )
  await denied(
    'Stale return is rejected',
    await rpc('reviewer', back, {
      ...b,
      p_expected_revision: v.revision_counter,
      p_request_id: randomUUID(),
    }),
    409,
    'PT409',
  )

  const returned = await rpc('reviewer', back, b)
  await check(
    'Reviewer returns the version with comments',
    returned,
    returned.status === 200 &&
      returned.data?.state === 'Draft' &&
      returned.data.version_id === v.version_id &&
      returned.data.request_id === b.p_request_id &&
      returned.data.revision_counter === v.revision_counter + 2 &&
      returned.data.record_revision === master.data[0].revision_counter + 2 &&
      typeof returned.data.comment_id === 'string',
  )

  const repeat = await rpc('reviewer', back, b)
  await check(
    'Return retry returns the original receipt',
    repeat,
    repeat.status === 200 && isDeepStrictEqual(repeat.data, returned.data),
  )
  await denied(
    'Changed return retry is rejected',
    await rpc('reviewer', back, {
      ...b,
      p_comment: 'Changed retry payload.',
    }),
    400,
    '22023',
  )

  const visible = await get('author', versionPath)
  await check(
    'Returned Draft preserves notes and predecessor',
    visible,
    visible.status === 200 &&
      visible.data?.length === 1 &&
      visible.data[0].state === 'Draft' &&
      visible.data[0].revision_counter === v.revision_counter + 2 &&
      visible.data[0].change_summary === v.change_summary &&
      visible.data[0].previous_version_id === v.previous_version_id &&
      visible.data[0].approved_at === null,
  )

  const comments = await get(
    'author',
    `review_comments?comment_id=eq.${returned.data.comment_id}&select=*`,
  )
  const c = comments.data?.[0]
  await check(
    'Author reads the exact retained review comment',
    comments,
    comments.status === 200 &&
      comments.data?.length === 1 &&
      c.version_id === v.version_id &&
      c.actor_user_id === users.reviewer &&
      c.request_id === b.p_request_id &&
      c.comment_text === b.p_comment &&
      c.reviewed_revision === v.revision_counter + 1 &&
      c.returned_revision === v.revision_counter + 2 &&
      c.audit_event_uuid === returned.data.audit_event_uuid,
  )

  const restored = await rpc('author', 'eacsc_get_version_file', fileBody)
  await check(
    'Returned Draft retains accepted attachment facts',
    restored,
    restored.status === 200 &&
      [
        'storage_key',
        'sha256',
        'file_size_bytes',
        'mime_type',
        'original_filename',
      ].every((k) => restored.data?.[k] === file.data[k]),
  )

  const final = await get('author', masterPath)
  await check(
    'Master revision advances exactly twice',
    final,
    final.status === 200 &&
      final.data?.[0]?.revision_counter === master.data[0].revision_counter + 2,
  )

  report.completed = true
  await save()
  log(
    'PASS review checks completed. Version 6 is back in Draft; one review comment is retained.',
  )
}

async function main() {
  const passwords = {
    author: process.env.BATCH6_AUTHOR_PASSWORD,
    reviewer: process.env.BATCH6_REVIEWER_PASSWORD,
  }
  delete process.env.BATCH6_AUTHOR_PASSWORD
  delete process.env.BATCH6_REVIEWER_PASSWORD

  const request = makeTransport(validateConfig(process.env))
  const reportPath = `batch6-review-${randomUUID()}.local`
  const report = { checks: [], commands: [] }
  const save = () =>
    writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')

  await writeFile(reportPath, JSON.stringify(report) + '\n', { flag: 'wx' })
  console.log(`Report: ${reportPath}`)
  await runReviewChecks({ request, passwords, report, save })
  console.log(`Report: ${reportPath}`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Review checks stopped.',
    )
    console.error(
      'Do not rerun after a failure; send the terminal result and keep the .local report.',
    )
    process.exitCode = 1
  })
}
