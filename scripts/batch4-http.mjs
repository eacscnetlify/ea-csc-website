// Revision 2: application edit conflicts use PT409 / HTTP 409.
// Raw HTTP integration checks: Node 24+, no SDK and no privileged key.
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

export const DEV_ORIGIN = 'https://gkhhwrrvqlzpayphvsqp.supabase.co'
export const record = (n) => `EACSC-2099-HTTP-${n}`
export const version = (n) => `b4000000-0000-4000-8000-00000000${n}`
const actors = ['author', 'custodian', 'inactive', 'no-profile']
const columns =
  'version_id,record_id,state,change_summary,revision_counter,updated_at'
const responseKeys = [
  'audit_event_uuid',
  'change_summary',
  'record_id',
  'request_id',
  'revision_counter',
  'state',
  'updated_at',
  'version_id',
]
const equal = (a, b) =>
  JSON.stringify(sortObject(a)) === JSON.stringify(sortObject(b))
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortObject(v)]),
    )
  return value
}

export function validateConfig(config) {
  let url
  try {
    url = new URL(config.VITE_SUPABASE_URL)
  } catch {
    throw new Error('Invalid development Supabase URL in .env.local.')
  }
  if (
    url.origin !== DEV_ORIGIN ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      'This runner is restricted to the existing ea-csc-website-dev project.',
    )
  if (
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(
      config.VITE_SUPABASE_PUBLISHABLE_KEY || '',
    )
  )
    throw new Error(
      'Use the publishable key from .env.local. Privileged and legacy keys are not accepted.',
    )
  return { origin: url.origin, key: config.VITE_SUPABASE_PUBLISHABLE_KEY }
}

export function makeTransport({ origin, key }, fetchFn = fetch) {
  return async ({ path, token, method = 'GET', body, schema }) => {
    const headers = { apikey: key, Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (schema) headers['Accept-Profile'] = schema
    let res
    try {
      res = await fetchFn(origin + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      })
    } catch (error) {
      const failureName = ['TimeoutError', 'AbortError'].includes(error?.name)
        ? error.name
        : 'NetworkError'
      const causeCode =
        typeof error?.cause?.code === 'string' &&
        /^(?:E[A-Z0-9_]{1,40}|UND_ERR_[A-Z0-9_]{1,40})$/.test(error.cause.code)
          ? error.cause.code
          : 'unavailable'
      throw new Error(
        `HTTP request failed (${failureName}; cause ${causeCode}). A write may have committed. Keep the report and inspect before continuing; the runner does not automatically resend writes.`,
      )
    }
    let data = null
    try {
      data = await res.json()
    } catch {
      /* A non-JSON error must fail the expected-code checks. */
    }
    return { status: res.status, data }
  }
}

