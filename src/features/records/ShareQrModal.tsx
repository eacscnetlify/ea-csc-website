import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface ShareQrModalProps {
  open: boolean
  title: string
  subtitle: string
  url: string
  onClose: () => void
}

export function ShareQrModal({
  open,
  title,
  subtitle,
  url,
  onClose,
}: ShareQrModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || !url) return
    let active = true
    QRCode.toDataURL(url, {
      width: 280,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl)
      })
      .catch(() => {
        if (active) setQrDataUrl('')
      })
    return () => {
      active = false
    }
  }, [open, url])

  if (!open) return null

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback ignored if clipboard blocked
    }
  }

  function downloadQrPng() {
    if (!qrDataUrl) return
    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = `${subtitle.replace(/[^a-zA-Z0-9_-]/g, '_')}_QR.png`
    document.body.append(link)
    link.click()
    link.remove()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 animate-[fadeIn_160ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Official Share & QR Code
            </p>
            <h3
              id="qr-modal-title"
              className="mt-1 text-lg font-bold text-slate-900"
            >
              {title}
            </h3>
            <p className="font-mono text-xs text-slate-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-5">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR code for ${title}`}
              className="h-52 w-52 rounded-lg border border-white bg-white p-2 shadow-sm"
            />
          ) : (
            <div className="flex h-52 w-52 items-center justify-center text-xs text-slate-500">
              Generating QR code…
            </div>
          )}
          <p className="mt-3 text-center text-xs text-slate-600">
            Scan to open this verified record directly on{' '}
            <strong className="text-slate-800">EA-CSC IIDGS</strong>.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 break-all">
          {url}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => void copyLink()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
          >
            {copied ? 'Link Copied!' : 'Copy Share Link'}
          </button>
          <button
            type="button"
            disabled={!qrDataUrl}
            onClick={downloadQrPng}
            className="rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
          >
            Download QR PNG
          </button>
        </div>
      </div>
    </div>
  )
}
