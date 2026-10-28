import { Link } from 'react-router'

export default function LoginPage() {
  return (
    <section
      aria-labelledby="login-heading"
      className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <p className="text-sm font-semibold text-emerald-800">Council officers</p>

      <h1 id="login-heading" className="mt-2 text-3xl font-bold">
        Officer sign-in
      </h1>

      <p className="mt-4 leading-7 text-slate-600">
        Sign-in is not enabled in this development preview. No credentials are
        collected.
      </p>

      <Link
        to="/officer"
        className="mt-6 inline-block rounded-lg bg-emerald-900 px-4 py-3 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        View workspace preview
      </Link>
    </section>
  )
}
