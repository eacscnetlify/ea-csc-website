import { useEffect, useId, useRef, useState } from 'react'
import type { AssignedVersion } from '../workspace/workspace.api'
import {
  createApprovalAttempt,
  findApprovalAttempt,
  forgetApprovalAttempt,
  sendApprovalAttempt,
} from './approval.commands'
import type {
  ApprovalKind,
  ChecklistKey,
  ChecklistStatus,
  SixPointChecklist,
} from './approval.commands'

const CHECKLIST_ITEMS: {
  key: ChecklistKey
  title: string
  description: string
}[] = [
  {
    key: 'identity_version',
    title: '1. Identity and version accuracy',
    description:
      'Correct activity or document title, record ID, current version, and source identified.',
  },
  {
    key: 'dates_deadlines',
    title: '2. Dates, times, and deadlines',
    description: 'Date, time, deadline, and relevant effective period checked.',
  },
  {
    key: 'location_link',
    title: '3. Location, venue, or online access link',
    description:
      'Physical venue or online link checked; known access instructions included.',
  },
  {
    key: 'audience_requirements',
    title: '4. Target audience and participation requirements',
    description:
      'Eligibility, participation requirements, attached forms, and instructions checked.',
  },
  {
    key: 'authority_disclosure',
    title: '5. Substantive authority and disclosure suitability',
    description:
      'Required substantive approval exists; version matches approval; intended copy checked for restricted details.',
  },
  {
    key: 'contact_reference',
    title: '6. Contact person and official release attribution',
    description:
      'Responsible contact, authoritative link/reference, release date, and any replacement notice included.',
  },
]

function initialChecklist(): SixPointChecklist {
  return {
    identity_version: { status: 'Confirmed', reason: '' },
    dates_deadlines: { status: 'Confirmed', reason: '' },
    location_link: { status: 'Confirmed', reason: '' },
    audience_requirements: { status: 'Confirmed', reason: '' },
    authority_disclosure: { status: 'Confirmed', reason: '' },
    contact_reference: { status: 'Confirmed', reason: '' },
  }
}

