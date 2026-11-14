import { useState } from 'react'
import { Link, useLocation } from 'react-router'

interface AssistantDrawerProps {
  open: boolean
  onClose: () => void
}

interface Message {
  id: string
  role: 'assistant' | 'user'
  text: string
  helpSection?: string
  helpLabel?: string
}

const ROUTE_CONTEXT: Array<{
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
    match: (p) => p === '/help',
    title: 'Help & Operations Guide',
    summary:
      'You are in the Help Center. Use the search box or topic links to read step-by-step instructions for every role and page.',
    section: 'overview',
  },
]

function answerQuestion(
  question: string,
  pathname: string,
): Omit<Message, 'id' | 'role'> {
  const q = question.toLowerCase()
  const ctx = ROUTE_CONTEXT.find((c) => c.match(pathname)) ?? ROUTE_CONTEXT[0]

  if (
    q.includes('this page') ||
    q.includes('where am i') ||
    q.includes('what can i do')
  ) {
    return {
      text: `${ctx.summary}`,
      helpSection: ctx.section,
      helpLabel: `Open ${ctx.title} guide`,
    }
  }

  if (
    q.includes('role') ||
    q.includes('privilege') ||
    q.includes('permission') ||
    q.includes('account') ||
    q.includes('who can')
  ) {
    return {
      text:
        'EA-CSC uses 6 officer roles plus public/observer access:\n' +
        '• Public Visitor (no login): View & download Public Library releases and Public Bulletins.\n' +
        '• Author: Edit Draft notes, upload attachments, and Submit for Review on assigned records.\n' +
        '• Custodian (Executive Secretary): Author duties + Bulletin compilation + Turnover preparation.\n' +
        '• Reviewer: Inspect For Review items (non-author only), run the 6-point check, or Return with comments.\n' +
        '• Approver (President/VP): Grant Substantive Approval after all 6 checklist points pass.\n' +
        '• Publisher (PIO): Publish, schedule, supersede, or withdraw releases.\n' +
        '• Technical Admin: Manage roles & Access Transfer during turnover.',
      helpSection: 'roles',
      helpLabel: 'View full Roles & Demo Accounts table',
    }
  }

  if (
    q.includes('6-point') ||
    q.includes('six') ||
    q.includes('checklist') ||
    q.includes('approve') ||
    q.includes('review')
  ) {
    return {
      text:
        'Before a version can be Approved, a non-author Reviewer/Approver must mark all 6 checklist items as Confirmed or Not Applicable (none may be Correction Required):\n' +
        '1. Identity & version alignment\n' +
        '2. Dates, deadlines & Manila (UTC+8) time\n' +
        '3. Location, venue, or official link\n' +
        '4. Audience eligibility & requirements\n' +
        '5. Issuing authority & privacy disclosure\n' +
        '6. Contact channel & reference IDs.\n' +
        'Note: Authors cannot approve their own submissions (segregation of duties).',
      helpSection: 'review-queue',
      helpLabel: 'Open Review Queue guide',
    }
  }

  if (
    q.includes('status') ||
    q.includes('draft') ||
    q.includes('superseded') ||
    q.includes('withdraw') ||
    q.includes('lifecycle')
  ) {
    return {
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
    }
  }

  if (
    q.includes('upload') ||
    q.includes('file') ||
    q.includes('pdf') ||
    q.includes('docx') ||
    q.includes('409') ||
    q.includes('conflict')
  ) {
    return {
      text: 'Allowed file formats are PDF (.pdf), Word (.docx), PNG (.png), and JPEG (.jpg/.jpeg) up to 10 MB. The server checks file magic bytes, so renamed executables are rejected. If you see a conflict error (PT409 / HTTP 409), another officer updated the record—click Reload to get the latest revision before saving.',
      helpSection: 'troubleshooting',
      helpLabel: 'Open Troubleshooting & File Rules',
    }
  }

  if (q.includes('bulletin') || q.includes('cutoff')) {
    return {
      text: 'Update Bulletins compile verified releases within a reporting window up to a Manila (UTC+8) cutoff timestamp. Public bulletins appear on /bulletins for everyone; Internal bulletins are restricted to signed-in officers. Re-issuing a corrected bulletin creates v2 and marks v1 as Superseded.',
      helpSection: 'bulletins',
      helpLabel: 'Open Bulletin Compiler guide',
    }
  }

  if (
    q.includes('turnover') ||
    q.includes('handover') ||
    q.includes('access')
  ) {
    return {
      text: 'At the end of an academic term, outgoing officers freeze the Turnover package (/officer/turnover), Technical Admins transfer role & record assignments to incoming officers (/officer/admin/access) and deactivate outgoing accounts, and incoming officers sign off with an Incoming Acknowledgment.',
      helpSection: 'turnover',
      helpLabel: 'Open Turnover & Access guide',
    }
  }

  return {
    text: `Here is what I can help with on ${ctx.title}: ask about user roles & privileges, the 6-point checklist, record statuses (Draft -> Published -> Superseded), file upload rules, Update Bulletins, or Turnover. You can also switch to the "Summarize & Classify" tab to summarize council text!`,
    helpSection: ctx.section,
    helpLabel: `Open ${ctx.title} in Help`,
  }
}

