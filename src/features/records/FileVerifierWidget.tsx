import { useState } from 'react'
import type { PublicRecordItem } from './records.types'

interface FileVerifierWidgetProps {
  records?: PublicRecordItem[]
}

async function hashArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

export function FileVerifierWidget({ records = [] }: FileVerifierWidgetProps) {
  const [open, setOpen] = useState(false)
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [pastedHash, setPastedHash] = useState('')
  const [fileName, setFileName] = useState('')
  const [localHash, setLocalHash] = useState('')
  const [comparing, setComparing] = useState(false)
  const [result, setResult] = useState<
    | { kind: 'idle' }
    | { kind: 'match'; label: string; officialHash: string }
    | { kind: 'mismatch'; label: string; officialHash: string }
    | { kind: 'computed_only' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function processFile(file: File | null) {
    if (!file) return
    setComparing(true)
    setFileName(file.name)
    setResult({ kind: 'idle' })

    try {
      const buffer = await file.arrayBuffer()
      const computed = await hashArrayBuffer(buffer)
      setLocalHash(computed)

      const normalizedPaste = pastedHash.trim().toLowerCase()
      if (normalizedPaste) {
        if (computed === normalizedPaste) {
          setResult({
            kind: 'match',
            label: 'Pasted SHA-256 Checksum',
            officialHash: normalizedPaste,
          })
        } else {
          setResult({
            kind: 'mismatch',
            label: 'Pasted SHA-256 Checksum',
            officialHash: normalizedPaste,
          })
        }
        return
      }

      if (selectedRecordId) {
        const endpoint = new URL(
          '/functions/v1/ea-csc-public-download',
          import.meta.env.VITE_SUPABASE_URL.trim(),
        )
        endpoint.searchParams.set('record_id', selectedRecordId)
        const res = await fetch(endpoint, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) {
          throw new Error('Could not fetch the official document copy to compare.')
        }
        const officialBuf = await res.arrayBuffer()
        const officialHash = await hashArrayBuffer(officialBuf)
        const rec = records.find((r) => r.recordId === selectedRecordId)
        const label = rec
          ? `${rec.recordId} (${rec.title})`
          : selectedRecordId
        if (computed === officialHash) {
          setResult({ kind: 'match', label, officialHash })
        } else {
          setResult({ kind: 'mismatch', label, officialHash })
        }
        return
      }

      setResult({ kind: 'computed_only' })
    } catch (err) {
      setResult({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Could not verify the selected file.',
      })
    } finally {
      setComparing(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-xs font-extrabold text-emerald-900">
            SHA
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Verify a Downloaded File (In-Browser SHA-256 Checker)
            </h2>
            <p className="text-xs text-slate-600">
              Drop any PDF/DOCX/image to confirm it matches an official council release byte-for-byte.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
          {open ? 'Hide' : 'Open Tool'}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 bg-slate-50/60 p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {records.length > 0 && (
              <div>
                <label
                  htmlFor="verify-record-select"
                  className="block text-xs font-bold text-slate-800"
                >
                  Compare Against Official Public Document
                </label>
                <select
                  id="verify-record-select"
                  value={selectedRecordId}
                  onChange={(e) => {
                    setSelectedRecordId(e.target.value)
                    if (e.target.value) setPastedHash('')
                  }}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-700 focus:outline-none"
                >
                  <option value="">-- Select a published document (optional) --</option>
                  {records.map((rec) => (
                    <option key={rec.recordId} value={rec.recordId}>
                      {rec.recordId} — {rec.title} (v{rec.versionNumber})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label
                htmlFor="verify-pasted-hash"
                className="block text-xs font-bold text-slate-800"
              >
                Or Paste Expected SHA-256 Checksum
              </label>
              <input
                id="verify-pasted-hash"
                type="text"
                value={pastedHash}
                onChange={(e) => {
                  setPastedHash(e.target.value)
                  if (e.target.value.trim()) setSelectedRecordId('')
                }}
                placeholder="64-character hex SHA-256 (optional)"
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-emerald-700 focus:outline-none"
              />
            </div>
          </div>

          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const dropped = e.dataTransfer.files?.[0] ?? null
              void processFile(dropped)
            }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center transition hover:border-emerald-700 hover:bg-emerald-50/30"
          >
            <input
              type="file"
              className="hidden"
              onChange={(e) => void processFile(e.target.files?.[0] ?? null)}
            />
            <span className="text-sm font-bold text-slate-800">
              {comparing
                ? 'Computing SHA-256 checksum…'
                : fileName
                  ? `Selected: ${fileName} (click or drop another file)`
                  : 'Click to choose a file or drag & drop it here'}
            </span>
            <span className="mt-1 text-xs text-slate-500">
              Computed locally in your browser — your file is never uploaded.
            </span>
          </label>

          {localHash && (
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs space-y-1">
              <p className="font-bold text-slate-800">Your File&apos;s SHA-256:</p>
              <p className="font-mono text-slate-600 break-all">{localHash}</p>
            </div>
          )}

          {result.kind === 'match' && (
            <div
              role="status"
              className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950 space-y-1"
            >
              <p className="text-sm font-bold text-emerald-900">
                ✓ AUTHENTICITY VERIFIED — Exact Match
              </p>
              <p>
                This file matches <strong>{result.label}</strong> byte-for-byte with zero alterations.
              </p>
            </div>
          )}

          {result.kind === 'mismatch' && (
            <div
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 p-4 text-xs text-red-950 space-y-1"
            >
              <p className="text-sm font-bold text-red-900">
                ✕ MISMATCH — File Does Not Match Official Release
              </p>
              <p>
                Your file&apos;s checksum differs from <strong>{result.label}</strong>. It may be an outdated version or modified copy.
              </p>
              <p className="font-mono text-[11px] text-red-800 break-all">
                Expected: {result.officialHash}
              </p>
            </div>
          )}

          {result.kind === 'computed_only' && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
              Checksum computed above. Select an official document or paste a SHA-256 hash to verify a match.
            </div>
          )}

          {result.kind === 'error' && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-900"
            >
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
