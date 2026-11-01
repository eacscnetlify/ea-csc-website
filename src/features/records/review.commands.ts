import { getSupabaseClient } from '../../lib/supabase'
import { WorkspaceError } from '../workspace/workspace.api'

interface ReviewRequest {
  actorId: string
  recordId: string
  versionId: string
  versionNumber: number
  expectedRevision: number
  operation: 'submit' | 'return'
  comment: string
  requestId: string
}

export interface ReviewReceipt {
  state: 'Draft' | 'For Review'
  revision: number
}

export interface ReviewAttempt {
  request: Readonly<ReviewRequest>
  status: 'sending' | 'uncertain' | 'confirmed' | 'rejected'
  receipt?: ReviewReceipt
  error?: WorkspaceError
  promise?: Promise<ReviewReceipt>
}

// Record scope preserves recovery even when Author reads hide the version.
const attempts = new Map<string, ReviewAttempt>()
const key = (actor: string, record: string) => `${actor}:${record}`
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export const findReviewAttempt = (actor: string, record: string) =>
  attempts.get(key(actor, record))

export function createReviewAttempt(request: ReviewRequest): ReviewAttempt {
  const prior = findReviewAttempt(request.actorId, request.recordId)
  if (prior) return prior

  const entry: ReviewAttempt = {
    request: Object.freeze({ ...request }),
    status: 'uncertain',
  }
  attempts.set(key(request.actorId, request.recordId), entry)
  return entry
}

export function forgetReviewAttempt(entry: ReviewAttempt) {
  if (entry.status === 'sending' || entry.status === 'uncertain') return
  const id = key(entry.request.actorId, entry.request.recordId)
  if (attempts.get(id) === entry) attempts.delete(id)
}

async function invokeReview(
  r: Readonly<ReviewRequest>,
): Promise<ReviewReceipt> {
  const uncertain = () =>
    new WorkspaceError(
      'uncertain',
      'The result is unconfirmed. Keep this tab open and use Retry same request before starting another review action.',
    )

  if (
    !uuid.test(r.actorId) ||
    !uuid.test(r.versionId) ||
    !uuid.test(r.requestId) ||
    !Number.isSafeInteger(r.expectedRevision) ||
    r.expectedRevision < 1 ||
    r.expectedRevision >= 2147483647 ||
    (r.operation !== 'submit' && r.operation !== 'return') ||
    (r.operation === 'return' &&
      (!r.comment.trim() || [...r.comment].length > 2000))
  ) {
    throw new WorkspaceError(
      'validation',
      'Provide a version and return comments of at most 2,000 characters.',
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

  let response: Response
  let body: Record<string, unknown>

  try {
    const command =
      r.operation === 'submit'
        ? 'eacsc_submit_version_for_review'
        : 'eacsc_return_version_for_correction'

    response = await fetch(
      new URL(
        `/rest/v1/rpc/${command}`,
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
          p_request_id: r.requestId,
          ...(r.operation === 'return' ? { p_comment: r.comment.trim() } : {}),
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
        'This review action is not permitted with your current assignment. Refresh access and reload versions.',
      )
    }
    if (response.status === 409 && body.code === 'PT409') {
      throw new WorkspaceError(
        'conflict',
        'The version changed. Reload versions before making a new review request.',
      )
    }
    if (body.code === '55000') {
      throw new WorkspaceError(
        'validation',
        'This version cannot enter the requested review step. Reload the record and check its accepted attachment.',
      )
    }
    if (body.code === '22023') {
      throw new WorkspaceError(
        'validation',
        'The review request was rejected. Check your comments and reload versions.',
      )
    }
    throw uncertain()
  }

  const state = r.operation === 'submit' ? 'For Review' : 'Draft'
  if (
    body.request_id !== r.requestId ||
    body.record_id !== r.recordId ||
    body.version_id !== r.versionId ||
    body.state !== state ||
    body.revision_counter !== r.expectedRevision + 1 ||
    typeof body.record_revision !== 'number' ||
    !Number.isSafeInteger(body.record_revision) ||
    body.record_revision < 1 ||
    typeof body.audit_event_uuid !== 'string' ||
    !uuid.test(body.audit_event_uuid) ||
    typeof body.updated_at !== 'string' ||
    !Number.isFinite(Date.parse(body.updated_at)) ||
    (r.operation === 'submit'
      ? body.comment_id !== null
      : typeof body.comment_id !== 'string' || !uuid.test(body.comment_id))
  )
    throw uncertain()

  return { state, revision: r.expectedRevision + 1 }
}

export function sendReviewAttempt(
  entry: ReviewAttempt,
): Promise<ReviewReceipt> {
  if (entry.status === 'sending' && entry.promise) return entry.promise
  if (entry.status === 'confirmed' && entry.receipt)
    return Promise.resolve(entry.receipt)

  const previouslyUncertain =
    entry.status === 'uncertain' && Boolean(entry.promise)

  entry.status = 'sending'
  entry.error = undefined
  entry.promise = invokeReview(entry.request)
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
              'The result is unconfirmed. Keep this tab open and retry the same request.',
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
