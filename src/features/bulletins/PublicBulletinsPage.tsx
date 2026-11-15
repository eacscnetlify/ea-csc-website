import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatManilaDate, formatManilaDateTime } from '../../lib/dates'
import { getSupabaseClient } from '../../lib/supabase'
import { PdfPreviewModal } from '../records/PdfPreviewModal'
import { ShareQrModal } from '../records/ShareQrModal'

interface PublicBulletinItem {
  bulletinId: string
  issueVersion: number
  title: string
  coverageStart: string
  coverageEnd: string
  cutoffAt: string
  issuedAt: string
  sourcesCount: number
}

export default function PublicBulletinsPage() {
  const [items, setItems] = useState<PublicBulletinItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [previewBulletin, setPreviewBulletin] =
    useState<PublicBulletinItem | null>(null)
  const [qrBulletin, setQrBulletin] = useState<PublicBulletinItem | null>(null)

  useEffect(() => {
    let active = true

    async function loadBulletins() {
      try {
        const { data, error: rpcError } = await getSupabaseClient().rpc(
          'eacsc_public_bulletins',
          { p_limit: 50, p_offset: 0 },
        )

        if (!active) return
        if (rpcError || !Array.isArray(data)) {
          setError('Public bulletins could not be loaded.')
          setLoading(false)
          return
        }

        const mapped: PublicBulletinItem[] = (
          data as Record<string, unknown>[]
        ).map((r) => ({
          bulletinId: String(r.bulletin_id),
          issueVersion: Number(r.issue_version),
          title: String(r.title),
          coverageStart: String(r.coverage_start),
          coverageEnd: String(r.coverage_end),
          cutoffAt: String(r.cutoff_at),
          issuedAt: String(r.issued_at),
          sourcesCount: Number(r.sources_count),
        }))
        setItems(mapped)
        setLoading(false)
      } catch {
        if (active) {
          setError('Public bulletins could not be loaded.')
          setLoading(false)
        }
      }
    }

    void loadBulletins()

    return () => {
      active = false
    }
  }, [])

  async function downloadPdf(bulletinId: string, issueVersion: number) {
    setDownloadingId(bulletinId)
    try {
      const endpoint = new URL(
        '/functions/v1/ea-csc-bulletin-file',
        import.meta.env.VITE_SUPABASE_URL.trim(),
      )
      endpoint.searchParams.set('bulletin_id', bulletinId)
      endpoint.searchParams.set('issue_version', String(issueVersion))

      const response = await fetch(endpoint, {
        method: 'GET',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Bulletin PDF unavailable.')

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${bulletinId}_v${issueVersion}.pdf`
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      alert('Could not download bulletin PDF.')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <section aria-labelledby="public-bulletins-heading" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-sm backdrop-blur-sm">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            Official publications
          </p>
          <h1
            id="public-bulletins-heading"
            className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900"
          >
            Update Bulletins
          </h1>
          <p className="mt-2.5 text-sm leading-6 text-slate-700 sm:text-base">
            Download official periodic summaries of authorized council releases.
            Each bulletin is preserved as an immutable PDF with its source
            cutoff timestamp.
          </p>
        </div>
        <Link
          to="/"
          className="group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-950 hover:shadow-sm"
        >
          <svg
            className="h-4 w-4 text-emerald-700 transition-transform duration-200 group-hover:-translate-x-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to Public Library
        </Link>
      </div>

      {loading && <p role="status">Loading update bulletins…</p>}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900"
        >
          {error}
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-900">
            No bulletins have been issued yet
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Check back later for official periodic release summaries.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          {items.map((b) => (
            <article
              key={`${b.bulletinId}:v${b.issueVersion}`}
              className="space-y-3 rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-950">
                  Issue v{b.issueVersion}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  {b.bulletinId}
                </span>
              </div>
              <h2 className="text-xl font-bold text-slate-900">{b.title}</h2>
              <p className="text-sm text-slate-600">
                Reporting coverage: {formatManilaDate(b.coverageStart)} to{' '}
                {formatManilaDate(b.coverageEnd)}
              </p>
              <p className="text-xs text-slate-500">
                Cutoff: {formatManilaDateTime(b.cutoffAt)} · {b.sourcesCount}{' '}
                releases summarized
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={downloadingId === b.bulletinId}
                  onClick={() => void downloadPdf(b.bulletinId, b.issueVersion)}
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-900 disabled:opacity-50"
                >
                  {downloadingId === b.bulletinId
                    ? 'Downloading…'
                    : 'Download official PDF'}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewBulletin(b)}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                >
                  Preview PDF
                </button>
                <button
                  type="button"
                  onClick={() => setQrBulletin(b)}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                >
                  QR Code
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {previewBulletin && (
        <PdfPreviewModal
          open
          title={previewBulletin.title}
          subtitle={`${previewBulletin.bulletinId} · Issue v${previewBulletin.issueVersion}`}
          fetchUrl={`${import.meta.env.VITE_SUPABASE_URL.trim()}/functions/v1/ea-csc-bulletin-file?bulletin_id=${encodeURIComponent(previewBulletin.bulletinId)}&issue_version=${previewBulletin.issueVersion}`}
          downloadFilename={`${previewBulletin.bulletinId}_v${previewBulletin.issueVersion}.pdf`}
          onClose={() => setPreviewBulletin(null)}
        />
      )}

      {qrBulletin && (
        <ShareQrModal
          open
          title={qrBulletin.title}
          subtitle={`${qrBulletin.bulletinId}_v${qrBulletin.issueVersion}`}
          url={`${window.location.origin}/bulletins`}
          onClose={() => setQrBulletin(null)}
        />
      )}
    </section>
  )
}
