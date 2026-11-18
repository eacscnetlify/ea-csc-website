import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PdfCanvasViewer } from '../../components/ui/PdfCanvasViewer'
import { isInAppBrowser, shouldUseCanvasPdfViewer } from './download'

interface PdfPreviewModalProps {
  open: boolean
  title: string
  subtitle: string
  fetchUrl: string | null
  downloadFilename: string
  onClose: () => void
}

async function computeSha256Hex(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

export function PdfPreviewModal({
  open,
  title,
  subtitle,
  fetchUrl,
  downloadFilename,
  onClose,
}: PdfPreviewModalProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [mimeType, setMimeType] = useState('')
  const [sha256, setSha256] = useState('')
  const [resolvedName, setResolvedName] = useState(downloadFilename)

  useEffect(() => {
    if (!open || !fetchUrl) return
    let active = true
    let createdUrl: string | null = null

    fetch(fetchUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(30_000),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Preview unavailable')
        const blob = await res.blob()
        const disposition = res.headers.get('Content-Disposition') ?? ''
        const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
        const name = encoded ? decodeURIComponent(encoded) : downloadFilename
        const hash = await computeSha256Hex(blob)
        if (!active) return
        createdUrl = URL.createObjectURL(blob)
        setMimeType(blob.type.toLowerCase())
        setResolvedName(name)
        setSha256(hash)
        setPdfBlob(blob)
        setBlobUrl(createdUrl)
        setStatus('ready')
      })
      .catch(() => {
        if (active) setStatus('error')
      })

    return () => {
      active = false
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl)
      }
    }
  }, [open, fetchUrl, downloadFilename])

  if (!open) return null

  const isPdf = mimeType.includes('pdf') || resolvedName.toLowerCase().endsWith('.pdf')
  const isImage =
    mimeType.startsWith('image/') ||
    /\.(png|jpe?g)$/i.test(resolvedName)

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      onClick={onClose}
    >
      <div
        className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-900">
                In-Browser Preview
              </span>
              <span className="font-mono text-xs text-slate-500 truncate">
                {subtitle}
              </span>
            </div>
            <h3
              id="preview-modal-title"
              className="mt-0.5 truncate text-base font-bold text-slate-900"
            >
              {title}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {blobUrl && (
              <a
                href={blobUrl}
                download={resolvedName}
                className="rounded-lg bg-emerald-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800"
              >
                Download
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>

        {sha256 && (
          <div className="border-b border-emerald-200 bg-emerald-50/70 px-4 py-1.5 text-[11px] text-emerald-950 flex flex-wrap items-center gap-2 sm:px-5">
            <span className="font-bold">Computed SHA-256:</span>
            <code className="font-mono break-all">{sha256}</code>
          </div>
        )}

        {isInAppBrowser() && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-950 sm:px-5">
            Inside an in-app browser (e.g., Messenger), if Download doesn&apos;t start, tap{' '}
            <strong>⋮ → Open in Browser</strong> (Chrome/Safari).
          </div>
        )}

        <div className="flex-1 overflow-auto bg-slate-100 p-3">
          {status === 'loading' && (
            <div className="flex h-full items-center justify-center text-sm font-medium text-slate-600">
              Loading official document preview…
            </div>
          )}

          {status === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center p-6">
              <p className="text-sm font-bold text-red-900">
                Preview could not be loaded.
              </p>
              <p className="text-xs text-slate-600">
                Try downloading the official copy directly from the record page.
              </p>
            </div>
          )}

          {status === 'ready' && blobUrl && isPdf && (
            shouldUseCanvasPdfViewer() && pdfBlob ? (
              <PdfCanvasViewer blob={pdfBlob} />
            ) : (
              <iframe
                src={blobUrl}
                title={`Preview of ${title}`}
                className="h-full w-full rounded-xl border border-slate-200 bg-white"
              />
            )
          )}

          {status === 'ready' && blobUrl && !isPdf && isImage && (
            <div className="flex h-full items-center justify-center">
              <img
                src={blobUrl}
                alt={title}
                className="max-h-full max-w-full rounded-xl border border-slate-200 bg-white object-contain shadow-sm"
              />
            </div>
          )}

          {status === 'ready' && blobUrl && !isPdf && !isImage && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center p-6">
              <p className="text-sm font-semibold text-slate-800">
                Browser inline preview is only available for PDF and image files.
              </p>
              <a
                href={blobUrl}
                download={resolvedName}
                className="rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                Download {resolvedName}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