export default function VerificationChecklist({
  userId,
  recordId,
  version,
  assignedFunctions,
  onConfirmed,
  onReload,
}: {
  userId: string
  recordId: string
  version: AssignedVersion
  assignedFunctions: string[]
  onConfirmed: () => void
  onReload: () => void
}) {
  const canApprover = assignedFunctions.includes('approver')
  const canCustodian = assignedFunctions.includes('custodian')
  const attempt = findApprovalAttempt(userId, recordId)

  const [checklist, setChecklist] =
    useState<SixPointChecklist>(initialChecklist)
  const [approvalKind, setApprovalKind] = useState<ApprovalKind>(
    canApprover ? 'substantive_approval' : 'custodian_acceptance',
  )
  const [approvingPosition, setApprovingPosition] = useState('')
  const [approvalDate, setApprovalDate] = useState('')
  const [approvalBasis, setApprovalBasis] = useState('')
  const [approvalEvidenceReference, setApprovalEvidenceReference] = useState('')
  const [approvalNotRequiredReason, setApprovalNotRequiredReason] = useState('')
  const [isProvisional, setIsProvisional] = useState(false)
  const [provisionalUncertainty, setProvisionalUncertainty] = useState('')
  const [provisionalUpdateOwner, setProvisionalUpdateOwner] = useState('')
  const [error, setError] = useState('')
  const [, redraw] = useState(0)

  const mounted = useRef(false)
  const busy = useRef(false)
  const id = useId()

  useEffect(() => {
    mounted.current = true
    let disposed = false
    const prior = findApprovalAttempt(userId, recordId)
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
  }, [userId, recordId])

  if (!canApprover && !canCustodian && !attempt) return null

  const hasCorrectionRequired = CHECKLIST_ITEMS.some(
    (item) => checklist[item.key].status === 'Correction Required',
  )
  const missingNotApplicableReason = CHECKLIST_ITEMS.some(
    (item) =>
      checklist[item.key].status === 'Not Applicable' &&
      !checklist[item.key].reason.trim(),
  )

  function updateItem(
    key: ChecklistKey,
    patch: Partial<{ status: ChecklistStatus; reason: string }>,
  ) {
    setChecklist((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }))
    setError('')
  }

  async function submitApproval() {
    if (busy.current || attempt?.status === 'sending') return
    busy.current = true
    setError('')
    try {
      const entry =
        attempt ??
        createApprovalAttempt({
          actorId: userId,
          recordId,
          versionId: version.versionId,
          versionNumber: version.versionNumber,
          expectedRevision: version.revision,
          checklist,
          approvalKind,
          approvingPosition,
          approvalDate,
          approvalBasis,
          approvalEvidenceReference,
          approvalNotRequiredReason,
          isProvisional,
          provisionalUncertainty,
          provisionalUpdateOwner,
          requestId: crypto.randomUUID(),
        })
      const promise = sendApprovalAttempt(entry)
      redraw((n) => n + 1)
      await promise

      if (mounted.current) {
        forgetApprovalAttempt(entry)
        onConfirmed()
      }
    } catch (failure) {
      if (mounted.current) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'The approval request could not be confirmed.',
        )
        redraw((n) => n + 1)
      }
    } finally {
      busy.current = false
    }
  }

  function reload() {
    if (!attempt) return onReload()
    forgetApprovalAttempt(attempt)
    if (attempt.receipt) onConfirmed()
    else onReload()
  }

  return (
    <section
      aria-label="Six-point verification and approval"
      className="space-y-5 rounded-xl border border-emerald-200 bg-white p-5"
    >
      <div>
        <h3 className="text-xl font-bold">
          Six-point verification &amp; approval
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Complete all six Appendix B checks for Version {version.versionNumber}{' '}
          (edit revision {version.revision}). Approval does not publish to the
          public portal.
        </p>
      </div>

      {attempt ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">
            Version {attempt.request.versionNumber} ·{' '}
            {attempt.request.approvalKind === 'substantive_approval'
              ? 'Substantive approval'
              : 'Custodian acceptance'}{' '}
            · Edit revision {attempt.request.expectedRevision}
          </p>
          {(error || attempt.error) && (
            <p
              role="alert"
              className="rounded-lg bg-amber-50 p-3 text-amber-950"
            >
              {error || attempt.error?.message}
            </p>
          )}
          {attempt.status === 'sending' && (
            <p role="status">Submitting verification and approval…</p>
          )}
          {attempt.status === 'uncertain' && (
            <div className="space-y-2">
              <p className="text-sm text-slate-700">
                Keep this tab open. Retry checks the original request with the
                same payload.
              </p>
              <button
                type="button"
                className="rounded-lg border border-emerald-800 px-4 py-2 font-semibold"
                onClick={() => void submitApproval()}
              >
                Retry same request
              </button>
            </div>
          )}
          {(attempt.status === 'rejected' ||
            attempt.status === 'confirmed') && (
            <div className="space-y-2">
              {attempt.status === 'confirmed' && (
                <p role="status" className="text-sm text-emerald-900">
                  Verification and approval confirmed. Reload the queue to view
                  updated state.
                </p>
              )}
              <button
                type="button"
                className="rounded-lg border border-emerald-800 px-4 py-2 font-semibold"
                onClick={reload}
              >
                Reload queue
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50/70 border border-emerald-200 px-4 py-2.5">
            <span className="text-xs font-medium text-emerald-950">
              Review each point below or mark all standard checks confirmed.
            </span>
            <button
              type="button"
              onClick={() => setChecklist(initialChecklist())}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              Confirm All 6 Checks
            </button>
          </div>
          <div className="space-y-4">
            {CHECKLIST_ITEMS.map((item) => {
              const current = checklist[item.key]
              return (
                <fieldset
                  key={item.key}
                  className="space-y-2 rounded-lg border border-slate-200 p-4"
                >
                  <legend className="px-1 text-sm font-bold text-slate-900">
                    {item.title}
                  </legend>
                  <p className="text-xs text-slate-600">{item.description}</p>
                  <div className="flex flex-wrap gap-4 pt-1 text-sm">
                    {(
                      [
                        'Confirmed',
                        'Correction Required',
                        'Not Applicable',
                      ] as ChecklistStatus[]
                    ).map((status) => (
                      <label
                        key={status}
                        className="flex items-center gap-2 font-medium"
                      >
                        <input
                          type="radio"
                          name={`${id}-${item.key}`}
                          value={status}
                          checked={current.status === status}
                          onChange={() =>
                            updateItem(item.key, {
                              status,
                              reason:
                                status === 'Not Applicable'
                                  ? current.reason
                                  : '',
                            })
                          }
                        />
                        {status}
                      </label>
                    ))}
                  </div>
                  {current.status === 'Not Applicable' && (
                    <div className="pt-2">
                      <label
                        htmlFor={`${id}-${item.key}-reason`}
                        className="block text-xs font-semibold text-slate-800"
                      >
                        Reason this check is Not Applicable (required)
                      </label>
                      <input
                        id={`${id}-${item.key}-reason`}
                        type="text"
                        maxLength={500}
                        value={current.reason}
                        onChange={(e) =>
                          updateItem(item.key, { reason: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
                      />
                    </div>
                  )}
                </fieldset>
              )
            })}
          </div>

          {hasCorrectionRequired && (
            <p
              role="alert"
              className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950"
            >
              One or more items are marked <strong>Correction Required</strong>.
              Ordinary approval is blocked—use <strong>Return to Draft</strong>{' '}
              above with specific comments.
            </p>
          )}

          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={isProvisional}
                onChange={(e) => setIsProvisional(e.target.checked)}
              />
              Mark as an authorized provisional notice (unconfirmed details
              remain visibly unconfirmed)
            </label>
            {isProvisional && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${id}-prov-uncert`}
                    className="block text-xs font-semibold text-slate-800"
                  >
                    Details awaiting confirmation (required)
                  </label>
                  <input
                    id={`${id}-prov-uncert`}
                    type="text"
                    maxLength={1000}
                    value={provisionalUncertainty}
                    onChange={(e) => setProvisionalUncertainty(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${id}-prov-owner`}
                    className="block text-xs font-semibold text-slate-800"
                  >
                    Officer responsible for updating (required)
                  </label>
                  <input
                    id={`${id}-prov-owner`}
                    type="text"
                    maxLength={160}
                    value={provisionalUpdateOwner}
                    onChange={(e) => setProvisionalUpdateOwner(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 border-t border-slate-200 pt-4">
            <div>
              <label
                htmlFor={`${id}-kind`}
                className="block text-sm font-semibold"
              >
                Approval / acceptance record type
              </label>
              <select
                id={`${id}-kind`}
                value={approvalKind}
                onChange={(e) =>
                  setApprovalKind(e.target.value as ApprovalKind)
                }
                className="mt-1 w-full rounded-lg border border-slate-400 p-3 text-sm"
              >
                {canApprover && (
                  <option value="substantive_approval">
                    Substantive approval (designated Approver)
                  </option>
                )}
                {(canCustodian || canApprover) && (
                  <option value="custodian_acceptance">
                    Custodian acceptance / external source (no council approval
                    invented)
                  </option>
                )}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`${id}-pos`}
                  className="block text-sm font-semibold"
                >
                  {approvalKind === 'substantive_approval'
                    ? 'Approving officer position'
                    : 'Originating / external authority'}
                </label>
                <input
                  id={`${id}-pos`}
                  type="text"
                  maxLength={160}
                  value={approvingPosition}
                  onChange={(e) => setApprovingPosition(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor={`${id}-date`}
                  className="block text-sm font-semibold"
                >
                  {approvalKind === 'substantive_approval'
                    ? 'Approval date (required)'
                    : 'Source / receipt date (optional)'}
                </label>
                <input
                  id={`${id}-date`}
                  type="date"
                  value={approvalDate}
                  onChange={(e) => setApprovalDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor={`${id}-basis`}
                className="block text-sm font-semibold"
              >
                Official basis
              </label>
              <input
                id={`${id}-basis`}
                type="text"
                maxLength={1000}
                value={approvalBasis}
                onChange={(e) => setApprovalBasis(e.target.value)}
                placeholder="e.g., EA-CSC Resolution No. 2026-04 or External Memo from Dean"
                className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor={`${id}-evidence`}
                className="block text-sm font-semibold"
              >
                Evidence reference
              </label>
              <input
                id={`${id}-evidence`}
                type="text"
                maxLength={500}
                value={approvalEvidenceReference}
                onChange={(e) => setApprovalEvidenceReference(e.target.value)}
                placeholder="e.g., Signed scan ref / Minutes item 4.2"
                className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
              />
            </div>

            {approvalKind === 'custodian_acceptance' && (
              <div>
                <label
                  htmlFor={`${id}-not-req`}
                  className="block text-sm font-semibold"
                >
                  Reason council substantive approval is not applicable
                  (required)
                </label>
                <input
                  id={`${id}-not-req`}
                  type="text"
                  maxLength={1000}
                  value={approvalNotRequiredReason}
                  onChange={(e) => setApprovalNotRequiredReason(e.target.value)}
                  placeholder="e.g., External memorandum received from college administration for preservation."
                  className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
                />
              </div>
            )}
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
            disabled={hasCorrectionRequired || missingNotApplicableReason}
            onClick={() => void submitApproval()}
            className="rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approvalKind === 'substantive_approval'
              ? 'Record substantive approval'
              : 'Record custodian acceptance'}
          </button>
        </div>
      )}
    </section>
  )
}
