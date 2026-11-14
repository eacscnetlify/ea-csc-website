import { createClient } from '@supabase/supabase-js'
import { acceptUpload } from './accept-upload.ts'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Promise<Response>): void
}

const DEV_URL = 'https://gkhhwrrvqlzpayphvsqp.supabase.co'
const DEFAULT_ORIGIN = 'http://localhost:5173'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function resolveAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null
  const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== '*')
  const allowed = new Set([DEFAULT_ORIGIN, ...configured])
  return allowed.has(origin) ? origin : null
}

const MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
])

class UploadError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

interface UploadRequest {
  upload_id: string
  actor_user_id: string
  bucket_id: string
  staging_key: string
  mime_type: string
  file_size_bytes: number
  sha256: string
}

function reply(origin: string | null, status: number, body: unknown): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }

  const allowedOrigin = resolveAllowedOrigin(origin)
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin
    headers['Access-Control-Allow-Headers'] =
      'authorization, apikey, content-type, x-client-info'
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
  }

  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  })
}

function requestMetadata(
  value: unknown,
  id: string,
  actor: string,
): UploadRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UploadError(
      503,
      'INVALID_METADATA',
      'Upload configuration could not be confirmed.',
    )
  }

  const item = value as Record<string, unknown>
  const key = `quarantine/${actor}/${id}.`

  if (
    item.upload_id !== id ||
    item.actor_user_id !== actor ||
    item.bucket_id !== 'internal-council-records' ||
    typeof item.staging_key !== 'string' ||
    !item.staging_key.startsWith(key) ||
    !/^(pdf|docx|jpg|jpeg|png)$/.test(item.staging_key.slice(key.length)) ||
    typeof item.mime_type !== 'string' ||
    !MIME_TYPES.has(item.mime_type) ||
    typeof item.file_size_bytes !== 'number' ||
    !Number.isSafeInteger(item.file_size_bytes) ||
    item.file_size_bytes < 1 ||
    item.file_size_bytes > 10000000 ||
    typeof item.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(item.sha256)
  ) {
    throw new UploadError(
      503,
      'INVALID_METADATA',
      'Upload configuration could not be confirmed.',
    )
  }

  return item as unknown as UploadRequest
}

