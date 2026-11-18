import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import { RECORD_CATEGORIES } from '../records/records.types'
import { WorkspaceError } from '../workspace/workspace.api'
import {
  createPublishAttempt,
  findPublishAttempt,
  forgetPublishAttempt,
  getPublisherWorkspace,
  sendPublishAttempt,
  withdrawRelease,
} from './publication.commands'
import type { PublisherRecordItem } from './publication.commands'

const button =
  'rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'

function RecordReleaseCard({
  userId,
  item,
  onDone,
  onReload,
}: {
  userId: string
  item: PublisherRecordItem
  onDone: (message: string) => void
  onReload: () => void
}) {
  const { record, approvedVersions, activeRelease } = item
  const unreleased = approvedVersions.filter(
    (v) => !activeRelease || v.versionId !== activeRelease.versionId,
  )

  const [selectedId, setSelectedId] = useState(unreleased[0]?.versionId ?? '')
  const [audience, setAudience] = useState<'public' | 'internal'>(
    record.accessClass === 'public' ? 'public' : 'internal',
  )
  const [publicTitle, setPublicTitle] = useState(record.title)
  const [publicCategory, setPublicCategory] = useState(record.category)
  const [authBasis, setAuthBasis] = useState('')
  const [authRef, setAuthRef] = useState('')
  const [effectiveAt, setEffectiveAt] = useState('')
  const [withdrawReason, setWithdrawReason] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [error, setError] = useState('')
  const [, redraw] = useState(0)

  const mounted = useRef(false)
  const busy = useRef(false)
  const id = useId()
  const attempt = findPublishAttempt(userId, record.recordId)
  const selected =
    unreleased.find((v) => v.versionId === selectedId) ?? unreleased[0]

  useEffect(() => {
    mounted.current = true
    let disposed = false
    const prior = findPublishAttempt(userId, record.recordId)
    const settled = () => {
      if (!disposed) redraw((n) => n + 1)
    }
    if (prior?.status === 'sending' && prior.promise) {
      void prior.promise.then(settled, settled)
    }
    return () => {
      disposed = true
      mounted.current = false
    }
  }, [userId, record.recordId])

  async function publish() {
    if (busy.current || attempt?.status === 'sending' || !selected) return
    busy.current = true
    setError('')
    try {
      const effectiveIso = effectiveAt.trim()
        ? new Date(effectiveAt).toISOString()
        : null
      const entry =
        attempt ??
        createPublishAttempt({
          actorId: userId,
          recordId: record.recordId,
          versionId: selected.versionId,
          versionNumber: selected.versionNumber,
          expectedVersionRevision: selected.revision,
          expectedRecordRevision: record.revision,
          releaseId: crypto.randomUUID(),
          audience,
          publicTitle,
          publicCategory,
          authorizationBasis: authBasis,
          authorizationReference: authRef,
          effectiveFrom: effectiveIso,
          requestId: crypto.randomUUID(),
        })
      const promise = sendPublishAttempt(entry)
      redraw((n) => n + 1)
      const receipt = await promise
      if (mounted.current) {
        forgetPublishAttempt(entry)
        onDone(
          receipt.activeNow
            ? `Published ${record.recordId} Version ${selected.versionNumber} to the public portal.`
            : `Recorded release for ${record.recordId} Version ${selected.versionNumber}.`,
        )
      }
    } catch (failure) {
      if (mounted.current) {
        setError(
          failure instanceof Error ? failure.message : 'Publication failed.',
        )
        redraw((n) => n + 1)
      }
    } finally {
      busy.current = false
    }
  }

  async function handleWithdraw() {
    if (!activeRelease || !withdrawReason.trim() || withdrawing) return
    setWithdrawing(true)
    setError('')
    try {
      await withdrawRelease(
        userId,
        activeRelease.releaseId,
        record.revision,
        withdrawReason,
      )
      onDone(
        `Withdrew active release for ${record.recordId} from public access.`,
      )
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Withdrawal failed.',
      )
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">{record.title}</h2>
          <p className="break-all font-mono text-xs text-slate-600">
            {record.recordId} · Classification: {record.accessClass} · Master
            rev {record.revision}
          </p>
        </div>
      </div>

      {activeRelease && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="font-semibold text-slate-900">
            Current selected release: {activeRelease.publicTitle} (
            {activeRelease.audience})
          </p>
          {activeRelease.withdrawnAt ? (
            <p className="text-amber-900">
              Withdrawn on{' '}
              {new Date(activeRelease.withdrawnAt).toLocaleString('en-PH', {
                timeZone: 'Asia/Manila',
              })}
            </p>
          ) : (
            <div className="space-y-2 pt-1">
              <label
                htmlFor={`${id}-withdraw`}
                className="block text-xs font-semibold text-slate-800"
              >
                Emergency withdrawal reason (PIO / President)
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id={`${id}-withdraw`}
                  type="text"
                  maxLength={1000}
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  placeholder="Reason for urgent withdrawal"
                  className="min-w-60 flex-1 rounded-lg border border-slate-400 bg-white p-2 text-sm"
                />
                <button
                  type="button"
                  disabled={withdrawing || !withdrawReason.trim()}
                  onClick={() => void handleWithdraw()}
                  className="rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {withdrawing ? 'Withdrawing…' : 'Withdraw release'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {attempt ? (
        <div className="space-y-2 rounded-lg border border-emerald-200 p-4 text-sm">
          <p className="font-semibold">
            Publishing Version {attempt.request.versionNumber}…
          </p>
          {(error || attempt.error) && (
            <p role="alert" className="text-amber-950">
              {error || attempt.error?.message}
            </p>
          )}
          {attempt.status === 'uncertain' && (
            <button
              type="button"
              className={button}
              onClick={() => void publish()}
            >
              Retry same request
            </button>
          )}
          {(attempt.status === 'rejected' ||
            attempt.status === 'confirmed') && (
            <button
              type="button"
              className={button}
              onClick={() => {
                forgetPublishAttempt(attempt)
                onReload()
              }}
            >
              Reload release panel
            </button>
          )}
        </div>
      ) : unreleased.length === 0 ? (
        <p className="text-sm text-slate-600">
          No unreleased Approved versions are pending publication for this
          record.
        </p>
      ) : (
        <div className="space-y-4 border-t border-slate-200 pt-4">
          <h3 className="text-base font-bold">Publish an Approved version</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${id}-version`}
                className="block text-sm font-semibold"
              >
                Approved version
              </label>
              <select
                id={`${id}-version`}
                value={selected?.versionId ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
              >
                {unreleased.map((v) => (
                  <option key={v.versionId} value={v.versionId}>
                    Version {v.versionNumber} (rev {v.revision})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={`${id}-audience`}
                className="block text-sm font-semibold"
              >
                Release audience
              </label>
              <select
                id={`${id}-audience`}
                value={audience}
                onChange={(e) =>
                  setAudience(e.target.value as 'public' | 'internal')
                }
                className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
              >
                {record.accessClass === 'public' && (
                  <option value="public">Public (student portal)</option>
                )}
                <option value="internal">Internal council only</option>
              </select>
            </div>

            <div>
              <label
                htmlFor={`${id}-title`}
                className="block text-sm font-semibold"
              >
                Frozen public title
              </label>
              <input
                id={`${id}-title`}
                type="text"
                maxLength={240}
                value={publicTitle}
                onChange={(e) => setPublicTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor={`${id}-category`}
                className="block text-sm font-semibold"
              >
                Public category
              </label>
              <select
                id={`${id}-category`}
                value={publicCategory}
                onChange={(e) => setPublicCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
              >
                {RECORD_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={`${id}-basis`}
                className="block text-sm font-semibold"
              >
                Publication authorization basis
              </label>
              <input
                id={`${id}-basis`}
                type="text"
                value={authBasis}
                onChange={(e) => setAuthBasis(e.target.value)}
                placeholder="e.g., PIO Release Check & Council Approval"
                className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor={`${id}-ref`}
                className="block text-sm font-semibold"
              >
                Authorization reference
              </label>
              <input
                id={`${id}-ref`}
                type="text"
                value={authRef}
                onChange={(e) => setAuthRef(e.target.value)}
                placeholder="e.g., REL-2026-001"
                className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor={`${id}-eff`}
              className="block text-sm font-semibold"
            >
              Effective date/time (optional — leave blank to publish
              immediately)
            </label>
            <input
              id={`${id}-eff`}
              type="datetime-local"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
              className="mt-1 rounded-lg border border-slate-400 p-2 text-sm"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-amber-50 p-3 text-amber-950"
            >
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={
              !publicTitle.trim() || !authBasis.trim() || !authRef.trim()
            }
            onClick={() => void publish()}
            className="rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            Verify release copy &amp; publish
          </button>
        </div>
      )}
    </article>
  )
}

export default function ReleasePanel() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [items, setItems] = useState<PublisherRecordItem[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => {
    setItems(null)
    setError('')
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!userId) return
    let disposed = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10_000)

    void getPublisherWorkspace(userId, controller.signal)
      .then((data) => {
        if (!disposed) setItems(data)
      })
      .catch((failure) => {
        if (!disposed) {
          setError(
            failure instanceof WorkspaceError
              ? failure.message
              : 'Release panel could not be loaded.',
          )
        }
      })
      .finally(() => window.clearTimeout(timer))

    return () => {
      disposed = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [userId, attempt])

  useEffect(() => {
    function onFocus() {
      setAttempt((n) => n + 1)
    }
    window.addEventListener('focus', onFocus)

    const client = getSupabaseClient()
    const channel = client
      .channel('release-panel-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'record_versions' },
        () => setAttempt((n) => n + 1),
      )
      .subscribe()

    return () => {
      window.removeEventListener('focus', onFocus)
      void client.removeChannel(channel)
    }
  }, [])

  return (
    <section aria-labelledby="release-panel-heading" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-800">
            PIO release management
          </p>
          <h1 id="release-panel-heading" className="mt-2 text-3xl font-bold">
            Publication &amp; release panel
          </h1>
          <p className="mt-3 text-slate-700">
            Publish verified Approved <strong>Public</strong> versions to the
            student portal, supersede prior public versions at effective time,
            or withdraw a release in an emergency. Internal and Restricted
            documents are automatically published to the{' '}
            <Link
              to="/officer/library"
              className="font-semibold text-emerald-800 underline"
            >
              Internal Library
            </Link>{' '}
            upon Presidential approval.
          </p>
        </div>
        <Link to="/officer" className={button}>
          Back to workspace
        </Link>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-4 text-emerald-950"
        >
          {notice}
        </p>
      )}

      <div>
        <button type="button" className={button} onClick={reload}>
          Reload release panel
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-5"
        >
          {error}
        </p>
      ) : !items ? (
        <p role="status">Loading publisher records…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold">No public releases pending</h2>
          <p className="mt-2 text-sm text-slate-600">
            There are no <strong>Public</strong> documents assigned to your
            publisher account right now. (Internal and Restricted documents
            auto-publish to the Internal Library on Presidential approval.)
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {items.map((item) => (
            <RecordReleaseCard
              key={`${userId}:${item.record.recordId}:${item.record.revision}`}
              userId={userId}
              item={item}
              onDone={(msg) => {
                setNotice(msg)
                reload()
              }}
              onReload={reload}
            />
          ))}
        </div>
      )}
    </section>
  )
}
