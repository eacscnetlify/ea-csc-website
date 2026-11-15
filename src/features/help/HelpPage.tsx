import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

interface HelpTopic {
  id: string
  title: string
  badge: string
  route?: string
  routeLabel?: string
  summary: string
  steps: string[]
}

const TOPICS: HelpTopic[] = [
  {
    id: 'overview',
    title: 'How the EA-CSC Governance System Works',
    badge: 'Start Here',
    summary:
      'This system organizes council files into Folders and Documents, ensuring every announcement, resolution, financial report, and activity guideline goes through verified version control before reaching students—while preserving full council history across academic terms.',
    steps: [
      '1. Folders & Documents: Officers organize related Documents inside Folders (e.g., Governance & Charter, Secretariat & Minutes, Financial & Audit, Activities). Each Document tracks multiple Versions over time (v1, v2, v3…).',
      '2. Draft (Author / Custodian): Upload source files (.pdf, .docx, .png, .jpg) and write version notes.',
      '3. For Review (Author -> Reviewer): Submit the draft so another officer can inspect it. (The President and Executive Secretary also have Executive Fast-Track Self-Approval for urgent bulletins.)',
      '4. Approved (Reviewer / Approver): All 6 verification checks pass and substantive approval is recorded.',
      '5. Published (Publisher / PRO): The approved document version becomes visible and downloadable on the Home — Public Library.',
      '6. Superseded or Withdrawn: Publishing a newer version (e.g. v2) automatically supersedes v1 while keeping version history, or urgent errors can be withdrawn with a public notice.',
    ],
  },
  {
    id: 'public-library',
    title: 'Home — Public Library, Student Accounts & Role Requests',
    badge: 'Public Portal',
    route: '/',
    routeLabel: 'Open Home — Public Library',
    summary:
      'Anyone (students, faculty, guests) can browse the Home — Public Library without signing in. Only Published, non-restricted Documents whose effective date has arrived appear here. Students can also create an Observer account and apply for an officer role.',
    steps: [
      'Search by document title, canonical ID (e.g. EACSC-2026-GOV-0001), or keyword, and filter by category (GOV, SEC, ACT, FIN, FRM, TRN).',
      'Click "View document" to inspect metadata, download the official verified file, view Superseded prior versions, or read any Withdrawal notice.',
      'Click "Create Account" (/signup) to register as a Student Observer (read-only), then open "My Account & Role" (/account) to apply for one of the 28 official EA-CSC positions (Executive Officers, Board Members, or Advisory).',
      'Once the Council President approves your application in /account, refresh access to unlock your Officer Operations tabs.',
    ],
  },
  {
    id: 'workspace',
    title: 'Document Workspace (Folders, Documents, Drafts & Submissions)',
    badge: 'Author / Custodian',
    route: '/officer',
    routeLabel: 'Open Document Workspace',
    summary:
      'Assigned Authors and Custodians create Folders, create Documents, and work on Draft versions here. Documents marked Restricted stay hidden from the Public Library and are visible only to explicitly assigned officers.',
    steps: [
      'Use "Create Folder" to organize documents cleanly, and "Create Document" to register a new Public or Restricted document.',
      'Select a Document and open its current Draft version (or upload a new Draft version when updating an existing document).',
      'Upload a valid attachment (.pdf, .docx, .png, or .jpg/.jpeg, maximum 10 MB). The server verifies real file contents (magic bytes) and computes a SHA-256 checksum.',
      'Update version notes, click "Save Draft Notes", and click "Submit for Review" when ready—or use "Executive Fast-Track Self-Approve" if you are the President or Executive Secretary handling an urgent release.',
    ],
  },
  {
    id: 'review-queue',
    title: 'Review Queue & Six-Point Verification Checklist',
    badge: 'Reviewer / Approver',
    route: '/officer/reviews',
    routeLabel: 'Open Review Queue',
    summary:
      'Segregation of duties prevents regular officers from approving their own drafts (except the President and Executive Secretary who have Executive Fast-Track privileges for urgent council releases).',
    steps: [
      'Open a submitted "For Review" version from the queue.',
      'Inspect the uploaded file and complete all 6 verification points: (1) Identity & version alignment, (2) Dates, deadlines & Manila UTC+8 time, (3) Location, venue or link, (4) Audience eligibility, (5) Issuing authority & privacy disclosure, and (6) Contact channel & reference IDs.',
      'If something is missing or wrong, mark it "Correction Required", write a clear review comment, and click "Return for Correction" (returns to Draft for the author).',
      'When all 6 points are "Confirmed" or "Not Applicable", an Approver clicks "Approve Version".',
    ],
  },
  {
    id: 'release-panel',
    title: 'Release Panel (Publication, Scheduling & Withdrawal)',
    badge: 'Publisher / PIO',
    route: '/officer/releases',
    routeLabel: 'Open Release Panel',
    summary:
      'Once a version is Approved, an authorized Publisher (PIO) controls when it goes live to students, replaces older versions, or is urgently withdrawn.',
    steps: [
      'Publish Immediately: Makes the Approved version live in the Public Library right away.',
      'Schedule Future Release: Set a future "effective_from" Manila timestamp. It stays hidden from the public until that time arrives and you click "Activate Scheduled Release".',
      'Supersede: Publishing a new version (v2) automatically marks v1 as "Superseded" and links them in public version history.',
      'Emergency Withdrawal: Immediately removes public file download (HTTP 404) and displays a public withdrawal notice with your stated reason.',
    ],
  },
  {
    id: 'bulletins',
    title: 'Update Bulletins & Bulletin Compiler',
    badge: 'Public & Internal',
    route: '/officer/bulletins',
    routeLabel: 'Open Bulletin Compiler',
    summary:
      'Update Bulletins bundle verified releases within a reporting window into a single official PDF digest. Public bulletins appear on /bulletins; Internal bulletins require officer sign-in.',
    steps: [
      'Choose Audience (Public or Internal) and set the reporting window and Manila (UTC+8) cutoff timestamp.',
      'Click "Compile Bulletin & Preview PDF" to freeze the snapshot of eligible releases.',
      'Review the generated PDF and click "Issue Bulletin" to archive v1 (or issue v2 to correct/supersede v1).',
    ],
  },
  {
    id: 'history',
    title: 'Council Activity & History',
    badge: 'Audit Trail',
    route: '/officer/history',
    routeLabel: 'Open Activity & History',
    summary:
      'Every major action across the council—document creation, new draft uploads, submissions, returns, approvals, fast-track releases, and role changes—is logged in a tamper-evident audit timeline.',
    steps: [
      'Filter by action type (Uploads, Reviews, Approvals, Releases, Role Changes) or search by document ID or actor.',
      'Use this tab to quickly verify what changed across all council folders without opening individual documents.',
    ],
  },
  {
    id: 'turnover',
    title: 'Turnover & Continuity',
    badge: 'End-of-Term',
    route: '/officer/turnover',
    routeLabel: 'Open Turnover',
    summary:
      'Ensures incoming student council officers inherit a complete, frozen inventory of records and continuity notes without losing institutional memory.',
    steps: [
      'Outgoing Custodian writes the continuity memorandum and freezes the outgoing inventory.',
      'Export the saved turnover package JSON or use Print / Save PDF for physical council records.',
      'Incoming Officer signs in and records "Incoming Acknowledgment" after verifying access.',
    ],
  },
  {
    id: 'access-transfer',
    title: 'Access Transfer & User Administration',
    badge: 'Technical Admin',
    route: '/officer/admin/access',
    routeLabel: 'Open Access Transfer',
    summary:
      'Technical Administrators manage which accounts are active, what functional roles they hold, and transfer record custody from outgoing officers to incoming officers.',
    steps: [
      'Verify incoming officer accounts are active and assigned the right roles.',
      'Execute record assignment transfer to move custody cleanly.',
      'Deactivate outgoing officer accounts once handover is acknowledged.',
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Common Questions & Troubleshooting',
    badge: 'FAQ',
    summary:
      'Quick answers for the most common messages you may encounter while working in the portal.',
    steps: [
      '"Conflict / PT409 / Package changed": Another officer updated the same record while your tab was open. Click Reload to fetch the latest revision, then reapply your edit.',
      '"Why can I not approve this version?": Either you are the author of that version (segregation of duties), or you hold Reviewer-only role without Approver privileges, or one of the 6 checklist items is still unchecked/Correction Required.',
      '"Why can I not see a Restricted record?": Restricted (internal) records require both an active officer account AND an explicit active assignment with allow_restricted permission.',
      '"Upload rejected": Only .pdf, .docx, .png, and .jpg/.jpeg up to 10 MB are accepted, and file contents must match their extension.',
    ],
  },
]

const ROLE_MATRIX = [
  {
    role: 'Public Visitor (No Sign-In)',
    who: 'Students, faculty, general public',
    canDo:
      'Browse Public Library, read Record Details & Version History, download Public releases, and download Public Update Bulletins.',
    cannotDo:
      'Cannot view Drafts, For Review items, Restricted records, Internal bulletins, or any /officer/* page.',
  },
  {
    role: 'Unassigned / Observer (roles: [])',
    who: 'Signed-in student account without officer roles',
    canDo: 'Same as Public Visitor, plus can manage their own account and submit an Officer Role Application on /account.',
    cannotDo:
      'Blocked from Officer Workspace, Review Queue, Release Panel, Bulletin Compiler, Activity & History, and Turnover.',
  },
  {
    role: 'Author (author)',
    who: 'Committee Heads / Representatives / Board Members',
    canDo:
      'Create Folders/Documents, edit Draft notes, upload attachments, and Submit for Review on assigned Documents.',
    cannotDo:
      'Cannot approve their own submissions (segregation of duties), publish releases, or access Restricted documents unless explicitly permitted.',
  },
  {
    role: 'Custodian (custodian)',
    who: 'Executive Secretary / Assistant Secretary / File Inventory Manager / Treasurer',
    canDo:
      'Manage Folders and Documents, compile Update Bulletins, and prepare Turnover packages. Executive Secretary also holds Executive Fast-Track Self-Approval for urgent council releases.',
    cannotDo:
      'Non-executive custodians cannot approve versions they authored or publish without Publisher role.',
  },
  {
    role: 'Reviewer (reviewer)',
    who: 'VP Internal / VP External / Auditors / Board of Directors',
    canDo:
      'Inspect For Review submissions (non-author), fill out the 6-point verification checklist, add review comments, and Return for Correction.',
    cannotDo:
      'Cannot grant final Substantive Approval without the Approver role.',
  },
  {
    role: 'Approver (approver)',
    who: 'EA-CSC President / Executive Secretary / Adviser',
    canDo:
      'Complete 6-point verification and grant final Substantive Approval (Approved). President & Executive Secretary also hold Executive Fast-Track Self-Approval for urgent releases.',
    cannotDo:
      'Cannot publish releases without the Publisher role.',
  },
  {
    role: 'Publisher (publisher)',
    who: 'Public Information Officer (PIO)',
    canDo:
      'Publish Approved versions (immediate or scheduled), activate scheduled releases, supersede old versions, and execute emergency Withdrawals.',
    cannotDo:
      'Cannot bypass the 6-point review/approval gate before publishing.',
  },
  {
    role: 'Technical Admin (technical_admin)',
    who: 'System / Access Administrator',
    canDo:
      'Manage officer role eligibility, transfer record assignments during turnover, and deactivate outgoing accounts.',
    cannotDo:
      'Cannot delete immutable audit logs, review comments, or checklist records.',
  },
]

const DEMO_ACCOUNTS = [
  {
    email: 'author@eacsc.example',
    name: 'Marco Reyes',
    position: 'Committee Head (Author)',
    roles: 'author',
  },
  {
    email: 'secretary@eacsc.example',
    name: 'Roxan Mariz Icaro',
    position: 'Executive Secretary (Custodian)',
    roles: 'custodian, author',
  },
  {
    email: 'reviewer@eacsc.example',
    name: 'Alyssa Tan',
    position: 'VP for Internal Affairs',
    roles: 'reviewer',
  },
  {
    email: 'president@eacsc.example',
    name: 'Rafael Santos',
    position: 'EA-CSC President',
    roles: 'approver, reviewer',
  },
  {
    email: 'pio@eacsc.example',
    name: 'Camille Cruz',
    position: 'Public Information Officer',
    roles: 'publisher',
  },
  {
    email: 'admin@eacsc.example',
    name: 'Daniel Lim',
    position: 'Technical & Access Admin',
    roles: 'technical_admin, custodian',
  },
  {
    email: 'observer@eacsc.example',
    name: 'Student Observer',
    position: 'Non-Officer Observer',
    roles: 'none (read-only)',
  },
]

export default function HelpPage() {
  const { hash } = useLocation()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!hash) return
    const target = document.getElementById(hash.replace('#', ''))
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [hash])

  const normalized = query.trim().toLowerCase()
  const filteredTopics = TOPICS.filter(
    (t) =>
      !normalized ||
      t.title.toLowerCase().includes(normalized) ||
      t.summary.toLowerCase().includes(normalized) ||
      t.steps.some((s) => s.toLowerCase().includes(normalized)),
  )

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <p className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
          Help Center &amp; Operations Forum
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
          How to Use the EA-CSC Governance Portal
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Plain-language instructions for every role, button, and workflow. Use
          the search bar below or click any topic to jump directly to its guide.
        </p>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help topics (e.g. checklist, upload, roles, PT409, turnover)…"
            aria-label="Search help topics"
            className="w-full max-w-md rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Clear search
            </button>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <a
            href="#roles"
            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
          >
            Roles &amp; Privileges
          </a>
          {TOPICS.map((topic) => (
            <a
              key={topic.id}
              href={`#${topic.id}`}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:border-emerald-700 hover:text-emerald-900"
            >
              {topic.title}
            </a>
          ))}
        </div>
      </section>

      <section
        id="roles"
        className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
              Access Control
            </span>
            <h2 className="mt-1 text-xl font-bold text-slate-900">
              User Roles &amp; Privileges Matrix
            </h2>
          </div>
          <Link
            to="/login"
            className="rounded-lg bg-emerald-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            Switch / Sign In
          </Link>
        </div>

        <p className="mt-2 text-sm text-slate-600">
          Every person viewing this website falls into one of the roles below.
          An officer can hold more than one role, but{' '}
          <strong>no officer can approve a version they authored</strong>.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 uppercase">
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Typical Officer</th>
                <th className="px-3 py-2.5">What They Can Do</th>
                <th className="px-3 py-2.5">Restrictions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {ROLE_MATRIX.map((row) => (
                <tr key={row.role} className="align-top">
                  <td className="px-3 py-3 font-semibold text-slate-900">
                    {row.role}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{row.who}</td>
                  <td className="px-3 py-3 text-slate-700">{row.canDo}</td>
                  <td className="px-3 py-3 text-slate-600">{row.cannotDo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-bold text-slate-900">
            Training &amp; Evaluation Accounts (Password:{' '}
            <code className="rounded bg-white px-1.5 py-0.5 text-emerald-900">
              eacsc_1999_CEA
            </code>
            )
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Use these representative accounts on{' '}
            <Link
              to="/login"
              className="font-semibold text-emerald-800 underline"
            >
              Officer Sign-In
            </Link>{' '}
            to demonstrate or test each privilege level:
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DEMO_ACCOUNTS.map((acct) => (
              <div
                key={acct.email}
                className="rounded-lg border border-slate-200 bg-white p-3 text-xs"
              >
                <p className="font-bold text-slate-900">{acct.name}</p>
                <p className="text-slate-600">{acct.position}</p>
                <p className="mt-1 font-mono text-emerald-900">{acct.email}</p>
                <p className="mt-0.5 text-slate-500">Roles: {acct.roles}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="space-y-4">
        {filteredTopics.map((topic) => (
          <section
            key={topic.id}
            id={topic.id}
            className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                  {topic.badge}
                </span>
                <h2 className="mt-1 text-lg font-bold text-slate-900">
                  {topic.title}
                </h2>
              </div>
              {topic.route && (
                <Link
                  to={topic.route}
                  className="rounded-lg border border-emerald-800 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50"
                >
                  {topic.routeLabel ?? 'Open page'} →
                </Link>
              )}
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {topic.summary}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-800">
              {topic.steps.map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-bold text-emerald-800">•</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
