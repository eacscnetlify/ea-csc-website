import { useEffect, useState } from 'react'
import { formatManilaDateTime } from '../../lib/dates'
import { getSupabaseClient } from '../../lib/supabase'

interface AuditEntry {
  eventUuid: string
  versionId: string | null
  actorName: string
  actorPosition: string
  actionType: string
  actionSummary: string
  previousRevision: number | null
  newRevision: number | null
  serverOccurredAt: string
}

type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: AuditEntry[] }

export default function HistoryPanel({ recordId }: { recordId: string }) {
  const [state, setState] = useState<HistoryState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10_000)

    async function load() {
      try {
        const { data, error } = await getSupabaseClient()
          .rpc('eacsc_get_record_audit_history', { p_record_id: recordId })
          .abortSignal(controller.signal)

        if (disposed) return
        if (error || !Array.isArray(data)) {
          setState({ status: 'error' })
          return
        }
        const entries: AuditEntry[] = (data as Record<string, unknown>[]).map(
          (row) => ({
            eventUuid: String(row.event_uuid),
            versionId:
              typeof row.version_id === 'string' ? row.version_id : null,
            actorName: String(row.actor_name),
            actorPosition: String(row.actor_position),
            actionType: String(row.action_type),
            actionSummary: String(row.action_summary),
            previousRevision:
              typeof row.previous_revision === 'number'
                ? row.previous_revision
                : null,
            newRevision:
              typeof row.new_revision === 'number' ? row.new_revision : null,
            serverOccurredAt: String(row.server_occurred_at),
          }),
        )
        setState({ status: 'ready', entries })
      } catch {
        if (!disposed) setState({ status: 'error' })
      } finally {
        window.clearTimeout(timer)
      }
    }

    void load()

    return () => {
      disposed = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [recordId, attempt])

  return (
    <section
      aria-label="Immutable audit history"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-bold">Audit history</h3>
        <span className="text-xs font-semibold text-slate-500">
          Authoritative server time (PST / UTC+8)
        </span>
      </div>

      {state.status === 'loading' && (
        <p role="status" className="text-sm text-slate-600">
          Loading audit timeline…
        </p>
      )}

      {state.status === 'error' && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-amber-900">
            Audit history could not be loaded.
          </p>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' })
              setAttempt((n) => n + 1)
            }}
            className="rounded-lg border border-emerald-800 px-3 py-1 text-sm font-semibold"
          >
            Retry history
          </button>
        </div>
      )}

      {state.status === 'ready' &&
        (state.entries.length === 0 ? (
          <p className="text-sm text-slate-600">
            No audit events recorded for this record yet.
          </p>
        ) : (
          <ol className="list-none space-y-3 p-0">
            {state.entries.map((entry) => (
              <li
                key={entry.eventUuid}
                className="space-y-1 border-l-4 border-emerald-700 pl-4 text-sm"
              >
                <p className="font-semibold text-slate-900">
                  {entry.actionSummary}
                </p>
                <p className="text-xs text-slate-600">
                  {entry.actorName} ({entry.actorPosition}) ·{' '}
                  <span className="font-mono">{entry.actionType}</span>
                  {entry.previousRevision !== null && entry.newRevision !== null
                    ? ` · rev ${entry.previousRevision} → ${entry.newRevision}`
                    : ''}
                </p>
                <time
                  dateTime={entry.serverOccurredAt}
                  className="block text-xs text-slate-500"
                >
                  {formatManilaDateTime(entry.serverOccurredAt)}
                </time>
              </li>
            ))}
          </ol>
        ))}
    </section>
  )
}
