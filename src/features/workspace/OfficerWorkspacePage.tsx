export default function OfficerWorkspacePage() {
  const areas = [
    'Records and versions',
    'Review and publication',
    'Turnover and continuity',
  ]

  return (
    <section aria-labelledby="workspace-heading">
      <p className="text-sm font-semibold text-amber-900">
        Publicly accessible mock preview
      </p>

      <h1 id="workspace-heading" className="mt-2 text-3xl font-bold">
        Officer workspace
      </h1>

      <p className="mt-4 max-w-2xl leading-7 text-slate-600">
        This placeholder contains no operational records. Sign-in and permission
        controls are not enabled yet.
      </p>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {areas.map((area) => (
          <section
            key={area}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold">{area}</h2>
            <p className="mt-3 text-sm text-slate-600">
              Workspace area reserved for later implementation.
            </p>
          </section>
        ))}
      </div>
    </section>
  )
}
