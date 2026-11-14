import { createClient } from '@supabase/supabase-js'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Promise<Response>): void
}

const DEV_URL = 'https://gkhhwrrvqlzpayphvsqp.supabase.co'
const ORIGIN = 'http://localhost:5173'

function headers(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  }
  if (origin === ORIGIN) {
    h['Access-Control-Allow-Origin'] = ORIGIN
    h['Access-Control-Allow-Headers'] =
      'authorization, apikey, content-type, x-client-info'
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    h['Access-Control-Expose-Headers'] =
      'Content-Disposition, Content-Length, X-Content-SHA256'
  }
  return h
}

function reply(origin: string | null, status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...headers(origin), 'Content-Type': 'application/json' },
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

    const params = new URL(request.url).searchParams
    const bulletinId = params.get('bulletin_id')?.trim() ?? ''
    const versionNum = Number(params.get('issue_version'))

    if (
      !/^EACSC-[1-9][0-9]{3}-BUL-[0-9]{4}$/.test(bulletinId) ||
      !Number.isSafeInteger(versionNum) ||
      versionNum < 1
    ) {
      return reply(origin, 400, {
        code: 'INVALID_PARAMETERS',
        message: 'Provide valid bulletin ID and issue version.',
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

    const { data: info, error } = await admin.rpc('eacsc_bulletin_file_facts', {
      p_bulletin_id: bulletinId,
      p_issue_version: versionNum,
    })

    if (error || !info || typeof info !== 'object') {
      return reply(origin, 404, {
        code: 'BULLETIN_UNAVAILABLE',
        message: 'Preserved bulletin file is unavailable.',
      })
    }

    const row = info as Record<string, unknown>
    if (row.withdrawn_at !== null) {
      return reply(origin, 404, {
        code: 'BULLETIN_WITHDRAWN',
        message: 'This bulletin has been withdrawn.',
      })
    }

    // If internal audience, require valid officer session
    if (row.audience === 'internal') {
      const token = request.headers
        .get('authorization')
        ?.match(/^Bearer\s+(\S+)$/i)?.[1]
      if (!token) {
        return reply(origin, 401, {
          code: 'SIGN_IN_REQUIRED',
          message: 'Sign in to access internal bulletins.',
        })
      }
      const { data: auth, error: authError } = await admin.auth.getUser(token)
      if (authError || !auth.user || auth.user.is_anonymous !== false) {
        return reply(origin, 403, { code: 'ACCESS_DENIED' })
      }
    }

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

    const filename = `${bulletinId}_v${versionNum}.pdf`

    return new Response(bytes, {
      status: 200,
      headers: {
        ...headers(origin),
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'X-Content-SHA256': hash,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch {
    return reply(origin, 503, { code: 'FILE_UNAVAILABLE' })
  }
})
