import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rootCertificates } from 'node:tls'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

export const PROJECT_ROOT = resolve(
  fileURLToPath(new URL('../', import.meta.url)),
)

export const PROJECT_REF = 'gkhhwrrvqlzpayphvsqp'

export const BUCKETS = ['internal-council-records', 'verified-council-releases']

const executeFile = promisify(execFile)

function required(name) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing ${name} in .env.backup.local.`)
  }

  return value
}

export function loadBackupConfig() {
  const url = new URL(required('SUPABASE_URL'))

  if (
    url.origin !== `https://${PROJECT_REF}.supabase.co` ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'SUPABASE_URL must be the expected development project HTTPS URL.',
    )
  }

  const key = required('SUPABASE_BACKUP_KEY').trim()

  if (!key.startsWith('sb_secret_')) {
    let claims

    try {
      claims = JSON.parse(
        Buffer.from(key.split('.')[1], 'base64url').toString('utf8'),
      )
    } catch {
      throw new Error(
        'Use a Supabase secret key or legacy service_role key for backup.',
      )
    }

    if (
      claims.role !== 'service_role' ||
      (claims.ref && claims.ref !== PROJECT_REF)
    ) {
      throw new Error(
        'The backup key is not a service_role key for this project.',
      )
    }
  }

  const host = required('PGHOST').trim().toLowerCase()
  const user = required('PGUSER').trim()

  const direct = host === `db.${PROJECT_REF}.supabase.co` && user === 'postgres'

  const session =
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) &&
    user === `postgres.${PROJECT_REF}`

  if (
    (!direct && !session) ||
    required('PGPORT') !== '5432' ||
    required('PGDATABASE') !== 'postgres'
  ) {
    throw new Error(
      "Use this project's direct connection or Session pooler on port 5432. Copy the host from Connect.",
    )
  }

  return {
    url: url.origin,
    key,
    host,
    user,
    port: 5432,
    database: 'postgres',
    password: required('PGPASSWORD'),
    bin: resolve(PROJECT_ROOT, required('PG_BIN_DIR')),
    certificate: resolve(PROJECT_ROOT, required('PGSSLROOTCERT')),
    backupRoot: resolve(PROJECT_ROOT, required('BACKUP_ROOT')),
  }
}

export async function createBackupContext(config) {
  const extraCa = await readFile(config.certificate, 'utf8')

  if (!extraCa.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(
      'PGSSLROOTCERT must point to the downloaded PEM root certificate.',
    )
  }

  const ca = `${rootCertificates.join('\n')}\n${extraCa}\n`

  const temporary = await mkdtemp(join(tmpdir(), 'eacsc-backup-ca-'))

  const certificateBundle = join(temporary, 'roots.pem')

  await writeFile(certificateBundle, ca)

  const nativeEnv = {
    ...process.env,
    PGHOST: config.host,
    PGPORT: String(config.port),
    PGUSER: config.user,
    PGPASSWORD: config.password,
    PGDATABASE: config.database,
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: certificateBundle,
    PGCONNECT_TIMEOUT: '15',
    PGCLIENTENCODING: 'UTF8',
    PGAPPNAME: 'eacsc-offline-backup',
  }

  delete nativeEnv.PGSERVICE
  delete nativeEnv.PGSERVICEFILE

  return {
    database: new pg.Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: {
        ca,
        rejectUnauthorized: true,
      },
      connectionTimeoutMillis: 15000,
      statement_timeout: 60000,
      options: '-c default_transaction_read_only=on',
      application_name: 'eacsc-offline-backup',
    }),

    storage: createClient(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, options) =>
          fetch(input, {
            ...options,
            signal: AbortSignal.timeout(30000),
          }),
      },
    }),

    nativeEnv,

    cleanup: () =>
      rm(temporary, {
        recursive: true,
        force: true,
      }),
  }
}

export async function runPostgresTool(config, name, args, env) {
  const executable = join(
    config.bin,
    process.platform === 'win32' ? `${name}.exe` : name,
  )

  const result = await executeFile(executable, args, {
    env,
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: 'utf8',
  })

  return result.stdout.trim()
}

export function safeBackupError(error) {
  let message = error instanceof Error ? error.message : 'Unknown backup error.'

  for (const name of ['PGPASSWORD', 'SUPABASE_BACKUP_KEY']) {
    const secret = process.env[name]

    if (secret) {
      message = message.replaceAll(secret, '[REDACTED]')
    }
  }

  return message.slice(0, 1200)
}
