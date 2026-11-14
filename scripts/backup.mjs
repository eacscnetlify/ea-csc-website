import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile, readdir, realpath, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const scripts = fileURLToPath(new URL('./', import.meta.url))
const project = 'gkhhwrrvqlzpayphvsqp'
const sha = (data) => createHash('sha256').update(data).digest('hex')

async function runScript(name, args = []) {
  return await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(scripts, name), ...args], {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'inherit'],
    })

    let output = ''

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      output += chunk.toString()
    })

    child.on('error', reject)

    child.on('close', (code) => {
      if (code === 0) {
        accept(output)
      } else {
        reject(
          new Error(
            `${name} stopped with exit code ${code}. Review the output above.`,
          ),
        )
      }
    })
  })
}

function tablesFromCopy(sql) {
  const tables = {}
  let active

  const escapes = {
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
  }

  function decode(text) {
    if (text === '\\N') return null

    return text.replace(
      /\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|[\s\S])/g,
      (_, code) => {
        if (/^[0-7]/.test(code)) {
          return String.fromCharCode(parseInt(code, 8))
        }

        if (/^x[0-9a-fA-F]/.test(code)) {
          return String.fromCharCode(parseInt(code.slice(1), 16))
        }

        return escapes[code] ?? code
      },
    )
  }

  for (const line of sql.split(/\r?\n/)) {
    if (active) {
      if (line === '\\.') {
        active = undefined
        continue
      }

      const values = line.split('\t').map(decode)

      if (values.length !== active.columns.length) {
        throw new Error('Unexpected COPY column count.')
      }

      active.rows.push(
        Object.fromEntries(active.columns.map((key, i) => [key, values[i]])),
      )

      continue
    }

    if (!line.startsWith('COPY ')) continue

    const match = line.match(
      /^COPY ([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*) \((.+)\) FROM stdin;$/,
    )

    if (!match) {
      throw new Error('Unsupported COPY table format; metadata export stopped.')
    }

    const key = `${match[1]}.${match[2]}`

    if (Object.hasOwn(tables, key)) {
      throw new Error(`Duplicate table: ${key}`)
    }

    active = {
      columns: match[3].split(', ').map((c) => c.replaceAll('"', '')),
      rows: [],
    }

    tables[key] = active
  }

  if (active) throw new Error('Truncated COPY data.')

  return tables
}

