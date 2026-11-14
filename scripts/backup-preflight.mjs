import {
  BUCKETS,
  loadBackupConfig,
  createBackupContext,
  runPostgresTool,
  safeBackupError,
} from './backup-common.mjs'

async function main() {
  const config = loadBackupConfig()
  const context = await createBackupContext(config)
  const db = context.database

  try {
    for (const tool of ['pg_dump', 'pg_restore', 'psql']) {
      const version = await runPostgresTool(
        config,
        tool,
        ['--version'],
        context.nativeEnv,
      )

      if (!/\b17\./.test(version)) {
        throw new Error(`${tool} must be PostgreSQL major version 17.`)
      }

      console.log(`PASS ${version}`)
    }

    await db.connect()
    await db.query('begin read only')

    const info = (
      await db.query(`
        select
          current_setting('server_version') as version,
          current_user as database_user,
          current_setting('transaction_read_only')
            as read_only,
          (
            select count(*)
            from public.master_records
          ) as records,
          (
            select count(*)
            from public.record_versions
          ) as versions,
          (
            select count(*)
            from public.audit_events
          ) as audit_events,
          (
            select count(*)
            from eacsc_private.mutation_receipts
          ) as receipts,
          (
            select count(*)
            from public.turnover_packages
          ) as turnover_packages,
          (
            select count(*)
            from auth.users
          ) as auth_users,
          (
            select count(*)
            from auth.identities
          ) as auth_identities
      `)
    ).rows[0]

    if (
      info.database_user !== 'postgres' ||
      info.read_only !== 'on' ||
      !info.version.startsWith('17.')
    ) {
      throw new Error(
        'Expected a read-only postgres connection to a version 17 database.',
      )
    }

    const bucketRows = (
      await db.query(
        `
          select
            b.id,
            b.public as is_public,
            count(o.id) as object_count
          from storage.buckets b
          left join storage.objects o
            on o.bucket_id = b.id
          where b.id = any($1::text[])
          group by b.id, b.public
          order by b.id
        `,
        [BUCKETS],
      )
    ).rows

    if (bucketRows.length !== 2 || bucketRows.some((row) => row.is_public)) {
      throw new Error(
        'Both expected private buckets must exist and remain private.',
      )
    }

    await db.query('rollback')

    console.log(
      `PASS verified TLS database connection: PostgreSQL ${info.version}`,
    )

    console.log('PASS protected history and Auth identity tables are readable')

    console.table([
      {
        records: info.records,
        versions: info.versions,
        audit_events: info.audit_events,
        retry_receipts: info.receipts,
        turnover_packages: info.turnover_packages,
        auth_users: info.auth_users,
        auth_identities: info.auth_identities,
      },
    ])

    const nativeCheckEnv = { ...context.nativeEnv }
    delete nativeCheckEnv.PGOPTIONS

    const readOnly = await runPostgresTool(
      config,
      'psql',
      [
        '-X',
        '-w',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        'begin read only;',
        '-c',
        "select current_setting('transaction_read_only');",
        '-c',
        'rollback;',
      ],
      nativeCheckEnv,
    )

    if (readOnly !== 'on') {
      throw new Error(
        `Native PostgreSQL read-only check returned ${JSON.stringify(readOnly)}; expected "on".`,
      )
    }

    console.log(
      'PASS psql verified TLS connection and explicit read-only transaction',
    )

    const { data: apiBuckets, error: bucketError } =
      await context.storage.storage.listBuckets()

    if (bucketError) {
      throw new Error(`Storage authentication failed: ${bucketError.message}`)
    }

    for (const bucket of bucketRows) {
      const apiBucket = apiBuckets?.find((item) => item.id === bucket.id)

      if (!apiBucket || apiBucket.public) {
        throw new Error(`Private Storage bucket check failed: ${bucket.id}`)
      }

      const { error } = await context.storage.storage
        .from(bucket.id)
        .list('', { limit: 1 })

      if (error) {
        throw new Error(
          `Storage listing failed for ${bucket.id}: ${error.message}`,
        )
      }

      console.log(
        `PASS private bucket listing: ${bucket.id} (${bucket.object_count} database object entries)`,
      )
    }

    console.log(
      'PREFLIGHT PASSED — connections are ready; no backup has been created yet.',
    )
  } finally {
    await db.end().catch(() => {})
    await context.cleanup()
  }
}

main().catch((error) => {
  console.error(`PREFLIGHT FAILED: ${safeBackupError(error)}`)
  process.exitCode = 1
})
