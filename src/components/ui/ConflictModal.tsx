import { useEffect, useId, useRef, useState } from 'react'

export default function ConflictModal({
  open,
  localText,
  storedText,
  storedRevision,
  onReload,
  onClose,
}: {
  open: boolean
  localText: string
  storedText: string
  storedRevision: number
  onReload: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null

  async function copyEdits() {
    try {
      await navigator.clipboard.writeText(localText)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-amber-300 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/60"
    >
      <h3 id={titleId} className="text-xl font-bold text-amber-950">
        Edit conflict detected (HTTP 409)
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-700">
        Another officer saved a newer version while you were editing (your
        loaded edit revision was {storedRevision}). Your typed notes are
        preserved below so you can copy them before reloading.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-800">
            Previously loaded notes
          </p>
          <p className="mt-2 whitespace-pre-wrap wrap-break-word text-sm text-slate-700">
            {storedText}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-bold text-emerald-950">
            Your unsaved edits
          </p>
          <p className="mt-2 whitespace-pre-wrap wrap-break-word text-sm text-slate-900">
            {localText}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void copyEdits()}
          className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold hover:bg-slate-100"
        >
          {copied ? 'Copied your edits' : 'Copy my edits'}
        </button>
        <button
          type="button"
          onClick={onReload}
          className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
        >
          Reload latest version
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
        >
          Keep editing view
        </button>
      </div>
    </dialog>
  )
}
