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

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  if (origin !== null && !resolveAllowedOrigin(origin)) {
    return reply(origin, 403, { code: 'ORIGIN_DENIED' })
  }
  if (request.method === 'OPTIONS') return reply(origin, 204, null)
  if (request.method !== 'POST') {
    return reply(origin, 405, { code: 'METHOD_NOT_ALLOWED' })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (url !== DEV_URL || !publicKey || !serverKey) {
      return reply(origin, 503, {
        code: 'CONFIGURATION',
        message: 'Release service is not configured.',
      })
    }

    const token = request.headers
      .get('authorization')
      ?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (!token) {
      return reply(origin, 401, {
        code: 'SIGN_IN_REQUIRED',
        message: 'Sign in to publish a release.',
      })
    }

    const payload = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (
      !payload ||
      typeof payload.version_id !== 'string' ||
      !UUID.test(payload.version_id) ||
      typeof payload.request_id !== 'string' ||
      !UUID.test(payload.request_id) ||
      typeof payload.release_id !== 'string' ||
      !UUID.test(payload.release_id) ||
      !Number.isSafeInteger(payload.expected_version_revision) ||
      !Number.isSafeInteger(payload.expected_record_revision)
    ) {
      return reply(origin, 400, {
        code: 'INVALID_REQUEST',
        message: 'Provide valid release identifiers and revisions.',
      })
    }

    const options = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { retry: false },
    }
    const userClient = createClient(url, publicKey, {
      ...options,
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: auth, error: authError } =
      await userClient.auth.getUser(token)
    if (
      authError ||
      !auth.user ||
      auth.user.is_anonymous !== false ||
      !UUID.test(auth.user.id)
    ) {
      return reply(origin, 401, {
        code: 'SIGN_IN_REQUIRED',
        message: 'Sign in with an authorized publisher account.',
      })
    }

    const { data: ctx, error: ctxError } = await userClient.rpc(
      'eacsc_get_publish_context',
      { p_version_id: payload.version_id },
    )
    if (ctxError || !ctx || typeof ctx !== 'object') {
      const status =
        ctxError?.code === '42501'
          ? 403
          : ctxError?.code === '55000'
            ? 409
            : 400
      return reply(origin, status, {
        code: ctxError?.code ?? 'PUBLISH_DENIED',
        message:
          ctxError?.message ?? 'Publication is not permitted for this version.',
      })
    }

    const admin = createClient(url, serverKey, options)
    const sourceBucket = String(
      (ctx as Record<string, unknown>).source_bucket_id,
    )
    const sourceKey = String(
      (ctx as Record<string, unknown>).source_storage_key,
    )
    const expectedSha = String((ctx as Record<string, unknown>).sha256)
    const mimeType = String((ctx as Record<string, unknown>).mime_type)
    const recordId = String((ctx as Record<string, unknown>).record_id)
    const versionNumber = Number(
      (ctx as Record<string, unknown>).version_number,
    )

    const downloaded = await admin.storage
      .from(sourceBucket)
      .download(sourceKey)
    if (downloaded.error || !downloaded.data) {
      return reply(origin, 503, {
        code: 'SOURCE_UNAVAILABLE',
        message: 'Source attachment could not be read.',
      })
    }

    const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
    const actualSha = await sha256(bytes)
    if (actualSha !== expectedSha) {
      return reply(origin, 409, {
        code: 'CHECKSUM_MISMATCH',
        message: 'Source attachment integrity check failed.',
      })
    }

    const ext = sourceKey.split('.').at(-1) ?? 'bin'
    const releaseBucket = 'verified-council-releases'
    const releaseKey = `releases/${recordId}/v${versionNumber}_${payload.release_id}.${ext}`

    const uploaded = await admin.storage
      .from(releaseBucket)
      .upload(releaseKey, bytes, {
        contentType: mimeType,
        cacheControl: '0',
        upsert: false,
      })

    if (uploaded.error) {
      const conflict =
        uploaded.error.name === 'StorageApiError' &&
        (String(uploaded.error.statusCode) === '409' ||
          ('status' in uploaded.error && uploaded.error.status === 409))
      if (!conflict) {
        return reply(origin, 503, {
          code: 'RELEASE_COPY_FAILED',
          message: 'Verified release copy could not be stored.',
        })
      }
      const existing = await admin.storage
        .from(releaseBucket)
        .download(releaseKey)
      if (
        existing.error ||
        !existing.data ||
        (await sha256(new Uint8Array(await existing.data.arrayBuffer()))) !==
          expectedSha
      ) {
        return reply(origin, 409, {
          code: 'RELEASE_CONFLICT',
          message: 'Release destination conflict.',
        })
      }
    }

    const { data: pubData, error: pubError } = await admin.rpc(
      'eacsc_publish_version',
      {
        p_actor_user_id: auth.user.id,
        p_version_id: payload.version_id,
        p_expected_version_revision: payload.expected_version_revision,
        p_expected_record_revision: payload.expected_record_revision,
        p_release_id: payload.release_id,
        p_audience: payload.audience,
        p_public_title: payload.public_title,
        p_public_category: payload.public_category,
        p_authorization_basis: payload.authorization_basis,
        p_authorization_reference: payload.authorization_reference,
        p_effective_from: payload.effective_from ?? null,
        p_release_bucket_id: releaseBucket,
        p_release_storage_key: releaseKey,
        p_release_sha256: actualSha,
        p_request_id: payload.request_id,
      },
    )

    if (pubError) {
      const status =
        pubError.code === '42501'
          ? 403
          : pubError.code === 'PT409' || pubError.code === '55000'
            ? 409
            : 400
      return reply(origin, status, {
        code: pubError.code,
        message: pubError.message,
      })
    }

    return reply(origin, 200, pubData)
  } catch {
    return reply(origin, 503, {
      code: 'PUBLISH_UNCONFIRMED',
      message: 'Publication could not be confirmed. Retry with the same IDs.',
    })
  }
})
