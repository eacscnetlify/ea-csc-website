import { getSupabaseClient } from '../../lib/supabase'
import { WorkspaceError } from '../workspace/workspace.api'

export type ChecklistStatus =
  'Confirmed' | 'Correction Required' | 'Not Applicable'

export type ChecklistKey =
  | 'identity_version'
  | 'dates_deadlines'
  | 'location_link'
  | 'audience_requirements'
  | 'authority_disclosure'
  | 'contact_reference'

export interface ChecklistItemValue {
  status: ChecklistStatus
  reason: string
}

export type SixPointChecklist = Record<ChecklistKey, ChecklistItemValue>

export type ApprovalKind = 'substantive_approval' | 'custodian_acceptance'

export interface ApprovalRequest {
  actorId: string
  recordId: string
  versionId: string
  versionNumber: number
  expectedRevision: number
  checklist: SixPointChecklist
  approvalKind: ApprovalKind
  approvingPosition: string
  approvalDate: string
  approvalBasis: string
  approvalEvidenceReference: string
  approvalNotRequiredReason: string
  isProvisional: boolean
  provisionalUncertainty: string
  provisionalUpdateOwner: string
  requestId: string
}

export interface ApprovalReceipt {
  state: 'Approved'
  revision: number
  verificationId: string
}

export interface ApprovalAttempt {
  request: Readonly<ApprovalRequest>
  status: 'sending' | 'uncertain' | 'confirmed' | 'rejected'
  receipt?: ApprovalReceipt
  error?: WorkspaceError
  promise?: Promise<ApprovalReceipt>
}

const attempts = new Map<string, ApprovalAttempt>()
const key = (actor: string, record: string) => `${actor}:${record}`
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export const findApprovalAttempt = (actor: string, record: string) =>
  attempts.get(key(actor, record))

export function createApprovalAttempt(
  request: ApprovalRequest,
): ApprovalAttempt {
  const prior = findApprovalAttempt(request.actorId, request.recordId)
  if (prior) return prior

  const entry: ApprovalAttempt = {
    request: Object.freeze({ ...request }),
    status: 'uncertain',
  }
  attempts.set(key(request.actorId, request.recordId), entry)
  return entry
}

export function forgetApprovalAttempt(entry: ApprovalAttempt) {
  if (entry.status === 'sending' || entry.status === 'uncertain') return
  const id = key(entry.request.actorId, entry.request.recordId)
  if (attempts.get(id) === entry) attempts.delete(id)
}

