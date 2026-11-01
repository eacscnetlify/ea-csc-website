import { getSupabaseClient } from '../../lib/supabase'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const types: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}
export type Classification =
  'initial_capture' | 'preventable_correction' | 'legitimate_change'
export interface SelectedFile {
  file: File
  mime: string
  sha256: string
}
export interface UploadRequest extends SelectedFile {
  actorId: string
  recordId: string
  expectedRevision: number
  notes: string
  classification: Classification
  prepareId: string
  acceptId: string
}
export interface PreparedUpload {
  uploadId: string
  versionId: string
  versionNumber: number
  expiresAt: string
}
export interface UploadReceipt {
  versionId: string
  versionNumber: number
  auditId: string
}
export class UploadError extends Error {
  kind: 'validation' | 'denied' | 'conflict' | 'expired' | 'uncertain'
  status: number
  constructor(kind: UploadError['kind'], message: string, status = 0) {
    super(message)
    this.name = 'UploadError'
    this.kind = kind
    this.status = status
  }
}
function uncertain() {
  return new UploadError(
    'uncertain',
    'The result could not be confirmed. Keep this tab open and retry the same upload.',
  )
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw uncertain()
  return value as Record<string, unknown>
}
function isId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value)
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export async function inspectSelectedFile(file: File): Promise<SelectedFile> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mime = Object.hasOwn(types, extension) ? types[extension] : ''
  if (
    !mime ||
    !file.name.trim() ||
    Array.from(file.name).length > 255 ||
    Array.from(file.name).some(
      (c) =>
        c.charCodeAt(0) < 32 ||
        c.charCodeAt(0) === 127 ||
        c === '/' ||
        c === '\\',
    )
  )
    throw new UploadError(
      'validation',
      'Choose a PDF, DOCX, JPEG or PNG with a valid filename.',
    )
  if (file.size < 1 || file.size > 10_000_000)
    throw new UploadError(
      'validation',
      'Choose a nonempty file no larger than 10,000,000 bytes.',
    )
  if (
    file.type &&
    file.type !== mime &&
    file.type !== 'application/octet-stream'
  )
    throw new UploadError(
      'validation',
      'The filename and reported file type do not match. Re-export the document in a supported format.',
    )
  const bytes = await file.arrayBuffer()
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  return { file, mime, sha256 }
}

async function call(
  request: UploadRequest,
  path: string,
  body: BodyInit,
  signal: AbortSignal,
  mime = 'application/json',
) {
  signal.throwIfAborted()
  const client = getSupabaseClient()
  const result = await client.auth.getSession()
  signal.throwIfAborted()
  const session = result.data.session
  if (
    result.error ||
    session?.user.id !== request.actorId ||
    session.user.is_anonymous !== false
  )
    throw new UploadError(
      'denied',
      'Your sign-in changed. Sign in with the original account and refresh access before retrying.',
    )
  let response: Response
  try {
    response = await fetch(
      new URL(path, import.meta.env.VITE_SUPABASE_URL.trim()),
      {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
        headers: {
          'Content-Type': mime,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.trim(),
          Authorization: `Bearer ${session.access_token}`,
        },
        body,
      },
    )
  } catch {
    throw uncertain()
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw uncertain()
  }
  if (!response.ok) {
    const code = object(value).code
    if (response.status === 401 || response.status === 403 || code === '42501')
      throw new UploadError(
        'denied',
        'Current upload access could not be confirmed. Refresh access before retrying.',
        response.status,
      )
    if (code === '55000')
      throw new UploadError(
        'expired',
        'This preparation is no longer usable. Reload the record before preparing another upload.',
        response.status,
      )
    if (response.status === 409 || code === 'PT409')
      throw new UploadError(
        'conflict',
        'The record changed or the upload conflicts with stored data. Reload before preparing another upload.',
        response.status,
      )
    if (response.status === 400 || response.status === 422 || code === '22023')
      throw new UploadError(
        'validation',
        response.status === 422
          ? 'The server rejected the file content. Re-export it as a supported PDF, DOCX, JPEG or PNG.'
          : 'The preparation was rejected. Check the file, notes and change classification, then reload the record.',
        response.status,
      )
    throw uncertain()
  }
  return object(value)
}

