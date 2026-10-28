import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import RecordDetailsModal from './RecordDetailsModal'
import { getPublicRecords } from './records.api'
import { RECORD_CATEGORIES } from './records.types'
import type { PublicRecordItem } from './records.types'

type LoadStatus = 'loading' | 'success' | 'error'

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

export default function PublicLibraryPage() {
  const [records, setRecords] = useState<PublicRecordItem[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [previewRecordId, setPreviewRecordId] = useState<string | null>(null)

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
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
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

    const matchesSearch = searchableText.includes(query)

    return matchesCategory && matchesSearch
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
    <section aria-labelledby="library-heading">
      <p className="text-sm font-semibold tracking-wide text-green-800">
        PUBLIC RECORDS PORTAL
      </p>

      <h1
        id="library-heading"
        className="mt-2 text-3xl font-bold tracking-tight text-slate-900"
      >
        Public records library
      </h1>

      <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
        Browse current public releases and open their record details. Everything
        displayed in this prototype is fictional.
      </p>

      <div
        aria-label="Record search and filters"
        className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        role="search"
      >
        <div className="grid min-w-0 gap-5 md:grid-cols-2">
          <div className="min-w-0">
            <label
              htmlFor="record-search"
              className="block text-sm font-semibold text-slate-800"
            >
              Search public records
            </label>

            <input
              id="record-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title, record ID, or keyword"
              aria-describedby="record-search-help"
              className="mt-2 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
            />

            <p
              id="record-search-help"
              className="mt-2 text-sm leading-6 text-slate-500"
            >
              Results update shortly after you stop typing.
            </p>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="record-category"
              className="block text-sm font-semibold text-slate-800"
            >
              Category
            </label>

            <select
              id="record-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-2 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
            >
              <option value="all">All categories</option>

              {RECORD_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={clearFilters}
          className="mt-5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
        >
          Clear filters
        </button>
      </div>

      <div className="mt-6" aria-busy={status === 'loading' || isSearchPending}>
        {status === 'loading' && (
          <p
            role="status"
            className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600"
          >
            Loading public records…
          </p>
        )}

        {status === 'error' && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-6"
          >
            <h2 className="text-lg font-semibold text-red-900">
              Public records could not be loaded
            </h2>

            <p className="mt-2 text-sm leading-6 text-red-800">
              Please try loading the catalog again.
            </p>

            <button
              type="button"
              onClick={retryLoading}
              className="mt-4 rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
            >
              Try again
            </button>
          </div>
        )}

        {status === 'success' && (
          <>
            <p role="status" className="mb-4 text-sm leading-6 text-slate-600">
              {isSearchPending
                ? 'Updating search results…'
                : `Showing ${filteredRecords.length} of ${records.length} public records.`}
            </p>

            {filteredRecords.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <h2 className="text-lg font-semibold text-slate-900">
                  {records.length === 0
                    ? 'No public records are available yet'
                    : 'No records match your filters'}
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {records.length === 0
                    ? 'Please check again when public releases are available.'
                    : 'Try another keyword or use Clear filters to show all public records.'}
                </p>
              </div>
            ) : (
              <ul className="grid list-none gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
                {filteredRecords.map((record) => (
                  <li key={record.recordId} className="min-w-0">
                    <article className="flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <p className="text-xs font-semibold leading-5 text-green-800">
                        {record.category}
                      </p>

                      <h2 className="mt-3 text-xl font-bold leading-7 text-slate-900">
                        {record.title}
                      </h2>

                      <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-500">
                        {record.recordId}
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-900">
                          {record.state}
                        </span>

                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          Version {record.versionNumber}
                        </span>

                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {record.documentType}
                        </span>
                      </div>

                      <p className="mt-4 text-sm leading-6 text-slate-600">
                        {record.summary}
                      </p>

                      <dl className="mt-5 space-y-3 text-sm">
                        <div>
                          <dt className="font-semibold text-slate-800">
                            Released
                          </dt>
                          <dd className="mt-1 text-slate-600">
                            <time dateTime={record.releasedAt}>
                              {dateFormatter.format(
                                new Date(record.releasedAt),
                              )}
                            </time>
                          </dd>
                        </div>

                        <div>
                          <dt className="font-semibold text-slate-800">
                            Effective
                          </dt>
                          <dd className="mt-1 text-slate-600">
                            <time dateTime={record.effectiveAt}>
                              {dateFormatter.format(
                                new Date(record.effectiveAt),
                              )}
                            </time>
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          aria-label={`Quick view: ${record.title}`}
                          onClick={(event) => {
                            event.currentTarget.focus()
                            setPreviewRecordId(record.recordId)
                          }}
                          className="inline-flex rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white hover:bg-green-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
                        >
                          Quick view
                        </button>

                        <Link
                          to={`/records/${encodeURIComponent(record.recordId)}`}
                          aria-label={`View ${record.title}`}
                          className="inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
                        >
                          View record
                        </Link>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {previewRecordId !== null && (
        <RecordDetailsModal
          key={previewRecordId}
          recordId={previewRecordId}
          onClose={() => setPreviewRecordId(null)}
        />
      )}
    </section>
  )
}
