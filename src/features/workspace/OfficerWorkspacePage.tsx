import ConflictModal from '../../components/ui/ConflictModal'
import HistoryPanel from '../history/HistoryPanel'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import ReviewHistory from '../records/ReviewHistory'
import VersionFileDownload from '../records/VersionFileDownload'
import UploadVersionForm from '../records/UploadVersionForm'
import ReviewActions from '../records/ReviewActions'
import {
  getAssignedRecords,
  getAssignedVersions,
  WorkspaceError,
} from './workspace.api'
import type { AssignedVersion, DraftReceipt } from './workspace.api'
import {
  createDraftAttempt,
  findDraftAttempt,
  forgetDraftAttempt,
  sendDraftAttempt,
} from './workspace.commands'
import type { DraftAttempt } from './workspace.commands'

const button =
  'rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'
type RecordPage = Awaited<ReturnType<typeof getAssignedRecords>>
type RecordDetails = Awaited<ReturnType<typeof getAssignedVersions>>
function message(error: unknown) {
  return error instanceof WorkspaceError
    ? error.message
    : 'The workspace could not be loaded. Check your connection and try again.'
}

function DraftNotesEditor({
  userId,
  version,
  canEdit,
  onSaved,
  onReload,
}: {
  userId: string
  version: AssignedVersion
  canEdit: boolean
  onSaved: (receipt: DraftReceipt) => void
  onReload: () => void
}) {
  const initial = findDraftAttempt(userId, version.versionId)
  const [notes, setNotes] = useState(initial?.request.notes ?? version.notes)
  const [attempt, setAttempt] = useState<DraftAttempt | undefined>(initial)
  const [busy, setBusy] = useState(initial?.status === 'sending')
  const [error, setError] = useState(initial?.error?.message ?? '')
  const [conflictOpen, setConflictOpen] = useState(false)
  const mounted = useRef(false)
  const submitting = useRef(false)
  const fieldId = useId()
  const locked =
    attempt?.status === 'sending' ||
    attempt?.status === 'uncertain' ||
    attempt?.status === 'confirmed'
  const unresolved =
    attempt?.status === 'sending' || attempt?.status === 'uncertain'
  const denied =
    attempt?.error?.kind === 'denied' || attempt?.error?.kind === 'conflict'
  const dirty = notes !== version.notes

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!dirty && !unresolved) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, unresolved])

  // If profile revalidation temporarily remounted this editor, observe the same
  // in-flight command. Never start a new write from an Effect.
  useEffect(() => {
    if (!initial?.promise) return
    let disposed = false
    void initial.promise
      .then(() => {
        if (!disposed) setBusy(false)
      })
      .catch((failure: unknown) => {
        if (!disposed) {
          setBusy(false)
          setError(message(failure))
        }
      })
    return () => {
      disposed = true
    }
  }, [initial])

  async function save(existing?: DraftAttempt) {
    if (submitting.current || busy) return
    submitting.current = true
    setBusy(true)
    setError('')
    const current =
      existing ??
      createDraftAttempt({
        actorId: userId,
        recordId: version.recordId,
        versionId: version.versionId,
        expectedRevision: version.revision,
        notes: notes.trim(),
        requestId: crypto.randomUUID(),
      })
    setAttempt(current)
    try {
      const receipt = await sendDraftAttempt(current)
      if (mounted.current) {
        forgetDraftAttempt(current)
        onSaved(receipt)
      }
    } catch (failure) {
      if (mounted.current) {
        setError(message(failure))
        if (failure instanceof WorkspaceError && failure.kind === 'conflict') {
          setConflictOpen(true)
        }
      }
    }
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit || version.state !== 'Draft' || locked || denied) return
    void save()
  }
  if (attempt?.status === 'confirmed' && attempt.receipt)
    return (
      <div
        className="mt-4 space-y-3 rounded-lg bg-emerald-50 p-4"
        role="status"
      >
        <p>
          The earlier save was confirmed. Reload to see the latest stored
          version.
        </p>
        <button
          type="button"
          className={button}
          onClick={() => {
            forgetDraftAttempt(attempt)
            onSaved(attempt.receipt!)
          }}
        >
          Reload confirmed save
        </button>
      </div>
    )
  if ((!canEdit || version.state !== 'Draft') && !unresolved) return null
  return (
    <form
      onSubmit={submit}
      className="mt-5 space-y-3 border-t border-slate-200 pt-5"
    >
      <label htmlFor={fieldId} className="block font-semibold">
        Draft version notes
      </label>
      <p id={`${fieldId}-help`} className="text-sm text-slate-600">
        Describe this version or its changes. Saving notes does not approve or
        publish the record.
      </p>
      <textarea
        id={fieldId}
        aria-describedby={`${fieldId}-help ${fieldId}-count`}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={2000}
        rows={4}
        disabled={
          busy || locked || denied || !canEdit || version.state !== 'Draft'
        }
        className="w-full rounded-lg border border-slate-400 bg-white p-3 disabled:bg-slate-100"
      />
      <p id={`${fieldId}-count`} className="text-sm text-slate-600">
        {notes.length}/2,000 · Loaded edit revision {version.revision}
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {attempt?.status === 'uncertain' ? (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void save(attempt)}
          >
            Retry same save
          </button>
        ) : (
          <button
            type="submit"
            className={button}
            disabled={
              busy ||
              locked ||
              denied ||
              !canEdit ||
              !notes.trim() ||
              notes.trim() === version.notes ||
              notes.length > 2000
            }
          >
            {busy ? 'Saving…' : 'Save Draft notes'}
          </button>
        )}
        {!unresolved && !busy && (
          <button type="button" className={button} onClick={onReload}>
            Reload latest version
          </button>
        )}
      </div>
      {unresolved && (
        <p role="status" className="text-sm text-slate-700">
          {busy
            ? 'Waiting for save confirmation…'
            : 'Keep this page open. Retrying uses the original notes and request so the same edit is not applied twice.'}
        </p>
      )}
      <ConflictModal
        open={conflictOpen}
        localText={notes}
        storedText={version.notes}
        storedRevision={version.revision}
        onReload={() => {
          setConflictOpen(false)
          onReload()
        }}
        onClose={() => setConflictOpen(false)}
      />
    </form>
  )
}

