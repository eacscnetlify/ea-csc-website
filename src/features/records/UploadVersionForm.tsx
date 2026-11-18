import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { SubmitEvent } from 'react'
import FileDropzone from '../../components/ui/FileDropzone'
import { setVersionExternalUrl } from '../workspace/workspace.api'
import { inspectSelectedFile, UploadError } from './upload.api'
import type { Classification, SelectedFile } from './upload.api'
import {
  createUploadAttempt,
  findUploadAttempt,
  forgetUploadAttempt,
  pauseUpload,
  sendUploadAttempt,
  subscribeUploads,
  uploadSnapshot,
} from './upload.commands'

const button =
  'rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'
export default function UploadVersionForm({
  userId,
  recordId,
  recordRevision,
  canUpload,
  onReload,
}: {
  userId: string
  recordId: string
  recordRevision: number
  canUpload: boolean
  onReload: () => void
}) {
  useSyncExternalStore(subscribeUploads, uploadSnapshot, () => 0)
  const attempt = findUploadAttempt(userId, recordId)
  const [mode, setMode] = useState<'file' | 'drive'>('file')
  const [driveUrl, setDriveUrl] = useState('')
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [notes, setNotes] = useState('')
  const [classification, setClassification] =
    useState<Classification>('legitimate_change')
  const [hashing, setHashing] = useState(false)
  const [error, setError] = useState('')
  const selection = useRef(0)
  const id = useId()
  const busy = attempt?.status === 'sending'
  const pending =
    attempt?.status === 'sending' || attempt?.status === 'uncertain'
  const file = attempt?.request ?? selected

  useEffect(
    () => () => {
      selection.current++
    },
    [],
  )
  useEffect(() => {
    if (!pending && !selected) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending, selected])

  async function select(files: File[]) {
    if (attempt || !canUpload) return
    const current = ++selection.current
    setSelected(null)
    setError('')
    if (files.length !== 1) {
      setError('Choose exactly one file.')
      return
    }
    setHashing(true)
    try {
      const value = await inspectSelectedFile(files[0])
      if (selection.current === current) setSelected(value)
    } catch (failure) {
      if (selection.current === current)
        setError(
          failure instanceof UploadError
            ? failure.message
            : 'The file could not be read. Select it again.',
        )
    } finally {
      if (selection.current === current) setHashing(false)
    }
  }
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (hashing || attempt || !canUpload) return
    setError('')
    try {
      let fileToUpload = selected
      let validatedDriveUrl: string | null = null

      if (mode === 'drive') {
        const cleanUrl = driveUrl.trim()
        if (!/^https:\/\/(drive\.google\.com|docs\.google\.com)\//i.test(cleanUrl)) {
          setError('Please enter a valid Google Drive or Google Docs HTTPS link (https://drive.google.com/... or https://docs.google.com/...).')
          return
        }
        validatedDriveUrl = cleanUrl
        setHashing(true)
        const { jsPDF } = await import('jspdf')
        const doc = new jsPDF({ unit: 'pt', format: 'a4' })
        doc.setFontSize(14)
        doc.text('EA-CSC External Attachment Reference Sheet', 48, 72)
        doc.setFontSize(11)
        doc.text(`Record ID: ${recordId}`, 48, 102)
        doc.text('Attached Google Drive / Docs Link:', 48, 130)
        const urlLines = doc.splitTextToSize(cleanUrl, 490) as string[]
        doc.text(urlLines, 48, 148)
        doc.text('Version Notes:', 48, 148 + urlLines.length * 16 + 14)
        const noteLines = doc.splitTextToSize(notes.trim(), 490) as string[]
        doc.text(noteLines, 48, 148 + urlLines.length * 16 + 32)
        const blob = doc.output('blob')
        const refFile = new File([blob], `${recordId}-drive-link-ref.pdf`, {
          type: 'application/pdf',
        })
        fileToUpload = await inspectSelectedFile(refFile)
        setHashing(false)
      }

      if (!fileToUpload) return

      const current = createUploadAttempt({
        ...fileToUpload,
        actorId: userId,
        recordId,
        expectedRevision: recordRevision,
        notes,
        classification,
        prepareId: crypto.randomUUID(),
        acceptId: crypto.randomUUID(),
      })
      await sendUploadAttempt(current)
      if (validatedDriveUrl && current.receipt?.versionId) {
        await setVersionExternalUrl(current.receipt.versionId, validatedDriveUrl)
        setDriveUrl('')
      }
    } catch (failure) {
      setHashing(false)
      setError(
        failure instanceof UploadError
          ? failure.message
          : failure instanceof Error
            ? failure.message
            : 'Check the file and notes before uploading.',
      )
    }
  }
  if (!canUpload && !attempt) return null
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-xl border border-emerald-200 bg-white p-5"
    >
      <h3 id={`${id}-heading`} className="text-xl font-bold">
        Upload a new Draft version
      </h3>
      <p className="mt-2 text-sm text-slate-700">
        The server verifies the attachment before saving a new Draft. Approval
        and publication are separate steps.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        {!attempt && (
          <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
            <button
              type="button"
              onClick={() => {
                setMode('file')
                setError('')
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === 'file'
                  ? 'bg-emerald-900 text-white'
                  : 'text-slate-700 hover:bg-white'
              }`}
            >
              Upload File (≤ 10 MB)
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('drive')
                setSelected(null)
                setError('')
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === 'drive'
                  ? 'bg-emerald-900 text-white'
                  : 'text-slate-700 hover:bg-white'
              }`}
            >
              Attach Google Drive Link (Large Files)
            </button>
          </div>
        )}
        {!attempt && mode === 'file' && (
          <FileDropzone
            disabled={!canUpload || hashing}
            onSelect={(files) => void select(files)}
          />
        )}
        {!attempt && mode === 'drive' && (
          <div>
            <label htmlFor={`${id}-drive`} className="block font-semibold">
              Google Drive / Docs Link
            </label>
            <input
              id={`${id}-drive`}
              type="url"
              required
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/..."
              className="mt-2 w-full rounded-lg border border-slate-400 p-3 text-sm"
            />
            <p className="mt-1 text-xs text-slate-600">
              For files larger than 10 MB, paste a shared Google Drive or Google Docs link. A verified reference PDF will be attached automatically.
            </p>
          </div>
        )}
        {hashing && (
          <p role="status">Reading the file and calculating its checksum…</p>
        )}
        {file && (
          <div className="min-w-0 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="wrap-break-word font-semibold">{file.file.name}</p>
            <p>{file.file.size.toLocaleString('en-PH')} bytes</p>
            <p className="mt-2 font-semibold">SHA-256</p>
            <p className="break-all font-mono text-xs">{file.sha256}</p>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-notes`} className="block font-semibold">
            Version notes
          </label>
          <textarea
            id={`${id}-notes`}
            rows={3}
            maxLength={2000}
            required
            value={attempt?.request.notes ?? notes}
            disabled={!!attempt || !canUpload}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-400 p-3 disabled:bg-slate-100"
          />
        </div>
        <div>
          <label
            htmlFor={`${id}-classification`}
            className="block font-semibold"
          >
            Change classification
          </label>
          <select
            id={`${id}-classification`}
            value={attempt?.request.classification ?? classification}
            disabled={!!attempt || !canUpload}
            onChange={(event) =>
              setClassification(event.target.value as Classification)
            }
            className="mt-2 w-full rounded-lg border border-slate-400 p-3 disabled:bg-slate-100"
          >
            <option value="legitimate_change">
              Legitimate change — new or updated content
            </option>
            <option value="preventable_correction">
              Preventable correction — fix an earlier error
            </option>
            <option value="initial_capture">
              Initial capture — first version of this record only
            </option>
          </select>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">
            {error}
          </p>
        )}
        {attempt?.error && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">
            {attempt.error.message}
          </p>
        )}
        {!attempt && (
          <button
            type="submit"
            className={button}
            disabled={
              !canUpload ||
              hashing ||
              !notes.trim() ||
              (mode === 'file' ? !selected : !driveUrl.trim())
            }
          >
            {mode === 'drive'
              ? 'Attach Google Drive Link as Draft'
              : 'Upload as new Draft'}
          </button>
        )}
        {busy && (
          <div className="space-y-3" role="status">
            <p>{attempt.phase}…</p>
            <progress aria-label={attempt.phase} className="w-full" />
            <button
              type="button"
              className={button}
              onClick={() => pauseUpload(attempt)}
            >
              Stop waiting
            </button>
          </div>
        )}
        {attempt?.status === 'uncertain' && (
          <div className="space-y-3">
            <p role="status">
              The upload result is unresolved. Keep this tab open. Retrying uses
              the same file and request references.
            </p>
            <button
              type="button"
              className={button}
              disabled={!canUpload}
              onClick={() => void sendUploadAttempt(attempt)}
            >
              Retry same upload
            </button>
          </div>
        )}
        {attempt?.status === 'rejected' && (
          <button
            type="button"
            className={button}
            onClick={() => {
              forgetUploadAttempt(attempt)
              setSelected(null)
              onReload()
            }}
          >
            Clear failed attempt and reload record
          </button>
        )}
        {attempt?.status === 'confirmed' && attempt.receipt && (
          <div className="space-y-3 rounded-lg bg-emerald-50 p-4">
            <p role="status">
              Version {attempt.receipt.versionNumber} was saved as a Draft with
              its verified attachment.
            </p>
            <button
              type="button"
              className={button}
              onClick={() => {
                forgetUploadAttempt(attempt)
                setSelected(null)
                onReload()
              }}
            >
              Show saved version
            </button>
          </div>
        )}
        {pending && (
          <p className="text-sm text-slate-700">
            Stopping or leaving does not undo a server operation. This tab
            retains the file and retry references in memory; reloading or
            closing it loses them.
          </p>
        )}
      </form>
    </section>
  )
}
