export type EngineSource = 'gemini' | 'local'

export interface AssistantReply {
  text: string
  engine: EngineSource
  model?: string
  helpSection?: string
  helpLabel?: string
  geminiConfigured?: boolean
}

export interface SummaryAnalysis {
  category: string
  bullets: string[]
  entities: {
    dates: string[]
    locations: string[]
    contacts: string[]
    amounts: string[]
  }
  reminders: string[]
  engine: EngineSource
  model?: string
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant'
  text: string
}

export const ROUTE_CONTEXT: Array<{
  match: (path: string) => boolean
  title: string
  summary: string
  section: string
}> = [
  {
    match: (p) => p === '/',
    title: 'Public Library',
    summary:
      'You are on the Public Library. Anyone can search, filter by category, preview details, and download verified current public releases without signing in.',
    section: 'public-library',
  },
  {
    match: (p) => p.startsWith('/records/'),
    title: 'Record Detail',
    summary:
      'You are viewing an official record page. It shows the current public release, official file download, any Superseded prior versions, and any emergency Withdrawal notice.',
    section: 'public-library',
  },
  {
    match: (p) => p === '/bulletins',
    title: 'Update Bulletins',
    summary:
      'You are on Update Bulletins. Public visitors can browse and download compiled council update PDFs issued by officers.',
    section: 'bulletins',
  },
  {
    match: (p) => p === '/officer',
    title: 'Officer Workspace',
    summary:
      'You are in the Officer Workspace. Assigned Authors and Custodians can edit Draft notes, upload PDF/DOCX/PNG/JPEG files (max 10 MB), and Submit versions for review.',
    section: 'workspace',
  },
  {
    match: (p) => p === '/officer/reviews',
    title: 'Review Queue',
    summary:
      'You are in the Review Queue. Non-author Reviewers and Approvers inspect submitted versions, complete the 6-point verification checklist, and either Return for Correction or Approve.',
    section: 'review-queue',
  },
  {
    match: (p) => p === '/officer/releases',
    title: 'Release Panel',
    summary:
      'You are in the Release Panel. Authorized Publishers (PIOs) publish Approved versions immediately or on a schedule, activate scheduled releases, supersede old versions, or execute emergency Withdrawals.',
    section: 'release-panel',
  },
  {
    match: (p) => p === '/officer/bulletins',
    title: 'Bulletin Compiler',
    summary:
      'You are in the Bulletin Compiler. Officers select a reporting window and cutoff time (Asia/Manila), preview a compiled PDF, and issue versioned Public or Internal bulletins.',
    section: 'bulletins',
  },
  {
    match: (p) => p === '/officer/turnover',
    title: 'Turnover & Continuity',
    summary:
      'You are in Turnover & Continuity. Outgoing and incoming officers prepare, freeze, export, and acknowledge the end-of-term council records package.',
    section: 'turnover',
  },
  {
    match: (p) => p === '/officer/admin/access',
    title: 'Access Transfer',
    summary:
      'You are in Access Transfer. Technical Administrators update officer roles, transfer record custody to incoming officers, and deactivate outgoing accounts.',
    section: 'access-transfer',
  },
  {
    match: (p) => p === '/account',
    title: 'My Account & Roles',
    summary:
      'You are on My Account & Roles. View your assigned EA-CSC functions, request an officer position upgrade, or update your account security.',
    section: 'roles',
  },
  {
    match: (p) => p === '/help',
    title: 'Help & Operations Guide',
    summary:
      'You are in the Help Center. Use the search box or expandable topic cards to read step-by-step instructions for every role and page.',
    section: 'overview',
  },
]

