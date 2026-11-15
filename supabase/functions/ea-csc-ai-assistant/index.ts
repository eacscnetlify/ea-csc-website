declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Promise<Response>): void
}

const DEFAULT_ORIGIN = 'http://localhost:5173'
const MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.0-flash',
]

function resolveAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null
  const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== '*')
  const allowed = new Set([DEFAULT_ORIGIN, ...configured])
  return allowed.has(origin) ? origin : null
}

function baseHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  }
  const allowedOrigin = resolveAllowedOrigin(origin)
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin
    headers['Access-Control-Allow-Headers'] =
      'authorization, apikey, content-type, x-client-info'
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
  }
  return headers
}

function reply(origin: string | null, status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...baseHeaders(origin), 'Content-Type': 'application/json' },
  })
}

const SYSTEM_INSTRUCTION = `You are the official AI Governance & Student Assistant for the Catanduanes State University — Engineering and Architecture College Student Council (CatSU EA-CSC) Institutional Information and Document Governance System (IIDGS).

Your capabilities:
1. Website & Governance Expert:
   - Explain pages: Public Library (/), Record Detail (/records/:id), Update Bulletins (/bulletins), Help & Guide (/help), Officer Workspace (/officer), Review Queue (/officer/reviews), Release Panel (/officer/releases), Bulletin Compiler (/officer/bulletins), Turnover & Continuity (/officer/turnover), Access Transfer (/officer/admin/access), My Account & Roles (/account).
   - Explain roles & Segregation of Duties:
     * Public Visitor / Observer: Browse & download published public records and public bulletins.
     * Author: Edit Draft notes, upload PDF/DOCX/PNG/JPEG (max 10 MB, magic-byte checked), submit versions for review. Cannot approve own submissions.
     * Custodian (e.g., Executive Secretary): Author duties + Bulletin compilation + Turnover preparation.
     * Reviewer: Non-author verification using the 6-point checklist; can Return for Correction.
     * Approver (e.g., President, VP): Grants Substantive Approval after all 6 checklist items pass.
     * Publisher (e.g., PIO): Publishes, schedules, supersedes, or executes emergency Withdrawals in Release Panel.
     * Technical Admin: Manages roles & Access Transfer during end-of-term turnover.
   - 6-Point Verification Checklist:
     1) Identity & version alignment
     2) Dates, deadlines & Asia/Manila (UTC+8) time
     3) Location, venue, or official link
     4) Audience eligibility & requirements
     5) Issuing authority & privacy disclosure (RA 10173 Data Privacy Act)
     6) Contact channel & reference IDs
   - Lifecycle: Draft -> For Review -> Approved -> Published -> Superseded / Withdrawn.
   - Categories: GOV (Governance & Legislation), ACT (Activities & Events), SEC (Secretariat & Minutes), FIN (Financial Records), FRM (Official Forms), TRN (Turnover & Continuity).
   - Integrity: SHA-256 checksums verify file authenticity; HTTP 409 / PT409 means optimistic-lock conflict (reload before saving).
2. General Assisting Functions:
   - Summarize pasted texts, meeting minutes, memos, or announcements into concise bullet points and action items.
   - Define words, technical terms, or governance vocabulary clearly with examples.
   - Draft or polish council announcements, resolution summaries, or return-for-correction notes.
   - Answer general academic, engineering, or student productivity questions concisely.

Style rules:
- Be clear, concise, accurate, and polite.
- Use plain text or clean bullet points (avoid heavy markdown clutter).
- Never invent fake database records or user credentials.`

function inferHelpSection(text: string, pathname?: string): string | undefined {
  const lower = text.toLowerCase()
  if (lower.includes('role') || lower.includes('permission') || lower.includes('privilege')) {
    return 'roles'
  }
  if (lower.includes('checklist') || lower.includes('6-point') || lower.includes('review') || lower.includes('approve')) {
    return 'review-queue'
  }
  if (lower.includes('bulletin') || lower.includes('cutoff')) {
    return 'bulletins'
  }
  if (lower.includes('release') || lower.includes('publish') || lower.includes('withdraw') || lower.includes('supersede')) {
    return 'release-panel'
  }
  if (lower.includes('turnover') || lower.includes('handover')) {
    return 'turnover'
  }
  if (lower.includes('access transfer') || lower.includes('custody')) {
    return 'access-transfer'
  }
  if (lower.includes('upload') || lower.includes('409') || lower.includes('error') || lower.includes('password')) {
    return 'troubleshooting'
  }
  if (pathname?.startsWith('/officer/reviews')) return 'review-queue'
  if (pathname?.startsWith('/officer/releases')) return 'release-panel'
  if (pathname?.startsWith('/officer/bulletins')) return 'bulletins'
  if (pathname?.startsWith('/officer/turnover')) return 'turnover'
  if (pathname?.startsWith('/officer/admin/access')) return 'access-transfer'
  if (pathname?.startsWith('/officer')) return 'workspace'
  return undefined
}

