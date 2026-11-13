import { useState } from 'react'
import type { PublicRecordItem } from './records.types'

interface RecordDetailsProps {
  record: PublicRecordItem
  history: PublicRecordItem[]
}

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

export default function RecordDetails({ record, history }: RecordDetailsProps) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  async function downloadPublicCopy() {
    if (downloading) return
    setDownloading(true)
    setDownloadError('')
    try {
      const endpoint = new URL(
        '/functions/v1/ea-csc-public-download',
        import.meta.env.VITE_SUPABASE_URL.trim(),
      )
      endpoint.searchParams.set('record_id', record.recordId)
      const response = await fetch(endpoint, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) {
        throw new Error('Official file is currently unavailable.')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      const filename = encodedName
        ? decodeURIComponent(encodedName)
        : `${record.recordId}_v${record.versionNumber}`
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.append(link)
      try {
        link.click()
      } finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch (failure) {
      setDownloadError(
        failure instanceof Error
          ? failure.message
          : 'Download could not be completed.',
      )
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="space-y-6">
      <section
        aria-label="Current public release"
        className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <p className="text-sm font-semibold text-green-800">
          {record.category}
        </p>

        <h2 className="mt-3 text-2xl font-bold leading-9 text-slate-900">
          {record.title}
        </h2>

        <p className="mt-2 break-all font-mono text-sm text-slate-500">
          {record.recordId}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-900">
            Current public release
          </span>

          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            Version {record.versionNumber}
          </span>

          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {record.state}
          </span>
        </div>

        <p className="mt-5 text-base leading-7 text-slate-600">
          {record.summary}
        </p>

        <dl className="mt-6 grid min-w-0 gap-5 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="font-semibold text-slate-900">Document type</dt>
            <dd className="mt-1 text-slate-600">{record.documentType}</dd>
          </div>

          <div className="min-w-0">
            <dt className="font-semibold text-slate-900">Originating office</dt>
            <dd className="mt-1 wrap-break-word text-slate-600">
              {record.originatingOffice}
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-900">Approval date</dt>
            <dd className="mt-1 text-slate-600">
              {record.approvedAt ? (
                <time dateTime={record.approvedAt}>
                  {dateFormatter.format(new Date(record.approvedAt))}
                </time>
              ) : (
                'Not recorded'
              )}
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-900">Release date</dt>
            <dd className="mt-1 text-slate-600">
              <time dateTime={record.releasedAt}>
                {dateFormatter.format(new Date(record.releasedAt))}
              </time>
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-900">Effective date</dt>
            <dd className="mt-1 text-slate-600">
              <time dateTime={record.effectiveAt}>
                {dateFormatter.format(new Date(record.effectiveAt))}
              </time>
            </dd>
          </div>

          <div className="min-w-0">
            <dt className="font-semibold text-slate-900">Public contact</dt>
            <dd className="mt-1 break-all text-slate-600">
              {record.publicContact}
            </dd>
          </div>
        </dl>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">
            Notes for this version
          </h3>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            {record.changeSummary}
          </p>
        </div>

        <div className="mt-6 space-y-2 border-t border-slate-200 pt-5">
          <button
            type="button"
            disabled={downloading}
            onClick={() => void downloadPublicCopy()}
            className="rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white hover:bg-green-900 disabled:opacity-50"
          >
            {downloading ? 'Downloading…' : 'Download official copy'}
          </button>
          {downloadError && (
            <p role="alert" className="text-sm text-red-800">
              {downloadError}
            </p>
          )}
        </div>
      </section>

      <section
        aria-label="Public version history"
        className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <h2 className="text-xl font-bold text-slate-900">
          Public version history
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Only earlier releases permitted for public history appear here.
        </p>

        {history.length === 0 ? (
          <p className="mt-5 rounded-lg bg-slate-100 p-4 text-sm leading-6 text-slate-600">
            No earlier public releases are available.
          </p>
        ) : (
          <ol className="mt-5 list-none space-y-4 p-0">
            {history.map((item) => (
              <li
                key={item.releaseId}
                className="min-w-0 rounded-lg border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-base font-bold text-slate-900">
                    Version {item.versionNumber}
                  </h3>

                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {item.state}
                  </span>
                </div>

                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                  Historical release. Use the current public version{' '}
                  {record.versionNumber} for current reference.
                </p>

                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {item.changeSummary}
                </p>

                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-slate-900">Released</dt>
                    <dd className="mt-1 text-slate-600">
                      <time dateTime={item.releasedAt}>
                        {dateFormatter.format(new Date(item.releasedAt))}
                      </time>
                    </dd>
                  </div>

                  <div>
                    <dt className="font-semibold text-slate-900">Effective</dt>
                    <dd className="mt-1 text-slate-600">
                      <time dateTime={item.effectiveAt}>
                        {dateFormatter.format(new Date(item.effectiveAt))}
                      </time>
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
