import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <section className="py-12 text-center">
      <p className="font-semibold text-emerald-800">404</p>

      <h1 className="mt-3 text-3xl font-bold">Page not found</h1>

      <p className="mt-4 text-slate-600">
        This address does not match a page in the application.
      </p>

      <Link
        to="/"
        className="mt-6 inline-block font-semibold text-emerald-800 underline underline-offset-4"
      >
        Return to public library
      </Link>
    </section>
  )
}
