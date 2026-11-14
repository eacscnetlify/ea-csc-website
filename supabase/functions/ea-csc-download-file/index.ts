import { createClient } from '@supabase/supabase-js'

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

const EXTENSIONS: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'docx',
  ],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
}

class FileError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

interface FileInfo {
  version_id: string
  record_id: string
  version_number: number
  revision_counter: number
  state: string
  upload_id: string
  bucket_id: string
  storage_key: string
  original_filename: string
  mime_type: string
  file_size_bytes: number
  sha256: string
}

function metadata(value: unknown, id: string): FileInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FileError(
      503,
      'FILE_UNAVAILABLE',
      'File details could not be confirmed.',
    )
  }

  const item = value as Record<string, unknown>
  const extensions =
    typeof item.mime_type === 'string' ? EXTENSIONS[item.mime_type] : undefined
  const extension =
    typeof item.storage_key === 'string'
      ? item.storage_key.split('.').at(-1)
      : undefined

  if (
    item.version_id !== id ||
    typeof item.upload_id !== 'string' ||
    !UUID.test(item.upload_id) ||
    typeof item.record_id !== 'string' ||
    !/^EACSC-[1-9][0-9]{3}-[A-Z]{2,10}-[0-9]{4}$/.test(item.record_id) ||
    !Number.isSafeInteger(item.version_number) ||
    Number(item.version_number) < 1 ||
    !Number.isSafeInteger(item.revision_counter) ||
    Number(item.revision_counter) < 1 ||
    !['Draft', 'For Review', 'Approved', 'Superseded'].includes(
      String(item.state),
    ) ||
    item.bucket_id !== 'internal-council-records' ||
    !extension ||
    !extensions?.includes(extension) ||
    typeof item.storage_key !== 'string' ||
    !/^(governance|secretariat|activities|financial|forms|turnover)\//.test(
      item.storage_key,
    ) ||
    item.storage_key.split('/').slice(1).join('/') !==
      `${item.record_id}/${item.version_number}_${item.upload_id}.${extension}` ||
    typeof item.original_filename !== 'string' ||
    !item.original_filename.trim() ||
    Array.from(item.original_filename).length > 255 ||
    Array.from(item.original_filename).some(
      (c) =>
        c.charCodeAt(0) < 32 ||
        c.charCodeAt(0) === 127 ||
        c === '/' ||
        c === '\\',
    ) ||
    typeof item.file_size_bytes !== 'number' ||
    !Number.isSafeInteger(item.file_size_bytes) ||
    item.file_size_bytes < 1 ||
    item.file_size_bytes > 10000000 ||
    typeof item.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(item.sha256)
  ) {
    throw new FileError(
      503,
      'FILE_UNAVAILABLE',
      'File details could not be confirmed.',
    )
  }

  return item as unknown as FileInfo
}

function headers(origin: string | null) {
  const result: Record<string, string> = {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin, Authorization',
  }

  const allowedOrigin = resolveAllowedOrigin(origin)
  if (allowedOrigin) {
    result['Access-Control-Allow-Origin'] = allowedOrigin
    result['Access-Control-Allow-Headers'] =
      'authorization, apikey, content-type, x-client-info'
    result['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    result['Access-Control-Expose-Headers'] =
      'Content-Disposition, Content-Length, X-Content-SHA256'
  }

  return result
}

function reply(origin: string | null, status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...headers(origin), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')

  if (origin !== null && !resolveAllowedOrigin(origin)) {
    return reply(origin, 403, { code: 'ORIGIN_DENIED' })
  }
  if (request.method === 'OPTIONS') return reply(origin, 204, null)
  if (request.method !== 'GET') {
    return reply(origin, 405, { code: 'METHOD_NOT_ALLOWED' })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (url !== DEV_URL || !publicKey || !serverKey) {
      throw new FileError(
        503,
        'CONFIGURATION',
        'The development file service is not configured.',
      )
    }

    const token = request.headers
      .get('authorization')
      ?.match(/^Bearer\s+(\S+)$/i)?.[1]

    if (!token) {
      throw new FileError(
        401,
        'SIGN_IN_REQUIRED',
        'Sign in to download this file.',
      )
    }

    const id = new URL(request.url).searchParams
      .get('version_id')
      ?.toLowerCase()

    if (!id || !UUID.test(id)) {
      throw new FileError(
        400,
        'INVALID_VERSION_ID',
        'Provide a valid version ID.',
      )
    }

    const timedFetch: typeof fetch = (input, init) =>
      fetch(input, {
        ...init,
        cache: 'no-store',
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
        headers: { Authorization: `Bearer ${token}` },
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
      throw new FileError(
        401,
        'SIGN_IN_REQUIRED',
        'Sign in with an authorized officer account.',
      )
    }

    const getFile = async () => {
      const { data, error } = await userClient.rpc('eacsc_get_version_file', {
        p_version_id: id,
      })

      if (error) {
        const status =
          error.code === '42501' ? 403 : error.code === '55000' ? 409 : 503

        throw new FileError(
          status,
          'FILE_UNAVAILABLE',
          'Current file access could not be confirmed.',
        )
      }

      return metadata(data, id)
    }

    const item = await getFile()
    const admin = createClient(url, serverKey, options)
    const stored = await admin.storage
      .from(item.bucket_id)
      .download(item.storage_key)

    if (
      stored.error ||
      !stored.data ||
      stored.data.size !== item.file_size_bytes
    ) {
      throw new FileError(
        503,
        'FILE_UNAVAILABLE',
        'The stored file could not be confirmed.',
      )
    }

    const bytes = new Uint8Array(await stored.data.arrayBuffer())
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')

    if (hash !== item.sha256) {
      throw new FileError(
        503,
        'INTEGRITY_CHECK_FAILED',
        'The stored file requires inspection.',
      )
    }

    // Recheck current permission and version facts before returning bytes.
    const current = await getFile()

    if (
      Object.keys(item).some(
        (key) => item[key as keyof FileInfo] !== current[key as keyof FileInfo],
      )
    ) {
      throw new FileError(
        409,
        'VERSION_CHANGED',
        'The version changed. Reload before downloading.',
      )
    }

    const filename = encodeURIComponent(item.original_filename).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    )

    return new Response(bytes, {
      status: 200,
      headers: {
        ...headers(origin),
        'Content-Type': item.mime_type,
        'Content-Length': String(bytes.byteLength),
        'X-Content-SHA256': hash,
        'Content-Disposition': `attachment; filename="download.${EXTENSIONS[item.mime_type][0]}"; filename*=UTF-8''${filename}`,
      },
    })
  } catch (error) {
    if (error instanceof FileError) {
      return reply(origin, error.status, {
        code: error.code,
        message: error.message,
      })
    }

    return reply(origin, 503, {
      code: 'FILE_UNAVAILABLE',
      message:
        'File retrieval could not be confirmed. Retry after checking access.',
    })
  }
})