async function readBytes(
  request: Request,
  expected: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get('content-length')

  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) !== expected)
  ) {
    throw new UploadError(
      400,
      'SIZE_MISMATCH',
      'The file size differs from the prepared request.',
    )
  }

  if (!request.body) {
    throw new UploadError(400, 'EMPTY_FILE', 'Select a file to upload.')
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  const deadline = Date.now() + 30000

  let size = 0
  let finished = false

  try {
    while (true) {
      const remaining = deadline - Date.now()

      if (remaining <= 0) {
        throw new UploadError(
          408,
          'UPLOAD_TIMEOUT',
          'File reception timed out.',
        )
      }

      let timer: ReturnType<typeof setTimeout> | undefined

      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new UploadError(
                  408,
                  'UPLOAD_TIMEOUT',
                  'File reception timed out.',
                ),
              ),
            remaining,
          )
        }),
      ]).finally(() => clearTimeout(timer))

      if (result.done) {
        finished = true
        break
      }

      size += result.value.byteLength

      if (size > expected || size > 10000000) {
        throw new UploadError(
          413,
          'FILE_TOO_LARGE',
          'The received file exceeds its prepared size.',
        )
      }

      chunks.push(result.value)
    }
  } finally {
    if (!finished) void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  if (size !== expected) {
    throw new UploadError(
      400,
      'SIZE_MISMATCH',
      'The file size differs from the prepared request.',
    )
  }

  const bytes = new Uint8Array(size)
  let position = 0

  for (const chunk of chunks) {
    bytes.set(chunk, position)
    position += chunk.byteLength
  }

  return bytes
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')

  if (origin !== null && !resolveAllowedOrigin(origin)) {
    return reply(origin, 403, {
      code: 'ORIGIN_DENIED',
      message: 'Origin is not permitted.',
    })
  }

  if (request.method === 'OPTIONS') {
    return reply(origin, 204, null)
  }

  if (request.method !== 'POST') {
    return reply(origin, 405, {
      code: 'METHOD_NOT_ALLOWED',
    })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (url !== DEV_URL || !publicKey || !serverKey) {
      throw new UploadError(
        503,
        'CONFIGURATION',
        'The development upload service is not configured.',
      )
    }

    const authorization = request.headers.get('authorization')
    const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]

    if (!token) {
      throw new UploadError(
        401,
        'SIGN_IN_REQUIRED',
        'Sign in to upload a file.',
      )
    }

    const id = new URL(request.url).searchParams.get('upload_id')?.toLowerCase()

    if (!id || !UUID.test(id)) {
      throw new UploadError(
        400,
        'INVALID_UPLOAD_ID',
        'Provide a valid upload request ID.',
      )
    }

    const timedFetch: typeof fetch = (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      })

    const options = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { retry: false },
      global: { fetch: timedFetch },
    }

    const userClient = createClient(url, publicKey, {
      ...options,
      global: {
        ...options.global,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    })

    const { data: auth, error: authError } =
      await userClient.auth.getUser(token)

    if (
      authError ||
      !auth.user ||
      auth.user.is_anonymous !== false ||
      !UUID.test(auth.user.id)
    ) {
      throw new UploadError(
        401,
        'SIGN_IN_REQUIRED',
        'Sign in with an authorized officer account.',
      )
    }

    const actor = auth.user.id
    const action = new URL(request.url).searchParams.get('action') ?? 'stage'

    if (action === 'accept') {
      const requestId = new URL(request.url).searchParams
        .get('request_id')
        ?.toLowerCase()

      if (!requestId || !UUID.test(requestId)) {
        throw new UploadError(
          400,
          'INVALID_REQUEST_ID',
          'Provide a valid acceptance request ID.',
        )
      }

      const result = await acceptUpload(
        userClient,
        createClient(url, serverKey, options),
        actor,
        id,
        requestId,
      )

      return reply(origin, result.status, result.body)
    }

    if (action !== 'stage') {
      throw new UploadError(400, 'INVALID_ACTION', 'Use stage or accept.')
    }
    const getRequest = async () => {
      const { data, error } = await userClient.rpc('eacsc_get_upload_request', {
        p_upload_id: id,
      })

      if (error) {
        const status =
          error.code === '42501'
            ? 403
            : error.code === 'PT409'
              ? 409
              : error.code === '55000'
                ? 409
                : 503

        throw new UploadError(
          status,
          'UPLOAD_UNAVAILABLE',
          status === 503
            ? 'Upload permission could not be confirmed.'
            : 'Upload permission or preparation has changed. Reload and check the request.',
        )
      }

      return requestMetadata(data, id, actor)
    }

    const item = await getRequest()
    const bytes = await readBytes(request, item.file_size_bytes)

    if ((await sha256(bytes)) !== item.sha256) {
      throw new UploadError(
        422,
        'CHECKSUM_MISMATCH',
        'The file differs from the prepared checksum.',
      )
    }

    // Recheck permission after receiving the file.
    const current = await getRequest()

    if (JSON.stringify(current) !== JSON.stringify(item)) {
      throw new UploadError(409, 'UPLOAD_CHANGED', 'Prepare the upload again.')
    }

    // Privileged client is used only for the selected Storage object.
    const admin = createClient(url, serverKey, options)

    const { error } = await admin.storage
      .from(item.bucket_id)
      .upload(item.staging_key, bytes.buffer, {
        contentType: item.mime_type,
        cacheControl: '0',
        upsert: false,
      })

    if (error) {
      const alreadyExists =
        error.name === 'StorageApiError' &&
        (error.status === 409 ||
          String(error.statusCode) === '409' ||
          ('code' in error &&
            [
              'ResourceAlreadyExists',
              'KeyAlreadyExists',
              'already_exists',
            ].includes(String(error.code))))

      if (alreadyExists) {
        const existing = await admin.storage
          .from(item.bucket_id)
          .download(item.staging_key)

        if (
          existing.error ||
          !existing.data ||
          existing.data.size !== item.file_size_bytes
        ) {
          throw new UploadError(
            409,
            'STAGING_CONFLICT',
            'The existing staged object requires inspection.',
          )
        }

        const saved = new Uint8Array(await existing.data.arrayBuffer())

        if ((await sha256(saved)) !== item.sha256) {
          throw new UploadError(
            409,
            'STAGING_CONFLICT',
            'The existing staged object requires inspection.',
          )
        }
      } else {
        throw new UploadError(
          503,
          'STAGING_UNCONFIRMED',
          'Staging could not be confirmed. Keep the same upload request for inspection or retry.',
        )
      }
    }

    return reply(origin, 200, {
      upload_id: id,
      status: 'staged',
      byte_size: item.file_size_bytes,
      sha256: item.sha256,
      accepted_version: false,
      message:
        'File staged privately. Document verification and acceptance are pending.',
    })
  } catch (error) {
    if (error instanceof UploadError) {
      return reply(origin, error.status, {
        code: error.code,
        message: error.message,
      })
    }

    return reply(origin, 503, {
      code: 'STAGING_UNCONFIRMED',
      message:
        'The operation could not be confirmed. Keep the upload request for inspection or retry.',
    })
  }
})
