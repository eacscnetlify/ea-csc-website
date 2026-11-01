import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { SubmitEvent } from 'react'
import FileDropzone from '../../components/ui/FileDropzone'
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
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || hashing || attempt || !canUpload) return
    setError('')
    try {
      const current = createUploadAttempt({
        ...selected,
        actorId: userId,
        recordId,
        expectedRevision: recordRevision,
        notes,
        classification,
        prepareId: crypto.randomUUID(),
        acceptId: crypto.randomUUID(),
      })
      void sendUploadAttempt(current)
    } catch (failure) {
      setError(
        failure instanceof UploadError
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
          <FileDropzone
            disabled={!canUpload || hashing}
            onSelect={(files) => void select(files)}
          />
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
            disabled={!canUpload || hashing || !selected || !notes.trim()}
          >
            Upload as new Draft
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
