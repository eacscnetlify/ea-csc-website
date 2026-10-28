import { Link } from 'react-router'

export default function PublicLibraryPage() {
  return (
    <section aria-labelledby="library-heading">
      <p className="text-sm font-semibold text-emerald-800">
        Public records portal
      </p>

      <h1
        id="library-heading"
        className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl"
      >
        Public records library
      </h1>

      <p className="mt-4 max-w-2xl leading-7 text-slate-600">
        This preview will demonstrate how students find current public forms,
        policies, and council information.
      </p>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Navigation example</h2>

        <p className="mt-3 leading-7 text-slate-600">
          Open the fictional example below to test the record detail route.
          Search and the sample records catalog will follow in the next stage.
        </p>

        <Link
          to="/records/EACSC-2026-FORM-0001"
          className="mt-5 inline-block rounded-lg bg-emerald-900 px-4 py-3 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          Open sample record route
        </Link>
      </div>
    </section>
  )
}