async function writeJson(directory, name, value) {
  await writeFile(
    join(directory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    { flag: 'wx' },
  )
}

try {
  let directory

  if (process.argv.length === 4 && process.argv[2] === '--finalize') {
    directory = await realpath(resolve(process.argv[3]))
  } else if (process.argv.length === 2) {
    const output = await runScript('backup-database.mjs')
    const folder = output.match(/^Backup folder: (.+)\r?$/m)?.[1].trim()

    if (!folder) {
      throw new Error('Database script did not return a backup folder.')
    }

    directory = await realpath(folder)

    await runScript('backup-storage.mjs', [directory])
  } else {
    throw new Error(
      'Use no arguments for a new backup, or --finalize followed by an existing backup folder.',
    )
  }

  await runScript('verify-backup.mjs', [directory])

  if ((await readdir(directory)).includes('manifest.json')) {
    console.log('This backup is already finalized and its verification passed.')
  } else {
    const database = JSON.parse(
      await readFile(join(directory, 'database-manifest.json'), 'utf8'),
    )

    const review = JSON.parse(
      await readFile(join(directory, 'verification-report.json'), 'utf8'),
    )

    if (
      database.project_ref !== project ||
      review.status === 'source_review_required'
    ) {
      throw new Error(
        'Backup project or source review is not ready for finalization.',
      )
    }

    const candidates = []

    for (const entry of await readdir(directory, {
      withFileTypes: true,
    })) {
      if (
        entry.isDirectory() &&
        entry.name.startsWith('storage-files-') &&
        (await readdir(join(directory, entry.name))).includes(
          'storage-manifest.json',
        )
      ) {
        candidates.push(entry.name)
      }
    }

    if (candidates.length !== 1) {
      throw new Error('Expected one completed Storage capture.')
    }

    const folder = candidates[0]

    const storage = JSON.parse(
      await readFile(join(directory, folder, 'storage-manifest.json'), 'utf8'),
    )

    if (!process.env.PG_BIN_DIR) {
      throw new Error('PG_BIN_DIR is required.')
    }

    const executable = join(
      resolve(process.env.PG_BIN_DIR),
      process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore',
    )

    const tables = {}

    for (const archive of [
      'application.dump',
      'auth-data.dump',
      'storage-data.dump',
    ]) {
      const { stdout, stderr } = await execute(
        executable,
        ['--data-only', '--file=-', join(directory, archive)],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 60000,
          maxBuffer: 128 * 1024 * 1024,
        },
      )

      if (stderr.trim()) {
        throw new Error(
          `Metadata extraction returned a warning for ${archive}.`,
        )
      }

      const extracted = tablesFromCopy(stdout)

      const list = await readFile(
        join(directory, `${archive}.list.txt`),
        'utf8',
      )

      for (const line of list.split(/\r?\n/)) {
        const item = line.match(
          / TABLE DATA ([a-z_][a-z0-9_]*) ([a-z_][a-z0-9_]*) /,
        )

        if (item && !Object.hasOwn(extracted, `${item[1]}.${item[2]}`)) {
          throw new Error(
            `Table missing from metadata export: ${item[1]}.${item[2]}`,
          )
        }
      }

      for (const [name, data] of Object.entries(extracted)) {
        if (Object.hasOwn(tables, name)) {
          throw new Error(`Duplicate exported table: ${name}`)
        }

        tables[name] = data
      }
    }

    for (const name of [
      'public.app_users',
      'public.master_records',
      'public.record_versions',
      'public.audit_events',
      'public.turnover_packages',
      'public.turnover_acknowledgments',
      'public.record_releases',
      'public.update_bulletins',
      'auth.users',
      'auth.identities',
      'storage.buckets',
      'storage.objects',
    ]) {
      if (!Object.hasOwn(tables, name)) {
        throw new Error(`Required metadata table missing: ${name}`)
      }
    }

    const tableCounts = Object.fromEntries(
      Object.entries(tables).map(([name, data]) => [name, data.rows.length]),
    )

    const stamp = new Date()
      .toISOString()
      .replaceAll(':', '-')
      .replaceAll('.', '-')

    const metadataFile = `backup_metadata_${stamp}.json`

    await writeJson(directory, metadataFile, {
      format: 'eacsc-backup-metadata-v1',
      project_ref: project,
      captured_at: database.captured_at,
      exported_at: new Date().toISOString(),
      encoding:
        'COPY text decoded; SQL NULL is JSON null; other column values are strings.',
      recovery_source:
        'Native archives retain PostgreSQL types, constraints, functions, policies, and sequence state.',
      table_counts: tableCounts,
      tables,
    })

    await writeFile(
      join(directory, 'capture-review.json'),
      `${JSON.stringify(review, null, 2)}\n`,
    )

    const names = new Set([
      ...database.files.map((file) => file.path),
      ...storage.files.map((file) => file.path),
      'database-manifest.json',
      'database-manifest.sha256',
      `${folder}/storage-manifest.json`,
      `${folder}/storage-manifest.sha256`,
      metadataFile,
      'capture-review.json',
    ])

    if ((await readdir(directory)).includes('SOURCE_EXCEPTION_REVIEW.txt')) {
      names.add('SOURCE_EXCEPTION_REVIEW.txt')
    }

    const files = []

    for (const name of [...names].sort()) {
      const hash = createHash('sha256')
      let bytes = 0

      for await (const chunk of createReadStream(join(directory, name))) {
        bytes += chunk.length
        hash.update(chunk)
      }

      files.push({
        path: name,
        bytes,
        sha256: hash.digest('hex'),
      })
    }

    const manifest = {
      format: 'eacsc-backup-v1',
      project_ref: project,
      captured_at: database.captured_at,
      finalized_at: new Date().toISOString(),
      status: review.status,
      restore_tested: false,
      integrity_method: 'SHA-256 checksums; no digital signature.',
      metadata_file: metadataFile,
      table_counts: tableCounts,
      storage_file_count: storage.files.length,
      expected_test_exceptions: review.expected_test_exceptions ?? [],
      files,
    }

    const text = `${JSON.stringify(manifest, null, 2)}\n`

    await writeFile(join(directory, 'manifest.json'), text, { flag: 'wx' })

    await writeFile(join(directory, 'manifest.sha256'), `${sha(text)}\n`, {
      flag: 'wx',
    })

    await runScript('verify-backup.mjs', [directory])

    await writeFile(
      join(directory, 'CAPTURE_VERIFIED_RESTORE_PENDING.txt'),
      'Database archives, metadata export, and Storage files verified.\n' +
        'See manifest.json for documented test exceptions.\n' +
        'Isolated restoration remains untested and is required in Batch 10.\n',
    )

    await rm(join(directory, 'INCOMPLETE.txt'), { force: true })

    console.log(
      `FINALIZED: ${Object.keys(tables).length} metadata tables; ` +
        `${storage.files.length} Storage files.`,
    )

    console.log(`Backup folder: ${directory}`)

    console.log(
      'BACKUP CAPTURE COMPLETE — isolated restore drill remains pending.',
    )
  }
} catch (error) {
  let message = error.message

  for (const name of ['PGPASSWORD', 'SUPABASE_BACKUP_KEY']) {
    if (process.env[name]) {
      message = message.replaceAll(process.env[name], '[REDACTED]')
    }
  }

  console.error(`BACKUP STOPPED: ${message.slice(0, 1200)}`)
  process.exitCode = 1
}
