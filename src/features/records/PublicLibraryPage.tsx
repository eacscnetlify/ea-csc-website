import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import HelpLink from '../../components/ui/HelpLink'
import { useAuth } from '../auth/useAuth'
import { FileVerifierWidget } from './FileVerifierWidget'
import { PdfPreviewModal } from './PdfPreviewModal'
import RecordDetailsModal from './RecordDetailsModal'
import { getPublicRecords } from './records.api'
import { RECORD_CATEGORIES } from './records.types'
import type { PublicRecordItem } from './records.types'
import { ShareQrModal } from './ShareQrModal'
import { useBookmarks } from './useBookmarks'

type LoadStatus = 'loading' | 'success' | 'error'

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

export default function PublicLibraryPage() {
  const auth = useAuth()
  const [records, setRecords] = useState<PublicRecordItem[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [previewRecordId, setPreviewRecordId] = useState<string | null>(null)
  const [pdfPreviewItem, setPdfPreviewItem] = useState<PublicRecordItem | null>(
    null,
  )
  const [qrRecord, setQrRecord] = useState<PublicRecordItem | null>(null)
  const { bookmarks, isPinned, togglePin, clearPins } = useBookmarks()

  useEffect(() => {
    let ignore = false
    getPublicRecords()
      .then((items) => {
        if (!ignore) {
          setRecords(items)
          setStatus('success')
        }
      })
      .catch(() => {
        if (!ignore) {
          setStatus('error')
        }
      })
    return () => {
      ignore = true
    }
  }, [attempt])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search)
    }, 250)
    return () => window.clearTimeout(timeoutId)
  }, [search])

  const query = debouncedSearch.trim().toLowerCase()
  const isSearchPending = search !== debouncedSearch

  const filteredRecords = records.filter((record) => {
    const matchesCategory = category === 'all' || record.category === category
    const searchableText = [
      record.recordId,
      record.title,
      record.summary,
      record.category,
      record.documentType,
      record.originatingOffice,
    ]
      .join(' ')
      .toLowerCase()
    return matchesCategory && searchableText.includes(query)
  })

  function clearFilters() {
    setSearch('')
    setDebouncedSearch('')
    setCategory('all')
  }

  function retryLoading() {
    setStatus('loading')
    setAttempt((previous) => previous + 1)
  }

  return (
    <section aria-labelledby="library-heading" className="space-y-8">
      {/* Hero Lobby Banner (CatSU CEA 2026 Theme) */}
      <div className="relative overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl border border-slate-800">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(153,27,27,0.55),transparent_55%),radial-gradient(circle_at_bottom_left,rgba(6,182,212,0.18),transparent_50%)]"
        />
        <div className="relative z-10 px-6 py-10 sm:px-10 sm:py-12 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
          <div className="max-w-2xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-950/60 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-rose-200">
              Welcome to Catanduanes State University
            </div>
            <h1
              id="library-heading"
              className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight"
            >
              Engineering & Architecture Student Council
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Institutional Information and Document Governance System (IIDGS).
              Access verified council constitutions, approved resolutions, event
              guidelines, and tamper-proof public bulletins with full SHA-256
              integrity verification.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to="/bulletins"
                className="rounded-xl bg-rose-700 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-rose-600 transition"
              >
                View Update Bulletins
              </Link>
              {auth.status !== 'signed-in' ? (
                <Link
                  to="/signup"
                  className="rounded-xl border border-slate-500 bg-slate-900/80 px-5 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-800 transition"
                >
                  Create Student Account
                </Link>
              ) : (
                <Link
                  to="/account"
                  className="rounded-xl border border-emerald-500/50 bg-emerald-950/60 px-5 py-2.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/70 transition"
                >
                  My Account & Role
                </Link>
              )}
              <HelpLink
                section="public-library"
                label="How to use this portal"
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-center">
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute -inset-2 rounded-full bg-rose-600/30 blur-xl"
              />
              <img
                src="/eacsc-logo-2026.jpg"
                alt="EA-CSC 2026 Official Emblem"
                className="relative h-36 w-36 sm:h-44 sm:w-44 rounded-full border-4 border-slate-300/80 object-cover shadow-2xl"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Three Statutory Transparency Cards (CatSU Ranking Cards Style) */}
      <div className="grid gap-5 md:grid-cols-3 -mt-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800">
              Public Library
            </span>
            <span className="text-2xl font-extrabold text-slate-900">
              {status === 'success' ? records.length : '—'}
            </span>
          </div>
          <h2 className="mt-3 text-base font-bold text-slate-900">
            Verified Council Documents
          </h2>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            Every published constitution, resolution, and event guideline approved
            under official 6-point council verification.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
              Integrity Guard
            </span>
            <span className="text-lg font-extrabold text-emerald-700">
              SHA-256
            </span>
          </div>
          <h2 className="mt-3 text-base font-bold text-slate-900">
            Cryptographic Verification
          </h2>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            All official files and periodic PDF bulletins carry immutable checksums
            to guarantee authenticity and prevent tampering.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="rounded-lg bg-cyan-50 px-2.5 py-1 text-xs font-bold text-cyan-800">
              Official Digests
            </span>
            <Link
              to="/bulletins"
              className="text-xs font-bold text-cyan-700 hover:underline"
            >
              Browse →
            </Link>
          </div>
          <h2 className="mt-3 text-base font-bold text-slate-900">
            Update Bulletins
          </h2>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            Periodic council gazettes compiling verified releases within each
            reporting window for students and college advisers.
          </p>
        </div>
      </div>

      {/* Search & Interactive Category Chips */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex-1">
            <label
              htmlFor="public-search"
              className="block text-sm font-bold text-slate-900"
            >
              Search Public Documents
            </label>
            <input
              id="public-search"
              type="search"
              placeholder="Search by document title, ID (e.g., EACSC-2026-GOV-0001), or office…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-950 focus:border-rose-700 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="sm:w-64">
            <label
              htmlFor="public-category"
              className="block text-sm font-bold text-slate-900"
            >
              Category
            </label>
            <select
              id="public-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-950 focus:border-rose-700 focus:bg-white focus:outline-none"
            >
              <option value="all">All Categories</option>
              {RECORD_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Interactive Quick Filter Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
              category === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All ({records.length})
          </button>
          {RECORD_CATEGORIES.map((cat) => {
            const count = records.filter((r) => r.category === cat).length
            if (count === 0) return null
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                  category === cat
                    ? 'bg-rose-800 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat} ({count})
              </button>
            )
          })}
          {(search.trim() !== '' || category !== 'all') && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-800 shadow-xs transition-all duration-150 hover:border-rose-300 hover:bg-rose-100 active:scale-[0.98]"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* In-Browser SHA-256 Verifier */}
      <FileVerifierWidget records={records} />

      {/* Pinned / Bookmarked Documents Strip */}
      {bookmarks.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-extrabold uppercase tracking-wider text-amber-900">
              Pinned by You ({bookmarks.length})
            </p>
            <button
              type="button"
              onClick={clearPins}
              className="text-xs font-semibold text-amber-900 hover:underline"
            >
              Clear all pins
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {bookmarks.map((pin) => (
              <div
                key={pin.recordId}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-xs shadow-2xs"
              >
                <Link
                  to={`/records/${encodeURIComponent(pin.recordId)}`}
                  className="font-semibold text-slate-900 hover:text-rose-800"
                >
                  {pin.title}
                </Link>
                <button
                  type="button"
                  aria-label={`Unpin ${pin.title}`}
                  onClick={() => togglePin(pin)}
                  className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document Cards Grid */}
      {status === 'loading' && (
        <div
          role="status"
          className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600"
        >
          Loading verified public documents…
        </div>
      )}

      {status === 'error' && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center space-y-3"
        >
          <p className="text-sm font-semibold text-red-900">
            The public document catalog could not be loaded right now.
          </p>
          <button
            type="button"
            onClick={retryLoading}
            className="rounded-lg bg-rose-800 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-900"
          >
            Try Again
          </button>
        </div>
      )}

      {status === 'success' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/95 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-800 shadow-xs backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              {isSearchPending
                ? 'Searching…'
                : `Showing ${filteredRecords.length} verified public document${filteredRecords.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {filteredRecords.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-2">
              <p className="text-base font-bold text-slate-900">
                No matching public documents found
              </p>
              <p className="text-sm text-slate-600">
                Try clearing your search or selecting another category.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {filteredRecords.map((record) => (
                <article
                  key={record.recordId}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-rose-300 hover:shadow-md"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-bold text-slate-800">
                        {record.recordId}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        v{record.versionNumber} Active Release
                      </span>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-slate-900 group-hover:text-rose-800 transition-colors">
                        {record.title}
                      </h3>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {record.category} · {record.documentType} ·{' '}
                        {record.originatingOffice}
                      </p>
                    </div>

                    <p className="text-sm text-slate-600 line-clamp-3 leading-relaxed">
                      {record.summary || 'Official published council document.'}
                    </p>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                    <span className="text-xs text-slate-500">
                      Effective:{' '}
                      <strong className="text-slate-700">
                        {record.effectiveAt
                          ? dateFormatter.format(new Date(record.effectiveAt))
                          : 'Immediate'}
                      </strong>
                    </span>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          togglePin({
                            recordId: record.recordId,
                            title: record.title,
                            category: record.category,
                            versionNumber: record.versionNumber,
                          })
                        }
                        className={`min-h-[40px] sm:min-h-0 rounded-lg border px-3 py-2 sm:px-2.5 sm:py-1.5 text-xs font-semibold transition ${
                          isPinned(record.recordId)
                            ? 'border-amber-300 bg-amber-50 text-amber-900'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {isPinned(record.recordId) ? 'Pinned' : 'Pin'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPdfPreviewItem(record)}
                        className="min-h-[40px] sm:min-h-0 rounded-lg border border-slate-300 bg-white px-3 py-2 sm:px-2.5 sm:py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Preview
                      </button>
                      {record.externalUrl && (
                        <a
                          href={record.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center min-h-[40px] sm:min-h-0 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 sm:px-2.5 sm:py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100"
                        >
                          Drive Link ↗
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setQrRecord(record)}
                        className="min-h-[40px] sm:min-h-0 rounded-lg border border-slate-300 bg-white px-3 py-2 sm:px-2.5 sm:py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        QR
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewRecordId(record.recordId)}
                        className="min-h-[40px] sm:min-h-0 rounded-lg border border-slate-300 bg-white px-3 py-2 sm:py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Details
                      </button>
                      <Link
                        to={`/records/${encodeURIComponent(record.recordId)}`}
                        className="inline-flex items-center min-h-[40px] sm:min-h-0 rounded-lg bg-slate-900 px-3 py-2 sm:py-1.5 text-xs font-semibold text-white hover:bg-rose-800 transition"
                      >
                        Open →
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {previewRecordId && (
        <RecordDetailsModal
          recordId={previewRecordId}
          onClose={() => setPreviewRecordId(null)}
        />
      )}

      {pdfPreviewItem && (
        <PdfPreviewModal
          open
          title={pdfPreviewItem.title}
          subtitle={`${pdfPreviewItem.recordId} · v${pdfPreviewItem.versionNumber}`}
          fetchUrl={`${import.meta.env.VITE_SUPABASE_URL.trim()}/functions/v1/ea-csc-public-download?record_id=${encodeURIComponent(pdfPreviewItem.recordId)}`}
          downloadFilename={`${pdfPreviewItem.recordId}_v${pdfPreviewItem.versionNumber}.pdf`}
          onClose={() => setPdfPreviewItem(null)}
        />
      )}

      {qrRecord && (
        <ShareQrModal
          open
          title={qrRecord.title}
          subtitle={qrRecord.recordId}
          url={`${window.location.origin}/records/${encodeURIComponent(qrRecord.recordId)}`}
          onClose={() => setQrRecord(null)}
        />
      )}
    </section>
  )
}
