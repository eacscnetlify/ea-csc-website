import { useEffect, useId, useRef, useState } from 'react'
import { getSupabaseClient } from '../../lib/supabase'
import type { AssignedVersion } from '../workspace/workspace.api'
import { findDraftAttempt } from '../workspace/workspace.commands'
import {
  createReviewAttempt,
  findReviewAttempt,
  forgetReviewAttempt,
  sendReviewAttempt,
} from './review.commands'

export default function ReviewActions({
  userId,
  recordId,
  versions,
  canSubmit,
  canReturn,
  onConfirmed,
  onReload,
}: {
  userId: string
  recordId: string
  versions: AssignedVersion[]
  canSubmit: boolean
  canReturn: boolean
  onConfirmed: (state: 'Draft' | 'For Review') => void
  onReload: () => void
}) {
  const candidates = versions.filter(
    (v) =>
      (canSubmit && v.state === 'Draft') ||
      (canReturn && v.state === 'For Review'),
  )
  const [selectedId, setSelectedId] = useState(candidates[0]?.versionId ?? '')
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [, redraw] = useState(0)
  const mounted = useRef(false)
  const busy = useRef(false)
  const id = useId()
  const attempt = findReviewAttempt(userId, recordId)
  const selected =
    candidates.find((v) => v.versionId === selectedId) ?? candidates[0]
  const operation = selected?.state === 'For Review' ? 'return' : 'submit'

  useEffect(() => {
    mounted.current = true
    let disposed = false
    const prior = findReviewAttempt(userId, recordId)
    const settled = () => {
      if (!disposed) redraw((n) => n + 1)
    }

    // Observe an existing request without resending it on mount.
    if (prior?.status === 'sending' && prior.promise)
      void prior.promise.then(settled, settled)

    return () => {
      disposed = true
      mounted.current = false
    }
  }, [userId, recordId])

  async function send() {
    if (busy.current || attempt?.status === 'sending') return
    if (!attempt && (!selected || (operation === 'return' && !comment.trim())))
      return

    const notesAttempt =
      selected && findDraftAttempt(userId, selected.versionId)
    if (
      !attempt &&
      operation === 'submit' &&
      notesAttempt &&
      (notesAttempt.status === 'sending' || notesAttempt.status === 'uncertain')
    ) {
      setError(
        'Confirm the pending Draft notes save before submitting this version for review.',
      )
      return
    }

    busy.current = true
    setError('')
    try {
      const entry =
        attempt ??
        createReviewAttempt({
          actorId: userId,
          recordId,
          versionId: selected.versionId,
          versionNumber: selected.versionNumber,
          expectedRevision: selected.revision,
          operation,
          comment,
          requestId: crypto.randomUUID(),
        })
      const promise = sendReviewAttempt(entry)
      redraw((n) => n + 1)
      const receipt = await promise

      if (mounted.current) {
        forgetReviewAttempt(entry)
        onConfirmed(receipt.state)
      }
    } catch (failure) {
      if (mounted.current) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'The review action could not be confirmed.',
        )
        redraw((n) => n + 1)
      }
    } finally {
      busy.current = false
    }
  }

  function reload() {
    if (!attempt) return onReload()
    forgetReviewAttempt(attempt)
    if (attempt.receipt) onConfirmed(attempt.receipt.state)
    else onReload()
  }

  if (!canSubmit && !canReturn && !attempt) return null

  return (
    <section
      aria-label="Review actions"
      className="space-y-3 rounded-xl border border-emerald-200 bg-white p-5"
    >
      <h3 className="text-xl font-bold">Review actions</h3>

      {attempt ? (
        <>
          <p>
            Version {attempt.request.versionNumber} ·{' '}
            {attempt.request.operation === 'submit'
              ? 'Submit for review'
              : 'Return to Draft'}{' '}
            · Edit revision {attempt.request.expectedRevision}
          </p>
          {attempt.request.operation === 'return' && (
            <p className="whitespace-pre-wrap wrap-break-word">
              {attempt.request.comment}
            </p>
          )}
          {(error || attempt.error) && (
            <p role="alert">{error || attempt.error?.message}</p>
          )}
          {attempt.status === 'sending' && (
            <p role="status">Checking review request…</p>
          )}
          {attempt.status === 'uncertain' && (
            <>
              <p>
                Keep this tab open. Retry checks the original request; its
                version and comments stay fixed.
              </p>
              <button
                type="button"
                className="rounded-lg border border-emerald-800 px-4 py-2 font-semibold"
                onClick={() => void send()}
              >
                Retry same request
              </button>
            </>
          )}
          {(attempt.status === 'rejected' ||
            attempt.status === 'confirmed') && (
            <>
              {attempt.status === 'confirmed' && (
                <p role="status">
                  Review change confirmed. Reload to show the current versions.
                </p>
              )}
              <button
                type="button"
                className="rounded-lg border border-emerald-800 px-4 py-2 font-semibold"
                onClick={reload}
              >
                Reload versions
              </button>
            </>
          )}
        </>
      ) : candidates.length === 0 ? (
        <p>
          No accessible versions are currently eligible for your review actions.
        </p>
      ) : (
        <>
          <label className="block font-semibold" htmlFor={`${id}-version`}>
            Version to act on
          </label>
          <select
            id={`${id}-version`}
            value={selected?.versionId ?? ''}
            className="w-full rounded-lg border border-slate-400 p-3"
            onChange={(event) => {
              setSelectedId(event.target.value)
              setComment('')
              setError('')
            }}
          >
            {candidates.map((v) => (
              <option key={v.versionId} value={v.versionId}>
                Version {v.versionNumber} — {v.state}
              </option>
            ))}
          </select>

          <p className="text-sm text-slate-600">
            Loaded edit revision {selected?.revision}. Save any Draft notes
            before submitting the saved version and attachment.
          </p>

          {operation === 'return' && (
            <>
              <label className="block font-semibold" htmlFor={`${id}-comment`}>
                Return comments
              </label>
              <textarea
                id={`${id}-comment`}
                rows={4}
                maxLength={2000}
                value={comment}
                className="w-full rounded-lg border border-slate-400 p-3"
                onChange={(event) => setComment(event.target.value)}
              />
              <p className="text-sm text-slate-600">
                Explain what needs correction. These comments are retained with
                the reviewed revision.
              </p>
            </>
          )}

          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              className="rounded-lg bg-rose-800 px-4 py-2 font-semibold text-white hover:bg-rose-900 disabled:opacity-50"
              disabled={!selected || (operation === 'return' && !comment.trim())}
              onClick={() => void send()}
            >
              {operation === 'submit' ? 'Submit for review' : 'Return with suggestions to Draft'}
            </button>
            {operation === 'return' && (
              <button
                type="button"
                className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
                disabled={!selected}
                onClick={async () => {
                  if (!selected) return
                  setError('')
                  try {
                    const { error: rpcErr } = await getSupabaseClient().rpc(
                      'eacsc_reviewer_pass_version',
                      {
                        p_version_id: selected.versionId,
                        p_expected_revision: selected.revision,
                        p_feedback: comment.trim(),
                      },
                    )
                    if (rpcErr) throw new Error(rpcErr.message)
                    onConfirmed('For Review')
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not pass version.')
                  }
                }}
              >
                Pass to President (Endorse)
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
