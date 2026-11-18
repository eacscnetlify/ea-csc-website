import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { getOfficerProfile } from '../features/auth/auth.api'
import type { OfficerProfile } from '../features/auth/auth.api'
import { useAuth } from '../features/auth/useAuth'
import { formatManilaDateTime } from '../lib/dates'
import { getSupabaseClient } from '../lib/supabase'

const AssistantDrawer = lazy(
  () => import('../features/assistant/AssistantDrawer'),
)

const PUBLIC_NAV = {
  heading: 'Public Portal',
  items: [
    { to: '/', label: 'Home', end: true },
    { to: '/bulletins', label: 'Update Bulletins', end: false },
    { to: '/help', label: 'Help & Guide', end: false },
  ],
}

const VISITOR_AUTH_NAV = {
  heading: 'Account Access',
  items: [
    { to: '/signup', label: 'Create Account', end: false },
    { to: '/login', label: 'Sign In', end: false },
  ],
}

const OBSERVER_NAV = {
  heading: 'Student Account',
  items: [{ to: '/account', label: 'My Account & Role', end: false }],
}

const OFFICER_NAV_GROUPS = [
  {
    heading: 'Officer Operations',
    items: [
      { to: '/officer', label: 'Document Workspace', end: true },
      { to: '/officer/reviews', label: 'Review Queue', end: false },
      { to: '/officer/releases', label: 'Release Panel', end: false },
      { to: '/officer/bulletins', label: 'Bulletin Compiler', end: false },
      { to: '/officer/history', label: 'Activity & History', end: false },
    ],
  },
  {
    heading: 'Continuity & Access',
    items: [
      { to: '/officer/turnover', label: 'Turnover & Continuity', end: false },
      { to: '/officer/admin/access', label: 'Access Transfer', end: false },
      { to: '/account', label: 'My Account & Roles', end: false },
    ],
  },
]

const PAGE_LABELS: Array<{
  match: (p: string) => boolean
  label: string
  help: string
}> = [
  { match: (p) => p === '/', label: 'Home — Public Library', help: 'public-library' },
  {
    match: (p) => p.startsWith('/records/'),
    label: 'Document Detail',
    help: 'public-library',
  },
  {
    match: (p) => p === '/bulletins',
    label: 'Update Bulletins',
    help: 'bulletins',
  },
  {
    match: (p) => p === '/help',
    label: 'Help & Operations Guide',
    help: 'overview',
  },
  { match: (p) => p === '/signup', label: 'Create Student Account', help: 'roles' },
  { match: (p) => p === '/login', label: 'Sign In', help: 'roles' },
  { match: (p) => p === '/account', label: 'My Account & Role', help: 'roles' },
  {
    match: (p) => p === '/officer',
    label: 'Document Workspace',
    help: 'workspace',
  },
  {
    match: (p) => p === '/officer/reviews',
    label: 'Review Queue',
    help: 'review-queue',
  },
  {
    match: (p) => p === '/officer/releases',
    label: 'Release Panel',
    help: 'release-panel',
  },
  {
    match: (p) => p === '/officer/bulletins',
    label: 'Bulletin Compiler',
    help: 'bulletins',
  },
  {
    match: (p) => p === '/officer/history',
    label: 'Council Activity & History',
    help: 'overview',
  },
  {
    match: (p) => p === '/officer/turnover',
    label: 'Turnover & Continuity',
    help: 'turnover',
  },
  {
    match: (p) => p === '/officer/admin/access',
    label: 'Access Transfer',
    help: 'access-transfer',
  },
]

