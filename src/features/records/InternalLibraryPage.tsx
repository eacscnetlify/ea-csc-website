import { useEffect, useMemo, useState } from 'react'
import { formatManilaDateTime } from '../../lib/dates'
import { getSupabaseClient } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import VersionFileDownload from './VersionFileDownload'

interface InternalLibraryItem {
  release_id: string
  record_id: string
  version_id: string
  version_number: number
  public_title: string
  public_category: string
  access_class: 'internal' | 'restricted' | string
  released_at: string
  approved_at: string | null
  external_url: string | null
  originating_office: string
  custodian_position: string
}

function ReleaseCard({
  item,
  userId,
}: {
  item: InternalLibraryItem
  userId: string | undefined
}) {
  const isRestricted = item.access_class === 'restricted'

  return (
    <article
      className={`rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
        isRestricted ? 'border-rose-200' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold text-slate-600">
            {item.record_id}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
            Version {item.version_number}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              isRestricted
                ? 'bg-rose-100 text-rose-800'
                : 'bg-sky-100 text-sky-800'
            }`}
          >
            {isRestricted ? 'Restricted' : 'Internal'}
          </span>
        </div>
        <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
          {item.public_category}
        </span>
      </div>

      <h3 className="mt-3 text-base font-semibold text-slate-900">
        {item.public_title}
      </h3>

      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs text-slate-600 sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-slate-700">Originating Office: </dt>
          <dd className="inline">{item.originating_office}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-slate-700">Creator: </dt>
          <dd className="inline">{item.custodian_position}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-slate-700">Released: </dt>
          <dd className="inline">{formatManilaDateTime(item.released_at)}</dd>
        </div>
        {item.approved_at && (
          <div>
            <dt className="inline font-medium text-slate-700">Approved: </dt>
            <dd className="inline">{formatManilaDateTime(item.approved_at)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
        {userId && (
          <div className="[&>div]:mt-0">
            <VersionFileDownload
              userId={userId}
              versionId={item.version_id}
              versionNumber={item.version_number}
            />
          </div>
        )}
        {item.external_url && (
          <a
            href={item.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100"
          >
            <span>Drive / External Link ↗</span>
          </a>
        )}
      </div>
    </article>
  )
}

export default function InternalLibraryPage() {
  const { session } = useAuth()
  const userId = session?.user.id
  const [items, setItems] = useState<InternalLibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('ALL')

  useEffect(() => {
    let active = true

    async function loadInternalLibrary() {
      setLoading(true)
      setError('')
      try {
        const { data, error: rpcError } = await getSupabaseClient().rpc(
          'eacsc_list_internal_library',
        )
        if (!active) return
        if (rpcError || !Array.isArray(data)) {
          setError(
            rpcError?.message || 'Internal library records could not be loaded.',
          )
          setLoading(false)
          return
        }
        setItems(data as InternalLibraryItem[])
        setLoading(false)
      } catch {
        if (active) {
          setError('Internal library records could not be loaded.')
          setLoading(false)
        }
      }
    }

    void loadInternalLibrary()
    return () => {
      active = false
    }
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      if (item.public_category) set.add(item.public_category)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [items])

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      if (
        selectedCategory !== 'ALL' &&
        item.public_category !== selectedCategory
      ) {
        return false
      }
      if (!q) return true
      return (
        item.public_title.toLowerCase().includes(q) ||
        item.record_id.toLowerCase().includes(q) ||
        item.originating_office.toLowerCase().includes(q) ||
        item.custodian_position.toLowerCase().includes(q) ||
        item.public_category.toLowerCase().includes(q)
      )
    })
  }, [items, searchQuery, selectedCategory])

  const internalReleases = useMemo(
    () => filteredItems.filter((item) => item.access_class !== 'restricted'),
    [filteredItems],
  )

  const restrictedReleases = useMemo(
    () => filteredItems.filter((item) => item.access_class === 'restricted'),
    [filteredItems],
  )

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-800">
              Officer-Only Portal
            </span>
            <h2 className="mt-2 text-xl font-bold text-slate-900">
              Internal Council Library
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Published internal council documents and authorized restricted
              records. These releases are never posted on the public student
              portal.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, ID, office, creator…"
              aria-label="Search internal library"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none sm:w-64"
            />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="Filter by category"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none sm:w-52"
            >
              <option value="ALL">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {loading && (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm"
        >
          Loading internal library releases…
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

      {!loading && !error && (
        <>
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                Internal Council Releases ({internalReleases.length})
              </h3>
            </div>

            {internalReleases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
                No published internal documents match your current filters.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {internalReleases.map((item) => (
                  <ReleaseCard
                    key={item.release_id}
                    item={item}
                    userId={userId}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4 rounded-xl border border-rose-200 bg-rose-50/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
                    Restricted Access Section
                  </span>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Restricted Executive &amp; Financial Releases (
                    {restrictedReleases.length})
                  </h3>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Visible only to exempted oversight officers (President,
                  Secretary, Auditor, PRO, Treasurer, Technical Admin) and
                  officers explicitly granted access by the creator.
                </p>
              </div>
            </div>

            {restrictedReleases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-rose-200 bg-white p-6 text-sm text-slate-600">
                No published restricted documents are available for your account
                under the current filters.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {restrictedReleases.map((item) => (
                  <ReleaseCard
                    key={item.release_id}
                    item={item}
                    userId={userId}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