const GOVERNANCE_GLOSSARY: Record<string, { term: string; definition: string; section?: string }> = {
  superseded: {
    term: 'Superseded',
    definition:
      'A status applied to an older Published record version or Update Bulletin when a newer verified version replaces it. Superseded versions stay in the archive for auditability but are no longer the current release.',
    section: 'overview',
  },
  withdrawn: {
    term: 'Withdrawn',
    definition:
      'An emergency status executed by a Publisher (PIO) that immediately disables public file downloads for a release and displays a visible withdrawal notice explaining why it was pulled.',
    section: 'release-panel',
  },
  'segregation of duties': {
    term: 'Segregation of Duties',
    definition:
      'A core governance control where no single officer can both author and approve/publish their own submission. Authors cannot review or approve their own versions.',
    section: 'review-queue',
  },
  custodian: {
    term: 'Custodian',
    definition:
      'An officer (typically the Executive Secretary) responsible for maintaining assigned council records, compiling Update Bulletins, and preparing the end-of-term Turnover package.',
    section: 'roles',
  },
  approver: {
    term: 'Approver',
    definition:
      'A senior council officer (typically President or Vice President) authorized to grant Substantive Approval after a non-author Reviewer confirms all 6 verification checklist items.',
    section: 'roles',
  },
  publisher: {
    term: 'Publisher (PIO)',
    definition:
      'The Public Information Officer authorized to publish Approved releases immediately or on a schedule, activate scheduled releases, supersede prior versions, or issue emergency Withdrawals.',
    section: 'release-panel',
  },
  reviewer: {
    term: 'Reviewer',
    definition:
      'A non-author officer who inspects For Review submissions against the 6-point verification checklist and either confirms readiness or returns the draft with correction notes.',
    section: 'review-queue',
  },
  author: {
    term: 'Author',
    definition:
      'An officer assigned to draft notes, upload supporting files (PDF/DOCX/PNG/JPEG up to 10 MB), and submit record versions for review.',
    section: 'workspace',
  },
  observer: {
    term: 'Observer / Public Visitor',
    definition:
      'Default access level for students, visitors, and newly created accounts before an officer role is granted. Can browse and download verified Public Library records and Public Bulletins.',
    section: 'roles',
  },
  'sha-256': {
    term: 'SHA-256 Checksum',
    definition:
      'A 64-character cryptographic hash computed from an official file. Any 1-byte change produces a completely different hash, letting students and advisers verify that a downloaded PDF has not been tampered with.',
    section: 'public-library',
  },
  checksum: {
    term: 'Checksum',
    definition:
      'A cryptographic fingerprint (SHA-256 in EA-CSC IIDGS) used to verify file integrity and authenticity.',
    section: 'public-library',
  },
  turnover: {
    term: 'Turnover & Continuity',
    definition:
      'The end-of-term handover process where outgoing officers freeze the council archive package, Technical Admins transfer role & record custody, and incoming officers sign off with an Incoming Acknowledgment.',
    section: 'turnover',
  },
  cutoff: {
    term: 'Bulletin Cutoff Timestamp',
    definition:
      'The Asia/Manila (UTC+8) date and time boundary used by the Bulletin Compiler to include all verified releases up to that exact moment.',
    section: 'bulletins',
  },
  quorum: {
    term: 'Quorum',
    definition:
      'The minimum number of council officers or voting members required to be present for official business, resolutions, or approvals to be valid.',
    section: 'overview',
  },
  resolution: {
    term: 'Council Resolution',
    definition:
      'A formal written decision or policy enacted by the EA-CSC (filed under GOV — Governance & Legislation) following deliberation and approval.',
    section: 'overview',
  },
  '409': {
    term: 'HTTP 409 / PT409 Conflict',
    definition:
      'An optimistic-locking conflict error indicating another officer updated the record while your editor was open. Click Reload to fetch the latest revision before saving.',
    section: 'troubleshooting',
  },
  pt409: {
    term: 'PT409 Optimistic Lock Conflict',
    definition:
      'Occurs when two officers edit the same record simultaneously. Reload the record to pull the latest version and avoid overwriting a teammate’s changes.',
    section: 'troubleshooting',
  },
  'ra 10173': {
    term: 'Republic Act No. 10173 (Data Privacy Act of 2012)',
    definition:
      'Philippine law governing the protection of personal information. Point 5 of the EA-CSC 6-point checklist verifies that public releases comply with privacy disclosure rules.',
    section: 'review-queue',
  },
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can',
  'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her',
  'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'just', 'may', 'me', 'might', 'more', 'most', 'must', 'my', 'no', 'nor', 'not',
  'of', 'on', 'or', 'our', 'ours', 'out', 'over', 'shall', 'she', 'should', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
])

