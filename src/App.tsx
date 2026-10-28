const sections = [
  {
    title: 'Records Hub',
    description:
      'Organize council records and find the appropriate document version.',
  },
  {
    title: 'Verification and Versions',
    description:
      'Keep review, approval, publication, and document changes traceable.',
  },
  {
    title: 'Turnover and Continuity',
    description:
      'Preserve records and operating knowledge for incoming officers.',
  },
]

function App() {
  return (
    <main className="min-h-screen bg-slate-100 px-5 py-10 text-slate-900 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <header className="border-b border-slate-300 pb-8">
          <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-900">
            Development preview
          </span>

          <p className="mt-6 text-sm font-semibold tracking-wide text-slate-600">
            Engineering and Architecture College Student Council
          </p>

          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
            EA-CSC Records System
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            A shared foundation for organized records, verified information, and
            continuity across council administrations.
          </p>
        </header>

        <section
          aria-label="System components"
          className="mt-8 grid gap-5 md:grid-cols-3"
        >
          {sections.map((section) => (
            <article
              key={section.title}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-lg font-semibold">{section.title}</h2>

              <p className="mt-3 text-sm leading-6 text-slate-600">
                {section.description}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}

export default App
