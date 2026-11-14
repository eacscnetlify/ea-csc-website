import { Link, NavLink, Outlet } from 'react-router'

const navigationItems = [
  { to: '/', label: 'Public Library', end: true },
  { to: '/bulletins', label: 'Update Bulletins', end: false },
  { to: '/login', label: 'Officer Sign-In', end: false },
  { to: '/officer', label: 'Officer Workspace', end: true },
  { to: '/officer/reviews', label: 'Review Queue', end: false },
  { to: '/officer/releases', label: 'Release Panel', end: false },
  { to: '/officer/bulletins', label: 'Bulletin Compiler', end: false },
  { to: '/officer/turnover', label: 'Turnover', end: false },
  { to: '/officer/admin/access', label: 'Access Transfer', end: false },
]

export default function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <a
        href="#main-content"
        className="sr-only rounded-lg bg-white p-3 text-sm font-semibold text-emerald-900 shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:outline-2 focus:outline-emerald-700"
      >
        Skip to main content
      </a>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
          >
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-900 font-bold text-white sm:size-12"
            >
              EA
            </span>

            <span className="min-w-0">
              <span className="block truncate text-base font-bold text-slate-900 sm:text-lg">
                EA-CSC Institutional Information &amp; Document Governance
              </span>
              <span className="block truncate text-xs text-slate-600 sm:text-sm">
                Catanduanes State University — College of Engineering and
                Architecture
              </span>
            </span>
          </Link>

          <nav
            aria-label="Main navigation"
            className="flex flex-wrap gap-1.5 sm:gap-2"
          >
            {navigationItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `inline-flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                    isActive
                      ? 'bg-emerald-900 text-white'
                      : 'text-slate-700 hover:bg-emerald-50 hover:text-emerald-950'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-5 sm:py-10"
      >
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl space-y-1.5 px-4 py-6 text-sm leading-6 text-slate-600 sm:px-5">
          <p className="font-semibold text-slate-800">
            Engineering and Architecture College Student Council (EA-CSC)
          </p>
          <p>
            Governance reference: EA-CSC Constitution and By-Laws. Privacy
            reference: Republic Act No. 10173 (Data Privacy Act of 2012).
          </p>
        </div>
      </footer>
    </div>
  )
}
