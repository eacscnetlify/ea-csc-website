import TurnoverExportPanel from './TurnoverExportPanel'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getOfficerProfile } from '../auth/auth.api'
import type { OfficerProfile } from '../auth/auth.api'
import { useAuth } from '../auth/useAuth'
import { formatManilaDateTime } from '../../lib/dates'
import { getSupabaseClient } from '../../lib/supabase'
import {
  fetchPositionInventory,
  getTurnoverDirectory,
  getTurnoverPackage,
  listTurnoverPackages,
  memoArguments,
  runTurnoverCommand,
  TurnoverError,
} from './turnover.api'
import type {
  InventoryRecord,
  PackageSummary,
  TurnoverMemo,
  TurnoverPackage,
  TurnoverPerson,
} from './turnover.api'

const memoFields = [
  ['ongoing_projects', 'Ongoing projects and pending matters'],
  ['critical_deadlines', 'Critical dates and recurring deadlines'],
  ['official_contacts', 'Official institutional contacts'],
  [
    'operational_lessons',
    'Recurring duties, operational lessons, and guidance',
  ],
  [
    'known_exceptions',
    'Missing records, responsible persons, and follow-up actions',
  ],
] as const

const blankMemo = (position = ''): TurnoverMemo => ({
  position_title: position,
  term_covered: '',
  incoming_officer_id: null,
  ongoing_projects: '',
  critical_deadlines: '',
  official_contacts: '',
  operational_lessons: '',
  known_exceptions: '',
})

function memoFromPackage(pkg: TurnoverPackage): TurnoverMemo {
  return {
    position_title: pkg.position_title,
    term_covered: pkg.term_covered,
    incoming_officer_id: pkg.incoming_officer_id,
    ongoing_projects: pkg.ongoing_projects,
    critical_deadlines: pkg.critical_deadlines,
    official_contacts: pkg.official_contacts,
    operational_lessons: pkg.operational_lessons,
    known_exceptions: pkg.known_exceptions,
  }
}

type Pending = {
  name: string
  args: Record<string, unknown>
  label: string
}

const buttonClass =
  'rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 disabled:opacity-50'

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-400 bg-white p-2 text-sm disabled:bg-slate-100'

