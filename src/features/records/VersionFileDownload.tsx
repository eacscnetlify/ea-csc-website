import { useEffect, useRef, useState } from 'react'
import {
  DownloadError,
  downloadVersionFile,
  saveDownloadedFile,
} from './download'

export default function VersionFileDownload({
  userId,
  versionId,
  versionNumber,
}: {
  userId: string
  versionId: string
  versionNumber: number
}) {
  const active = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => () => active.current?.abort(), [userId, versionId])

  async function download() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setNotice('')
    setError('')
    try {
      const file = await downloadVersionFile(
        userId,
        versionId,
        controller.signal,
      )
      if (controller.signal.aborted) return
      saveDownloadedFile(file)
      setNotice('File verified and sent to your browser for download.')
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof DownloadError
            ? failure.message
            : 'The download could not be completed. Check your connection and try again.',
        )
    } finally {
      if (active.current === controller) {
        active.current = null
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }

  return (
    <div className="mt-4 space-y-2" aria-busy={busy}>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        aria-label={`Download attachment for version ${versionNumber}`}
        className="rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        {busy ? 'Checking and downloading…' : 'Download attachment'}
      </button>
      <p className="text-sm text-slate-600">
        Downloads require current file access. Some versions have no accepted
        attachment.
      </p>
      <p role="status" className="text-sm text-emerald-900">
        {busy ? 'Checking access and file integrity…' : notice}
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">
          {error}
        </p>
      )}
    </div>
  )
}
