import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile, mkdtemp, realpath, lstat } from 'node:fs/promises'
import { join, basename, dirname, resolve } from 'node:path'
import {
  PROJECT_REF,
  loadBackupConfig,
  createBackupContext,
  safeBackupError,
} from './backup-common.mjs'

const sha = (data) => createHash('sha256').update(data).digest('hex')

async function digest(path) {
  if (!(await lstat(path)).isFile()) {
    throw new Error('Expected a regular backup file.')
  }

  const hash = createHash('sha256')
  let bytes = 0

  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }

  return { bytes, sha256: hash.digest('hex') }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    )
  }

  return value
}

function identity(object) {
  return JSON.stringify(
    stable({
      id: object.id,
      bucket_id: object.bucket_id,
      name: object.name,
      version: object.version,
      updated_at: object.updated_at,
      metadata: object.metadata,
    }),
  )
}

let context
let directory

try {
  if (process.argv.length !== 3) {
    throw new Error('Supply the database backup folder as the only argument.')
  }

  const config = loadBackupConfig()
  directory = await realpath(resolve(process.argv[2]))

  if (dirname(directory) !== (await realpath(config.backupRoot))) {
    throw new Error(
      'Choose an existing backup folder immediately inside BACKUP_ROOT.',
    )
  }

  const manifestText = await readFile(join(directory, 'database-manifest.json'))

  const expected = (
    await readFile(join(directory, 'database-manifest.sha256'), 'utf8')
  ).trim()

  if (sha(manifestText) !== expected) {
    throw new Error('Database manifest checksum mismatch.')
  }

  const database = JSON.parse(manifestText)

  if (
    database.project_ref !== PROJECT_REF ||
    database.format !== 'eacsc-database-backup-v1'
  ) {
    throw new Error('Unexpected project or database manifest format.')
  }

  const seenPaths = new Set()

  for (const file of database.files) {
    if (file.path !== basename(file.path) || seenPaths.has(file.path)) {
      throw new Error('Unsafe or duplicate database artifact path.')
    }

    seenPaths.add(file.path)

    const checked = await digest(join(directory, file.path))

    if (checked.bytes !== file.bytes || checked.sha256 !== file.sha256) {
      throw new Error(`Database artifact checksum mismatch: ${file.path}`)
    }
  }

  if (!seenPaths.has('storage-catalog.json')) {
    throw new Error('Storage catalog is not checksummed.')
  }

  const catalog = JSON.parse(
    await readFile(join(directory, 'storage-catalog.json'), 'utf8'),
  )

  if (!Array.isArray(catalog.objects) || !Array.isArray(catalog.buckets)) {
    throw new Error('Invalid Storage catalog.')
  }

  const ids = new Set()

  for (const object of catalog.objects) {
    if (!/^[0-9a-f-]{36}$/i.test(object.id) || ids.has(object.id)) {
      throw new Error('Invalid or duplicate Storage object ID.')
    }

    ids.add(object.id)

    if (!catalog.buckets.some((bucket) => bucket.id === object.bucket_id)) {
      throw new Error('A Storage object has no captured bucket.')
    }
  }

  context = await createBackupContext(config)
  await context.database.connect()

  async function checkSource(object) {
    const { rows } = await context.database.query(
      `select to_jsonb(o) as object
       from storage.objects o
       where o.id::text = $1`,
      [object.id],
    )

    if (rows.length !== 1 || identity(rows[0].object) !== identity(object)) {
      throw new Error(
        'A captured Storage object changed or disappeared. ' +
          'Keep this backup and create a fresh database capture.',
      )
    }
  }

  for (const object of catalog.objects) {
    await checkSource(object)
  }

  const destination = await mkdtemp(join(directory, 'storage-files-'))

  const folder = basename(destination)
  const files = []

  for (const object of catalog.objects) {
    const { data, error } = await context.storage.storage
      .from(object.bucket_id)
      .download(object.name)

    if (error || !data) {
      throw new Error(
        `Storage download failed for object ${object.id}: ` +
          (error?.message ?? 'empty response'),
      )
    }

    const path = join(destination, `${object.id}.bin`)

    await writeFile(path, data.stream(), { flag: 'wx' })

    const checked = await digest(path)
    const size = object.metadata?.size

    if (size != null && String(checked.bytes) !== String(size)) {
      throw new Error(`Storage size mismatch for object ${object.id}`)
    }

    await checkSource(object)

    files.push({
      object_id: object.id,
      bucket_id: object.bucket_id,
      name: object.name,
      path: `${folder}/${object.id}.bin`,
      ...checked,
    })

    console.log(
      `PASS file ${files.length}/${catalog.objects.length}: ` +
        object.bucket_id,
    )
  }

  for (const object of catalog.objects) {
    await checkSource(object)
  }

  for (const file of files) {
    const checked = await digest(join(directory, file.path))

    if (checked.bytes !== file.bytes || checked.sha256 !== file.sha256) {
      throw new Error(`Saved Storage file checksum mismatch: ${file.object_id}`)
    }
  }

  const text = `${JSON.stringify(
    {
      format: 'eacsc-storage-backup-v1',
      project_ref: PROJECT_REF,
      database_manifest_sha256: expected,
      captured_at: database.captured_at,
      downloaded_at: new Date().toISOString(),
      status: 'catalog_files_copied_reference_review_pending',
      restore_tested: false,
      object_count: files.length,
      files,
    },
    null,
    2,
  )}\n`

  await writeFile(join(destination, 'storage-manifest.json'), text, {
    flag: 'wx',
  })

  await writeFile(
    join(destination, 'storage-manifest.sha256'),
    `${sha(text)}\n`,
    { flag: 'wx' },
  )

  const savedManifest = await digest(join(destination, 'storage-manifest.json'))

  if (savedManifest.sha256 !== sha(text)) {
    throw new Error('Storage manifest verification failed.')
  }

  await writeFile(
    join(directory, 'INCOMPLETE.txt'),
    'Database and catalogued Storage files copied.\n' +
      `Storage manifest: ${folder}/storage-manifest.json\n` +
      'Application attachment-reference review and isolated ' +
      'restore verification remain pending.\n',
  )

  console.log(
    `STORAGE CAPTURE PASSED — ${files.length} files ` +
      'copied and checksummed.',
  )

  console.log(
    'Application attachment-reference review and isolated ' +
      'restore verification remain pending.',
  )

  console.log(`Storage folder: ${destination}`)
} catch (error) {
  console.error(`STORAGE BACKUP FAILED: ${safeBackupError(error)}`)

  if (directory) {
    console.error(`Existing backup retained: ${directory}`)
  }

  process.exitCode = 1
} finally {
  if (context) {
    await context.database.end().catch(() => {})
    await context.cleanup().catch(() => {})
  }
}
