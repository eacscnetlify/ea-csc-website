import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const project = 'gkhhwrrvqlzpayphvsqp'
const hash = (data) => createHash('sha256').update(data).digest('hex')

let root

async function local(path) {
  if (
    typeof path !== 'string' ||
    path.includes('\\') ||
    isAbsolute(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..')
  ) {
    throw new Error('Unsafe backup path.')
  }

  const full = join(root, path)
  const actual = await realpath(full)
  const rel = relative(root, actual)

  if (
    rel.startsWith('..') ||
    isAbsolute(rel) ||
    !(await lstat(full)).isFile()
  ) {
    throw new Error('Backup file escapes its folder or is not a regular file.')
  }

  return full
}

async function digest(path) {
  const sha = createHash('sha256')
  let bytes = 0

  for await (const chunk of createReadStream(await local(path))) {
    bytes += chunk.length
    sha.update(chunk)
  }

  return { bytes, sha256: sha.digest('hex') }
}

async function manifest(path) {
  const data = await readFile(await local(`${path}.json`))
  const expected = (
    await readFile(await local(`${path}.sha256`), 'utf8')
  ).trim()

  if (hash(data) !== expected) {
    throw new Error(`Manifest checksum mismatch: ${path}`)
  }

  return { data: JSON.parse(data), sha256: expected }
}

async function checkFiles(files) {
  if (!Array.isArray(files)) {
    throw new Error('Invalid manifest file list.')
  }

  const seen = new Set()

  for (const file of files) {
    if (seen.has(file.path)) {
      throw new Error('Duplicate manifest file path.')
    }

    seen.add(file.path)
    const actual = await digest(file.path)

    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) {
      throw new Error(`Checksum or size mismatch: ${file.path}`)
    }
  }

  return seen
}

function decode(text) {
  if (text === '\\N') return null

  const escapes = {
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
  }

  return text.replace(/\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|[\s\S])/g, (_, code) => {
    if (/^[0-7]/.test(code)) {
      return String.fromCharCode(parseInt(code, 8))
    }

    if (/^x[0-9a-fA-F]/.test(code)) {
      return String.fromCharCode(parseInt(code.slice(1), 16))
    }

    return escapes[code] ?? code
  })
}

function copyTables(sql) {
  const tables = new Map()
  let current

  for (const line of sql.split(/\r?\n/)) {
    if (current) {
      if (line === '\\.') {
        current = undefined
        continue
      }

      const values = line.split('\t').map(decode)

      if (values.length !== current.columns.length) {
        throw new Error('Unexpected COPY data column count.')
      }

      current.rows.push(
        Object.fromEntries(current.columns.map((key, i) => [key, values[i]])),
      )

      continue
    }

    const match = line.match(/^COPY public\.([a-z_]+) \((.+)\) FROM stdin;$/)

    if (match) {
      if (tables.has(match[1])) {
        throw new Error('Duplicate COPY table.')
      }

      current = {
        columns: match[2].split(', ').map((c) => c.replaceAll('"', '')),
        rows: [],
      }

      tables.set(match[1], current)
    }
  }

  if (current) throw new Error('Truncated COPY table.')
  return tables
}