const KNOWLEDGE_TOPICS: Array<{
  keywords: string[]
  phrases: string[]
  text: string
  helpSection: string
  helpLabel: string
}> = [
  {
    keywords: ['role', 'roles', 'privilege', 'privileges', 'permission', 'permissions', 'who', 'access', 'position'],
    phrases: ['user role', 'who can', 'what can i do', 'officer role'],
    text:
      'EA-CSC uses 6 officer functions plus Public/Observer access:\n' +
      '• Public Visitor / Observer: View & download Public Library releases and Public Bulletins.\n' +
      '• Author: Edit Draft notes, upload attachments (PDF/DOCX/PNG/JPEG <= 10 MB), and Submit for Review.\n' +
      '• Custodian (Executive Secretary): Author duties + Bulletin compilation + Turnover preparation.\n' +
      '• Reviewer: Inspect For Review items (non-author only), run the 6-point check, or Return for Correction.\n' +
      '• Approver (President/VP): Grant Substantive Approval after all 6 checklist points pass.\n' +
      '• Publisher (PIO): Publish, schedule, supersede, or execute emergency Withdrawals.\n' +
      '• Technical Admin: Manage roles & Access Transfer during turnover.',
    helpSection: 'roles',
    helpLabel: 'View full Roles & Permissions guide',
  },
  {
    keywords: ['6-point', 'six', 'checklist', 'approve', 'approval', 'review', 'verify', 'verification'],
    phrases: ['6 point', 'six point', 'review queue', 'return for correction'],
    text:
      'Before a version can be Approved, a non-author Reviewer/Approver must mark all 6 checklist items as Confirmed or Not Applicable (none may be Correction Required):\n' +
      '1. Identity & version alignment\n' +
      '2. Dates, deadlines & Manila (UTC+8) time\n' +
      '3. Location, venue, or official link\n' +
      '4. Audience eligibility & requirements\n' +
      '5. Issuing authority & privacy disclosure (RA 10173)\n' +
      '6. Contact channel & reference IDs.\n' +
      'Note: Authors cannot approve their own submissions (Segregation of Duties).',
    helpSection: 'review-queue',
    helpLabel: 'Open Review Queue guide',
  },
  {
    keywords: ['status', 'statuses', 'draft', 'published', 'superseded', 'withdraw', 'withdrawn', 'lifecycle'],
    phrases: ['record status', 'version lifecycle', 'emergency withdrawal'],
    text:
      'Record version lifecycle:\n' +
      '• Draft: Being edited by Author/Custodian (private).\n' +
      '• For Review: Submitted for 6-point verification (locked from author edits).\n' +
      '• Approved: Passed 6-point check and substantive approval; ready for Release Panel.\n' +
      '• Published: Live in Public Library (once effective_from arrives).\n' +
      '• Superseded: Replaced by a newer Published version (kept in version history).\n' +
      '• Withdrawn: Emergency removal of public file download with a visible withdrawal notice.',
    helpSection: 'overview',
    helpLabel: 'View Lifecycle Overview',
  },
  {
    keywords: ['upload', 'file', 'files', 'pdf', 'docx', 'png', 'jpeg', '409', 'pt409', 'conflict', 'error', 'size', 'limit'],
    phrases: ['file format', 'max size', 'magic byte', 'cannot upload'],
    text:
      'Allowed file formats are PDF (.pdf), Word (.docx), PNG (.png), and JPEG (.jpg/.jpeg) up to 10 MB. The server validates file magic bytes, so renamed executables are rejected. If you see a conflict error (PT409 / HTTP 409), another officer updated the record—click Reload to get the latest revision before saving.',
    helpSection: 'troubleshooting',
    helpLabel: 'Open Troubleshooting & File Rules',
  },
  {
    keywords: ['bulletin', 'bulletins', 'cutoff', 'compile', 'compiler', 'gazette'],
    phrases: ['update bulletin', 'bulletin compiler'],
    text:
      'Update Bulletins compile verified releases within a reporting window up to a Manila (UTC+8) cutoff timestamp. Public bulletins appear on /bulletins for everyone; Internal bulletins are restricted to signed-in officers. Re-issuing a corrected bulletin creates v2 and marks v1 as Superseded.',
    helpSection: 'bulletins',
    helpLabel: 'Open Bulletin Compiler guide',
  },
  {
    keywords: ['turnover', 'handover', 'continuity', 'freeze', 'acknowledgment', 'transfer', 'custody'],
    phrases: ['access transfer', 'end of term', 'incoming officer', 'outgoing officer'],
    text:
      'At the end of an academic term, outgoing officers freeze the Turnover package (/officer/turnover), Technical Admins transfer role & record assignments to incoming officers (/officer/admin/access) and deactivate outgoing accounts, and incoming officers sign off with an Incoming Acknowledgment.',
    helpSection: 'turnover',
    helpLabel: 'Open Turnover & Access guide',
  },
  {
    keywords: ['password', 'login', 'signup', 'account', 'reset', 'forgot', 'email'],
    phrases: ['forgot password', 'reset password', 'create account', 'sign in'],
    text:
      'Students and officers can create an account on /signup (starting as Observer) and request an officer position from /account. If you forget your password, use "Forgot password?" on /login to receive a recovery link (note: Supabase free-tier auth emails have an hourly rate limit).',
    helpSection: 'troubleshooting',
    helpLabel: 'Open Account & Troubleshooting guide',
  },
  {
    keywords: ['sha', 'sha-256', 'hash', 'checksum', 'verify', 'tamper', 'integrity'],
    phrases: ['cryptographic verification', 'verify file'],
    text:
      'Every official file and compiled bulletin in EA-CSC IIDGS carries a SHA-256 checksum. You can compare the published SHA-256 hash on the Record Detail page against your downloaded file to confirm zero tampering.',
    helpSection: 'public-library',
    helpLabel: 'Open Public Library guide',
  },
]

