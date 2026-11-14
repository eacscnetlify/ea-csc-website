import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PROJECT_REF,
  loadBackupConfig,
  createBackupContext,
  safeBackupError,
} from './backup-common.mjs'

const execute = promisify(execFile)

async function digest(path) {
  const hash = createHash('sha256')
  let bytes = 0

  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }

  return { bytes, sha256: hash.digest('hex') }
}

let context
let directory
let transaction = false

try {
  const config = loadBackupConfig()
  context = await createBackupContext(config)

  await mkdir(config.backupRoot, { recursive: true })

  const stamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replaceAll('.', '-')

  directory = await mkdtemp(join(config.backupRoot, `EA_CSC_${stamp}_`))

  await writeFile(
    join(directory, 'INCOMPLETE.txt'),
    'Database capture in progress. Storage files still required.\n',
  )

  console.log(`Backup folder: ${directory}`)

  await context.database.connect()
  await context.database.query(
    'begin isolation level repeatable read read only',
  )
  transaction = true

  await context.database.query(
    "set local idle_in_transaction_session_timeout = '15min'",
  )

  const {
    rows: [snapshot],
  } = await context.database.query(`
    select
      pg_export_snapshot() as id,
      current_timestamp::text as captured_at,
      version() as server_version
  `)

  const { rows: schemas } = await context.database.query(
    'select nspname from pg_namespace where nspname = any($1::text[])',
    [['public', 'eacsc_private', 'auth', 'storage', 'supabase_migrations']],
  )

  const names = schemas.map((row) => row.nspname)

  for (const name of ['public', 'eacsc_private', 'auth', 'storage']) {
    if (!names.includes(name)) {
      throw new Error(`Required schema missing: ${name}`)
    }
  }

  const {
    rows: [catalog],
  } = await context.database.query(`
    select
      (
        select coalesce(
          json_agg(b order by b.id),
          '[]'::json
        )::text
        from storage.buckets b
      ) as buckets,
      (
        select coalesce(
          json_agg(o order by o.bucket_id, o.name),
          '[]'::json
        )::text
        from storage.objects o
      ) as objects
  `)

  await writeFile(
    join(directory, 'storage-catalog.json'),
    `{"buckets":${catalog.buckets},"objects":${catalog.objects}}\n`,
  )

  const env = { ...context.nativeEnv }
  delete env.PGOPTIONS

  const warnings = []

  async function native(name, args) {
    const executable = join(
      config.bin,
      process.platform === 'win32' ? `${name}.exe` : name,
    )

    const result = await execute(executable, args, {
      env,
      windowsHide: true,
      timeout: 600000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    })

    if (result.stderr.trim()) {
      warnings.push(safeBackupError(new Error(result.stderr.trim())))
    }

    return result.stdout
  }

  const appSchemas = ['public', 'eacsc_private']

  if (names.includes('supabase_migrations')) {
    appSchemas.push('supabase_migrations')
  }

  const jobs = [
    ['application.dump', appSchemas.map((name) => `--schema=${name}`)],
    [
      'managed-schema.dump',
      ['--schema-only', '--schema=auth', '--schema=storage'],
    ],
    ['auth-data.dump', ['--data-only', '--schema=auth']],
    ['storage-data.dump', ['--data-only', '--schema=storage']],
  ]

  const artifacts = ['storage-catalog.json']

  for (const [file, options] of jobs) {
    const path = join(directory, file)

    await native('pg_dump', [
      '-w',
      '--format=custom',
      '--lock-wait-timeout=15000',
      `--snapshot=${snapshot.id}`,
      `--file=${path}`,
      ...options,
    ])

    const listing = await native('pg_restore', ['--list', path])

    if (!listing.includes('Format: CUSTOM')) {
      throw new Error(`Archive format check failed: ${file}`)
    }

    await writeFile(join(directory, `${file}.list.txt`), listing)

    artifacts.push(file, `${file}.list.txt`)

    console.log(`PASS archive created and catalog readable: ${file}`)
  }

  await context.database.query('rollback')
  transaction = false

  const files = []

  for (const file of artifacts) {
    files.push({
      path: file,
      ...(await digest(join(directory, file))),
    })
  }

  const manifest = {
    format: 'eacsc-database-backup-v1',
    project_ref: PROJECT_REF,
    captured_at: snapshot.captured_at,
    server_version: snapshot.server_version,
    status: 'database_captured_storage_pending',
    restore_tested: false,
    warnings,
    files,
  }

  const text = `${JSON.stringify(manifest, null, 2)}\n`

  await writeFile(join(directory, 'database-manifest.json'), text)

  const manifestHash = createHash('sha256').update(text).digest('hex')

  await writeFile(
    join(directory, 'database-manifest.sha256'),
    `${manifestHash}\n`,
  )

  const checks = [
    ...files,
    {
      path: 'database-manifest.json',
      bytes: Buffer.byteLength(text),
      sha256: manifestHash,
    },
  ]

  for (const file of checks) {
    const checked = await digest(join(directory, file.path))

    if (checked.sha256 !== file.sha256 || checked.bytes !== file.bytes) {
      throw new Error(`Checksum verification failed: ${file.path}`)
    }
  }

  await writeFile(
    join(directory, 'INCOMPLETE.txt'),
    'Database archives captured and checksummed. ' +
      'Actual Storage files are NOT backed up yet.\n' +
      'Restore has NOT been tested.\n',
  )

  console.log(
    `PASS checksums verified for ${files.length} ` +
      'database artifacts and their manifest',
  )

  console.log(`Archive warnings recorded: ${warnings.length}`)

  console.log(
    'DATABASE CAPTURE PASSED — Storage file backup ' +
      'and restore verification remain pending.',
  )

  console.log(`Backup folder: ${directory}`)
} catch (error) {
  console.error(`DATABASE BACKUP FAILED: ${safeBackupError(error)}`)

  if (directory) {
    console.error(`Partial files retained in: ${directory}`)
  }

  process.exitCode = 1
} finally {
  if (context) {
    if (transaction) {
      await context.database.query('rollback').catch(() => {})
    }

    await context.database.end().catch(() => {})
    await context.cleanup().catch(() => {})
  }
}
