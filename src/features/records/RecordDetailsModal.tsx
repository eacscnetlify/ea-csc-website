import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import RecordDetails from './RecordDetails'
import { getPublicRecord, getPublicRecordHistory } from './records.api'
import type { PublicRecordItem } from './records.types'

interface RecordDetailsModalProps {
  recordId: string
  onClose: () => void
}

type ModalState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | {
      status: 'success'
      record: PublicRecordItem
      history: PublicRecordItem[]
    }

export default function RecordDetailsModal({
  recordId,
  onClose,
}: RecordDetailsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  const [state, setState] = useState<ModalState>({
    status: 'loading',
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const dialog = dialogRef.current

    if (!dialog) {
      return
    }

    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow

    dialog.showModal()
    closeButtonRef.current?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'

    return () => {
      if (dialog.open) {
        dialog.close()
      }

      document.body.style.overflow = previousOverflow

      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

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
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-xl border-0 bg-slate-100 p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white p-4 sm:p-5">
        <h2 id={titleId} className="text-xl font-bold text-slate-900">
          Record preview
        </h2>

        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
        >
          Close
        </button>
      </div>

      <div className="p-4 sm:p-6">
        <div aria-busy={state.status === 'loading'}>
          {state.status === 'loading' && (
            <p
              role="status"
              className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600"
            >
              Loading record preview…
            </p>
          )}

          {state.status === 'error' && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-5"
            >
              <h3 className="font-semibold text-red-900">
                Record preview could not be loaded
              </h3>

              <p className="mt-2 text-sm leading-6 text-red-800">
                Please try loading the preview again.
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
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <h3 className="font-semibold text-slate-900">
                Public record unavailable
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-600">
                No current public release is available for this preview.
              </p>
            </div>
          )}

          {state.status === 'success' && (
            <>
              <p role="status" className="sr-only">
                Record preview loaded.
              </p>

              <RecordDetails record={state.record} history={state.history} />

              <div className="mt-6">
                <Link
                  to={`/records/${encodeURIComponent(state.record.recordId)}`}
                  className="inline-flex rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white hover:bg-green-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
                >
                  Open full record page
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </dialog>
  )
}