function SelectedRecord({
  userId,
  recordId,
}: {
  userId: string
  recordId: string
}) {
  const [details, setDetails] = useState<RecordDetails | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState('')
  const refresh = useCallback(() => {
    setDetails(null)
    setError('')
    setAttempt((n) => n + 1)
  }, [])
  const saved = useCallback(
    (receipt: DraftReceipt) => {
      setNotice(`Save confirmed at edit revision ${receipt.revision}.`)
      refresh()
    },
    [refresh],
  )
  const reviewed = useCallback(
    (state: 'Draft' | 'For Review') => {
      setNotice(
        state === 'For Review'
          ? 'Submission confirmed. Author-only access hides versions while they are For Review.'
          : 'Return confirmed. The version is back in Draft and the review comments are retained.',
      )
      refresh()
    },
    [refresh],
  )
  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10_000)
    void getAssignedVersions(userId, recordId, controller.signal)
      .then((data) => {
        if (!disposed) setDetails(data)
      })
      .catch((failure) => {
        if (!disposed) setError(message(failure))
      })
      .finally(() => window.clearTimeout(timer))
    return () => {
      disposed = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [userId, recordId, attempt])
  return (
    <section aria-label="Selected record" className="space-y-5">
      {notice && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-4 text-emerald-950"
        >
          {notice}
        </p>
      )}
      {error ? (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5"
        >
          <p>{error}</p>
          <button type="button" className={button} onClick={refresh}>
            Reload selected record
          </button>
        </div>
      ) : !details ? (
        <p role="status">Loading authorized versions…</p>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-2xl font-bold">{details.record.title}</h2>
            <p className="mt-2 break-all font-mono text-sm">
              {details.record.recordId}
            </p>
            <p className="mt-3 text-sm">
              Classification: <strong>{details.record.accessClass}</strong> ·
              Custodian: {details.record.custodianPosition}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {details.record.category}
            </p>
          </div>
          <UploadVersionForm
            key={`upload:${userId}:${recordId}`}
            userId={userId}
            recordId={recordId}
            recordRevision={details.record.revision}
            canUpload={details.canEditDraft}
            onReload={refresh}
          />
          <ReviewActions
            key={`actions:${userId}:${recordId}`}
            userId={userId}
            recordId={recordId}
            versions={details.versions}
            canSubmit={details.canSubmitForReview}
            canReturn={details.canReturnForCorrection}
            onConfirmed={reviewed}
            onReload={refresh}
          />
          <ReviewHistory
            key={`reviews:${userId}:${recordId}`}
            userId={userId}
            recordId={recordId}
            versions={details.versions}
          />
          <HistoryPanel
            key={`audit:${userId}:${recordId}`}
            recordId={recordId}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl font-bold">Versions you can access</h3>
            <button type="button" className={button} onClick={refresh}>
              Reload versions
            </button>
          </div>
          <p className="text-sm text-slate-600">
            These are the versions your current assignment permits. A newer
            version may exist outside your access. Public classification and
            approval do not establish publication.
          </p>
          {details.truncated && (
            <p role="status">
              Showing the first 100 accessible versions, newest first.
              Additional versions are not shown in this view.
            </p>
          )}
          {details.versions.length === 0 ? (
            <p className="rounded-xl bg-white p-5">
              No versions are currently accessible for this record.
            </p>
          ) : (
            <ul className="list-none space-y-5 p-0">
              {details.versions.map((version) => (
                <li
                  key={version.versionId}
                  className="min-w-0 rounded-xl border border-slate-200 bg-white p-5"
                >
                  <h4 className="text-lg font-bold">
                    Version {version.versionNumber} — {version.state}
                  </h4>
                  <p className="mt-2 text-sm text-slate-600">
                    Edit revision {version.revision} · Updated{' '}
                    {new Intl.DateTimeFormat('en-PH', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Manila',
                    }).format(new Date(version.updatedAt))}
                  </p>
                  <p className="mt-4 whitespace-pre-wrap wrap-break-word">
                    {version.notes}
                  </p>
                  <VersionFileDownload
                    key={`file:${userId}:${version.versionId}`}
                    userId={userId}
                    versionId={version.versionId}
                    versionNumber={version.versionNumber}
                  />
                  <DraftNotesEditor
                    key={`${version.versionId}:${version.revision}`}
                    userId={userId}
                    version={version}
                    canEdit={details.canEditDraft}
                    onSaved={saved}
                    onReload={refresh}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

export default function OfficerWorkspacePage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<{
    page: number
    data: RecordPage
  } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (!userId) return
    let disposed = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10_000)
    void getAssignedRecords(userId, page, controller.signal)
      .then((data) => {
        if (!disposed) setResult({ page, data })
      })
      .catch((failure) => {
        if (!disposed) setError(message(failure))
      })
      .finally(() => window.clearTimeout(timer))
    return () => {
      disposed = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [userId, page, attempt])
  function reload(nextPage = page) {
    setResult(null)
    setSelected(null)
    setError('')
    setPage(nextPage)
    setAttempt((n) => n + 1)
  }
  const data = result?.page === page ? result.data : null
  const recordId =
    data?.records.find((r) => r.recordId === selected)?.recordId ??
    data?.records[0]?.recordId
  return (
    <section aria-labelledby="workspace-heading" className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-emerald-800">
          Assigned records
        </p>
        <h1 id="workspace-heading" className="mt-2 text-3xl font-bold">
          Officer workspace
        </h1>
        <p className="mt-3 text-slate-700">
          View records available to your current account and record assignments.
          Authorized Authors and Custodians can update Draft version notes.
          Download attachments available to your current account.
        </p>
      </div>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Development database: the retained test records are fictional. Public
        library pages still use prototype data. Approvals, publication and
        turnover acknowledgment are coming in later steps.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button} onClick={() => reload()}>
          Reload record list
        </button>
        <span className="text-sm text-slate-600">Page {page + 1}</span>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-5"
        >
          {error}
        </p>
      ) : !data ? (
        <p role="status">Loading assigned records…</p>
      ) : (
        <>
          {data.records.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-5">
              No accessible assigned records were returned. An active account
              alone does not grant record access.
            </p>
          ) : (
            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <nav aria-label="Assigned record selection">
                <ul className="list-none space-y-3 p-0">
                  {data.records.map((record) => (
                    <li key={record.recordId}>
                      <button
                        type="button"
                        onClick={() => setSelected(record.recordId)}
                        aria-current={
                          recordId === record.recordId ? 'true' : undefined
                        }
                        className={`w-full rounded-xl border p-4 text-left ${recordId === record.recordId ? 'border-emerald-700 bg-emerald-50' : 'border-slate-200 bg-white'}`}
                      >
                        <span className="block font-semibold">
                          {record.title}
                        </span>
                        <span className="mt-2 block break-all font-mono text-xs">
                          {record.recordId}
                        </span>
                        <span className="mt-2 block text-sm text-slate-600">
                          {record.accessClass}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              {recordId && (
                <SelectedRecord
                  key={`${userId}:${recordId}`}
                  userId={userId}
                  recordId={recordId}
                />
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={button}
              disabled={page === 0}
              onClick={() => reload(page - 1)}
            >
              Previous page
            </button>
            <button
              type="button"
              className={button}
              disabled={!data.hasNext}
              onClick={() => reload(page + 1)}
            >
              Next page
            </button>
          </div>
        </>
      )}
    </section>
  )
}
