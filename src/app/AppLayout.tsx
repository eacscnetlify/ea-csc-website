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

const NAV_GROUPS = [
  {
    heading: 'Public Portal',
    items: [
      { to: '/', label: 'Public Library', end: true },
      { to: '/bulletins', label: 'Update Bulletins', end: false },
      { to: '/help', label: 'Help & Guide', end: false },
    ],
  },
  {
    heading: 'Officer Operations',
    items: [
      { to: '/officer', label: 'Officer Workspace', end: true },
      { to: '/officer/reviews', label: 'Review Queue', end: false },
      { to: '/officer/releases', label: 'Release Panel', end: false },
      { to: '/officer/bulletins', label: 'Bulletin Compiler', end: false },
    ],
  },
  {
    heading: 'Continuity & Access',
    items: [
      { to: '/officer/turnover', label: 'Turnover & Continuity', end: false },
      { to: '/officer/admin/access', label: 'Access Transfer', end: false },
    ],
  },
]

const PAGE_LABELS: Array<{
  match: (p: string) => boolean
  label: string
  help: string
}> = [
  { match: (p) => p === '/', label: 'Public Library', help: 'public-library' },
  {
    match: (p) => p.startsWith('/records/'),
    label: 'Record Detail',
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
  { match: (p) => p === '/login', label: 'Officer Sign-In', help: 'roles' },
  {
    match: (p) => p === '/officer',
    label: 'Officer Workspace',
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
  const [profile, setProfile] = useState<OfficerProfile | null>(null)

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

  const sidebarContent = (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 px-5 py-4">
        <Link
          to="/"
          onClick={() => setSidebarOpen(false)}
          className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-sm font-bold text-white"
          >
            EA
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-white">
              EA-CSC IIDGS Portal
            </span>
            <span className="block truncate text-xs text-slate-400">
              CatSU · CEA Student Council
            </span>
          </span>
        </Link>
      </div>

      <nav
        aria-label="Main navigation"
        className="flex-1 space-y-6 overflow-y-auto px-3 py-5"
      >
        {NAV_GROUPS.map((group) => (
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
                    `flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
                      isActive
                        ? 'bg-emerald-800 font-semibold text-white'
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
        {activeProfile ? (
          <div className="space-y-3 rounded-xl bg-slate-900 p-3.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">
                {activeProfile.full_name}
              </p>
              <p className="truncate text-xs text-slate-400">
                {activeProfile.council_position ?? 'Council Account'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {activeProfile.functional_roles.length > 0 ? (
                  activeProfile.functional_roles.map((r) => (
                    <span
                      key={r}
                      className="rounded bg-emerald-900/80 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-200 uppercase"
                    >
                      {r}
                    </span>
                  ))
                ) : (
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                    Observer (Read-only)
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                to="/login"
                onClick={() => setSidebarOpen(false)}
                className="flex-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-center text-xs font-semibold text-slate-200 hover:bg-slate-800"
              >
                Switch Account
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 rounded-xl bg-slate-900 p-3.5">
            <div>
              <p className="text-sm font-semibold text-white">Public Visitor</p>
              <p className="text-xs text-slate-400">
                Viewing verified public releases
              </p>
            </div>
            <Link
              to="/login"
              onClick={() => setSidebarOpen(false)}
              className="block w-full rounded-lg bg-emerald-800 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Officer Sign-In
            </Link>
          </div>
        )}
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
      <aside className="hidden w-72 shrink-0 lg:sticky lg:top-0 lg:block lg:h-screen">
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation menu"
                className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 lg:hidden"
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

            <div className="flex shrink-0 items-center gap-2">
              <Link
                to={`/help#${pageInfo.help}`}
                aria-label={`Help for ${pageInfo.label}`}
                title={`Help for ${pageInfo.label}`}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900"
              >
                <span className="inline-flex size-4 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-900">
                  ?
                </span>
                <span className="hidden sm:inline">Help</span>
              </Link>

              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                AI Assistant
              </button>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
        >
          <Outlet />
        </main>

        <footer className="border-t border-slate-200 bg-white">
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

      {assistantOpen && (
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