function getSupabaseEdgeConfig() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  const publishableKey = (
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  )?.trim()
  if (!url || !publishableKey) return null
  return { url: url.replace(/\/$/, ''), publishableKey }
}

async function callEdgeAssistant(payload: {
  mode: 'chat' | 'summarize' | 'define'
  message: string
  pathname: string
  pageTitle: string
  history?: ChatHistoryTurn[]
}): Promise<{
  configured: boolean
  fallback?: boolean
  reply?: string
  model?: string
  helpSection?: string
} | null> {
  const cfg = getSupabaseEdgeConfig()
  if (!cfg) return null

  try {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30000)
    const res = await fetch(`${cfg.url}/functions/v1/ea-csc-ai-assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.publishableKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    window.clearTimeout(timeout)
    if (!res.ok) return null
    return (await res.json()) as {
      configured: boolean
      fallback?: boolean
      reply?: string
      model?: string
      helpSection?: string
    }
  } catch {
    return null
  }
}

function extractDefineTarget(question: string): string | null {
  const trimmed = question.trim()
  const patterns = [
    /^(?:define|definition of|meaning of|what does|what is(?: the meaning of)?|explain the term)\s+["'“]?([a-z0-9\-\s]{2,40}?)["'”]?(?:\s+mean)?[?.!]*$/i,
    /^["']([a-z0-9\-]{2,30})["']\s*\??$/i,
  ]
  for (const re of patterns) {
    const match = trimmed.match(re)
    if (match?.[1]) {
      return match[1].trim()
    }
  }
  return null
}

async function lookupDefinitionLocal(rawTerm: string): Promise<AssistantReply> {
  const normalized = rawTerm.toLowerCase().trim()
  const glossaryHit = GOVERNANCE_GLOSSARY[normalized]
  if (glossaryHit) {
    return {
      text: `${glossaryHit.term} (EA-CSC Governance Term):\n${glossaryHit.definition}`,
      engine: 'local',
      helpSection: glossaryHit.section ?? 'overview',
      helpLabel: 'Read more in Help Center',
      geminiConfigured: false,
    }
  }

  // Partial glossary match for multi-word governance phrases
  const partialKey = Object.keys(GOVERNANCE_GLOSSARY).find(
    (k) => normalized.includes(k) || k.includes(normalized),
  )
  if (partialKey && normalized.length >= 4) {
    const hit = GOVERNANCE_GLOSSARY[partialKey]
    return {
      text: `${hit.term} (EA-CSC Governance Term):\n${hit.definition}`,
      engine: 'local',
      helpSection: hit.section ?? 'overview',
      helpLabel: 'Read more in Help Center',
      geminiConfigured: false,
    }
  }

  // Free public English Dictionary API (no API key required)
  const singleWord = normalized.split(/\s+/)[0]
  if (/^[a-z\-]{2,30}$/i.test(singleWord)) {
    try {
      const res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(singleWord)}`,
      )
      if (res.ok) {
        const entries = (await res.json()) as Array<{
          word?: string
          phonetic?: string
          meanings?: Array<{
            partOfSpeech?: string
            definitions?: Array<{ definition?: string; example?: string }>
          }>
        }>
        const first = entries?.[0]
        if (first?.meanings?.length) {
          const lines: string[] = [
            `${first.word ?? singleWord}${first.phonetic ? ` (${first.phonetic})` : ''}:`,
          ]
          for (const m of first.meanings.slice(0, 2)) {
            const def = m.definitions?.[0]
            if (def?.definition) {
              lines.push(`• [${m.partOfSpeech ?? 'term'}] ${def.definition}`)
              if (def.example) {
                lines.push(`  Example: "${def.example}"`)
              }
            }
          }
          return {
            text: lines.join('\n'),
            engine: 'local',
            geminiConfigured: false,
          }
        }
      }
    } catch {
      // Fall through cleanly if offline
    }
  }

  return {
    text: `I could not find "${rawTerm}" in the local EA-CSC glossary or online dictionary. Try asking about a governance term (e.g., Superseded, Withdrawn, Quorum, SHA-256, Custodian) or connect a Gemini API key for full AI explanations.`,
    engine: 'local',
    helpSection: 'overview',
    helpLabel: 'Open Help Center',
    geminiConfigured: false,
  }
}

