import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import RecordDetails from './RecordDetails'
import { getPublicRecord, getPublicRecordHistory } from './records.api'
import type { PublicRecordItem } from './records.types'

type DetailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | {
      status: 'success'
      record: PublicRecordItem
      history: PublicRecordItem[]
    }

interface RecordDetailLoaderProps {
  recordId: string
}

function RecordDetailLoader({ recordId }: RecordDetailLoaderProps) {
  const [state, setState] = useState<DetailState>({
    status: 'loading',
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false

    Promise.all([getPublicRecord(recordId), getPublicRecordHistory(recordId)])
      .then(([record, history]) => {
        if (ignore) {
          return
        }

        if (!record) {
          setState({ status: 'unavailable' })
          return
        }

        setState({
          status: 'success',
          record,
          history,
        })
      })
      .catch(() => {
        if (!ignore) {
          setState({ status: 'error' })
        }
      })

    return () => {
      ignore = true
    }
  }, [recordId, attempt])

  function retryLoading() {
    setState({ status: 'loading' })
    setAttempt((previous) => previous + 1)
  }

  return (
    <section aria-labelledby="record-detail-heading">
      <Link
        to="/"
        className="inline-flex rounded text-sm font-semibold text-green-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
      >
        Back to public library
      </Link>

      <h1
        id="record-detail-heading"
        className="mt-5 text-3xl font-bold tracking-tight text-slate-900"
      >
        Record details
      </h1>

      <p className="mt-3 text-base leading-7 text-slate-600">
        Current public release information and permitted public history.
      </p>

      <div className="mt-6" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && (
          <p
            role="status"
            className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600"
          >
            Loading record details…
          </p>
        )}

        {state.status === 'error' && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-6"
          >
            <h2 className="text-lg font-semibold text-red-900">
              Record details could not be loaded
            </h2>

            <p className="mt-2 text-sm leading-6 text-red-800">
              Please try loading this record again.
            </p>

            <button
              type="button"
              onClick={retryLoading}
              className="mt-4 rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === 'unavailable' && (
          <div
            role="status"
            className="rounded-xl border border-slate-200 bg-white p-6"
          >
            <h2 className="text-xl font-bold text-slate-900">
              Public record unavailable
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-600">
              No current public release is available at this address. Return to
              the public library to browse available records.
            </p>
          </div>
        )}

        {state.status === 'success' && (
          <RecordDetails record={state.record} history={state.history} />
        )}
      </div>
    </section>
  )
}

export default function RecordDetailPage() {
  const { recordId } = useParams()
  const requestedId = recordId ?? ''

  return <RecordDetailLoader key={requestedId} recordId={requestedId} />
}
