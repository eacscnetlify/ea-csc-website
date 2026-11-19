import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'
import { getOfficerProfile } from '../auth/auth.api'
import { useAuth } from '../auth/useAuth'
import { formatManilaDateTime } from '../../lib/dates'
import {
  getTurnoverDirectory,
  listTurnoverPackages,
  runTurnoverCommand,
  TurnoverError,
} from '../turnover/turnover.api'
import type { PackageSummary, TurnoverPerson } from '../turnover/turnover.api'

type AdminData = {
  allowed: boolean
  packages: PackageSummary[]
  people: TurnoverPerson[]
}

type TransferRequest = {
  args: Record<string, unknown>
  position: string
}

const buttonClass =
  'rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50'

async function loadAdminData(
  userId: string,
  signal: AbortSignal,
): Promise<AdminData> {
  const profile = await getOfficerProfile(userId, signal)
  const isTechAdmin =
    Boolean(profile?.is_active) &&
    Boolean(profile?.functional_roles.includes('technical_admin'))

  if (!profile?.is_active) {
    return {
      allowed: false,
      packages: [],
      people: [],
    }
  }

  const [packages, people] = await Promise.all([
    listTurnoverPackages().catch(() => [] as PackageSummary[]),
    getTurnoverDirectory().catch(() => [] as TurnoverPerson[]),
  ])

  return {
    allowed: isTechAdmin,
    packages,
    people,
  }
}