export function summarizeLocally(rawText: string): SummaryAnalysis | null {
  const clean = rawText.replace(/\s+/g, ' ').trim()
  if (!clean) return null

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12)

  // Compute word frequencies (TF) excluding stop words
  const tf = new Map<string, number>()
  const words = clean.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
  for (const w of words) {
    if (!STOP_WORDS.has(w)) {
      tf.set(w, (tf.get(w) ?? 0) + 1)
    }
  }

  let bullets: string[]
  if (sentences.length <= 3) {
    bullets =
      sentences.length > 0
        ? sentences
        : [clean.slice(0, 220) + (clean.length > 220 ? '…' : '')]
  } else {
    // Extractive sentence scoring: TF density + position bonus + action/date signal
    const scored = sentences.map((sentence, idx) => {
      const tokens = sentence.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
      let score = 0
      let meaningfulCount = 0
      for (const t of tokens) {
        if (!STOP_WORDS.has(t)) {
          score += tf.get(t) ?? 0
          meaningfulCount++
        }
      }
      const normalizedTf = meaningfulCount > 0 ? score / Math.sqrt(meaningfulCount) : 0
      const positionBonus = idx === 0 ? 1.8 : idx === sentences.length - 1 ? 0.6 : 0
      const signalBonus =
        /(\d{1,2}:\d{2}|am|pm|deadline|must|required|approved|resolved|php|₱)/i.test(
          sentence,
        )
          ? 1.2
          : 0
      return { sentence, idx, score: normalizedTf + positionBonus + signalBonus }
    })

    bullets = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .sort((a, b) => a.idx - b.idx)
      .map((item) => item.sentence)
  }

  // Weighted category classification
  const lower = clean.toLowerCase()
  const categoryRules: Array<{ label: string; terms: string[] }> = [
    {
      label: 'GOV — Governance & Legislation',
      terms: ['constitution', 'resolution', 'policy', 'bylaw', 'amendment', 'ordinance', 'article'],
    },
    {
      label: 'SEC — Secretariat & Minutes',
      terms: ['minutes', 'agenda', 'meeting', 'quorum', 'adjourned', 'presiding', 'secretary'],
    },
    {
      label: 'FIN — Financial Records',
      terms: ['budget', 'liquidation', 'expense', 'php', '₱', 'financial', 'receipt', 'audit'],
    },
    {
      label: 'FRM — Official Forms',
      terms: ['form', 'template', 'application', 'request', 'clearance', 'waiver', 'endorsement'],
    },
    {
      label: 'TRN — Turnover & Continuity',
      terms: ['turnover', 'handover', 'outgoing', 'incoming', 'continuity', 'acknowledgment'],
    },
    {
      label: 'ACT — Activities & Events',
      terms: ['event', 'seminar', 'assembly', 'webinar', 'workshop', 'program', 'registration', 'venue'],
    },
  ]

  let bestCategory = 'ACT — Activities & Events'
  let bestScore = 0
  for (const rule of categoryRules) {
    let score = 0
    for (const term of rule.terms) {
      if (lower.includes(term)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      bestCategory = rule.label
    }
  }

  const dates = Array.from(
    new Set(
      clean.match(
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)\b/g,
      ) ?? [],
    ),
  ).slice(0, 4)

  const locations = Array.from(
    new Set(
      clean.match(
        /(?:https?:\/\/\S+|(?:Room|Hall|Building|Auditorium|Studio|Lab|Zoom|Google Meet)\s+[A-Za-z0-9\-]+)/gi,
      ) ?? [],
    ),
  ).slice(0, 4)

  const contacts = Array.from(
    new Set(clean.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []),
  ).slice(0, 3)

  const amounts = Array.from(
    new Set(clean.match(/(?:PHP|Php|₱)\s?\d[\d,]*(?:\.\d{2})?/g) ?? []),
  ).slice(0, 4)

  const reminders: string[] = []
  if (dates.length === 0 && !/(utc\+8|manila|\d{4})/i.test(clean)) {
    reminders.push('Add explicit date & Asia/Manila (UTC+8) time.')
  }
  if (locations.length === 0) {
    reminders.push('Confirm venue, room, or official link.')
  }
  if (contacts.length === 0 && !/(contact|page|desk|council)/i.test(clean)) {
    reminders.push('Include official EA-CSC contact channel.')
  }
  if (reminders.length === 0) {
    reminders.push(
      'Dates, location/link, and contact details appear present—verify issuing authority & RA 10173 privacy disclosure before submitting.',
    )
  }

  return {
    category: bestCategory,
    bullets,
    entities: { dates, locations, contacts, amounts },
    reminders,
    engine: 'local',
  }
}