export async function runSuite({
  request,
  passwords,
  prompt,
  report,
  log = console.log,
}) {
  const sessions = {}
  let profileMayBeInactive = false
  const check = (name, passed, detail = '') => {
    report.checks.push({
      name,
      passed: passed === true,
      ...(detail ? { detail } : {}),
    })
    if (passed !== true)
      throw new Error(`${name}${detail ? ': ' + detail : ''}`)
    log(`PASS ${name}`)
  }
  const call = (actor, path, opts = {}) =>
    request({ path, token: sessions[actor]?.token, ...opts })
  const get = (actor, table, query) => call(actor, `/rest/v1/${table}?${query}`)
  const rows = (name, result) => {
    check(
      name,
      result.status === 200 && Array.isArray(result.data),
      `HTTP ${result.status}`,
    )
    return result.data
  }
  const denied = (name, result, code = '42501', status = 403) =>
    check(
      name,
      result.status === status && result.data?.code === code,
      `HTTP ${result.status}; code ${result.data?.code || 'missing'}`,
    )
  const input = (n, rev, notes, id = randomUUID()) => ({
    p_version_id: version(n),
    p_expected_revision: rev,
    p_change_summary: notes,
    p_request_id: id,
  })
  const rpc = (actor, body) => {
    report.attempted_commands ??= []
    report.attempted_commands.push({ actor: actor || 'signed-out', ...body })
    return call(actor, '/rest/v1/rpc/eacsc_update_draft_notes', {
      method: 'POST',
      body,
    })
  }
  const concurrent = async (requests) => {
    const results = await Promise.allSettled(requests)
    const failed = results.find((r) => r.status === 'rejected')
    if (failed) throw failed.reason
    return results.map((r) => r.value)
  }
  const note = (label) => `HTTP/${report.run_id}/${label}`
  const readVersion = async (actor, n) => {
    const found = rows(
      `${actor} reads version ${n}`,
      await get(
        actor,
        'record_versions',
        `select=${columns}&version_id=eq.${version(n)}`,
      ),
    )
    check(
      `Version ${n} has exactly one visible row for ${actor}`,
      found.length === 1,
    )
    return found[0]
  }
  const saved = (name, actor, body, result) => {
    const data = result.data
    check(
      name,
      result.status === 200 &&
        data &&
        !Array.isArray(data) &&
        equal(Object.keys(data).sort(), responseKeys) &&
        data.version_id === body.p_version_id &&
        data.state === 'Draft' &&
        data.change_summary === body.p_change_summary.trim() &&
        data.revision_counter === body.p_expected_revision + 1 &&
        data.request_id === body.p_request_id &&
        /^[0-9a-f-]{36}$/i.test(data.audit_event_uuid) &&
        Number.isFinite(Date.parse(data.updated_at)),
      `HTTP ${result.status}; code ${data?.code || 'none'}`,
    )
    report.successful_commands.push({ actor, ...body, response: data })
    return data
  }
  try {
    // Sign in once per fixture; tokens are never refreshed during the suite.
    for (const actor of actors) {
      let password = passwords[actor]
      delete passwords[actor]
      const result = await request({
        path: '/auth/v1/token?grant_type=password',
        method: 'POST',
        body: { email: `batch4-${actor}@example.invalid`, password },
      })
      password = undefined
      if (
        result.status !== 200 ||
        typeof result.data?.access_token !== 'string' ||
        !result.data.user?.id ||
        result.data.user?.is_anonymous !== false
      )
        throw new Error(
          `Fixture ${actor} sign-in failed (HTTP ${result.status}). Check its private password and confirmed Auth account.`,
        )
      sessions[actor] = {
        token: result.data.access_token,
        user: result.data.user.id,
      }
      check(`${actor} signs in as a permanent Auth user`, true)
    }
    const own = rows(
      'Author profile query succeeds',
      await get(
        'author',
        'app_users',
        `select=user_id,is_active,functional_roles&user_id=eq.${sessions.author.user}`,
      ),
    )
    check(
      'Author profile is active with the author function',
      own.length === 1 &&
        own[0].is_active === true &&
        equal(own[0].functional_roles, ['author']),
    )
    const custodian = rows(
      'Custodian profile query succeeds',
      await get(
        'custodian',
        'app_users',
        `select=user_id,is_active,functional_roles&user_id=eq.${sessions.custodian.user}`,
      ),
    )
    check(
      'Custodian profile has the expected active function',
      custodian.length === 1 &&
        custodian[0].is_active &&
        equal(custodian[0].functional_roles, ['custodian']),
    )
    check(
      'Author cannot read another officer profile',
      rows(
        'Cross-profile query succeeds',
        await get(
          'author',
          'app_users',
          `select=user_id&user_id=eq.${sessions.custodian.user}`,
        ),
      ).length === 0,
    )
    denied(
      'Profile email column remains private',
      await get('author', 'app_users', 'select=email'),
    )
    for (const actor of ['inactive', 'no-profile']) {
      const profiles = rows(
        `${actor} profile status query succeeds`,
        await get(actor, 'app_users', 'select=user_id,is_active'),
      )
      check(
        `${actor} profile is inactive or absent`,
        actor === 'inactive'
          ? profiles.length === 1 && profiles[0].is_active === false
          : profiles.length === 0,
      )
      check(
        `${actor} cannot read fixture records`,
        rows(
          `${actor} record query succeeds`,
          await get(
            actor,
            'master_records',
            'select=record_id&record_id=like.EACSC-2099-HTTP-*',
          ),
        ).length === 0,
      )
      denied(
        `${actor} cannot mutate Draft notes`,
        await rpc(actor, input(9601, 1, note(actor))),
      )
    }
    for (const table of [
      'master_records',
      'record_versions',
      'record_assignments',
      'audit_events',
    ]) {
      denied(
        `Signed-out caller cannot directly read ${table}`,
        await get(
          null,
          table,
          `select=${table === 'audit_events' ? 'event_uuid' : 'record_id'}&limit=1`,
        ),
        '42501',
        401,
      )
    }
    denied(
      'Signed-out caller cannot call the write RPC',
      await rpc(null, input(9601, 1, note('signed-out'))),
      '42501',
      401,
    )
    const invalid = await request({
      path: '/rest/v1/master_records?select=record_id&limit=1',
      token: 'invalid-test-token',
    })
    check('Malformed bearer token is rejected', invalid.status === 401)
    const visible = rows(
      'Author fixture master query succeeds',
      await get(
        'author',
        'master_records',
        'select=record_id&record_id=like.EACSC-2099-HTTP-*&order=record_id',
      ),
    )
    check(
      'Author sees only assigned unrestricted fixture masters',
      equal(
        visible.map((r) => r.record_id),
        [record(9601), record(9604)],
      ),
    )
    const assignments = rows(
      'Author assignment query succeeds',
      await get(
        'author',
        'record_assignments',
        'select=record_id,user_id,assignment_function&record_id=like.EACSC-2099-HTTP-*',
      ),
    )
    check(
      'Author sees only own permitted assignments',
      assignments.length === 2 &&
        assignments.every(
          (r) =>
            r.user_id === sessions.author.user &&
            r.assignment_function === 'author' &&
            [record(9601), record(9604)].includes(r.record_id),
        ),
    )
    check(
      'Author cannot read a For Review version',
      rows(
        'Author For Review query succeeds',
        await get(
          'author',
          'record_versions',
          `select=${columns}&version_id=eq.${version(9604)}`,
        ),
      ).length === 0,
    )
    check(
      'Assigned custodian can read For Review',
      (await readVersion('custodian', 9604)).state === 'For Review',
    )
    denied(
      'Author cannot mutate For Review',
      await rpc('author', input(9604, 1, note('review'))),
      '55000',
      500,
    )
    for (const n of [9602, 9603, 9605]) {
      check(
        `Author cannot read denied version ${n}`,
        rows(
          `Denied version query ${n} succeeds`,
          await get(
            'author',
            'record_versions',
            `select=${columns}&version_id=eq.${version(n)}`,
          ),
        ).length === 0,
      )
      denied(
        `Author cannot mutate denied version ${n}`,
        await rpc('author', input(n, 1, note(`denied-${n}`))),
      )
    }
    denied(
      'Version storage key is not exposed',
      await get('author', 'record_versions', 'select=storage_key&limit=1'),
    )
    denied(
      'Version approval evidence is not exposed',
      await get(
        'custodian',
        'record_versions',
        'select=approval_evidence_reference&limit=1',
      ),
    )
    denied(
      'Audit history has no direct application read grant',
      await get('author', 'audit_events', 'select=event_uuid&limit=1'),
    )
    const privateSchema = await call(
      'author',
      '/rest/v1/mutation_receipts?select=request_id&limit=1',
      { schema: 'eacsc_private' },
    )
    denied(
      'Private schema is not exposed by the Data API',
      privateSchema,
      'PGRST106',
      406,
    )
    // Direct base writes must fail rather than silently updating zero rows.
    for (const [table, filter, body] of [
      [
        'record_versions',
        `version_id=eq.${version(9601)}`,
        { change_summary: note('forbidden-direct-update') },
      ],
      [
        'master_records',
        `record_id=eq.${record(9601)}`,
        { title: 'Forbidden direct edit' },
      ],
      [
        'record_assignments',
        `record_id=eq.${record(9601)}`,
        { allow_restricted: true },
      ],
      ['app_users', `user_id=eq.${sessions.author.user}`, { is_active: true }],
    ])
      denied(
        `Direct UPDATE of ${table} is denied`,
        await call('author', `/rest/v1/${table}?${filter}`, {
          method: 'PATCH',
          body,
        }),
      )
    denied(
      'Direct audit INSERT is denied',
      await call('author', '/rest/v1/audit_events', {
        method: 'POST',
        body: {
          actor_user_id: sessions.author.user,
          action_type: 'forbidden',
          action_summary: 'Fictional denied test',
        },
      }),
    )
    const before = await readVersion('author', 9601)
    check(
      'Fixture starts as a Draft with a valid revision',
      before.state === 'Draft' &&
        Number.isSafeInteger(before.revision_counter) &&
        before.revision_counter >= 1,
    )
    denied(
      'Blank notes are rejected',
      await rpc('author', input(9601, before.revision_counter, '   ')),
      '22023',
      400,
    )
    denied(
      'Oversized notes are rejected',
      await rpc(
        'author',
        input(9601, before.revision_counter, 'x'.repeat(2001)),
      ),
      '22023',
      400,
    )
    const firstBody = input(9601, before.revision_counter, note('first'))
    const first = saved(
      'Assigned author saves notes through the RPC',
      'author',
      firstBody,
      await rpc('author', firstBody),
    )
    const replay = await rpc('author', firstBody)
    check(
      'Identical retry returns the original response',
      replay.status === 200 && equal(replay.data, first),
    )
    denied(
      'Request ID cannot be reused with different notes',
      await rpc('author', {
        ...firstBody,
        p_change_summary: note('changed-payload'),
      }),
      '22023',
      400,
    )
    denied(
      'Stale edit revision is rejected',
      await rpc('author', input(9601, before.revision_counter, note('stale'))),
      'PT409',
      409,
    )
    denied(
      'Unchanged notes are rejected',
      await rpc(
        'author',
        input(9601, first.revision_counter, first.change_summary),
      ),
      '22023',
      400,
    )
    const duplicateBody = input(9601, first.revision_counter, note('duplicate'))
    const duplicates = await concurrent([
      rpc('author', duplicateBody),
      rpc('author', duplicateBody),
    ])
    const duplicate = saved(
      'Concurrent identical request commits one logical edit',
      'author',
      duplicateBody,
      duplicates[0],
    )
    check(
      'Concurrent identical request gets the same receipt',
      duplicates[1].status === 200 && equal(duplicates[1].data, duplicate),
    )
    check(
      'Duplicate requests advance the version only once',
      (await readVersion('author', 9601)).revision_counter ===
        duplicate.revision_counter,
    )
    const raceBodies = [
      input(9601, duplicate.revision_counter, note('race-author')),
      input(9601, duplicate.revision_counter, note('race-custodian')),
    ]
    const race = await concurrent([
      rpc('author', raceBodies[0]),
      rpc('custodian', raceBodies[1]),
    ])
    check(
      'Competing edits produce exactly one HTTP success',
      race.filter((r) => r.status === 200).length === 1,
    )
    const winner = race[0].status === 200 ? 0 : 1
    const raceSaved = saved(
      'Winning competing edit has the next revision',
      ['author', 'custodian'][winner],
      raceBodies[winner],
      race[winner],
    )
    denied(
      'Losing competing edit gets an explicit revision conflict',
      race[1 - winner],
      'PT409',
      409,
    )
    const afterRace = await readVersion('author', 9601)
    check(
      'Competing edits preserve the winner and advance only once',
      afterRace.revision_counter === raceSaved.revision_counter &&
        afterRace.change_summary === raceSaved.change_summary,
    )
    const oldReplay = await rpc('author', firstBody)
    check(
      'Older identical retry returns its original acknowledgment',
      oldReplay.status === 200 && equal(oldReplay.data, first),
    )
    check(
      'Older retry does not overwrite a later edit',
      (await readVersion('author', 9601)).revision_counter ===
        raceSaved.revision_counter,
    )
    const custodianBody = input(
      9601,
      raceSaved.revision_counter,
      note('custodian'),
    )
    const last = saved(
      'Assigned custodian saves Draft notes',
      'custodian',
      custodianBody,
      await rpc('custodian', custodianBody),
    )
    const restricted = await readVersion('custodian', 9605)
    const restrictedBody = input(
      9605,
      restricted.revision_counter,
      note('restricted-custodian'),
    )
    saved(
      'Custodian with explicit restricted permission saves notes',
      'custodian',
      restrictedBody,
      await rpc('custodian', restrictedBody),
    )

    // Keep the exact sign-in token while the administrator changes DB status.
    const sameAuthorToken = sessions.author.token
    profileMayBeInactive = true
    try {
      await prompt(
        '\nSTEP A: In Supabase run supabase/tests/deactivate_batch4_http_author.sql. Confirm is_active=false, then press Enter here: ',
      )
      const inactive = rows(
        'Same token can read its inactive profile',
        await get(
          'author',
          'app_users',
          `select=is_active&user_id=eq.${sessions.author.user}`,
        ),
      )
      check(
        'Administrator deactivation is visible with the original token',
        inactive.length === 1 && inactive[0].is_active === false,
      )
      check(
        'Deactivation denies reads with the original token',
        rows(
          'Deactivated record query succeeds',
          await get(
            'author',
            'master_records',
            `select=record_id&record_id=eq.${record(9601)}`,
          ),
        ).length === 0,
      )
      denied(
        'Deactivation denies new writes with the original token',
        await rpc(
          'author',
          input(9601, last.revision_counter, note('deactivated')),
        ),
      )
      denied(
        'Deactivation also denies replaying an old receipt',
        await rpc('author', firstBody),
      )
      check(
        'Denied writes did not advance the version',
        (await readVersion('custodian', 9601)).revision_counter ===
          last.revision_counter,
      )
    } finally {
      await prompt(
        '\nSTEP B: In Supabase run supabase/tests/restore_batch4_http_author.sql. Confirm is_active=true, then press Enter here: ',
      )
      const restored = rows(
        'Restored author profile query succeeds',
        await get(
          'author',
          'app_users',
          `select=is_active&user_id=eq.${sessions.author.user}`,
        ),
      )
      check(
        'Author profile is restored',
        restored.length === 1 && restored[0].is_active === true,
      )
      profileMayBeInactive = false
    }
    check(
      'Reactivation restores authorized reads',
      (await readVersion('author', 9601)).revision_counter ===
        last.revision_counter,
    )
    const restoredReplay = await rpc('author', firstBody)
    check(
      'Reactivation permits the identical old acknowledgment',
      restoredReplay.status === 200 && equal(restoredReplay.data, first),
    )
    check(
      'Revocation tests used the unchanged original token',
      sessions.author.token === sameAuthorToken,
    )
    report.status = 'PASS_HTTP_PENDING_SQL_VERIFICATION'
  } finally {
    report.author_restoration_required = profileMayBeInactive
    for (const actor of actors) delete passwords[actor]
    report.session_cleanup = []
    for (const [actor, session] of Object.entries(sessions)) {
      try {
        const result = await request({
          path: '/auth/v1/logout?scope=local',
          method: 'POST',
          token: session.token,
        })
        report.session_cleanup.push({
          actor,
          success: result.status >= 200 && result.status < 300,
        })
      } catch {
        report.session_cleanup.push({ actor, success: false })
      }
      delete sessions[actor]
    }
  }
  return report
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Use your installed Node 24 or later.')
  const config = validateConfig(parseEnv(await readFile('.env.local', 'utf8')))
  const passwords = {}
  for (const actor of actors) {
    const name =
      'EACSC_HTTP_' + actor.toUpperCase().replaceAll('-', '_') + '_PASSWORD'
    passwords[actor] = process.env[name]
    delete process.env[name]
    if (!passwords[actor])
      throw new Error(
        'Run through scripts/run-batch4-http.ps1 so passwords are entered privately.',
      )
  }
  const run_id = randomUUID()
  const report = {
    run_id,
    started_at: new Date().toISOString(),
    status: 'INCOMPLETE',
    checks: [],
    successful_commands: [],
    author_restoration_required: false,
  }
  const filename = `batch4-http-${run_id}.local`
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await runSuite({
      request: makeTransport(config),
      passwords,
      prompt: (message) => rl.question(message),
      report,
    })
    console.log(
      `\nHTTP CHECKS PASSED: ${report.checks.length}. Now run verify_batch4_http_history.sql in Supabase.`,
    )
  } catch (error) {
    report.status = 'FAIL_OR_INCOMPLETE'
    report.error = error.message
    console.error(`\nSTOP: ${error.message}`)
    console.error(
      'If STEP A was reached, run restore_batch4_http_author.sql before leaving this test.',
    )
    process.exitCode = 1
  } finally {
    rl.close()
    report.finished_at = new Date().toISOString()
    await writeFile(filename, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
    console.log(
      `Safe result report: ${filename}. No passwords, API keys, or tokens are included.`,
    )
    if (report.session_cleanup?.some((r) => !r.success))
      console.log(
        'Some test-session sign-out requests failed. Sign out those fixture sessions later; do not assume their access tokens expired.',
      )
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      'Runner could not start or save its report. Check Node 24, .env.local, and the project directory. No credential values are printed.',
    )
    process.exitCode = 1
  })
}
