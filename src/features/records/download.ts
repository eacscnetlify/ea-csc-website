import { getSupabaseClient } from '../../lib/supabase'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const extensions: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'docx',
  ],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
}

export class DownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DownloadError'
  }
}

export async function downloadVersionFile(
  actorId: string,
  versionId: string,
  cancellation: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  if (!uuid.test(actorId) || !uuid.test(versionId))
    throw new DownloadError('Reload the record before downloading.')
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(60_000)])
  const client = getSupabaseClient()
  async function session() {
    signal.throwIfAborted()
    const result = await client.auth.getSession()
    signal.throwIfAborted()
    const current = result.data.session
    if (
      result.error ||
      current?.user.id !== actorId ||
      current.user.is_anonymous !== false
    )
      throw new DownloadError(
        'Your sign-in changed. Sign in again before downloading.',
      )
    return current
  }
  const current = await session()
  const endpoint = new URL(
    '/functions/v1/ea-csc-download-file',
    import.meta.env.VITE_SUPABASE_URL,
  )
  endpoint.searchParams.set('version_id', versionId)
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${current.access_token}`,
    },
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    const messages: Record<number, string> = {
      401: 'Your sign-in expired. Sign in again before downloading.',
      403: 'Your current account cannot download this version. Refresh access and reload the record.',
      409: 'The attachment is unavailable or the version changed. Reload the record before trying again.',
    }
    throw new DownloadError(
      messages[response.status] ??
        'The file could not be retrieved. Check your connection and try again.',
    )
  }
  const mime =
    response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ??
    ''
  const length = Number(response.headers.get('Content-Length'))
  const hash = response.headers.get('X-Content-SHA256') ?? ''
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const encodedName = disposition.match(
    /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i,
  )?.[1]
  let filename = ''
  try {
    filename = decodeURIComponent(encodedName ?? '')
  } catch {
    // Invalid metadata is rejected below; never use a server error body as a file.
  }
  if (
    response.status !== 200 ||
    !Object.hasOwn(extensions, mime) ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > 10_000_000 ||
    !/^[0-9a-f]{64}$/.test(hash) ||
    !/^attachment\s*;/i.test(disposition) ||
    !filename.trim() ||
    Array.from(filename).length > 255 ||
    Array.from(filename).some(
      (c) =>
        c.charCodeAt(0) < 32 ||
        c.charCodeAt(0) === 127 ||
        c === '/' ||
        c === '\\',
    ) ||
    !extensions[mime]?.includes(
      filename.split('.').pop()?.toLowerCase() ?? '',
    ) ||
    !response.body
  ) {
    await response.body?.cancel()
    throw new DownloadError(
      'The attachment details could not be verified. Reload the record.',
    )
  }
  const reader = response.body.getReader()
  const bytes = new Uint8Array(length)
  let offset = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > length - offset)
        throw new DownloadError(
          'The downloaded file size could not be verified.',
        )
      bytes.set(value, offset)
      offset += value.byteLength
    }
  } finally {
    try {
      await reader.cancel()
    } finally {
      reader.releaseLock()
    }
  }
  if (offset !== length)
    throw new DownloadError(
      'The download was incomplete. Try downloading again.',
    )
  const actual = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  if (actual !== hash)
    throw new DownloadError(
      'The downloaded file failed its integrity check. No file was saved.',
    )
  await session()
  return { blob: new Blob([bytes], { type: mime }), filename }
}

export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /FBAN|FBAV|Messenger|Instagram|Line\/|MicroMessenger/i.test(
    navigator.userAgent,
  )
}

export function shouldUseCanvasPdfViewer(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    isInAppBrowser() ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  )
}

export function saveDownloadedFile(file: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    // Give the browser time to consume the temporary download URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