function answerLocally(question: string, pathname: string): AssistantReply {
  const q = question.toLowerCase().trim()
  const ctx = ROUTE_CONTEXT.find((c) => c.match(pathname)) ?? ROUTE_CONTEXT[0]

  if (/^(hi|hello|hey|good\s+(morning|afternoon|evening)|kumusta)[!.\s]*$/i.test(q)) {
    return {
      text: `Hello! You are currently on ${ctx.title}. Ask me anything about how this page works, council roles, the 6-point checklist, word definitions (e.g., "define superseded"), or paste text in Summarize & Analyze.`,
      engine: 'local',
      helpSection: ctx.section,
      helpLabel: `Open ${ctx.title} guide`,
      geminiConfigured: false,
    }
  }

  if (
    q.includes('this page') ||
    q.includes('where am i') ||
    q.includes('what can i do') ||
    q === 'help'
  ) {
    return {
      text: ctx.summary,
      engine: 'local',
      helpSection: ctx.section,
      helpLabel: `Open ${ctx.title} guide`,
      geminiConfigured: false,
    }
  }

  // Weighted keyword + phrase scoring across topics
  let bestTopic: (typeof KNOWLEDGE_TOPICS)[number] | null = null
  let bestScore = 0

  for (const topic of KNOWLEDGE_TOPICS) {
    let score = 0
    for (const phrase of topic.phrases) {
      if (q.includes(phrase)) score += 3
    }
    for (const kw of topic.keywords) {
      if (q.includes(kw)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      bestTopic = topic
    }
  }

  if (bestTopic && bestScore > 0) {
    return {
      text: bestTopic.text,
      engine: 'local',
      helpSection: bestTopic.helpSection,
      helpLabel: bestTopic.helpLabel,
      geminiConfigured: false,
    }
  }

  return {
    text:
      `You are on ${ctx.title}. Here are things I can help with right now:\n` +
      `• Website guide: ask about roles, the 6-point checklist, statuses, uploads, bulletins, or turnover.\n` +
      `• Define words: type "define <word>" (e.g., "define superseded" or "define algorithm").\n` +
      `• Summarize text: prefix with "summarize: <text>" or use the Summarize & Analyze tab.`,
    engine: 'local',
    helpSection: ctx.section,
    helpLabel: `Open ${ctx.title} in Help`,
    geminiConfigured: false,
  }
}

export async function askAssistant(params: {
  question: string
  pathname: string
  history: ChatHistoryTurn[]
}): Promise<AssistantReply> {
  const { question, pathname, history } = params
  const ctx = ROUTE_CONTEXT.find((c) => c.match(pathname)) ?? ROUTE_CONTEXT[0]

  // Detect explicit summarize command in chat
  const summarizeMatch = question.trim().match(/^summarize\s*:\s*(.+)$/is)
  if (summarizeMatch?.[1]) {
    const edge = await callEdgeAssistant({
      mode: 'summarize',
      message: summarizeMatch[1],
      pathname,
      pageTitle: ctx.title,
      history,
    })
    if (edge?.configured && !edge.fallback && edge.reply) {
      return {
        text: edge.reply,
        engine: 'gemini',
        model: edge.model,
        helpSection: edge.helpSection ?? ctx.section,
        helpLabel: 'Open related Help guide',
        geminiConfigured: true,
      }
    }
    const localSummary = summarizeLocally(summarizeMatch[1])
    if (localSummary) {
      return {
        text:
          `Category: ${localSummary.category}\n\n` +
          `Summary:\n${localSummary.bullets.map((b) => `• ${b}`).join('\n')}\n\n` +
          `Checklist Reminders:\n${localSummary.reminders.map((r) => `• ${r}`).join('\n')}`,
        engine: 'local',
        geminiConfigured: false,
      }
    }
  }

  // Detect explicit define command
  const defineTerm = extractDefineTarget(question)

  const edge = await callEdgeAssistant({
    mode: defineTerm ? 'define' : 'chat',
    message: defineTerm ?? question,
    pathname,
    pageTitle: ctx.title,
    history,
  })

  if (edge?.configured && !edge.fallback && edge.reply) {
    return {
      text: edge.reply,
      engine: 'gemini',
      model: edge.model,
      helpSection: edge.helpSection,
      helpLabel: edge.helpSection ? 'Read more in Help Center' : undefined,
      geminiConfigured: true,
    }
  }

  if (defineTerm) {
    return await lookupDefinitionLocal(defineTerm)
  }

  return answerLocally(question, pathname)
}

export async function summarizeWithAssistant(params: {
  rawText: string
  pathname: string
}): Promise<SummaryAnalysis | null> {
  const local = summarizeLocally(params.rawText)
  if (!local) return null

  const ctx =
    ROUTE_CONTEXT.find((c) => c.match(params.pathname)) ?? ROUTE_CONTEXT[0]

  const edge = await callEdgeAssistant({
    mode: 'summarize',
    message: params.rawText,
    pathname: params.pathname,
    pageTitle: ctx.title,
  })

  if (edge?.configured && !edge.fallback && edge.reply) {
    // Parse Gemini response cleanly into bullets while keeping extracted entities
    const lines = edge.reply
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    return {
      ...local,
      bullets: lines.slice(0, 8),
      engine: 'gemini',
      model: edge.model,
    }
  }

  return local
}