export async function prepareUpload(
  request: UploadRequest,
  signal: AbortSignal,
): Promise<PreparedUpload> {
  const row = await call(
    request,
    '/rest/v1/rpc/eacsc_prepare_version_upload',
    JSON.stringify({
      p_record_id: request.recordId,
      p_expected_record_revision: request.expectedRevision,
      p_original_filename: request.file.name.trim(),
      p_mime_type: request.mime,
      p_file_size_bytes: request.file.size,
      p_sha256: request.sha256,
      p_change_summary: request.notes,
      p_correction_classification: request.classification,
      p_request_id: request.prepareId,
    }),
    signal,
  )
  if (
    row.request_id !== request.prepareId ||
    row.record_id !== request.recordId ||
    row.expected_record_revision !== request.expectedRevision ||
    row.original_filename !== request.file.name.trim() ||
    row.mime_type !== request.mime ||
    row.file_size_bytes !== request.file.size ||
    row.sha256 !== request.sha256 ||
    !isId(row.upload_id) ||
    !isId(row.proposed_version_id) ||
    !isId(row.preparation_event_uuid) ||
    !positive(row.proposed_version_number) ||
    typeof row.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(row.expires_at))
  )
    throw uncertain()
  return {
    uploadId: row.upload_id,
    versionId: row.proposed_version_id,
    versionNumber: row.proposed_version_number,
    expiresAt: row.expires_at,
  }
}

function receipt(
  value: unknown,
  request: UploadRequest,
  prepared: PreparedUpload,
): UploadReceipt {
  const row = object(value)
  if (
    row.accepted_version !== true ||
    row.state !== 'Draft' ||
    row.upload_id !== prepared.uploadId ||
    row.request_id !== request.acceptId ||
    row.record_id !== request.recordId ||
    row.version_id !== prepared.versionId ||
    row.version_number !== prepared.versionNumber ||
    row.record_revision !== request.expectedRevision + 1 ||
    row.version_revision !== 1 ||
    !isId(row.audit_event_uuid)
  )
    throw uncertain()
  return {
    versionId: prepared.versionId,
    versionNumber: prepared.versionNumber,
    auditId: row.audit_event_uuid,
  }
}

export async function inspectUpload(
  request: UploadRequest,
  prepared: PreparedUpload,
  signal: AbortSignal,
): Promise<UploadReceipt | null> {
  const row = await call(
    request,
    '/rest/v1/rpc/eacsc_get_upload_acceptance',
    JSON.stringify({
      p_upload_id: prepared.uploadId,
      p_request_id: request.acceptId,
    }),
    signal,
  )
  if (row.status === 'accepted')
    return receipt(row.acknowledgement, request, prepared)
  if (
    row.status !== 'ready' ||
    row.upload_id !== prepared.uploadId ||
    row.actor_user_id !== request.actorId ||
    row.record_id !== request.recordId ||
    row.proposed_version_id !== prepared.versionId ||
    row.proposed_version_number !== prepared.versionNumber ||
    row.mime_type !== request.mime ||
    row.file_size_bytes !== request.file.size ||
    row.sha256 !== request.sha256
  )
    throw uncertain()
  return null
}

export async function stageUpload(
  request: UploadRequest,
  prepared: PreparedUpload,
  signal: AbortSignal,
) {
  const row = await call(
    request,
    `/functions/v1/ea-csc-stage-upload?upload_id=${prepared.uploadId}`,
    request.file,
    signal,
    request.mime,
  )
  if (
    row.status !== 'staged' ||
    row.accepted_version !== false ||
    row.upload_id !== prepared.uploadId ||
    row.byte_size !== request.file.size ||
    row.sha256 !== request.sha256
  )
    throw uncertain()
}

export async function acceptUpload(
  request: UploadRequest,
  prepared: PreparedUpload,
  signal: AbortSignal,
) {
  const row = await call(
    request,
    `/functions/v1/ea-csc-stage-upload?action=accept&upload_id=${prepared.uploadId}&request_id=${request.acceptId}`,
    '',
    signal,
  )
  if (row.status !== 'accepted') throw uncertain()
  return receipt(row, request, prepared)
}