export default function AppLayout() {
  const { status, session } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantMounted, setAssistantMounted] = useState(false)
  const [profile, setProfile] = useState<OfficerProfile | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (status !== 'signed-in' || !userId) {
      return
    }
    const controller = new AbortController()
    getOfficerProfile(userId, controller.signal)
      .then((loaded) => setProfile(loaded))
      .catch(() => setProfile(null))
    return () => controller.abort()
  }, [status, userId])

  const activeProfile = status === 'signed-in' && userId ? profile : null
  const isOfficer =
    Boolean(activeProfile?.is_active) &&
    (activeProfile?.functional_roles.length ?? 0) > 0

  const isCustodian = Boolean(
    activeProfile?.is_active &&
      activeProfile?.functional_roles.includes('custodian'),
  )
  const navGroups = isOfficer
    ? [
        PUBLIC_NAV,
        ...OFFICER_NAV_GROUPS.map((g) => ({
          ...g,
          items: g.items.filter(
            (item) => item.to !== '/officer/bulletins' || isCustodian,
          ),
        })),
      ]
    : status === 'signed-in'
      ? [PUBLIC_NAV, OBSERVER_NAV]
      : [PUBLIC_NAV, VISITOR_AUTH_NAV]

  const pageInfo = PAGE_LABELS.find((p) => p.match(pathname)) ?? {
    label: 'EA-CSC Portal',
    help: 'overview',
  }

  async function handleSignOut() {
    try {
      await getSupabaseClient().auth.signOut()
    } finally {
      setProfile(null)
      setSidebarOpen(false)
      navigate('/login')
    }
  }

  async function handleRefreshAccess() {
    if (!userId || refreshing) return
    setRefreshing(true)
    try {
      await getSupabaseClient().auth.refreshSession()
      const loaded = await getOfficerProfile(userId, new AbortController().signal)
      setProfile(loaded)
    } catch {
      // keep existing profile on transient failure
    } finally {
      setRefreshing(false)
    }
  }

  const sidebarContent = (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100 border-r border-slate-800">
      <div className="border-b border-rose-900/50 bg-gradient-to-r from-slate-950 to-rose-950/30 px-5 py-4">
        <Link
          to="/"
          onClick={() => setSidebarOpen(false)}
          className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
        >
          <img
            src="/eacsc-logo-2026.jpg"
            alt="CatSU EA-CSC 2026 Seal"
            className="size-10 shrink-0 rounded-full border border-slate-400 object-cover shadow"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-white">
              EA-CSC IIDGS Portal
            </span>
            <span className="block truncate text-[11px] text-rose-300 font-medium">
              CatSU · CEA Student Council
            </span>
          </span>
        </Link>
      </div>

      <nav
        aria-label="Main navigation"
        className="flex-1 space-y-6 overflow-y-auto px-3 py-5"
      >
        {navGroups.map((group) => (
          <div key={group.heading}>
            <p className="px-3 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              {group.heading}
            </p>
            <div className="mt-2 space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex min-h-[42px] items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 ${
                      isActive
                        ? 'bg-rose-800 font-semibold text-white shadow-sm'
                        : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-4">
        <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/90 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold tracking-wider text-slate-300 uppercase">
              Governance Guard
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/90 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-700/40">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              SHA-256
            </span>
          </div>
          <p className="text-[11px] leading-4 text-slate-400">
            6-Point Verification · Segregation of Duties · RA 10173 Privacy · UTC+8
          </p>
          <div className="flex gap-2 pt-0.5">
            <Link
              to="/help"
              onClick={() => setSidebarOpen(false)}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-center text-[11px] font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white"
            >
              Guide
            </Link>
            <Link
              to="/bulletins"
              onClick={() => setSidebarOpen(false)}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-center text-[11px] font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white"
            >
              Bulletins
            </Link>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      <a
        href="#main-content"
        className="sr-only rounded-lg bg-white p-3 text-sm font-semibold text-emerald-900 shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:outline-2 focus:outline-emerald-700"
      >
        Skip to main content
      </a>

      {/* Desktop persistent sidebar */}
      <aside className="relative z-20 hidden w-72 shrink-0 lg:sticky lg:top-0 lg:block lg:h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile slide-over sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation menu"
        >
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[85vw]">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="relative flex min-w-0 flex-1 flex-col overflow-x-clip">
        {(() => {
          const isAuth =
            pathname === '/login' ||
            pathname === '/signup' ||
            pathname.startsWith('/auth/')
          const isContinuity =
            pathname.startsWith('/officer/turnover') ||
            pathname.startsWith('/officer/admin/') ||
            pathname === '/account'
          const isOfficer = pathname.startsWith('/officer')

          const bg = isAuth
            ? { src: '/bg-auth.jpg', opacity: 'opacity-[0.52]', wash: 'bg-slate-100/30' }
            : isContinuity
              ? { src: '/bg-continuity.jpg', opacity: 'opacity-[0.55]', wash: 'bg-white/40' }
              : isOfficer
                ? { src: '/bg-officer.jpg', opacity: 'opacity-[0.55]', wash: 'bg-white/40' }
                : { src: '/bg-public.jpg', opacity: 'opacity-[0.48]', wash: 'bg-slate-100/35' }

          return (
            <div
              aria-hidden="true"
              className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none lg:left-72"
            >
              <img
                src={bg.src}
                alt=""
                className={`h-full w-full object-cover object-center transition-opacity duration-500 ${bg.opacity}`}
              />
              <div className={`absolute inset-0 backdrop-blur-[1px] ${bg.wash}`} />
            </div>
          )
        })()}

        <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:flex-nowrap sm:gap-3 sm:px-6 sm:py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation menu"
                className="inline-flex min-h-[40px] shrink-0 items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 lg:hidden"
              >
                Menu
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900 sm:text-base">
                  {pageInfo.label}
                </p>
                <p className="hidden truncate text-xs text-slate-500 sm:block">
                  {formatManilaDateTime(new Date().toISOString())} (Asia/Manila)
                </p>
              </div>
            </div>

            <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto sm:shrink-0 sm:gap-2">
              {status === 'signed-in' && (
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={() => void handleRefreshAccess()}
                  title="Refresh access & roles"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 hover:shadow-sm active:scale-95 disabled:opacity-60"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <span className="hidden sm:inline">
                    {refreshing ? 'Syncing' : 'Refresh'}
                  </span>
                </button>
              )}

              <Link
                to="/"
                title="Home Library"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 hover:shadow-sm active:scale-95"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="size-3.5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z"
                  />
                </svg>
                <span className="hidden sm:inline">Home</span>
              </Link>

              <Link
                to={`/help#${pageInfo.help}`}
                aria-label={`Help for ${pageInfo.label}`}
                title={`Help for ${pageInfo.label}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 hover:shadow-sm active:scale-95"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="size-3.5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.5 9a2.5 2.5 0 014.8.8c0 1.7-2.3 2.2-2.3 3.7m.05 3h.01"
                  />
                </svg>
                <span className="hidden sm:inline">Help</span>
              </Link>

              {status === 'signed-in' ? (
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  title="Sign out"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-rose-700 hover:bg-rose-50 hover:text-rose-900 hover:shadow-sm active:scale-95"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="size-3.5"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"
                    />
                  </svg>
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              ) : (
                <Link
                  to="/login"
                  title="Sign in"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 hover:shadow-sm active:scale-95"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="size-3.5"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"
                    />
                  </svg>
                  <span className="hidden sm:inline">Sign in</span>
                </Link>
              )}

              <button
                type="button"
                onClick={() => {
                  setAssistantMounted(true)
                  setAssistantOpen(true)
                }}
                className="ai-launcher-btn inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-900 via-emerald-800 to-[#8B0029] px-3.5 text-xs font-semibold text-white shadow-sm transition-all duration-200 hover:shadow-md hover:shadow-emerald-900/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
                </span>
                <span>AI Assistant</span>
              </button>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
        >
          <div key={pathname} className="animate-page-enter">
            <Outlet />
          </div>
        </main>

        <footer className="relative z-10 border-t border-slate-200/90 bg-white/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-xs leading-5 text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="font-semibold text-slate-800">
              Engineering and Architecture College Student Council (EA-CSC)
            </p>
            <p>
              EA-CSC Constitution &amp; By-Laws · Republic Act No. 10173 (Data
              Privacy Act of 2012)
            </p>
          </div>
        </footer>
      </div>

      {assistantMounted && (
        <Suspense fallback={null}>
          <AssistantDrawer
            open={assistantOpen}
            onClose={() => setAssistantOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
