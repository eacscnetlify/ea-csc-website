import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

interface AccordionSection {
  id: string
  title: string
  subtitle: string
  badge: string
  icon: 'book' | 'shield' | 'users' | 'workflow' | 'scenarios' | 'wrench'
  route?: string
  routeLabel?: string
  definitions?: Array<{ term: string; detail: string }>
  steps?: string[]
  scenarios?: Array<{ title: string; steps: string[] }>
  includeRoleMatrix?: boolean
  includeRosterSample?: boolean
}

const ROLE_MATRIX = [
  {
    role: 'Public Visitor (No Sign-In)',
    who: 'Students, faculty, guests',
    canDo:
      'Browse Home — Public Library, inspect Document Details & Version History, download Published public files, and download Public Update Bulletins.',
    cannotDo:
      'Cannot view Drafts, For Review items, Restricted documents, Internal bulletins, or any /officer/* page.',
  },
  {
    role: 'Student Observer (roles: [])',
    who: 'Signed-in student account without officer roles',
    canDo:
      'Same as Public Visitor, plus can manage their account and apply for one of the 28 EA-CSC officer positions on /account.',
    cannotDo:
      'Blocked from Document Workspace, Review Queue, Release Panel, Bulletin Compiler, Activity & History, and Turnover.',
  },
  {
    role: 'Author (author)',
    who: 'Committee Heads, Representatives, Board Members',
    canDo:
      'Create Folders and Documents, upload Draft attachments, save version notes, and Submit for Review on assigned Documents.',
    cannotDo:
      'Cannot approve their own submissions (segregation of duties), publish releases, or access Restricted documents without explicit assignment.',
  },
  {
    role: 'Custodian (custodian)',
    who: 'Executive Secretary, Assistant Secretary, File Inventory Manager, Executive Treasurer',
    canDo:
      'Manage Folders and Documents, compile Update Bulletins, and prepare/freeze Turnover packages. Executive Secretary also holds Executive Fast-Track Self-Approval.',
    cannotDo:
      'Non-executive custodians cannot approve versions they authored or publish without Publisher role.',
  },
  {
    role: 'Reviewer (reviewer)',
    who: 'Internal VP, External VP, Auditors, Board of Directors',
    canDo:
      'Inspect For Review submissions (non-author), complete the 6-point verification checklist, add review comments, and Return for Correction.',
    cannotDo:
      'Cannot grant final Substantive Approval without the Approver role.',
  },
  {
    role: 'Approver (approver)',
    who: 'Council President, Executive Secretary, Adviser',
    canDo:
      'Complete 6-point verification and grant final Substantive Approval (Approved). President & Executive Secretary also hold Executive Fast-Track Self-Approval.',
    cannotDo:
      'Cannot publish releases to the public without the Publisher role.',
  },
  {
    role: 'Publisher (publisher)',
    who: 'Public Relations Officer (PRO), Editorial',
    canDo:
      'Publish Approved versions immediately, schedule future effective dates, supersede older versions, or perform Emergency Withdrawal.',
    cannotDo:
      'Cannot approve Drafts/For Review versions without Reviewer/Approver roles.',
  },
  {
    role: 'Technical Admin (technical_admin)',
    who: 'Technical Administrator',
    canDo:
      'Activate/deactivate officer accounts, update functional roles, and execute record custody Access Transfers.',
    cannotDo:
      'Cannot bypass 6-point verification or approve without Approver role.',
  },
]

