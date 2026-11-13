import { createClient } from '@supabase/supabase-js'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Promise<Response>): void
}

const DEV_URL = 'https://gkhhwrrvqlzpayphvsqp.supabase.co'
const ORIGIN = 'http://localhost:5173'
const RECORD_ID = /^EACSC-[1-9][0-9]{3}-[A-Z]{2,10}-[0-9]{4}$/

function baseHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  }
  if (origin === ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ORIGIN
    headers['Access-Control-Allow-Headers'] =
      'authorization, apikey, content-type, x-client-info'
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    headers['Access-Control-Expose-Headers'] =
      'Content-Disposition, Content-Length, X-Content-SHA256'
  }
  return headers
}

function reply(origin: string | null, status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...baseHeaders(origin), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== ORIGIN) {
    return reply(origin, 403, { code: 'ORIGIN_DENIED' })
  }
  if (request.method === 'OPTIONS') return reply(origin, 204, null)
  if (request.method !== 'GET') {
    return reply(origin, 405, { code: 'METHOD_NOT_ALLOWED' })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (url !== DEV_URL || !serverKey) {
      return reply(origin, 503, { code: 'CONFIGURATION' })
    }

    const recordId =
      new URL(request.url).searchParams.get('record_id')?.trim() ?? ''
    if (!RECORD_ID.test(recordId)) {
      return reply(origin, 400, {
        code: 'INVALID_RECORD_ID',
        message: 'Provide a valid record ID.',
      })
    }

    const admin = createClient(url, serverKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { retry: false },
    })

    const { data: info, error } = await admin.rpc('eacsc_public_release_file', {
      p_record_id: recordId,
    })
    if (error || !info || typeof info !== 'object') {
      return reply(origin, 404, {
        code: 'RELEASE_UNAVAILABLE',
        message: 'No active public release file is available for this record.',
      })
    }

    const row = info as Record<string, unknown>
    const stored = await admin.storage
      .from(String(row.bucket_id))
      .download(String(row.storage_key))

    if (
      stored.error ||
      !stored.data ||
      stored.data.size !== Number(row.file_size_bytes)
    ) {
      return reply(origin, 503, { code: 'FILE_UNAVAILABLE' })
    }

    const bytes = new Uint8Array(await stored.data.arrayBuffer())
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')

    if (hash !== String(row.sha256)) {
      return reply(origin, 503, { code: 'INTEGRITY_CHECK_FAILED' })
    }

    const encodedName = encodeURIComponent(
      String(row.original_filename),
    ).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    )

    return new Response(bytes, {
      status: 200,
      headers: {
        ...baseHeaders(origin),
        'Content-Type': String(row.mime_type),
        'Content-Length': String(bytes.byteLength),
        'X-Content-SHA256': hash,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
      },
    })
  } catch {
    return reply(origin, 503, { code: 'FILE_UNAVAILABLE' })
  }
})
