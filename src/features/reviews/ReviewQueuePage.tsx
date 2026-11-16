import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import VerificationChecklist from './VerificationChecklist'
import ReviewActions from '../records/ReviewActions'
import ReviewHistory from '../records/ReviewHistory'
import VersionFileDownload from '../records/VersionFileDownload'
import {
  getForReviewQueue,
  getVersionFileMetadata,
  WorkspaceError,
} from '../workspace/workspace.api'
import type {
  ReviewQueueItem,
  VersionFileInfo,
} from '../workspace/workspace.api'

const button =
  'rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'

const manilaDateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
})

function errorMessage(error: unknown) {
  return error instanceof WorkspaceError
    ? error.message
    : 'The review queue could not be loaded. Check your connection and try again.'
}

function InspectionPanel({
  userId,
  item,
  onConfirmed,
  onReload,
}: {
  userId: string
  item: ReviewQueueItem
  onConfirmed: () => void
  onReload: () => void
}) {
  const [fileState, setFileState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; file: VersionFileInfo | null }
  >({ status: 'loading' })

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10_000)

    void getVersionFileMetadata(item.version.versionId, controller.signal)
      .then((file) => {
        if (!disposed) setFileState({ status: 'ready', file })
      })
      .catch((failure) => {
        if (!disposed) {
          setFileState({
            status: 'error',
            message: errorMessage(failure),
          })
        }
      })
      .finally(() => window.clearTimeout(timer))

    return () => {
      disposed = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [item.version.versionId])

  const isReviewer = item.assignedFunctions.includes('reviewer')
  const isApprover = item.assignedFunctions.includes('approver')
  const isStage2 = Boolean(item.version.reviewerPassedAt)
  const canReturn = isStage2 ? isApprover || isReviewer : isReviewer

  return (
    <section aria-label="Review inspection" className="space-y-5">
      <div
        className={`rounded-xl border p-4 text-sm ${
          isStage2
            ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
            : 'border-amber-300 bg-amber-50 text-amber-950'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold">
            {isStage2
              ? 'Stage 2: Passed by Reviewer — Ready for President’s 6-Point Approval'
              : 'Stage 1: Initial Reviewer Inspection (Suggestions / Endorsement)'}
          </span>
          {isStage2 && item.version.reviewerPassedAt && (
            <span className="text-xs font-medium">
              Passed {manilaDateTime.format(new Date(item.version.reviewerPassedAt))}
            </span>
          )}
        </div>
        {isStage2 && item.version.reviewerFeedback && (
          <p className="mt-2 rounded-lg bg-white/80 p-2.5 text-xs text-slate-800">
            <strong>Reviewer Note:</strong> {item.version.reviewerFeedback}
          </p>
        )}
        {!isStage2 && isApprover && !isReviewer && (
          <p className="mt-1 text-xs">
            Awaiting Stage 1 Reviewer endorsement before Executive 6-Point Approval unlocks.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              {item.record.category}
            </p>
            <h2 className="mt-1 text-2xl font-bold">{item.record.title}</h2>
            <p className="mt-1 break-all font-mono text-sm text-slate-600">
              {item.record.recordId}
            </p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-950">
            Version {item.version.versionNumber} — {item.version.state}
          </span>
        </div>

        {item.record.summary && (
          <p className="mt-4 text-sm leading-6 text-slate-700">
            {item.record.summary}
          </p>
        )}

        <dl className="mt-5 grid gap-4 border-t border-slate-200 pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-slate-800">Document type</dt>
            <dd className="mt-1 text-slate-600">{item.record.documentType}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">Originating office</dt>
            <dd className="mt-1 text-slate-600">
              {item.record.originatingOffice}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">Custodian position</dt>
            <dd className="mt-1 text-slate-600">
              {item.record.custodianPosition}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">Classification</dt>
            <dd className="mt-1 text-slate-600">{item.record.accessClass}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">
              Edit revision &amp; updated
            </dt>
            <dd className="mt-1 text-slate-600">
              Revision {item.version.revision} ·{' '}
              {manilaDateTime.format(new Date(item.version.updatedAt))}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">
              Change classification
            </dt>
            <dd className="mt-1 text-slate-600">
              {item.version.correctionClassification ?? 'Not classified'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">
              Your active assignment(s)
            </dt>
            <dd className="mt-1 text-slate-600">
              {item.assignedFunctions.join(', ')}
            </dd>
          </div>
          {item.record.recordDate && (
            <div>
              <dt className="font-semibold text-slate-800">Document date</dt>
              <dd className="mt-1 text-slate-600">{item.record.recordDate}</dd>
            </div>
          )}
        </dl>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Author&apos;s change notes
          </h3>
          <p className="mt-2 whitespace-pre-wrap wrap-break-word text-sm leading-6 text-slate-700">
            {item.version.notes}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-bold">Submitted attachment facts</h3>
        {fileState.status === 'loading' && (
          <p role="status" className="mt-2 text-sm text-slate-600">
            Checking accepted attachment details…
          </p>
        )}
        {fileState.status === 'error' && (
          <p role="alert" className="mt-2 text-sm text-amber-900">
            {fileState.message}
          </p>
        )}
        {fileState.status === 'ready' && !fileState.file && (
          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
            No accepted attachment is linked to this version. Return it for
            correction before any approval.
          </p>
        )}
        {fileState.status === 'ready' && fileState.file && (
          <>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="font-semibold text-slate-800">Filename</dt>
                <dd className="mt-1 wrap-break-word text-slate-600">
                  {fileState.file.originalFilename}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-800">
                  Size &amp; type
                </dt>
                <dd className="mt-1 text-slate-600">
                  {fileState.file.fileSizeBytes.toLocaleString('en-PH')} bytes ·{' '}
                  {fileState.file.mimeType}
                </dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="font-semibold text-slate-800">SHA-256</dt>
                <dd className="mt-1 break-all font-mono text-xs text-slate-600">
                  {fileState.file.sha256}
                </dd>
              </div>
            </dl>
            <VersionFileDownload
              key={`queue-file:${userId}:${item.version.versionId}`}
              userId={userId}
              versionId={item.version.versionId}
              versionNumber={item.version.versionNumber}
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-bold">Predecessor version</h3>
        {!item.version.previousVersionId ? (
          <p className="mt-2 text-sm text-slate-600">
            This is the initial version (no predecessor linked).
          </p>
        ) : !item.predecessor ? (
          <p className="mt-2 text-sm text-slate-600">
            Predecessor details are not visible with your current access.
          </p>
        ) : (
          <div className="mt-3 space-y-2 text-sm">
            <p className="font-semibold text-slate-900">
              Version {item.predecessor.versionNumber} —{' '}
              {item.predecessor.state}
            </p>
            <p className="text-slate-600">
              Updated{' '}
              {manilaDateTime.format(new Date(item.predecessor.updatedAt))}
              {item.predecessor.approvedAt
                ? ` · Approved ${manilaDateTime.format(new Date(item.predecessor.approvedAt))}`
                : ''}
            </p>
            <p className="whitespace-pre-wrap wrap-break-word text-slate-700">
              {item.predecessor.notes}
            </p>
          </div>
        )}
      </div>

      <ReviewActions
        key={`queue-actions:${userId}:${item.record.recordId}:${isStage2 ? 's2' : 's1'}`}
        userId={userId}
        recordId={item.record.recordId}
        versions={[item.version]}
        canSubmit={false}
        canReturn={canReturn}
        reviewerPassed={isStage2}
        onConfirmed={onConfirmed}
        onReload={onReload}
      />
      {isStage2 && (
        <VerificationChecklist
          key={`queue-verify:${userId}:${item.record.recordId}:${item.version.versionId}`}
          userId={userId}
          recordId={item.record.recordId}
          version={item.version}
          assignedFunctions={item.assignedFunctions}
          onConfirmed={onConfirmed}
          onReload={onReload}
        />
      )}
      <ReviewHistory
        key={`queue-history:${userId}:${item.record.recordId}`}
        userId={userId}
        recordId={item.record.recordId}
        versions={[item.version]}
      />
    </section>
  )
}

export default function ReviewQueuePage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [items, setItems] = useState<ReviewQueueItem[] | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  )
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => {
    setItems(null)
    setError('')
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!userId) return
    let disposed = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10_000)

    void getForReviewQueue(userId, controller.signal)
      .then((data) => {
        if (!disposed) setItems(data)
      })
      .catch((failure) => {
        if (!disposed) setError(errorMessage(failure))
      })
      .finally(() => window.clearTimeout(timer))

    return () => {
      disposed = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [userId, attempt])

  useEffect(() => {
    function onFocus() {
      setAttempt((n) => n + 1)
    }
    window.addEventListener('focus', onFocus)

    const client = getSupabaseClient()
    const channel = client
      .channel('review-queue-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'record_versions' },
        () => setAttempt((n) => n + 1),
      )
      .subscribe()

    return () => {
      window.removeEventListener('focus', onFocus)
      void client.removeChannel(channel)
    }
  }, [])

  const selected =
    items?.find((item) => item.version.versionId === selectedVersionId) ??
    items?.[0] ??
    null

  return (
    <section aria-labelledby="review-queue-heading" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-800">
            Officer review workflow
          </p>
          <h1 id="review-queue-heading" className="mt-2 text-3xl font-bold">
            For Review queue
          </h1>
          <p className="mt-3 text-slate-700">
            Inspect submitted versions across your active non-author
            assignments, complete the six-point verification checklist, and
            record substantive approval or return for correction.
          </p>
        </div>
        <Link to="/officer" className={button}>
          Back to workspace
        </Link>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-4 text-emerald-950"
        >
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button} onClick={reload}>
          Reload review queue
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-5"
        >
          {error}
        </p>
      ) : !items ? (
        <p role="status">Loading versions awaiting review…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold">No versions awaiting review</h2>
          <p className="mt-2 text-sm text-slate-600">
            No assigned records currently have a version in the{' '}
            <strong>For Review</strong> state within your review scope.
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <nav aria-label="Versions awaiting review">
            <ul className="list-none space-y-3 p-0">
              {items.map((item) => {
                const isSelected =
                  selected?.version.versionId === item.version.versionId
                return (
                  <li key={item.version.versionId}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedVersionId(item.version.versionId)
                      }
                      aria-current={isSelected ? 'true' : undefined}
                      className={`w-full rounded-xl border p-4 text-left ${
                        isSelected
                          ? 'border-emerald-700 bg-emerald-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <span className="block font-semibold">
                        {item.record.title}
                      </span>
                      <span className="mt-1 block break-all font-mono text-xs text-slate-600">
                        {item.record.recordId} · v{item.version.versionNumber}
                      </span>
                      <span className="mt-2 block text-xs font-semibold text-amber-900">
                        {item.version.state} · {item.record.accessClass}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          {selected && (
            <InspectionPanel
              key={`${userId}:${selected.version.versionId}:${selected.version.revision}`}
              userId={userId}
              item={selected}
              onConfirmed={() => {
                setNotice(
                  'Review action confirmed. The queue has been updated.',
                )
                reload()
              }}
              onReload={reload}
            />
          )}
        </div>
      )}
    </section>
  )
}