export default function AccessPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [data, setData] = useState<AdminData | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [acceptedKey, setAcceptedKey] = useState('')
  const [busy, setBusy] = useState(true)
  const [retryNeeded, setRetryNeeded] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const working = useRef(false)
  const pending = useRef<TransferRequest | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false

    void loadAdminData(userId, controller.signal)
      .then((result) => {
        if (!disposed) setData(result)
      })
      .catch((failure: unknown) => {
        if (!disposed) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not load administrative access.',
          )
        }
      })
      .finally(() => {
        if (!disposed) setBusy(false)
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [userId])

  useEffect(() => {
    if (!retryNeeded) return

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warn)

    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  }, [retryNeeded])

  const selected = data?.packages.find((item) => item.package_id === selectedId)

  const reviewKey = selected
    ? [
        selected.package_id,
        selected.revision_counter,
        selected.outgoing_profile_revision,
        selected.incoming_profile_revision,
      ].join(':')
    : ''

  const ready = Boolean(
    data?.allowed &&
    selected &&
    selected.status === 'draft' &&
    selected.outgoing_confirmed_at &&
    !selected.access_transferred_at &&
    selected.incoming_officer_id &&
    selected.incoming_profile_revision &&
    selected.outgoing_officer_id !== userId &&
    selected.incoming_officer_id !== userId,
  )

  function personName(id: string | null) {
    if (!id) return 'Not designated'

    return data?.people.find((person) => person.user_id === id)?.full_name ?? id
  }

  async function refresh() {
    if (working.current || busy || retryNeeded) return

    working.current = true
    setBusy(true)
    setError('')
    setAcceptedKey('')

    try {
      const result = await loadAdminData(userId, new AbortController().signal)

      setData(result)
      setNeedsRefresh(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Refresh failed.')
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  async function executeTransfer() {
    const task = pending.current

    if (!task || working.current) return

    working.current = true
    setBusy(true)
    setError('')
    setNotice('')

    try {
      const result = await runTurnoverCommand(
        'eacsc_transfer_position_role_v2',
        task.args,
      )

      pending.current = null
      setRetryNeeded(false)
      setAcceptedKey('')
      setNeedsRefresh(true)

      setNotice(
        `Access transferred for ${task.position}. Package revision ${result.revision_counter}. The incoming officer must now review the package and acknowledge receipt.`,
      )

      try {
        const fresh = await loadAdminData(userId, new AbortController().signal)

        setData(fresh)
        setNeedsRefresh(false)
      } catch {
        setError(
          'Transfer succeeded, but refreshing failed. Use Refresh access data; do not create another transfer request.',
        )
      }
    } catch (failure) {
      const uncertain =
        !(failure instanceof TurnoverError) ||
        failure.status === 0 ||
        failure.status >= 500

      if (!uncertain) pending.current = null

      setRetryNeeded(uncertain)
      setAcceptedKey('')

      if (!uncertain) setNeedsRefresh(true)

      setError(
        failure instanceof TurnoverError && failure.code === 'PT409'
          ? 'The package, profile, or assignment changed. Refresh access data and review it again before transferring.'
          : failure instanceof Error
            ? failure.message
            : 'Transfer failed.',
      )
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  function startTransfer() {
    if (
      !selected ||
      !ready ||
      busy ||
      retryNeeded ||
      needsRefresh ||
      working.current ||
      acceptedKey !== reviewKey
    ) {
      return
    }

    pending.current = {
      position: selected.position_title,
      args: {
        p_package_id: selected.package_id,
        p_expected_revision: selected.revision_counter,
        p_expected_outgoing_revision: selected.outgoing_profile_revision,
        p_expected_incoming_revision: selected.incoming_profile_revision,
        p_request_id: crypto.randomUUID(),
      },
    }

    void executeTransfer()
  }

  return (
    <section aria-labelledby="admin-access-heading" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="admin-access-heading" className="text-3xl font-bold">
            Administrative access transfer
          </h1>

          <p className="mt-2 text-slate-600">
            Transfer the existing assignments in a confirmed position package.
          </p>
        </div>

        <Link to="/officer/turnover" className={buttonClass}>
          Turnover workspace
        </Link>
      </div>

      {busy && (
        <p role="status">Checking access and loading package information…</p>
      )}

      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 p-4">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 p-4">
          {error}
        </p>
      )}

      {retryNeeded && (
        <div className="space-y-3 rounded-lg border border-amber-300 p-4">
          <p>
            The server result is uncertain. Keep this page open and retry the
            same request.
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={() => void executeTransfer()}
            className={buttonClass}
          >
            Retry same transfer request
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={busy || retryNeeded}
        onClick={() => void refresh()}
        className={buttonClass}
      >
        Refresh access data
      </button>

      {data && !data.allowed && (
        <p className="rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-700">
          Administrative transfer execution requires an active Technical Administrator. If you are an incoming officer, any package transferred to you appears below for one-click acceptance.
        </p>
      )}

      {/* Incoming Officer Package Receipt (One-click Accept & Acknowledge) */}
      {data &&
        data.packages.filter(
          (p) =>
            p.incoming_officer_id === userId &&
            p.access_transferred_at &&
            p.status === 'draft',
        ).length > 0 && (
          <div className="space-y-4 rounded-xl border border-emerald-300 bg-emerald-50/70 p-5">
            <h2 className="text-xl font-bold text-emerald-950">
              Incoming Officer Package Receipt
            </h2>
            <p className="text-sm text-emerald-900">
              Review your transferred handover package below. Clicking{' '}
              <strong>Accept &amp; Acknowledge Package</strong> confirms your
              takeover, activates your term, retires the outgoing officer, and
              marks this transfer as <strong>Done</strong>.
            </p>
            <div className="space-y-3">
              {data.packages
                .filter(
                  (p) =>
                    p.incoming_officer_id === userId &&
                    p.access_transferred_at &&
                    p.status === 'draft',
                )
                .map((pkg) => {
                  const outgoing = data.people.find(
                    (person) => person.user_id === pkg.outgoing_officer_id,
                  )
                  return (
                    <div
                      key={pkg.package_id}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-white p-4"
                    >
                      <div className="space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900">
                            {pkg.position_title}
                          </span>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                            PENDING TAKEOVER - INCOMING
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          Term: {pkg.term_covered} · Outgoing:{' '}
                          {outgoing ? outgoing.full_name : 'Outgoing Officer'}{' '}
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                            OUTGOING
                          </span>
                        </p>
                        <p className="text-xs text-slate-500">
                          Transferred:{' '}
                          {formatManilaDateTime(pkg.access_transferred_at ?? '')}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true)
                          setError('')
                          setNotice('')
                          try {
                            const { error: ackErr } =
                              await getSupabaseClient().rpc(
                                'eacsc_complete_turnover_acknowledgment',
                                { p_package_id: pkg.package_id },
                              )
                            if (ackErr) throw new Error(ackErr.message)
                            setNotice(
                              `Package for ${pkg.position_title} accepted & acknowledged. Handover is now Done!`,
                            )
                            await refresh()
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : 'Could not acknowledge package.',
                            )
                          } finally {
                            setBusy(false)
                          }
                        }}
                        className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
                      >
                        Accept &amp; Acknowledge Package
                      </button>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

      {data?.allowed && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-xl font-bold">Select a position package</h2>

          <p className="text-sm text-slate-600">
            This page shows package identity and transfer status. The officers
            retain access to the memorandum and its records.
          </p>

          <label className="block text-sm font-semibold">
            Saved package
            <select
              value={selectedId}
              disabled={busy || retryNeeded}
              onChange={(event) => {
                setSelectedId(event.target.value)
                setAcceptedKey('')
                setError('')
                setNotice('')
              }}
              className="mt-2 w-full rounded-lg border border-slate-400 bg-white p-3"
            >
              <option value="">Choose a package</option>

              {data.packages
                .filter((item) => item.status === 'draft')
                .map((item) => (
                  <option key={item.package_id} value={item.package_id}>
                    {item.position_title} — {item.term_covered} —{' '}
                    {item.access_transferred_at
                      ? 'access transferred'
                      : item.outgoing_confirmed_at
                        ? 'confirmed'
                        : 'awaiting outgoing confirmation'}
                  </option>
                ))}
            </select>
          </label>

          {!data.packages.length && <p>No packages are available.</p>}

          {selected && (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-semibold">Package</dt>
                  <dd className="break-all">{selected.package_id}</dd>
                </div>

                <div>
                  <dt className="font-semibold">Position</dt>
                  <dd>{selected.position_title}</dd>
                </div>

                <div>
                  <dt className="font-semibold">Outgoing officer</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <span>{personName(selected.outgoing_officer_id)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                      {selected.access_transferred_at ? 'Transferred - Outgoing' : 'Active - Outgoing'}
                    </span>
                  </dd>
                </div>

                <div>
                  <dt className="font-semibold">Incoming officer</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <span>{personName(selected.incoming_officer_id)}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                      {selected.access_transferred_at ? 'Pending Acknowledgment - Incoming' : 'Pending Takeover - Incoming'}
                    </span>
                  </dd>
                </div>

                <div>
                  <dt className="font-semibold">Package revision</dt>
                  <dd>{selected.revision_counter}</dd>
                </div>

                <div>
                  <dt className="font-semibold">Outgoing confirmation</dt>
                  <dd>
                    {selected.outgoing_confirmed_at
                      ? formatManilaDateTime(selected.outgoing_confirmed_at)
                      : 'Pending'}
                  </dd>
                </div>

                <div>
                  <dt className="font-semibold">Access transfer</dt>
                  <dd>
                    {selected.access_transferred_at
                      ? formatManilaDateTime(selected.access_transferred_at)
                      : 'Pending'}
                  </dd>
                </div>
              </dl>

              {!selected.outgoing_confirmed_at && (
                <p className="text-amber-900">
                  The outgoing officer must confirm this package before access
                  can be transferred.
                </p>
              )}

              {selected.access_transferred_at && (
                <p className="text-emerald-900">
                  Access has already been transferred. The incoming officer
                  completes receipt in the Turnover workspace.
                </p>
              )}

              {ready && (
                <label className="flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-sm">
                  <input
                    type="checkbox"
                    disabled={busy || retryNeeded || needsRefresh}
                    checked={acceptedKey === reviewKey}
                    onChange={(event) =>
                      setAcceptedKey(event.target.checked ? reviewKey : '')
                    }
                    className="mt-1"
                  />

                  <span>
                    I checked the outgoing and incoming identities. This
                    transfers the confirmed existing assignments and deactivates
                    the outgoing officer&apos;s operational profile. Historical
                    records remain preserved.
                  </span>
                </label>
              )}

              <button
                type="button"
                disabled={
                  !ready ||
                  busy ||
                  retryNeeded ||
                  needsRefresh ||
                  acceptedKey !== reviewKey
                }
                onClick={startTransfer}
                className={buttonClass}
              >
                Transfer confirmed position access
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
