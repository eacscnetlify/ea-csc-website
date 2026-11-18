import { useEffect, useState } from 'react'
import { formatManilaDate, formatManilaDateTime } from '../../lib/dates'
import { getSupabaseClient } from '../../lib/supabase'

interface InternalBulletinItem {
  issueUuid: string
  bulletinId: string
  issueVersion: number
  title: string
  coverageStart: string
  coverageEnd: string
  cutoffAt: string
  audience: string
  sourcesCount: number
  issuedAt: string
}

export default function InternalBulletinsPage() {
  const [items, setItems] = useState<InternalBulletinItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    let active = true

    async function loadInternalBulletins() {
      setLoading(true)
      setError('')
      try {
        const { data, error: rpcError } = await getSupabaseClient().rpc(
          'eacsc_list_internal_bulletins',
        )
        if (!active) return
        if (rpcError || !Array.isArray(data)) {
          setError(
            rpcError?.message || 'Internal bulletins could not be loaded.',
          )
          setLoading(false)
          return
        }

        const mapped: InternalBulletinItem[] = (
          data as Record<string, unknown>[]
        ).map((r) => ({
          issueUuid: String(r.issue_uuid),
          bulletinId: String(r.bulletin_id),
          issueVersion: Number(r.issue_version),
          title: String(r.title),
          coverageStart: String(r.coverage_start),
          coverageEnd: String(r.coverage_end),
          cutoffAt: String(r.cutoff_at),
          audience: String(r.audience),
          sourcesCount: Number(r.sources_count),
          issuedAt: String(r.issued_at),
        }))
        setItems(mapped)
        setLoading(false)
      } catch {
        if (active) {
          setError('Internal bulletins could not be loaded.')
          setLoading(false)
        }
      }
    }

    void loadInternalBulletins()
    return () => {
      active = false
    }
  }, [])

  async function downloadPdf(bulletinId: string, issueVersion: number) {
    const key = `${bulletinId}:${issueVersion}`
    setDownloadingKey(key)
    setDownloadError('')
    try {
      const {
        data: { session },
      } = await getSupabaseClient().auth.getSession()
      if (!session?.access_token) {
        throw new Error('Your officer session has expired. Please sign in again.')
      }

      const endpoint = new URL(
        '/functions/v1/ea-csc-bulletin-file',
        import.meta.env.VITE_SUPABASE_URL.trim(),
      )
      endpoint.searchParams.set('bulletin_id', bulletinId)
      endpoint.searchParams.set('issue_version', String(issueVersion))

      const response = await fetch(endpoint, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      if (!response.ok) {
        throw new Error('Internal bulletin PDF could not be retrieved.')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${bulletinId}_v${issueVersion}_internal.pdf`
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setDownloadError(
        err instanceof Error
          ? err.message
          : 'Could not download internal bulletin PDF.',
      )
    } finally {
      setDownloadingKey(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-800">
          Officer-Only Portal
        </span>
        <h2 className="mt-2 text-xl font-bold text-slate-900">
          Internal Update Bulletins
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Official council update bulletins issued for internal officer
          distribution. Public student accounts cannot access these bulletins.
        </p>
      </section>

      {downloadError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {downloadError}
        </div>
      )}

      {loading && (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm"
        >
          Loading internal bulletins…
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No internal update bulletins have been issued yet.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => {
            const key = `${item.bulletinId}:${item.issueVersion}`
            const busy = downloadingKey === key
            return (
              <article
                key={item.issueUuid}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-700">
                      {item.bulletinId}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                      Issue v{item.issueVersion}
                    </span>
                    <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-800">
                      Internal
                    </span>
                  </div>
                  <span className="text-xs font-medium text-slate-600">
                    {item.sourcesCount}{' '}
                    {item.sourcesCount === 1 ? 'release' : 'releases'}
                  </span>
                </div>

                <h3 className="mt-3 text-base font-semibold text-slate-900">
                  {item.title}
                </h3>

                <dl className="mt-3 space-y-1 text-xs text-slate-600">
                  <div>
                    <dt className="inline font-medium text-slate-700">
                      Coverage Window:{' '}
                    </dt>
                    <dd className="inline">
                      {formatManilaDate(item.coverageStart)} –{' '}
                      {formatManilaDate(item.coverageEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-slate-700">
                      Cutoff:{' '}
                    </dt>
                    <dd className="inline">
                      {formatManilaDateTime(item.cutoffAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-slate-700">
                      Issued:{' '}
                    </dt>
                    <dd className="inline">
                      {formatManilaDateTime(item.issuedAt)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void downloadPdf(item.bulletinId, item.issueVersion)
                    }
                    className="inline-flex items-center rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? 'Downloading PDF…' : 'Download Bulletin PDF'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
