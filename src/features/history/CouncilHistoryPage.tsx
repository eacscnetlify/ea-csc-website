import { useCallback, useEffect, useState } from 'react'
import { formatManilaDateTime } from '../../lib/dates'
import { getSupabaseClient } from '../../lib/supabase'

interface AuditEventItem {
  event_id: number
  record_id: string | null
  record_title: string | null
  version_id: string | null
  actor_user_id: string
  actor_name: string
  actor_position: string | null
  action_type: string
  action_summary: string
  server_occurred_at: string
}

export default function CouncilHistoryPage() {
  const [events, setEvents] = useState<AuditEventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterText, setFilterText] = useState('')
  const [actionFilter, setActionFilter] = useState('all')

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: rpcErr } = await getSupabaseClient().rpc(
        'eacsc_list_global_audit_history',
        { p_limit: 150 },
      )
      if (rpcErr || !Array.isArray(data)) {
        setError(rpcErr?.message || 'Could not load global audit history.')
        setEvents([])
      } else {
        setEvents(data as AuditEventItem[])
      }
    } catch {
      setError('Could not load global audit history.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const filtered = events.filter((ev) => {
    const matchesAction =
      actionFilter === 'all' ||
      ev.action_type.toLowerCase().includes(actionFilter)
    const q = filterText.trim().toLowerCase()
    const matchesSearch =
      !q ||
      ev.action_summary.toLowerCase().includes(q) ||
      ev.actor_name.toLowerCase().includes(q) ||
      (ev.record_id ?? '').toLowerCase().includes(q) ||
      (ev.record_title ?? '').toLowerCase().includes(q)
    return matchesAction && matchesSearch
  })

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-rose-800">
            Council Audit Trail
          </p>
          <h1 className="text-2xl font-bold text-slate-900">
            Council Activity & History
          </h1>
          <p className="text-sm text-slate-600">
            Chronological log of all document creations, draft uploads, peer reviews, approvals, releases, and role changes.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadHistory()}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh History
        </button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <input
          type="search"
          placeholder="Search by officer, document ID, or summary…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="flex-1 min-w-[220px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-rose-700 focus:outline-none"
        />
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700"
        >
          <option value="all">All Event Types</option>
          <option value="document">Documents & Folders</option>
          <option value="version">Drafts & Approvals</option>
          <option value="release">Releases & Withdrawals</option>
          <option value="bulletin">Bulletins</option>
          <option value="role_request">Role Applications</option>
        </select>
      </div>

      {loading && (
        <p role="status" className="text-sm text-slate-600">
          Loading council audit timeline…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
          {error}
        </p>
      )}

      {!loading && !error && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No matching audit events found.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((ev) => (
                <li
                  key={ev.event_id}
                  className="p-4 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
                          {ev.action_type}
                        </span>
                        {ev.record_id && (
                          <span className="rounded bg-rose-50 px-2 py-0.5 font-mono text-xs font-semibold text-rose-900 border border-rose-200">
                            {ev.record_id}
                          </span>
                        )}
                        {ev.record_title && (
                          <span className="text-xs font-medium text-slate-600">
                            {ev.record_title}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-900">
                        {ev.action_summary}
                      </p>
                      <p className="text-xs text-slate-500">
                        By <strong>{ev.actor_name}</strong>
                        {ev.actor_position ? ` (${ev.actor_position})` : ''}
                      </p>
                    </div>

                    <time className="text-xs font-medium text-slate-500 whitespace-nowrap">
                      {formatManilaDateTime(ev.server_occurred_at)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