async function invokeApproval(
  r: Readonly<ApprovalRequest>,
): Promise<ApprovalReceipt> {
  const uncertain = () =>
    new WorkspaceError(
      'uncertain',
      'The approval result is unconfirmed. Keep this tab open and use Retry same request.',
    )

  const keys: ChecklistKey[] = [
    'identity_version',
    'dates_deadlines',
    'location_link',
    'audience_requirements',
    'authority_disclosure',
    'contact_reference',
  ]

  for (const k of keys) {
    const item = r.checklist[k]
    if (item.status === 'Correction Required') {
      throw new WorkspaceError(
        'validation',
        'Items marked Correction Required must be returned to Draft before approval.',
      )
    }
    if (item.status === 'Not Applicable' && !item.reason.trim()) {
      throw new WorkspaceError(
        'validation',
        'Every Not Applicable item requires a recorded reason.',
      )
    }
  }

  if (
    !uuid.test(r.actorId) ||
    !uuid.test(r.versionId) ||
    !uuid.test(r.requestId) ||
    !r.approvingPosition.trim() ||
    !r.approvalBasis.trim() ||
    !r.approvalEvidenceReference.trim() ||
    (r.approvalKind === 'substantive_approval' && !r.approvalDate.trim()) ||
    (r.approvalKind === 'custodian_acceptance' &&
      !r.approvalNotRequiredReason.trim()) ||
    (r.isProvisional &&
      (!r.provisionalUncertainty.trim() || !r.provisionalUpdateOwner.trim()))
  ) {
    throw new WorkspaceError(
      'validation',
      'Complete all required approval, checklist, and provisional-notice fields.',
    )
  }

  const { data, error } = await getSupabaseClient().auth.getSession()
  if (
    error ||
    data.session?.user.id !== r.actorId ||
    data.session.user.is_anonymous
  ) {
    throw new WorkspaceError(
      'denied',
      'Your sign-in session changed. Refresh access before continuing.',
    )
  }

  const checklistPayload = Object.fromEntries(
    keys.map((k) => [
      k,
      {
        status: r.checklist[k].status,
        reason: r.checklist[k].reason.trim() || null,
      },
    ]),
  )

  let response: Response
  let body: Record<string, unknown>

  try {
    response = await fetch(
      new URL(
        '/rest/v1/rpc/eacsc_approve_version',
        import.meta.env.VITE_SUPABASE_URL.trim(),
      ),
      {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.trim(),
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          p_version_id: r.versionId,
          p_expected_revision: r.expectedRevision,
          p_checklist: checklistPayload,
          p_approval_kind: r.approvalKind,
          p_approving_position: r.approvingPosition.trim(),
          p_approval_date: r.approvalDate.trim() || null,
          p_approval_basis: r.approvalBasis.trim(),
          p_approval_evidence_reference: r.approvalEvidenceReference.trim(),
          p_approval_not_required_reason:
            r.approvalKind === 'custodian_acceptance'
              ? r.approvalNotRequiredReason.trim()
              : null,
          p_is_provisional: r.isProvisional,
          p_provisional_uncertainty: r.isProvisional
            ? r.provisionalUncertainty.trim()
            : null,
          p_provisional_update_owner: r.isProvisional
            ? r.provisionalUpdateOwner.trim()
            : null,
          p_request_id: r.requestId,
        }),
      },
    )

    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw uncertain()
    body = value as Record<string, unknown>
  } catch {
    throw uncertain()
  }

  if (!response.ok) {
    if (
      response.status === 401 ||
      response.status === 403 ||
      body.code === '42501'
    ) {
      throw new WorkspaceError(
        'denied',
        'This approval action is not permitted with your current assignment.',
      )
    }
    if (response.status === 409 && body.code === 'PT409') {
      throw new WorkspaceError(
        'conflict',
        'The version changed. Reload the queue before approving.',
      )
    }
    if (body.code === '55000') {
      throw new WorkspaceError(
        'validation',
        'An accepted attachment must remain available before approval.',
      )
    }
    if (body.code === '22023') {
      throw new WorkspaceError(
        'validation',
        typeof body.message === 'string' && body.message.trim()
          ? body.message
          : 'The approval request was rejected. Check all fields and reload.',
      )
    }
    throw uncertain()
  }

  if (
    body.request_id !== r.requestId ||
    body.record_id !== r.recordId ||
    body.version_id !== r.versionId ||
    body.state !== 'Approved' ||
    body.revision_counter !== r.expectedRevision + 1 ||
    typeof body.verification_id !== 'string' ||
    !uuid.test(body.verification_id)
  ) {
    throw uncertain()
  }

  return {
    state: 'Approved',
    revision: r.expectedRevision + 1,
    verificationId: body.verification_id,
  }
}

export function sendApprovalAttempt(
  entry: ApprovalAttempt,
): Promise<ApprovalReceipt> {
  if (entry.status === 'sending' && entry.promise) return entry.promise
  if (entry.status === 'confirmed' && entry.receipt)
    return Promise.resolve(entry.receipt)

  const previouslyUncertain =
    entry.status === 'uncertain' && Boolean(entry.promise)

  entry.status = 'sending'
  entry.error = undefined
  entry.promise = invokeApproval(entry.request)
    .then((receipt) => {
      entry.status = 'confirmed'
      entry.receipt = receipt
      return receipt
    })
    .catch((error: unknown) => {
      const failure =
        error instanceof WorkspaceError
          ? error
          : new WorkspaceError(
              'uncertain',
              'The approval result is unconfirmed. Keep this tab open and retry the same request.',
            )

      entry.status =
        previouslyUncertain || failure.kind === 'uncertain'
          ? 'uncertain'
          : 'rejected'
      entry.error = failure
      throw failure
    })

  return entry.promise
}