export default function TurnoverPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [profile, setProfile] = useState<OfficerProfile | null>(null)
  const [packages, setPackages] = useState<PackageSummary[]>([])
  const [people, setPeople] = useState<TurnoverPerson[]>([])
  const [memo, setMemo] = useState<TurnoverMemo>(blankMemo())
  const [pkg, setPkg] = useState<TurnoverPackage | null>(null)
  const [token, setToken] = useState<{
    id: string
    revision: number
  } | null>(null)
  const [inventory, setInventory] = useState<InventoryRecord[]>([])
  const [exceptions, setExceptions] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('Loading workspace')
  const [retryNeeded, setRetryNeeded] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const [savedMemo, setSavedMemo] = useState(JSON.stringify(blankMemo()))

  const pending = useRef<Pending | null>(null)
  const working = useRef(false)

  const dirty = JSON.stringify(memo) !== savedMemo
  const frozen = Boolean(
    pkg?.outgoing_confirmed_at || (pkg && pkg.status !== 'draft'),
  )
  const owner = !pkg || pkg.outgoing_officer_id === userId
  const canPrepare = Boolean(
    profile?.council_position &&
    profile.functional_roles.some((role) =>
      ['author', 'custodian', 'publisher'].includes(role),
    ),
  )
  const blocked = Boolean(busy) || retryNeeded

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false

    void Promise.all([
      getOfficerProfile(userId, controller.signal),
      listTurnoverPackages(),
      getTurnoverDirectory(),
    ])
      .then(([officer, items, directory]) => {
        if (disposed) return

        setProfile(officer)
        setPackages(items)
        setPeople(directory)

        const initial = blankMemo(officer?.council_position ?? '')
        setSavedMemo(JSON.stringify(initial))
        setMemo(initial)
      })
      .catch((failure: unknown) => {
        if (!disposed) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Workspace loading failed.',
          )
        }
      })
      .finally(() => {
        if (!disposed) setBusy('')
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [userId])

  function applyPackage(detail: TurnoverPackage, rows: InventoryRecord[]) {
    const next = memoFromPackage(detail)

    setSavedMemo(JSON.stringify(next))
    setMemo(next)
    setPkg(detail)
    setToken({
      id: detail.package_id,
      revision: detail.revision_counter,
    })
    setInventory(rows)
    setNeedsReload(false)
    setExceptions('')
  }

  async function readPackage(id: string) {
    const detail = await getTurnoverPackage(id)
    const rows = detail.outgoing_confirmed_at
      ? detail.inventory_snapshot
      : await fetchPositionInventory(detail.position_title)

    applyPackage(detail, rows)
  }

  async function openPackage(id: string) {
    if (working.current || blocked) return

    if (
      dirty &&
      !window.confirm(
        'Discard unsaved form changes and open the saved package?',
      )
    ) {
      return
    }

    working.current = true
    setBusy('Opening package')
    setError('')

    try {
      await readPackage(id)
      setNotice('Saved package opened.')
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not open package.',
      )
    } finally {
      working.current = false
      setBusy('')
    }
  }

  async function refreshLists() {
    if (working.current || blocked) return

    working.current = true
    setBusy('Refreshing lists')
    setError('')

    try {
      const [items, directory] = await Promise.all([
        listTurnoverPackages(),
        getTurnoverDirectory(),
      ])

      setPackages(items)
      setPeople(directory)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Refresh failed.')
    } finally {
      working.current = false
      setBusy('')
    }
  }

  function newDraft() {
    if (blocked || !canPrepare) return

    if (
      dirty &&
      !window.confirm('Discard unsaved changes and start a new package?')
    ) {
      return
    }

    const next = blankMemo(profile?.council_position ?? '')

    setSavedMemo(JSON.stringify(next))
    setMemo(next)
    setPkg(null)
    setToken(null)
    setInventory([])
    setNeedsReload(false)
    setExceptions('')
    setError('')
    setNotice('New Draft for your assigned position.')
  }

  async function executePending() {
    const task = pending.current
    if (!task || working.current) return

    working.current = true
    setBusy(task.label)
    setError('')
    setNotice('')

    try {
      const result = await runTurnoverCommand(task.name, task.args)

      pending.current = null
      setRetryNeeded(false)
      setToken({
        id: result.package_id,
        revision: result.revision_counter,
      })
      setNeedsReload(true)
      setNotice(`${task.label} completed. Revision ${result.revision_counter}.`)

      try {
        await readPackage(result.package_id)
        setPackages(await listTurnoverPackages())
      } catch {
        setError(
          'The operation succeeded, but refreshing failed. Use Reload saved package; do not repeat the operation.',
        )
      }
    } catch (failure) {
      const uncertain =
        !(failure instanceof TurnoverError) ||
        failure.status === 0 ||
        failure.status >= 500

      if (!uncertain) pending.current = null
      setRetryNeeded(uncertain)

      setError(
        failure instanceof TurnoverError && failure.code === 'PT409'
          ? 'Conflict: a newer revision exists. Your typed work is preserved. Copy it before reloading the saved package.'
          : failure instanceof Error
            ? failure.message
            : 'Request failed.',
      )
    } finally {
      working.current = false
      setBusy('')
    }
  }

  function submit(name: string, args: Record<string, unknown>, label: string) {
    if (blocked || working.current) return

    pending.current = {
      name,
      args: {
        ...args,
        p_request_id: crypto.randomUUID(),
      },
      label,
    }

    void executePending()
  }

  function saveMemo() {
    submit(
      'eacsc_save_turnover_package_v2',
      {
        ...memoArguments(memo),
        p_package_id: token?.id ?? null,
        p_expected_revision: token?.revision ?? 0,
      },
      'Save memorandum',
    )
  }

  async function deletePackage(packageId: string) {
    if (blocked) return
    if (
      !window.confirm(
        'Delete this turnover package? This cannot be undone.',
      )
    ) {
      return
    }
    setBusy('Deleting package')
    setError('')
    setNotice('')
    try {
      const { error: rpcError } = await getSupabaseClient().rpc(
        'eacsc_delete_turnover_package',
        { p_package_id: packageId },
      )
      if (rpcError) throw new Error(rpcError.message)
      if (token?.id === packageId) {
        setPkg(null)
        setToken(null)
        setMemo(blankMemo(profile?.council_position ?? ''))
      }
      setPackages(await listTurnoverPackages())
      setNotice('Turnover package deleted.')
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not delete turnover package.',
      )
    } finally {
      setBusy('')
    }
  }

  async function copyEdits() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(memo, null, 2))
      setNotice('Your form text was copied.')
    } catch {
      setError(
        'Clipboard unavailable. Select and copy your form text manually before reloading.',
      )
    }
  }

  return (
    <section aria-labelledby="turnover-heading" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="turnover-heading" className="text-3xl font-bold">
            Position turnover and continuity
          </h1>
          <p className="mt-2 text-slate-600">
            Prepare a memo, confirm its inventory, transfer access, and
            acknowledge receipt.
          </p>
        </div>

        <Link to="/officer" className={buttonClass}>
          Back to workspace
        </Link>
      </div>

      {busy && <p role="status">{busy}…</p>}

      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3">
          {error}
        </p>
      )}

      {retryNeeded && (
        <div className="space-y-2 rounded-lg border border-amber-300 p-3">
          <p>
            The server result is uncertain. Retry the same request before
            changing the form.
          </p>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void executePending()}
            className={buttonClass}
          >
            Retry last request
          </button>
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-bold">Saved packages</h2>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={blocked}
            onClick={() => void refreshLists()}
            className={buttonClass}
          >
            Refresh package list
          </button>

          <button
            type="button"
            disabled={blocked || !canPrepare}
            onClick={newDraft}
            className={buttonClass}
          >
            New package for my position
          </button>
        </div>

        {!packages.length && (
          <p className="text-sm text-slate-600">
            No packages are available to this account.
          </p>
        )}

        {packages.map((item) => (
          <div
            key={item.package_id}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"
          >
            <div>
              <p className="font-semibold">
                {item.position_title} — {item.term_covered}
              </p>
              <p className="text-sm text-slate-600">
                {item.status} · revision {item.revision_counter} ·{' '}
                {formatManilaDateTime(item.updated_at)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={blocked}
                onClick={() => void openPackage(item.package_id)}
                className={buttonClass}
              >
                Open package
              </button>
              {item.outgoing_officer_id === userId &&
                item.status === 'draft' &&
                !item.access_transferred_at && (
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => void deletePackage(item.package_id)}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                  >
                    Delete package
                  </button>
                )}
            </div>
          </div>
        ))}

        <p className="text-sm text-slate-600">
          Incoming officers can open package contents after administrative
          access transfer.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-bold">
          Institutional Continuity Memorandum
        </h2>

        <p className="text-sm text-slate-600">
          {token
            ? `Package ${token.id} · revision ${token.revision}`
            : 'New unsaved package'}
        </p>

        <fieldset
          disabled={blocked || needsReload || frozen || !owner || !canPrepare}
          className="space-y-4"
        >
          <label className="block text-sm font-semibold">
            Position
            <input
              readOnly
              value={memo.position_title}
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-semibold">
            Term covered
            <input
              maxLength={120}
              value={memo.term_covered}
              onChange={(event) =>
                setMemo({
                  ...memo,
                  term_covered: event.target.value,
                })
              }
              className={inputClass}
              placeholder="e.g. Academic Year 2026–2027"
            />
          </label>

          <label className="block text-sm font-semibold">
            Designated incoming officer
            <select
              value={memo.incoming_officer_id ?? ''}
              onChange={(event) => {
                const nextId = event.target.value || null
                const isTechAdmin = Boolean(
                  profile?.functional_roles.includes('technical_admin'),
                )
                const selectedPerson = nextId
                  ? people.find((p) => p.user_id === nextId)
                  : undefined
                const nextPosition =
                  isTechAdmin && selectedPerson?.council_position
                    ? selectedPerson.council_position
                    : isTechAdmin
                      ? (profile?.council_position ?? memo.position_title)
                      : memo.position_title

                setMemo({
                  ...memo,
                  incoming_officer_id: nextId,
                  position_title: nextPosition,
                })

                if (isTechAdmin && nextPosition) {
                  void fetchPositionInventory(nextPosition)
                    .then((items) => setInventory(items))
                    .catch(() => {})
                }
              }}
              className={inputClass}
            >
              <option value="">Not designated yet</option>

              {people
                .filter(
                  (person) =>
                    person.user_id !== userId ||
                    person.user_id === memo.incoming_officer_id,
                )
                .map((person) => (
                  <option key={person.user_id} value={person.user_id}>
                    {person.full_name} —{' '}
                    {person.council_position ?? 'No position'}
                  </option>
                ))}

              {memo.incoming_officer_id &&
                !people.some(
                  (person) => person.user_id === memo.incoming_officer_id,
                ) && (
                  <option value={memo.incoming_officer_id}>
                    Previously designated account (currently unavailable)
                  </option>
                )}
            </select>
          </label>

          {memoFields.map(([key, label]) => (
            <label key={key} className="block text-sm font-semibold">
              {label}
              <textarea
                rows={3}
                maxLength={20000}
                value={memo[key]}
                onChange={(event) =>
                  setMemo({
                    ...memo,
                    [key]: event.target.value,
                  })
                }
                className={inputClass}
              />
            </label>
          ))}

          <button
            type="button"
            disabled={!memo.term_covered.trim()}
            onClick={saveMemo}
            className={buttonClass}
          >
            Save memorandum
          </button>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyEdits()}
            className={buttonClass}
          >
            Copy my form text
          </button>

          {token && (
            <button
              type="button"
              disabled={blocked}
              onClick={() => void openPackage(token.id)}
              className={buttonClass}
            >
              Reload saved package
            </button>
          )}
        </div>

        {frozen && (
          <p className="text-sm text-slate-600">
            Outgoing confirmation freezes this memo. Corrections require a new
            package.
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-bold">
          {pkg?.outgoing_confirmed_at
            ? 'Confirmed inventory snapshot'
            : 'Permitted position inventory'}{' '}
          ({inventory.length})
        </h2>

        {!token && (
          <p>
            Save the memorandum first to load the permitted inventory for your
            exact position.
          </p>
        )}

        {token && !inventory.length && (
          <p>
            No permitted records found. Check the exact custodian position and
            your record assignments.
          </p>
        )}

        {inventory.map((record) => (
          <article
            key={record.record_id}
            className="border-t border-slate-100 pt-3"
          >
            <p className="font-semibold">{record.title}</p>
            <p className="text-sm">
              {record.record_id} · {record.access_class} · latest permitted
              state: {record.current_state}
            </p>
            <p className="text-sm text-slate-600">
              Versions:{' '}
              {record.versions
                .map(
                  (version) => `${version.version_number} (${version.state})`,
                )
                .join(', ') || 'No permitted version'}
            </p>
          </article>
        ))}
      </div>

      {pkg && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-xl font-bold">Confirmation and acknowledgment</h2>

          <p>
            Outgoing confirmation:{' '}
            {pkg.outgoing_confirmed_at
              ? formatManilaDateTime(pkg.outgoing_confirmed_at)
              : 'Pending'}
          </p>

          <p>
            Access transfer:{' '}
            {pkg.access_transferred_at
              ? formatManilaDateTime(pkg.access_transferred_at)
              : 'Pending'}
          </p>

          {owner && !frozen && (
            <button
              type="button"
              disabled={
                blocked ||
                needsReload ||
                dirty ||
                !memo.incoming_officer_id ||
                !inventory.length
              }
              className={buttonClass}
              onClick={() => {
                if (
                  window.confirm(
                    'Freeze the saved memo and inventory for handover? Further corrections require a new package.',
                  )
                ) {
                  submit(
                    'eacsc_confirm_turnover_outgoing',
                    {
                      p_package_id: pkg.package_id,
                      p_expected_revision: pkg.revision_counter,
                    },
                    'Confirm outgoing package',
                  )
                }
              }}
            >
              Confirm outgoing package
            </button>
          )}

          {pkg.incoming_officer_id === userId &&
            pkg.access_transferred_at &&
            pkg.status === 'draft' && (
              <div className="space-y-3">
                <p>
                  Review the memo and verify that you can retrieve the required
                  records in your officer workspace before acknowledging
                  receipt.
                </p>

                <label className="block text-sm font-semibold">
                  Receipt exceptions and follow-up
                  <textarea
                    disabled={blocked}
                    rows={3}
                    maxLength={20000}
                    value={exceptions}
                    onChange={(event) => setExceptions(event.target.value)}
                    className={inputClass}
                  />
                </label>

                <button
                  type="button"
                  disabled={blocked || needsReload}
                  className={buttonClass}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Confirm that you reviewed this package and checked required record access?',
                      )
                    ) {
                      submit(
                        'eacsc_sign_turnover_acknowledgment_v2',
                        {
                          p_package_id: pkg.package_id,
                          p_expected_revision: pkg.revision_counter,
                          p_exceptions_summary: exceptions,
                        },
                        'Acknowledge receipt',
                      )
                    }
                  }}
                >
                  Acknowledge receipt
                </button>
              </div>
            )}

          {pkg.acknowledgments.map((ack) => (
            <div key={ack.ack_id} className="rounded-lg bg-emerald-50 p-3">
              <p>
                Receipt recorded: {formatManilaDateTime(ack.acknowledged_at)}
              </p>
              <p className="whitespace-pre-wrap">
                {ack.exceptions_summary || 'No receipt exceptions recorded.'}
              </p>
            </div>
          ))}
        </div>
      )}

      {token && !blocked && !needsReload && (
        <TurnoverExportPanel
          key={`${userId}:${token.id}`}
          packageId={token.id}
        />
      )}
    </section>
  )
}
