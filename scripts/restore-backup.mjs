import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { PROJECT_REF } from './backup-common.mjs'

const executeFile = promisify(execFile)

function printUsage() {
  console.log(`Usage:
  node --env-file=.env.backup.local scripts/restore-backup.mjs --dry-run <backup-folder>
  node --env-file=.env.backup.local scripts/restore-backup.mjs --target-db <postgres-url> --target-supabase-url <https-url> --target-service-key <key> --confirm-isolated-restore <backup-folder>

Safety:
  Refuses any target referencing operational development project "${PROJECT_REF}".`)
}

function assertSafeTarget(value, label) {
  if (!value) return
  if (value.toLowerCase().includes(PROJECT_REF)) {
    throw new Error(
      `SAFETY REFUSAL: ${label} references operational project "${PROJECT_REF}". Restore is permitted only into an isolated non-operational target.`,
    )
  }
}

function pgTool(name) {
  if (!process.env.PG_BIN_DIR) {
    throw new Error('PG_BIN_DIR is required to run pg_restore / psql.')
  }
  return join(
    resolve(process.env.PG_BIN_DIR),
    process.platform === 'win32' ? `${name}.exe` : name,
  )
}

async function runTool(toolName, args, env = process.env) {
  const { stdout } = await executeFile(pgTool(toolName), args, {
    env,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
  })
  return stdout
}

async function sha256File(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

async function inspectBackupDir(backupDir) {
  const root = resolve(backupDir)
  const entries = await readdir(root, { withFileTypes: true })
  const storageFolders = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('storage-files-'))
    .map((e) => e.name)

  if (storageFolders.length !== 1) {
    throw new Error(`Expected 1 storage-files-* directory in ${root}`)
  }

  const dbManifest = JSON.parse(
    await readFile(join(root, 'database-manifest.json'), 'utf8'),
  )
  const mainManifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  )
  const storageFolder = storageFolders[0]
  const storageManifest = JSON.parse(
    await readFile(join(root, storageFolder, 'storage-manifest.json'), 'utf8'),
  )
  const storageCatalog = JSON.parse(
    await readFile(join(root, 'storage-catalog.json'), 'utf8'),
  )

  return {
    root,
    storageFolder,
    dbManifest,
    mainManifest,
    storageManifest,
    storageCatalog,
  }
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    confirmIsolatedRestore: false,
    targetDb: '',
    targetSupabaseUrl: '',
    targetServiceKey: '',
    backupDir: '',
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--confirm-isolated-restore')
      opts.confirmIsolatedRestore = true
    else if (arg === '--target-db') opts.targetDb = argv[++i] ?? ''
    else if (arg === '--target-supabase-url')
      opts.targetSupabaseUrl = argv[++i] ?? ''
    else if (arg === '--target-service-key')
      opts.targetServiceKey = argv[++i] ?? ''
    else if (!arg.startsWith('--') && !opts.backupDir) opts.backupDir = arg
    else throw new Error(`Unknown or duplicate argument: ${arg}`)
  }

  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.backupDir || (!opts.dryRun && !opts.confirmIsolatedRestore)) {
    printUsage()
    process.exitCode = 1
    return
  }

  assertSafeTarget(opts.targetDb, '--target-db')
  assertSafeTarget(opts.targetSupabaseUrl, '--target-supabase-url')

  const bundle = await inspectBackupDir(opts.backupDir)
  const dumpFiles = [
    'application.dump',
    'managed-schema.dump',
    'auth-data.dump',
    'storage-data.dump',
  ]

  const archiveSummary = {}
  for (const file of dumpFiles) {
    const fullPath = join(bundle.root, file)
    await access(fullPath)
    const toc = await runTool('pg_restore', ['--list', fullPath])
    const itemLines = toc
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.startsWith(';'))
    archiveSummary[file] = {
      toc_entries: itemLines.length,
      sha256: await sha256File(fullPath),
    }
  }

  if (opts.dryRun) {
    const report = {
      format: 'eacsc-restore-dry-run-v1',
      checked_at: new Date().toISOString(),
      backup_dir: bundle.root,
      source_project_ref: bundle.dbManifest.project_ref,
      table_counts: bundle.mainManifest.table_counts,
      storage_objects_in_manifest: bundle.storageManifest.files.length,
      storage_objects_in_catalog: bundle.storageCatalog.objects.length,
      archives: archiveSummary,
      operational_ref_guard: `Refuses target containing "${PROJECT_REF}"`,
      status: 'dry_run_passed_isolated_target_pending',
    }
    await writeFile(
      join(bundle.root, 'restore-dry-run-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    console.log('RESTORE DRY-RUN PASSED:')
    console.log(JSON.stringify(report, null, 2))
    return
  }

  if (!opts.targetDb || !opts.targetSupabaseUrl || !opts.targetServiceKey) {
    throw new Error(
      'Isolated restore requires --target-db, --target-supabase-url, --target-service-key, and --confirm-isolated-restore.',
    )
  }

  // Execute isolated target restore (pg_restore + Storage object re-upload)
  await runTool('psql', [
    opts.targetDb,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    'DROP SCHEMA IF EXISTS eacsc_private CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
  ])

  const dumpConfigs = [
    {
      file: 'auth-data.dump',
      exclude: [/\bTABLE DATA auth schema_migrations\b/],
      extraArgs: [],
    },
    {
      file: 'application.dump',
      exclude: [/\bSCHEMA - public\b/],
      extraArgs: [],
    },
    {
      file: 'storage-data.dump',
      exclude: [
        /\bTABLE DATA storage migrations\b/,
        /\bTABLE DATA storage buckets\b/,
      ],
      extraArgs: [],
    },
  ]

  for (const cfg of dumpConfigs) {
    const dumpPath = join(bundle.root, cfg.file)
    const rawToc = await runTool('pg_restore', ['--list', dumpPath])
    const filteredToc = rawToc
      .split(/\r?\n/)
      .filter((line) => !cfg.exclude.some((re) => re.test(line)))
      .join('\n')
    const listPath = join(
      tmpdir(),
      `eacsc-restore-${Date.now()}-${cfg.file}.toc`,
    )
    await writeFile(listPath, filteredToc, 'utf8')
    try {
      await runTool('pg_restore', [
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '--use-list',
        listPath,
        ...cfg.extraArgs,
        '--dbname',
        opts.targetDb,
        dumpPath,
      ])
    } finally {
      await rm(listPath, { force: true })
    }
  }

  const targetStorage = createClient(
    opts.targetSupabaseUrl,
    opts.targetServiceKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

  for (const file of bundle.storageManifest.files) {
    const bytes = await readFile(join(bundle.root, file.path))
    const actualSha = createHash('sha256').update(bytes).digest('hex')
    if (actualSha !== file.sha256) {
      throw new Error(`Backup blob hash mismatch before upload: ${file.path}`)
    }
    const { error } = await targetStorage.storage
      .from(file.bucket_id)
      .upload(file.name, bytes, {
        contentType: file.mime_type || 'application/octet-stream',
        upsert: true,
      })
    if (error) {
      throw new Error(
        `Storage restore upload failed (${file.bucket_id}/${file.name}): ${error.message}`,
      )
    }
  }

  console.log(
    `ISOLATED RESTORE COMPLETED: ${bundle.storageManifest.files.length} Storage objects and database dumps restored to isolated target.`,
  )
}

main().catch((err) => {
  console.error('RESTORE FAILED:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