try {
  if (process.argv.length !== 3) {
    throw new Error('Supply the backup folder as the only argument.')
  }

  root = await realpath(resolve(process.argv[2]))
  const database = await manifest('database-manifest')

  if (
    database.data.project_ref !== project ||
    database.data.format !== 'eacsc-database-backup-v1'
  ) {
    throw new Error('Unexpected database project or format.')
  }

  const paths = await checkFiles(database.data.files)

  for (const file of [
    'application.dump',
    'managed-schema.dump',
    'auth-data.dump',
    'storage-data.dump',
    'storage-catalog.json',
  ]) {
    if (!paths.has(file)) {
      throw new Error(`Missing required artifact: ${file}`)
    }
  }

  console.log('PASS database manifest and artifact checksums')
  if ((await readdir(root)).includes('manifest.json')) {
    const complete = await manifest('manifest')

    if (
      complete.data.project_ref !== project ||
      complete.data.format !== 'eacsc-backup-v1'
    ) {
      throw new Error('Unexpected consolidated manifest.')
    }

    const completePaths = await checkFiles(complete.data.files)

    if (
      !completePaths.has(complete.data.metadata_file) ||
      !completePaths.has('capture-review.json')
    ) {
      throw new Error('Consolidated backup metadata is missing.')
    }

    const metadata = JSON.parse(
      await readFile(await local(complete.data.metadata_file), 'utf8'),
    )

    if (
      metadata.project_ref !== project ||
      metadata.format !== 'eacsc-backup-metadata-v1' ||
      Object.keys(metadata.tables).length !==
        Object.keys(complete.data.table_counts).length
    ) {
      throw new Error('Metadata export format or table count mismatch.')
    }

    for (const [name, count] of Object.entries(complete.data.table_counts)) {
      if (
        metadata.tables[name]?.rows.length !== count ||
        metadata.table_counts[name] !== count
      ) {
        throw new Error(`Metadata row count mismatch: ${name}`)
      }
    }

    console.log(
      'PASS consolidated manifest, metadata export, and all listed files',
    )
  }
  const candidates = []

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('storage-files-'))
      continue

    const contents = await readdir(join(root, entry.name))

    if (contents.includes('storage-manifest.json')) {
      candidates.push(entry.name)
    }
  }

  if (candidates.length !== 1) {
    throw new Error('Expected exactly one completed Storage capture folder.')
  }

  const folder = candidates[0]
  const storage = await manifest(`${folder}/storage-manifest`)

  if (
    storage.data.project_ref !== project ||
    storage.data.format !== 'eacsc-storage-backup-v1' ||
    storage.data.database_manifest_sha256 !== database.sha256
  ) {
    throw new Error('Storage capture does not match this database backup.')
  }

  await checkFiles(storage.data.files)

  const catalog = JSON.parse(
    await readFile(await local('storage-catalog.json'), 'utf8'),
  )

  if (
    storage.data.object_count !== catalog.objects.length ||
    storage.data.files.length !== catalog.objects.length
  ) {
    throw new Error('Storage object count mismatch.')
  }

  const objects = new Map()
  const ids = new Set()

  for (const file of storage.data.files) {
    const source = catalog.objects.find((o) => o.id === file.object_id)

    const key = JSON.stringify([file.bucket_id, file.name])

    if (
      !source ||
      ids.has(file.object_id) ||
      objects.has(key) ||
      source.bucket_id !== file.bucket_id ||
      source.name !== file.name ||
      file.path !== `${folder}/${file.object_id}.bin`
    ) {
      throw new Error('Storage catalog mapping mismatch.')
    }

    if (
      source.metadata?.size != null &&
      String(source.metadata.size) !== String(file.bytes)
    ) {
      throw new Error('Storage catalog size mismatch.')
    }

    ids.add(file.object_id)
    objects.set(key, file)
  }

  console.log(
    `PASS ${objects.size} Storage files: checksums, sizes, and catalog mapping`,
  )

  if (!process.env.PG_BIN_DIR) {
    throw new Error('PG_BIN_DIR is required to read the saved archive.')
  }

  const executable = join(
    resolve(process.env.PG_BIN_DIR),
    process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore',
  )

  const { stdout } = await execute(
    executable,
    [
      '--data-only',
      '--schema=public',
      '--table=record_versions',
      '--table=record_releases',
      '--table=update_bulletins',
      '--file=-',
      await local('application.dump'),
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
    },
  )

  const tables = copyTables(stdout)

  function rows(name) {
    if (!tables.has(name)) {
      throw new Error(`Missing saved table data: ${name}`)
    }

    return tables.get(name).rows
  }

  const versions = rows('record_versions')
  const releases = rows('record_releases')
  const bulletins = rows('update_bulletins')

  const issues = []
  let references = 0

  function attachment(label, bucket, name, bytes, sha256) {
    references++
    const file = objects.get(JSON.stringify([bucket, name]))

    if (!name || !bucket || !bytes || !sha256) {
      issues.push({
        reference: label,
        problem: 'incomplete_attachment_metadata',
      })
    } else if (!file) {
      issues.push({
        reference: label,
        problem: 'referenced_file_missing',
        bucket,
        name,
      })
    } else if (
      String(file.bytes) !== String(bytes) ||
      file.sha256 !== sha256.toLowerCase()
    ) {
      issues.push({
        reference: label,
        problem: 'application_hash_or_size_mismatch',
        bucket,
        name,
      })
    }
  }

  const bulletinVersions = new Set(
    bulletins.map((b) => b.archive_version_id).filter(Boolean),
  )

  for (const version of versions) {
    if (version.storage_key == null) continue

    attachment(
      `${version.record_id} version ${version.version_number}`,
      bulletinVersions.has(version.version_id)
        ? 'verified-council-releases'
        : 'internal-council-records',
      version.storage_key,
      version.file_size_bytes,
      version.sha256,
    )
  }

  for (const release of releases) {
    attachment(
      `release ${release.release_id}`,
      release.release_bucket_id,
      release.release_storage_key,
      release.release_file_size_bytes,
      release.release_sha256,
    )
  }

  for (const bulletin of bulletins) {
    if (bulletin.pdf_storage_key != null || bulletin.issue_status !== 'Draft') {
      attachment(
        `bulletin ${bulletin.bulletin_id} issue ${bulletin.issue_version}`,
        'verified-council-releases',
        bulletin.pdf_storage_key,
        bulletin.pdf_size_bytes,
        bulletin.pdf_sha256,
      )
    }
  }

  const fixture = versions.find(
    (v) =>
      v.version_id === 'b4000000-0000-4000-8000-000000009604' &&
      v.record_id === 'EACSC-2099-HTTP-9604' &&
      v.version_number === '1' &&
      v.state === 'For Review' &&
      v.original_filename === 'fictional-no-object.pdf' &&
      v.mime_type === 'application/pdf' &&
      v.storage_key === 'batch4-http-fixtures/no-object-review.pdf' &&
      v.file_size_bytes === '128' &&
      v.sha256 === 'a'.repeat(64),
  )

  const expectedTestExceptions = issues.filter(
    (issue) =>
      fixture &&
      issue.reference === 'EACSC-2099-HTTP-9604 version 1' &&
      issue.problem === 'referenced_file_missing' &&
      issue.bucket === 'internal-council-records' &&
      issue.name === 'batch4-http-fixtures/no-object-review.pdf',
  )

  const unexpectedIssues = issues.filter(
    (issue) => !expectedTestExceptions.includes(issue),
  )

  const report = {
    format: 'eacsc-backup-verification-v1',
    verified_at: new Date().toISOString(),
    database_manifest_sha256: database.sha256,
    storage_manifest_sha256: storage.sha256,
    archive_warnings: database.data.warnings ?? [],
    storage_objects: objects.size,
    record_versions: versions.length,
    releases: releases.length,
    bulletins: bulletins.length,
    attachment_references_checked: references,
    issues,
    expected_test_exceptions: expectedTestExceptions,
    unexpected_issues: unexpectedIssues,
    restore_tested: false,
    status:
      unexpectedIssues.length || database.data.warnings?.length
        ? 'source_review_required'
        : expectedTestExceptions.length
          ? 'capture_verified_with_test_exception_restore_pending'
          : 'capture_verified_restore_pending',
  }

  await writeFile(
    join(root, 'verification-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )

  console.log(
    `Saved rows: ${versions.length} versions, ` +
      `${releases.length} releases, ${bulletins.length} bulletins`,
  )

  console.log(`Attachment references checked: ${references}`)

  if (issues.length) console.table(issues)

  console.log(
    `Expected test exceptions: ${expectedTestExceptions.length}; ` +
      `unexpected source issues: ${unexpectedIssues.length}; ` +
      `archive warnings: ${report.archive_warnings.length}`,
  )

  console.log(
    report.status === 'source_review_required'
      ? 'REVIEW REQUIRED — copied files are intact; source references or archive warnings need review.'
      : 'BACKUP CAPTURE VERIFIED — isolated restore verification remains pending.',
  )

  console.log('No database connection or restore was performed.')

  if (report.status === 'source_review_required') {
    process.exitCode = 2
  }
} catch (error) {
  console.error(`BACKUP VERIFICATION FAILED: ${error.message}`)
  process.exitCode = 1
}
