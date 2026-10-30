import { Link, NavLink, Outlet } from 'react-router'

const navigationItems = [
  { to: '/', label: 'Public library', end: true },
  { to: '/login', label: 'Officer sign-in', end: false },
  { to: '/officer', label: 'Officer workspace', end: false },
]

export default function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <a
        href="#main-content"
        className="sr-only rounded-lg bg-white p-3 text-emerald-900 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to main content
      </a>

      <div className="bg-amber-100 px-5 py-2 text-center text-sm text-amber-950">
        <strong>DEVELOPMENT MODE</strong>
        {' — '}
        Fictional information only
      </div>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
          >
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-900 font-bold text-white"
            >
              EA
            </span>

            <span>
              <span className="block text-lg font-bold">
                EA-CSC Records System
              </span>
              <span className="block text-sm text-slate-600">
                Catanduanes State University
              </span>
            </span>
          </Link>

          <nav aria-label="Main navigation" className="flex flex-wrap gap-2">
            {navigationItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                    isActive
                      ? 'bg-emerald-900 text-white'
                      : 'text-slate-700 hover:bg-emerald-50'
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
        className="mx-auto w-full max-w-6xl flex-1 px-5 py-10"
      >
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl space-y-2 px-5 py-6 text-sm leading-6 text-slate-600">
          <p>Engineering and Architecture College Student Council</p>
          <p>
            Governance reference: EA-CSC Constitution and By-Laws. Privacy
            reference: Data Privacy Act of 2012.
          </p>
          <p>
            Development prototype. Official publication and privacy notices will
            be finalized before operational use.
          </p>
        </div>
      </footer>
    </div>
  )
}
