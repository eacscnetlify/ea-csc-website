import { Link, useParams } from 'react-router'

export default function RecordDetailPage() {
  const { recordId } = useParams()

  return (
    <section aria-labelledby="record-heading">
      <Link
        to="/"
        className="font-semibold text-emerald-800 underline underline-offset-4"
      >
        Back to public library
      </Link>

      <h1 id="record-heading" className="mt-6 text-3xl font-bold">
        Record details
      </h1>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-600">
          Requested record ID
        </h2>

        <p className="mt-2 break-all text-lg font-semibold">{recordId}</p>

        <p className="mt-4 leading-7 text-slate-600">
          Navigation preview only. No document is loaded yet. The next stage
          will connect this screen to permitted fictional record information.
        </p>
      </div>
    </section>
  )
}