async function callGemini(
  apiKey: string,
  model: string,
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  return await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(9000),
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 900,
      },
    }),
  })
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
    const apiKey = (Deno.env.get('GEMINI_API_KEY') ?? '').trim()
    if (!apiKey) {
      return reply(origin, 200, {
        configured: false,
        reason: 'GEMINI_API_KEY_NOT_SET',
      })
    }

    const payload = (await request.json().catch(() => null)) as {
      mode?: 'chat' | 'summarize' | 'define'
      message?: string
      pathname?: string
      pageTitle?: string
      history?: Array<{ role?: string; text?: string }>
    } | null

    const message = (payload?.message ?? '').trim()
    if (!message) {
      return reply(origin, 400, { code: 'EMPTY_MESSAGE' })
    }
    if (message.length > 12000) {
      return reply(origin, 400, { code: 'MESSAGE_TOO_LONG' })
    }

    const mode = payload?.mode ?? 'chat'
    const contextPrefix = payload?.pathname
      ? `[User is currently viewing route "${payload.pathname}" (${payload.pageTitle ?? 'Portal Page'})]\n`
      : ''

    const modePrompt =
      mode === 'summarize'
        ? `${contextPrefix}Please summarize and analyze the following council/document text. Provide:\n1. Suggested EA-CSC Category Code (GOV, ACT, SEC, FIN, FRM, or TRN)\n2. Key Points Summary (3-5 concise bullets)\n3. 6-Point Verification Checklist Readiness (note any missing date/time UTC+8, venue/link, contact channel, or authority details)\n\nText:\n${message}`
        : mode === 'define'
          ? `${contextPrefix}Please define the following term or word clearly, concisely, and include how it applies in EA-CSC / engineering governance if relevant:\n${message}`
          : `${contextPrefix}${message}`

    const history = Array.isArray(payload?.history) ? payload!.history.slice(-8) : []
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []

    for (const turn of history) {
      const text = (turn?.text ?? '').trim()
      if (!text) continue
      contents.push({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: text.slice(0, 2000) }],
      })
    }
    contents.push({ role: 'user', parts: [{ text: modePrompt }] })

    const preferredModel = (Deno.env.get('GEMINI_MODEL') ?? '').trim()
    const candidates = preferredModel
      ? [preferredModel, ...MODEL_CANDIDATES.filter((m) => m !== preferredModel)]
      : MODEL_CANDIDATES

    let res: Response | null = null
    let usedModel = candidates[0]
    for (const candidate of candidates) {
      usedModel = candidate
      try {
        res = await callGemini(apiKey, candidate, contents)
      } catch {
        res = null
        continue
      }
      if (res.ok) break
      // Retry next model on 404 (retired), 429 (rate limit), or 5xx (temporary high demand)
      if (res.status !== 404 && res.status !== 429 && res.status < 500) {
        break
      }
    }

    if (!res || !res.ok) {
      const errText = res ? await res.text().catch(() => '') : 'NO_RESPONSE'
      return reply(origin, 200, {
        configured: true,
        fallback: true,
        status: res?.status ?? 500,
        error: errText.slice(0, 300),
      })
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
      }>
    }

    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim() ?? ''

    if (!text) {
      return reply(origin, 200, {
        configured: true,
        fallback: true,
        error: 'EMPTY_GEMINI_RESPONSE',
      })
    }

    return reply(origin, 200, {
      configured: true,
      fallback: false,
      model: usedModel,
      reply: text,
      helpSection: inferHelpSection(`${message}\n${text}`, payload?.pathname),
    })
  } catch (err) {
    return reply(origin, 200, {
      configured: false,
      fallback: true,
      error: err instanceof Error ? err.message : 'UNKNOWN_ERROR',
    })
  }
})