function summarizeAndClassify(rawText: string) {
  const clean = rawText.replace(/\s+/g, ' ').trim()
  if (!clean) {
    return null
  }

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15)

  const bullets =
    sentences.length > 0
      ? sentences.slice(0, 4)
      : [clean.slice(0, 220) + (clean.length > 220 ? '…' : '')]

  const lower = clean.toLowerCase()
  let category = 'ACT — Activities & Events'
  if (
    lower.includes('constitution') ||
    lower.includes('resolution') ||
    lower.includes('policy') ||
    lower.includes('bylaw')
  ) {
    category = 'GOV — Governance & Legislation'
  } else if (
    lower.includes('minutes') ||
    lower.includes('agenda') ||
    lower.includes('meeting') ||
    lower.includes('quorum')
  ) {
    category = 'SEC — Secretariat & Minutes'
  } else if (
    lower.includes('budget') ||
    lower.includes('liquidation') ||
    lower.includes('expense') ||
    lower.includes('php') ||
    lower.includes('financial')
  ) {
    category = 'FIN — Financial Records'
  } else if (
    lower.includes('form') ||
    lower.includes('template') ||
    lower.includes('application') ||
    lower.includes('request')
  ) {
    category = 'FRM — Official Forms'
  } else if (
    lower.includes('turnover') ||
    lower.includes('handover') ||
    lower.includes('outgoing') ||
    lower.includes('incoming')
  ) {
    category = 'TRN — Turnover & Continuity'
  }

  const reminders: string[] = []
  if (!/(utc\+8|manila|am|pm|\d{4})/i.test(clean)) {
    reminders.push('Add explicit date & Asia/Manila (UTC+8) time.')
  }
  if (!/(room|hall|zoom|meet|venue|http)/i.test(clean)) {
    reminders.push('Confirm venue, room, or official link.')
  }
  if (!/(contact|email|@|page|desk)/i.test(clean)) {
    reminders.push('Include official EA-CSC contact channel.')
  }
  if (reminders.length === 0) {
    reminders.push(
      'Dates, location/link, and contact details appear present—verify authority & privacy disclosure before submitting.',
    )
  }

  return { bullets, category, reminders }
}

export default function AssistantDrawer({
  open,
  onClose,
}: AssistantDrawerProps) {
  const { pathname } = useLocation()
  const [tab, setTab] = useState<'chat' | 'summarize'>('chat')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Hi! I am the EA-CSC Governance Assistant. Ask me how any page works, what a role can do, or switch to "Summarize & Classify" to draft clean record notes.',
      helpSection: 'overview',
      helpLabel: 'Open full Help Center',
    },
  ])
  const [draftText, setDraftText] = useState('')
  const [summaryResult, setSummaryResult] = useState<ReturnType<
    typeof summarizeAndClassify
  > | null>(null)

  if (!open) return null

  function sendPrompt(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const reply = answerQuestion(trimmed, pathname)
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-u`, role: 'user', text: trimmed },
      { id: `${Date.now()}-a`, role: 'assistant', ...reply },
    ])
    setInput('')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-label="EA-CSC Governance Assistant"
    >
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-emerald-950 px-5 py-4 text-white">
          <div>
            <h2 className="text-base font-bold">EA-CSC Governance Assistant</h2>
            <p className="text-xs text-emerald-200">
              Operations guide, role helper &amp; text summarizer
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-900"
          >
            Close
          </button>
        </div>

        <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-2">
          <button
            type="button"
            onClick={() => setTab('chat')}
            className={`border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === 'chat'
                ? 'border-emerald-800 text-emerald-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Ask &amp; Guide
          </button>
          <button
            type="button"
            onClick={() => setTab('summarize')}
            className={`border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === 'summarize'
                ? 'border-emerald-800 text-emerald-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Summarize &amp; Classify
          </button>
        </div>

        {tab === 'chat' ? (
          <>
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-white px-4 py-2.5">
              {[
                'What can I do on this page?',
                'Explain user roles',
                '6-point checklist',
                'Explain statuses',
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => sendPrompt(chip)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900"
                >
                  {chip}
                </button>
              ))}
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-xl p-3.5 text-sm leading-relaxed whitespace-pre-line ${
                    msg.role === 'user'
                      ? 'ml-8 bg-emerald-900 text-white'
                      : 'mr-4 border border-slate-200 bg-slate-50 text-slate-800'
                  }`}
                >
                  <p>{msg.text}</p>
                  {msg.helpSection && (
                    <Link
                      to={`/help#${msg.helpSection}`}
                      onClick={onClose}
                      className="mt-2 inline-block text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
                    >
                      {msg.helpLabel ?? 'Read more in Help'} →
                    </Link>
                  )}
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                sendPrompt(input)
              }}
              className="flex gap-2 border-t border-slate-200 p-3"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask how a button, role, or workflow works…"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-700 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Ask
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <p className="text-xs leading-5 text-slate-600">
              Paste council announcement text, meeting notes, or draft
              guidelines below to extract a clean bullet summary, suggested
              record category, and 6-point checklist reminders.
            </p>
            <textarea
              rows={6}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Paste resolution, memo, or event announcement text here…"
              className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-700 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setSummaryResult(summarizeAndClassify(draftText))
                }
                className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Summarize &amp; Classify
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftText('')
                  setSummaryResult(null)
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>

            {summaryResult && (
              <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm">
                <div>
                  <p className="text-xs font-bold tracking-wide text-emerald-900 uppercase">
                    Suggested Category
                  </p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {summaryResult.category}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold tracking-wide text-emerald-900 uppercase">
                    Key Points Summary
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-800">
                    {summaryResult.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-bold tracking-wide text-emerald-900 uppercase">
                    6-Point Verification Reminders
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-700">
                    {summaryResult.reminders.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