const OFFICIAL_TEST_SAMPLE = [
  { email: 'president@eacsc.example', position: 'President', roles: 'approver, reviewer, author, custodian (Fast-Track)' },
  { email: 'executive.secretary@eacsc.example', position: 'Executive Secretary', roles: 'custodian, author, approver, reviewer (Fast-Track)' },
  { email: 'internal.vp@eacsc.example', position: 'Internal Vice President', roles: 'reviewer, author' },
  { email: 'external.vp@eacsc.example', position: 'External Vice President', roles: 'reviewer, author' },
  { email: 'executive.treasurer@eacsc.example', position: 'Executive Treasurer', roles: 'custodian, author' },
  { email: 'executive.auditor@eacsc.example', position: 'Executive Auditor', roles: 'reviewer' },
  { email: 'pro@eacsc.example', position: 'Public Relations Officer', roles: 'publisher, author' },
  { email: 'event.chairperson@eacsc.example', position: 'Event Chairperson', roles: 'author' },
  { email: 'adviser@eacsc.example', position: 'Adviser', roles: 'reviewer, approver' },
  { email: 'admin@eacsc.example', position: 'Technical Administrator', roles: 'technical_admin, custodian' },
]

const SECTIONS: AccordionSection[] = [
  {
    id: 'overview',
    title: 'Core Concepts: Folders, Documents, Versions & Security',
    subtitle: 'Definitions of Folders, Documents, Version states, Public vs. Restricted access, and SHA-256 integrity',
    badge: 'Definitions',
    icon: 'book',
    definitions: [
      {
        term: 'Folder',
        detail:
          'An organizational container created by officers in the Document Workspace (e.g., "Engineering Week & Council Operations 2026") so related documents stay grouped instead of appearing in one long list.',
      },
      {
        term: 'Document (Master Record)',
        detail:
          'A permanent institutional file with an immutable canonical ID (e.g., EACSC-2026-ACT-0001). A Document is not a folder—it is the living official record that evolves through numbered Versions over time.',
      },
      {
        term: 'Version (v1, v2, v3…)',
        detail:
          'Each revision of a Document moves through strict states: Draft → For Review → Approved → Published (or Superseded when replaced by a newer version, or Withdrawn in an emergency).',
      },
      {
        term: 'Public vs. Internal vs. Restricted',
        detail:
          'Public documents appear on the Home — Public Library once Published. Internal documents are for council operations. Restricted documents (e.g., financial ledgers) are hidden from the public and visible ONLY to officers explicitly assigned with allow_restricted permission.',
      },
      {
        term: 'SHA-256 & Magic-Byte Verification',
        detail:
          'Every uploaded file (.pdf, .docx, .png, .jpg/.jpeg up to 10 MB) has its real file bytes inspected and a cryptographic SHA-256 checksum recorded so tampering can always be detected.',
      },
    ],
  },
  {
    id: 'roles',
    title: 'Council Positions, Functional Roles & Fast-Track Rule',
    subtitle: 'The 28 EA-CSC positions, Segregation of Duties, President & Executive Secretary Fast-Track, and Role Matrix',
    badge: 'Access Control',
    icon: 'shield',
    definitions: [
      {
        term: '28 Official EA-CSC Positions',
        detail:
          'Organized into Executive Officers (President, Internal VP, External VP, Executive Secretary, Executive Treasurer, Executive Auditor, Business Manager, Public Relations Officer, Board of Director), Board Members (Assistant/Auxiliary Secretaries, File Inventory Manager, Assistant Treasurer/Auditor, Graphic Designer, Editorial, Documentary Team, Logistics, Procurement, Event Chairperson/Organizers, Ways & Means, 1st–4th Year Representatives), and Advisory (Adviser).',
      },
      {
        term: 'Segregation of Duties (Standard Rule)',
        detail:
          'Regular officers cannot approve their own Drafts. An Author submits a Draft ("For Review"), and a separate Reviewer/Approver inspects it via the 6-point checklist before a Publisher (PRO) releases it.',
      },
      {
        term: 'President & Executive Secretary Fast-Track Exception',
        detail:
          'For urgent council memos or time-sensitive bulletins, the Council President and Executive Secretary hold Executive Fast-Track Self-Approval privileges directly inside the Document Workspace, logged in the permanent audit trail with their stated rationale.',
      },
    ],
    includeRoleMatrix: true,
  },
  {
    id: 'public-library',
    title: 'Public Portal, Student Sign-Up & Officer Role Requests',
    subtitle: 'How visitors browse Home & Bulletins, create Student Observer accounts, and apply for council roles',
    badge: 'Public & Accounts',
    icon: 'users',
    route: '/',
    routeLabel: 'Open Home — Public Library',
    steps: [
      'Home — Public Library (/): Anyone can search published documents by title or canonical ID, filter by category (GOV, SEC, ACT, FIN, FRM, TRN), and download verified files or inspect superseded version history.',
      'Update Bulletins (/bulletins): View and download official periodic PDF digests compiling verified releases within a reporting window.',
      'Create Observer Account (/signup): Students register with their Full Name, Student ID, Degree Program (BS Civil, Electronics, Computer Engineering, or BS Architecture), Email, and Password. Duplicate names, Student IDs, and emails are automatically blocked with clear warnings.',
      'Apply for Officer Role (/account): Signed-in Student Observers select their appointed EA-CSC position from the 28-position dropdown and submit a justification. Once the Council President approves the request in /account, Officer Operations tabs unlock immediately.',
    ],
  },
  {
    id: 'workspace',
    title: 'Officer Operations: Workspace, Reviews, Releases, Bulletins & History',
    subtitle: 'Step-by-step guide for Document Workspace, Review Queue, Release Panel, Bulletin Compiler, and Activity & History',
    badge: 'Officer Workflow',
    icon: 'workflow',
    route: '/officer',
    routeLabel: 'Open Document Workspace',
    steps: [
      '1. Document Workspace (/officer): Create Folders, create Public or Restricted Documents, upload valid attachments (.pdf, .docx, .png, .jpg), save Draft notes, and click "Submit for Review" (or use Executive Fast-Track if President/Executive Secretary).',
      '2. Review Queue (/officer/reviews): Reviewers and Approvers inspect "For Review" submissions against the 6-point verification checklist (Identity, Dates/Manila UTC+8 time, Venue/Link, Eligibility, Authority/Privacy, Contact/IDs). Return for Correction with comments, or record Substantive Approval.',
      '3. Release Panel (/officer/releases): The Public Relations Officer (Publisher) publishes Approved versions immediately, schedules a future Manila effective date, supersedes prior versions, or executes an Emergency Withdrawal.',
      '4. Bulletin Compiler (/officer/bulletins): Compiles Public or Internal PDF digests over a chosen Manila (UTC+8) reporting window and issues v1/v2 bulletins.',
      '5. Council Activity & History (/officer/history): View the chronological, tamper-evident audit timeline of all document creations, uploads, reviews, approvals, releases, and role changes across the entire council.',
    ],
  },
  {
    id: 'scenarios',
    title: 'Real-World Scenarios & Step-by-Step Walkthroughs',
    subtitle: 'Practical examples: regular submission, returned draft correction, urgent fast-track, observer onboarding, and turnover',
    badge: 'Scenarios',
    icon: 'scenarios',
    scenarios: [
      {
        title: 'Scenario A: Event Chairperson Publishes Engineering Week Guidelines',
        steps: [
          'Event Chairperson signs in, opens Document Workspace (/officer), selects "Engineering Week & Council Operations 2026", and creates or opens EACSC-2026-ACT-0001.',
          'Uploads the PDF, writes Draft notes, and clicks "Submit for Review". The draft locks.',
          'Internal Vice President (Reviewer) opens Review Queue (/officer/reviews), checks the 6 points, and President (Approver) records Substantive Approval.',
          'Public Relations Officer (Publisher) opens Release Panel (/officer/releases) and clicks "Publish Immediately"—students can now download it on Home (/).',
        ],
      },
      {
        title: 'Scenario B: Reviewer Returns a Draft for Correction',
        steps: [
          'Executive Treasurer uploads a budget draft and submits it for review.',
          'Executive Auditor spots a missing Manila deadline, marks that checklist item "Correction Required", writes a review comment, and clicks "Return for Correction".',
          'The version returns to Draft. Executive Treasurer sees the review comment in "Review return history", uploads the corrected file, saves notes, and re-submits.',
        ],
      },
      {
        title: 'Scenario C: Urgent Bulletin by President or Executive Secretary',
        steps: [
          'During an urgent class suspension or venue change, the President or Executive Secretary creates/uploads the Draft in Document Workspace (/officer).',
          'Using the "Executive Fast-Track Self-Approval" panel, they enter a brief urgency rationale and approve the version immediately—bypassing the separate-reviewer wait while logging the action in Activity & History.',
          'Public Relations Officer (or Editorial) publishes it on Release Panel.',
        ],
      },
      {
        title: 'Scenario D: New Student Becomes an Officer',
        steps: [
          'A student creates an account at /signup (starts as Student Observer with read-only access).',
          'They open My Account & Role (/account), choose their appointed position (e.g., Graphic Designer), and submit an application.',
          'President opens /account, sees the pending application in the President’s Role Approval Console, and clicks Approve.',
          'The student clicks "Refresh access" (or signs back in) and immediately gains Document Workspace access.',
        ],
      },
    ],
  },
  {
    id: 'continuity',
    title: 'Turnover, Access Transfer & Troubleshooting',
    subtitle: 'End-of-term continuity packages, officer handover, common error codes (PT409), and 2026 test accounts',
    badge: 'Continuity & FAQ',
    icon: 'wrench',
    route: '/officer/turnover',
    routeLabel: 'Open Turnover & Continuity',
    steps: [
      'Turnover & Continuity (/officer/turnover): Outgoing Custodians write the continuity memorandum, freeze the outgoing inventory, and export JSON/PDF. Incoming officers record "Incoming Acknowledgment" after verifying access.',
      'Access Transfer (/officer/admin/access): Technical Administrators transfer document custody from outgoing officers to incoming officers and deactivate outgoing accounts.',
      'PT409 / Conflict Error: Means another officer updated the same document or version while your tab was open. Click Reload to fetch the latest revision and reapply your change.',
      'Restricted Document Not Visible: Restricted documents require BOTH an active officer account AND an explicit assignment with allow_restricted enabled.',
    ],
    includeRosterSample: true,
  },
]

