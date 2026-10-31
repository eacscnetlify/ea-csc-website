import type { SupabaseClient } from '@supabase/supabase-js'
import { FileVerificationError, verifyFileFacts } from './verify-file-facts.ts'
import { verifyUpload } from './verify-upload.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const EXTENSIONS: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'docx',
  ],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
}

class AcceptanceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

interface ReadyUpload {
  status: 'ready'
  upload_id: string
  actor_user_id: string
  record_id: string
  proposed_version_id: string
  proposed_version_number: number
  bucket_id: string
  staging_key: string
  destination_key: string
  mime_type: string
  file_size_bytes: number
  sha256: string
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AcceptanceError(
      503,
      'INVALID_METADATA',
      'Acceptance details could not be confirmed.',
    )
  }
  return value as Record<string, unknown>
}

function acknowledgement(value: unknown, id: string, requestId: string) {
  const ack = object(value)
  if (
    ack.upload_id !== id ||
    ack.request_id !== requestId ||
    ack.accepted_version !== true ||
    typeof ack.version_id !== 'string' ||
    !UUID.test(ack.version_id) ||
    ack.state !== 'Draft' ||
    !Number.isSafeInteger(ack.version_number) ||
    Number(ack.version_number) < 1 ||
    !Number.isSafeInteger(ack.record_revision) ||
    Number(ack.record_revision) < 2
  ) {
    throw new AcceptanceError(
      503,
      'INVALID_METADATA',
      'Acceptance acknowledgement could not be confirmed.',
    )
  }
  return { ...ack, status: 'accepted' }
}

function metadata(value: unknown, id: string, actor: string): ReadyUpload {
  const item = object(value)
  const extensions =
    typeof item.mime_type === 'string' ? EXTENSIONS[item.mime_type] : undefined
  const extension =
    typeof item.staging_key === 'string'
      ? item.staging_key.split('.').at(-1)
      : undefined

  if (
    item.status !== 'ready' ||
    item.upload_id !== id ||
    item.actor_user_id !== actor ||
    item.bucket_id !== 'internal-council-records' ||
    typeof item.record_id !== 'string' ||
    !/^EACSC-[1-9][0-9]{3}-[A-Z]{2,10}-[0-9]{4}$/.test(item.record_id) ||
    typeof item.proposed_version_id !== 'string' ||
    !UUID.test(item.proposed_version_id) ||
    !Number.isSafeInteger(item.proposed_version_number) ||
    Number(item.proposed_version_number) < 1 ||
    Number(item.proposed_version_number) > 2147483647 ||
    !extension ||
    !extensions?.includes(extension) ||
    item.staging_key !== `quarantine/${actor}/${id}.${extension}` ||
    typeof item.destination_key !== 'string' ||
    !/^(governance|secretariat|activities|financial|forms|turnover)\//.test(
      item.destination_key,
    ) ||
    item.destination_key.split('/').slice(1).join('/') !==
      `${item.record_id}/${item.proposed_version_number}_${id}.${extension}` ||
    typeof item.file_size_bytes !== 'number' ||
    !Number.isSafeInteger(item.file_size_bytes) ||
    item.file_size_bytes < 1 ||
    item.file_size_bytes > 10000000 ||
    typeof item.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(item.sha256)
  ) {
    throw new AcceptanceError(
      503,
      'INVALID_METADATA',
      'Prepared file details could not be confirmed.',
    )
  }
  return item as unknown as ReadyUpload
}

function databaseError(code: string | undefined): never {
  const status =
    code === '42501'
      ? 403
      : code === 'PT409' || code === '55000'
        ? 409
        : code === '22023'
          ? 400
          : 503

  throw new AcceptanceError(
    status,
    status === 503 ? 'ACCEPTANCE_UNCONFIRMED' : 'ACCEPTANCE_UNAVAILABLE',
    status === 503
      ? 'Acceptance could not be confirmed. Keep both IDs and retry the same request.'
      : 'Permission, preparation or record state changed. Reload and inspect the request.',
  )
}

