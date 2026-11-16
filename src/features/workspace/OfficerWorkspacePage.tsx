import ConflictModal from '../../components/ui/ConflictModal'
import HelpLink from '../../components/ui/HelpLink'
import HistoryPanel from '../history/HistoryPanel'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, SubmitEvent } from 'react'
import { getSupabaseClient } from '../../lib/supabase'
import { getOfficerProfile } from '../auth/auth.api'
import type { OfficerProfile } from '../auth/auth.api'
import { RoleActionBanner } from '../auth/RoleActionBanner'
import { useAuth } from '../auth/useAuth'
import { RECORD_CATEGORIES } from '../records/records.types'
import ReviewHistory from '../records/ReviewHistory'
import VersionFileDownload from '../records/VersionFileDownload'
import UploadVersionForm from '../records/UploadVersionForm'
import ReviewActions from '../records/ReviewActions'
import {
  assignDocumentFolder,
  createDocumentFolder,
  createWorkspaceDocument,
  executiveSelfApprove,
  getAssignedRecords,
  getAssignedVersions,
  listDocumentFolders,
  WorkspaceError,
} from './workspace.api'
import type {
  AssignedVersion,
  DocumentFolder,
  DraftReceipt,
} from './workspace.api'
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
  folders,
  profile,
  onFolderChanged,
}: {
  userId: string
  recordId: string
  folders: DocumentFolder[]
  profile: OfficerProfile | null
  onFolderChanged: () => void
}) {
  const [details, setDetails] = useState<RecordDetails | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState('')
  const [movingFolder, setMovingFolder] = useState(false)
  const [fastRationale, setFastRationale] = useState('')
  const [fastApproving, setFastApproving] = useState(false)
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
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                      details.record.accessClass === 'public'
                        ? 'bg-emerald-100 text-emerald-800'
                        : details.record.accessClass === 'restricted'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {details.record.accessClass}
                  </span>
                  {details.record.accessClass === 'restricted' && (
                    <span className="text-xs text-red-700 font-medium">
                      🔒 Visible to assigned officers and Council President
                    </span>
                  )}
                </div>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">
                  {details.record.title}
                </h2>
                <p className="mt-1 break-all font-mono text-sm text-slate-600">
                  {details.record.recordId}
                </p>
                <p className="mt-2 text-sm text-slate-700">
                  Custodian: {details.record.custodianPosition} · Office: {details.record.originatingOffice}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {details.record.category}
                </p>
              </div>

              <div className="min-w-[200px]">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Document Folder
                </label>
                <select
                  disabled={movingFolder}
                  value={details.record.folderId ?? ''}
                  onChange={async (e) => {
                    const nextFolder = e.target.value || null
                    setMovingFolder(true)
                    try {
                      await assignDocumentFolder(details.record.recordId, nextFolder)
                      setNotice('Document folder updated.')
                      refresh()
                      onFolderChanged()
                    } catch (err) {
                      setError(message(err))
                    } finally {
                      setMovingFolder(false)
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800"
                >
                  <option value="">Unfiled (No Folder)</option>
                  {folders.map((f) => (
                    <option key={f.folderId} value={f.folderId}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {profile &&
            (profile.functional_roles.includes('approver') ||
              profile.functional_roles.includes('custodian')) &&
            details.versions.some(
              (v) => v.state === 'Draft' || v.state === 'For Review',
            ) && (
              <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-amber-950">
                      Executive Fast-Track Self-Approval
                    </h3>
                    <p className="text-xs text-amber-800">
                      Available to Council President & Executive Secretary for urgent bulletins or resolutions. Recorded in the audit trail.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Urgent executive rationale (e.g., Immediate storm advisory)…"
                    value={fastRationale}
                    onChange={(e) => setFastRationale(e.target.value)}
                    className="flex-1 min-w-[220px] rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    disabled={fastApproving || !fastRationale.trim()}
                    onClick={async () => {
                      const targetVer = details.versions.find(
                        (v) => v.state === 'Draft' || v.state === 'For Review',
                      )
                      if (!targetVer) return
                      setFastApproving(true)
                      try {
                        await executiveSelfApprove({
                          versionId: targetVer.versionId,
                          expectedRevision: targetVer.revision,
                          rationale: fastRationale.trim(),
                        })
                        setFastRationale('')
                        setNotice(
                          `Executive fast-track approval recorded for Version ${targetVer.versionNumber}. It is now ready in the Release Panel.`,
                        )
                        refresh()
                      } catch (err) {
                        setError(message(err))
                      } finally {
                        setFastApproving(false)
                      }
                    }}
                    className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                  >
                    {fastApproving
                      ? 'Approving…'
                      : 'Fast-Track Approve Latest Draft'}
                  </button>
                </div>
              </div>
            )}
          {/* Initial Draft guidance for new documents without versions */}
          {details.versions.length === 0 && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50/80 p-5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                  1
                </span>
                <h3 className="text-sm font-bold text-emerald-950">
                  Step 2: Upload Initial Draft (v1)
                </h3>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed">
                This document record has been created. To begin the review workflow, upload your initial draft file (PDF, DOCX, or PNG/JPEG up to 10 MB) below.
              </p>
            </div>
          )}
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
  const [folders, setFolders] = useState<DocumentFolder[]>([])
  const [profile, setProfile] = useState<OfficerProfile | null>(null)
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  // Modal states
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderDesc, setFolderDesc] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)

  const [newDocOpen, setNewDocOpen] = useState(false)
  const [docTitle, setDocTitle] = useState('')
  const [docCategory, setDocCategory] = useState<string>(RECORD_CATEGORIES[0])
  const [docType, setDocType] = useState('Resolution')
  const [docAccess, setDocAccess] = useState<'public' | 'internal' | 'restricted'>('public')
  const [docFolderId, setDocFolderId] = useState<string>('')
  const [docSummary, setDocSummary] = useState('')
  const [savingDoc, setSavingDoc] = useState(false)

  useEffect(() => {
    if (!userId) return
    let disposed = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10_000)

    void Promise.all([
      getAssignedRecords(userId, page, controller.signal),
      listDocumentFolders(),
      getOfficerProfile(userId, controller.signal),
    ])
      .then(([data, loadedFolders, loadedProfile]) => {
        if (!disposed) {
          setResult({ page, data })
          setFolders(loadedFolders)
          setProfile(loadedProfile)
        }
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

  function reload(nextPage = page, selectId?: string) {
    setResult(null)
    setSelected(selectId ?? null)
    setError('')
    setPage(nextPage)
    setAttempt((n) => n + 1)
  }

  // Realtime & Window Focus listener for automatic cross-device synchronization
  useEffect(() => {
    function onFocus() {
      setAttempt((n) => n + 1)
    }
    window.addEventListener('focus', onFocus)

    const client = getSupabaseClient()
    const channel = client
      .channel('workspace-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'master_records' },
        () => setAttempt((n) => n + 1),
      )
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

  async function handleCreateFolder(e: FormEvent) {
    e.preventDefault()
    if (!folderName.trim() || savingFolder) return
    setSavingFolder(true)
    try {
      await createDocumentFolder(folderName.trim(), folderDesc.trim())
      setFolderName('')
      setFolderDesc('')
      setNewFolderOpen(false)
      reload()
    } catch (err) {
      setError(message(err))
    } finally {
      setSavingFolder(false)
    }
  }

  async function handleCreateDocument(e: FormEvent) {
    e.preventDefault()
    if (!docTitle.trim() || savingDoc) return
    setSavingDoc(true)
    try {
      const created = await createWorkspaceDocument({
        title: docTitle.trim(),
        category: docCategory,
        documentType: docType.trim() || 'Official Document',
        accessClass: docAccess,
        summary: docSummary.trim(),
        folderId: docFolderId || null,
      })
      setDocTitle('')
      setDocSummary('')
      setNewDocOpen(false)
      reload(0, created.record_id)
    } catch (err) {
      setError(message(err))
    } finally {
      setSavingDoc(false)
    }
  }

  const data = result?.page === page ? result.data : null
  const visibleRecords = (data?.records ?? []).filter((r) => {
    if (folderFilter === 'all') return true
    if (folderFilter === 'unfiled') return !r.folderId
    return r.folderId === folderFilter
  })
  const recordId =
    visibleRecords.find((r) => r.recordId === selected)?.recordId ??
    visibleRecords[0]?.recordId

  return (
    <section aria-labelledby="workspace-heading" className="space-y-6">
      <RoleActionBanner />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-rose-800">
            Document Management
          </p>
          <div className="mt-1 flex items-center gap-3">
            <h1 id="workspace-heading" className="text-3xl font-bold text-slate-900">
              Document Workspace
            </h1>
            <HelpLink
              section="workspace"
              label="Open Document Workspace guide in Help"
            />
          </div>
          <p className="mt-2 text-sm text-slate-600 max-w-2xl">
            Organize council documents into folders, create new resolutions or
            guidelines, upload new draft versions, and submit drafts for review.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setNewFolderOpen(true)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            + New Folder
          </button>
          <button
            type="button"
            onClick={() => setNewDocOpen(true)}
            className="rounded-lg bg-rose-800 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-900 shadow-sm"
          >
            + Create Document
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => reload()}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Folder Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <button
          type="button"
          onClick={() => setFolderFilter('all')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            folderFilter === 'all'
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          All Documents ({data?.records.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setFolderFilter('unfiled')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            folderFilter === 'unfiled'
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Unfiled ({(data?.records ?? []).filter((r) => !r.folderId).length})
        </button>
        {folders.map((f) => {
          const count = (data?.records ?? []).filter(
            (r) => r.folderId === f.folderId,
          ).length
          return (
            <button
              key={f.folderId}
              type="button"
              onClick={() => setFolderFilter(f.folderId)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                folderFilter === f.folderId
                  ? 'bg-rose-800 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {f.name} ({count})
            </button>
          )
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950"
        >
          {error}
        </p>
      ) : !data ? (
        <p role="status" className="text-sm text-slate-600">
          Loading council documents…
        </p>
      ) : (
        <>
          {visibleRecords.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-2">
              <p className="font-bold text-slate-900">
                No documents in this folder view
              </p>
              <p className="text-sm text-slate-600">
                Select “All Documents” or click “+ Create Document” to start a new council document.
              </p>
            </div>
          ) : (
            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <nav aria-label="Assigned document selection">
                <ul className="list-none space-y-2.5 p-0">
                  {visibleRecords.map((record) => {
                    const folderName = folders.find(
                      (f) => f.folderId === record.folderId,
                    )?.name
                    return (
                      <li key={record.recordId}>
                        <button
                          type="button"
                          onClick={() => setSelected(record.recordId)}
                          aria-current={
                            recordId === record.recordId ? 'true' : undefined
                          }
                          className={`w-full rounded-xl border p-4 text-left transition ${
                            recordId === record.recordId
                              ? 'border-rose-700 bg-rose-50/70 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-bold text-slate-500">
                              {record.recordId}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                record.accessClass === 'public'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : record.accessClass === 'restricted'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {record.accessClass}
                            </span>
                          </div>
                          <span className="mt-1.5 block font-bold text-slate-900">
                            {record.title}
                          </span>
                          {folderName && (
                            <span className="mt-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              {folderName}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </nav>
              {recordId && (
                <SelectedRecord
                  key={`${userId}:${recordId}`}
                  userId={userId}
                  recordId={recordId}
                  folders={folders}
                  profile={profile}
                  onFolderChanged={() => reload(page, recordId)}
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

      {/* + New Folder Modal */}
      {newFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-slate-900">
              Create Document Folder
            </h2>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800">
                  Folder Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., AY 2026-2027 Events"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800">
                  Description (optional)
                </label>
                <textarea
                  rows={2}
                  value={folderDesc}
                  onChange={(e) => setFolderDesc(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewFolderOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFolder}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingFolder ? 'Creating…' : 'Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* + Create Document Modal */}
      {newDocOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-slate-900">
              Create New Council Document
            </h2>
            <p className="text-xs text-slate-600">
              You will be automatically assigned as Author & Custodian so you can immediately upload drafts and submit for review.
            </p>
            <form onSubmit={handleCreateDocument} className="space-y-3.5">
              <div>
                <label className="block text-sm font-semibold text-slate-800">
                  Document Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Engineering Week 2026 Guidelines"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-800">
                    Category
                  </label>
                  <select
                    value={docCategory}
                    onChange={(e) => setDocCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {RECORD_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800">
                    Document Type
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Resolution / Memo / Charter"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-800">
                    Classification
                  </label>
                  <select
                    value={docAccess}
                    onChange={(e) =>
                      setDocAccess(
                        e.target.value as 'public' | 'internal' | 'restricted',
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="public">Public (Student Visible)</option>
                    <option value="internal">Internal (Officers Only)</option>
                    <option value="restricted">Restricted (Executive/Audit)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800">
                    Folder
                  </label>
                  <select
                    value={docFolderId}
                    onChange={(e) => setDocFolderId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Unfiled</option>
                    {folders.map((f) => (
                      <option key={f.folderId} value={f.folderId}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800">
                  Summary / Purpose
                </label>
                <textarea
                  rows={2}
                  value={docSummary}
                  onChange={(e) => setDocSummary(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewDocOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDoc}
                  className="rounded-lg bg-rose-800 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-900 disabled:opacity-50"
                >
                  {savingDoc ? 'Creating…' : 'Create Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