function SectionIcon({ icon }: { icon: AccordionSection['icon'] }) {
  const cls = 'h-5 w-5 text-slate-600'
  switch (icon) {
    case 'book':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      )
    case 'shield':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      )
    case 'users':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      )
    case 'workflow':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      )
    case 'scenarios':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      )
    case 'wrench':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
        </svg>
      )
  }
}

export default function HelpPage() {
  const { hash } = useLocation()
  const [query, setQuery] = useState('')
  const [openIds, setOpenIds] = useState<string[]>([])

  useEffect(() => {
    if (!hash) return
    const targetId = hash.replace('#', '')
    const mapHashToSection: Record<string, string> = {
      overview: 'overview',
      roles: 'roles',
      'public-library': 'public-library',
      workspace: 'workspace',
      'review-queue': 'workspace',
      'release-panel': 'workspace',
      bulletins: 'workspace',
      turnover: 'continuity',
      'access-transfer': 'continuity',
    }
    const sectionId = mapHashToSection[targetId] ?? targetId
    const timer = window.setTimeout(() => {
      setOpenIds((prev) => (prev.includes(sectionId) ? prev : [...prev, sectionId]))
      const el = document.getElementById(sectionId)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [hash])

  const normalized = query.trim().toLowerCase()
  const filteredSections = SECTIONS.filter((s) => {
    if (!normalized) return true
    const haystack = [
      s.title,
      s.subtitle,
      s.badge,
      ...(s.steps ?? []),
      ...(s.definitions ?? []).flatMap((d) => [d.term, d.detail]),
      ...(s.scenarios ?? []).flatMap((sc) => [sc.title, ...sc.steps]),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalized)
  })

  function toggleSection(id: string) {
    setOpenIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-wider text-rose-800 uppercase">
              Help Center &amp; Operations Guide
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
              How to Use the EA-CSC Governance Portal
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Click any category below to expand its definitions, step-by-step
              workflows, and real-world council scenarios.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpenIds(SECTIONS.map((s) => s.id))}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={() => setOpenIds([])}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Collapse All
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search guides, terms, or scenarios (e.g., folder, fast-track, restricted, PT409, scenario)…"
            aria-label="Search help topics"
            className="w-full max-w-lg rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:border-rose-700 focus:outline-none"
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
      </section>

      <div className="space-y-3">
        {filteredSections.map((section) => {
          const isOpen = normalized.length > 0 || openIds.includes(section.id)
          return (
            <section
              key={section.id}
              id={section.id}
              className="scroll-mt-20 overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-xs backdrop-blur-xs transition hover:border-slate-300"
            >
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50/80"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50">
                    <SectionIcon icon={section.icon} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">
                        {section.title}
                      </h2>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                        {section.badge}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500 sm:text-sm">
                      {section.subtitle}
                    </p>
                  </div>
                </div>

                <svg
                  className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${
                    isOpen ? 'rotate-180 text-rose-800' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && (
                <div className="animate-accordion-reveal border-t border-slate-100 bg-slate-50/40 px-5 py-5 space-y-5">
                  {section.definitions && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {section.definitions.map((def) => (
                        <div
                          key={def.term}
                          className="rounded-xl border border-slate-200 bg-white p-4"
                        >
                          <p className="text-sm font-bold text-slate-900">{def.term}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            {def.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {section.steps && (
                    <ol className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-4">
                      {section.steps.map((step) => (
                        <li
                          key={step}
                          className="flex gap-2.5 text-sm leading-6 text-slate-700"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-700" />
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {section.scenarios && (
                    <div className="grid gap-4 md:grid-cols-2">
                      {section.scenarios.map((sc) => (
                        <div
                          key={sc.title}
                          className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5"
                        >
                          <h3 className="text-sm font-bold text-slate-900">
                            {sc.title}
                          </h3>
                          <ol className="space-y-1.5 text-xs leading-5 text-slate-600">
                            {sc.steps.map((s, idx) => (
                              <li key={s}>
                                <strong className="text-slate-800">{idx + 1}.</strong>{' '}
                                {s}
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>
                  )}

                  {section.includeRoleMatrix && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                        <thead className="bg-slate-50 font-semibold text-slate-700">
                          <tr>
                            <th className="px-4 py-2.5">Role</th>
                            <th className="px-4 py-2.5">Typical Positions</th>
                            <th className="px-4 py-2.5">Allowed Actions</th>
                            <th className="px-4 py-2.5">Restrictions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ROLE_MATRIX.map((row) => (
                            <tr key={row.role}>
                              <td className="px-4 py-2.5 font-semibold text-slate-900">
                                {row.role}
                              </td>
                              <td className="px-4 py-2.5 text-slate-600">{row.who}</td>
                              <td className="px-4 py-2.5 text-slate-700">{row.canDo}</td>
                              <td className="px-4 py-2.5 text-slate-600">{row.cannotDo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {section.includeRosterSample && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Key 2026 Test Roster Accounts (Password: eacsc_1999_CEA)
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {OFFICIAL_TEST_SAMPLE.map((acc) => (
                          <div
                            key={acc.email}
                            className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                          >
                            <p className="font-bold text-slate-900">
                              {acc.position}{' '}
                              <span className="font-normal text-slate-500">
                                ({acc.email})
                              </span>
                            </p>
                            <p className="text-slate-600">{acc.roles}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {section.route && section.routeLabel && (
                    <div>
                      <Link
                        to={section.route}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        {section.routeLabel} →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}

        {filteredSections.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
            No help topics matched "{query}". Try clearing your search.
          </div>
        )}
      </div>
    </div>
  )
}