export async function acceptUpload(
  userClient: SupabaseClient,
  admin: SupabaseClient,
  actor: string,
  id: string,
  requestId: string,
): Promise<{ status: number; body: unknown }> {
  try {
    const inspect = async () => {
      const { data, error } = await userClient.rpc(
        'eacsc_get_upload_acceptance',
        {
          p_upload_id: id,
          p_request_id: requestId,
        },
      )
      if (error) databaseError(error.code)
      return object(data)
    }

    const initial = await inspect()
    if (initial.status === 'accepted') {
      return {
        status: 200,
        body: acknowledgement(initial.acknowledgement, id, requestId),
      }
    }

    const item = metadata(initial, id, actor)
    const bucket = admin.storage.from(item.bucket_id)
    const staged = await bucket.download(item.staging_key)

    if (staged.error || !staged.data) {
      const missing = staged.error && String(staged.error.statusCode) === '404'
      throw new AcceptanceError(
        missing ? 409 : 503,
        missing ? 'NOT_STAGED' : 'ACCEPTANCE_UNCONFIRMED',
        'The staged file could not be read. Keep both IDs and inspect or retry the same request.',
      )
    }

    if (staged.data.size !== item.file_size_bytes) {
      throw new AcceptanceError(
        422,
        'SIZE_MISMATCH',
        'Stored size differs from the prepared file.',
      )
    }

    const bytes = new Uint8Array(await staged.data.arrayBuffer())
    const verified = await verifyUpload(bytes, item)

    // Recheck current authority after parsing, before writing the final object.
    const current = await inspect()
    if (current.status === 'accepted') {
      return {
        status: 200,
        body: acknowledgement(current.acknowledgement, id, requestId),
      }
    }

    const latest = metadata(current, id, actor)
    if (
      latest.destination_key !== item.destination_key ||
      latest.sha256 !== item.sha256 ||
      latest.file_size_bytes !== item.file_size_bytes ||
      latest.mime_type !== item.mime_type
    ) {
      throw new AcceptanceError(
        409,
        'UPLOAD_CHANGED',
        'Prepared file details changed.',
      )
    }

    const saved = await bucket.upload(item.destination_key, bytes, {
      contentType: item.mime_type,
      cacheControl: '0',
      upsert: false,
    })

    if (saved.error) {
      const error = saved.error
      const conflict =
        error.name === 'StorageApiError' &&
        (String(error.statusCode) === '409' ||
          ('status' in error && error.status === 409) ||
          ('code' in error &&
            [
              'ResourceAlreadyExists',
              'KeyAlreadyExists',
              'already_exists',
            ].includes(String(error.code))))

      if (!conflict) {
        throw new AcceptanceError(
          503,
          'ACCEPTANCE_UNCONFIRMED',
          'Destination write could not be confirmed. Retry with the same IDs.',
        )
      }
    }

    // Verify the stored destination too; never overwrite or delete a conflict.
    const finalFile = await bucket.download(item.destination_key)
    if (finalFile.error || !finalFile.data) {
      throw new AcceptanceError(
        503,
        'ACCEPTANCE_UNCONFIRMED',
        'Destination read-back could not be confirmed. Retry with the same IDs.',
      )
    }

    if (finalFile.data.size !== item.file_size_bytes) {
      throw new AcceptanceError(
        409,
        'DESTINATION_CONFLICT',
        'The destination object requires inspection.',
      )
    }

    try {
      await verifyFileFacts(
        new Uint8Array(await finalFile.data.arrayBuffer()),
        item,
        [item.mime_type],
      )
    } catch (error) {
      if (!(error instanceof FileVerificationError)) throw error
      throw new AcceptanceError(
        409,
        'DESTINATION_CONFLICT',
        'The destination object requires inspection.',
      )
    }

    const info = await bucket.info(item.destination_key)
    if (info.error || !info.data || !UUID.test(info.data.id)) {
      throw new AcceptanceError(
        503,
        'ACCEPTANCE_UNCONFIRMED',
        'Destination identity could not be confirmed. Retry with the same IDs.',
      )
    }

    const result = await admin.rpc('eacsc_accept_version_upload', {
      p_actor_user_id: actor,
      p_upload_id: id,
      p_request_id: requestId,
      p_storage_object_id: info.data.id,
      p_verified_mime_type: verified.detected_mime_type,
      p_verified_file_size_bytes: verified.file_size_bytes,
      p_verified_sha256: verified.sha256,
      p_verifier_version: verified.verifier_version,
    })

    if (result.error) {
      // A lost response can follow a committed transaction. Recover its receipt first.
      const recovered = await inspect()
      if (recovered.status === 'accepted') {
        return {
          status: 200,
          body: acknowledgement(recovered.acknowledgement, id, requestId),
        }
      }
      databaseError(result.error.code)
    }

    return { status: 200, body: acknowledgement(result.data, id, requestId) }
  } catch (error) {
    if (error instanceof FileVerificationError) {
      return { status: 422, body: { code: error.code, message: error.message } }
    }
    if (error instanceof AcceptanceError) {
      return {
        status: error.status,
        body: { code: error.code, message: error.message },
      }
    }
    return {
      status: 503,
      body: {
        code: 'ACCEPTANCE_UNCONFIRMED',
        message:
          'Acceptance could not be confirmed. Keep both IDs and retry the same request.',
      },
    }
  }
}
