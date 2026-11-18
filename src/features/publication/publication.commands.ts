import { getSupabaseClient } from '../../lib/supabase'
import { getOfficerProfile } from '../auth/auth.api'
import { getAssignedRecords, WorkspaceError } from '../workspace/workspace.api'
import type {
  AssignedRecord,
  AssignedVersion,
} from '../workspace/workspace.api'

export interface ActiveReleaseInfo {
  releaseId: string
  versionId: string
  audience: string
  publicTitle: string
  releasedAt: string
  effectiveFrom: string
  withdrawnAt: string | null
}

export interface PublisherRecordItem {
  record: AssignedRecord
  approvedVersions: AssignedVersion[]
  activeRelease: ActiveReleaseInfo | null
}

export interface PublishRequest {
  actorId: string
  recordId: string
  versionId: string
  versionNumber: number
  expectedVersionRevision: number
  expectedRecordRevision: number
  releaseId: string
  audience: 'public' | 'internal'
  publicTitle: string
  publicCategory: string
  authorizationBasis: string
  authorizationReference: string
  effectiveFrom: string | null
  requestId: string
}

export interface PublishReceipt {
  releaseId: string
  activeNow: boolean
  supersededVersionId: string | null
}

export interface PublishAttempt {
  request: Readonly<PublishRequest>
  status: 'sending' | 'uncertain' | 'confirmed' | 'rejected'
  receipt?: PublishReceipt
  error?: WorkspaceError
  promise?: Promise<PublishReceipt>
}

const attempts = new Map<string, PublishAttempt>()
const key = (actor: string, record: string) => `${actor}:${record}`
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export const findPublishAttempt = (actor: string, record: string) =>
  attempts.get(key(actor, record))

export function createPublishAttempt(request: PublishRequest): PublishAttempt {
  const prior = findPublishAttempt(request.actorId, request.recordId)
  if (prior) return prior

  const entry: PublishAttempt = {
    request: Object.freeze({ ...request }),
    status: 'uncertain',
  }
  attempts.set(key(request.actorId, request.recordId), entry)
  return entry
}

export function forgetPublishAttempt(entry: PublishAttempt) {
  if (entry.status === 'sending' || entry.status === 'uncertain') return
  const id = key(entry.request.actorId, entry.request.recordId)
  if (attempts.get(id) === entry) attempts.delete(id)
}

export async function getPublisherWorkspace(
  userId: string,
  signal: AbortSignal,
): Promise<PublisherRecordItem[]> {
  const client = getSupabaseClient()
  const [profile, page, assignments, versions, releases] = await Promise.all([
    getOfficerProfile(userId, signal),
    getAssignedRecords(userId, 0, signal),
    client
      .from('record_assignments')
      .select(
        'record_id,user_id,assignment_function,is_active,allow_restricted',
      )
      .eq('user_id', userId)
      .eq('assignment_function', 'publisher')
      .eq('is_active', true)
      .abortSignal(signal),
    client
      .from('record_versions')
      .select(
        'version_id,record_id,version_number,revision_counter,state,previous_version_id,change_summary,correction_classification,approved_at,created_at,updated_at',
      )
      .eq('state', 'Approved')
      .order('version_number', { ascending: false })
      .abortSignal(signal),
    client.rpc('eacsc_list_publisher_releases').abortSignal(signal),
  ])

  if (!profile?.is_active || !profile.functional_roles.includes('publisher')) {
    return []
  }

  if (assignments.error || versions.error || releases.error) {
    throw new WorkspaceError(
      'load',
      'Publisher records could not be loaded. Check your connection and try again.',
    )
  }

  const releaseMap = new Map<string, ActiveReleaseInfo>()
  if (Array.isArray(releases.data)) {
    for (const row of releases.data as Record<string, unknown>[]) {
      if (
        typeof row.record_id === 'string' &&
        typeof row.release_id === 'string'
      ) {
        releaseMap.set(row.record_id, {
          releaseId: row.release_id,
          versionId: String(row.version_id),
          audience: String(row.audience),
          publicTitle: String(row.public_title),
          releasedAt: String(row.released_at),
          effectiveFrom: String(row.effective_from),
          withdrawnAt:
            typeof row.withdrawn_at === 'string' ? row.withdrawn_at : null,
        })
      }
    }
  }

  const publisherRecords = page.records.filter(
    (record) =>
      record.accessClass === 'public' &&
      record.documentType !== 'Update bulletin',
  )

  return publisherRecords.map((record) => {
    const activeRelease = releaseMap.get(record.recordId) ?? null
    const approvedVersions = (versions.data as Record<string, unknown>[])
      .filter((v) => v.record_id === record.recordId)
      .map((v) => ({
        versionId: String(v.version_id),
        recordId: record.recordId,
        versionNumber: Number(v.version_number),
        revision: Number(v.revision_counter),
        state: 'Approved' as const,
        previousVersionId:
          typeof v.previous_version_id === 'string'
            ? v.previous_version_id
            : null,
        notes: String(v.change_summary),
        correctionClassification:
          typeof v.correction_classification === 'string'
            ? v.correction_classification
            : null,
        approvedAt: typeof v.approved_at === 'string' ? v.approved_at : null,
        reviewerPassedAt:
          typeof v.reviewer_passed_at === 'string' ? v.reviewer_passed_at : null,
        reviewerPassedBy:
          typeof v.reviewer_passed_by === 'string' ? v.reviewer_passed_by : null,
        reviewerFeedback:
          typeof v.reviewer_feedback === 'string' ? v.reviewer_feedback : null,
        externalUrl:
          typeof v.external_url === 'string' ? v.external_url : null,
        createdAt: String(v.created_at),
        updatedAt: String(v.updated_at),
      }))

    return { record, approvedVersions, activeRelease }
  })
}

async function invokePublish(
  r: Readonly<PublishRequest>,
): Promise<PublishReceipt> {
  const uncertain = () =>
    new WorkspaceError(
      'uncertain',
      'Publication could not be confirmed. Keep this tab open and use Retry same request.',
    )

  if (
    !uuid.test(r.actorId) ||
    !uuid.test(r.versionId) ||
    !uuid.test(r.releaseId) ||
    !uuid.test(r.requestId) ||
    !r.publicTitle.trim() ||
    !r.authorizationBasis.trim() ||
    !r.authorizationReference.trim()
  ) {
    throw new WorkspaceError(
      'validation',
      'Complete the public title, category, authorization basis, and reference.',
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
      'Your sign-in session changed. Refresh access before publishing.',
    )
  }

  let response: Response
  let body: Record<string, unknown>

  try {
    response = await fetch(
      new URL(
        '/functions/v1/ea-csc-publish-release',
        import.meta.env.VITE_SUPABASE_URL.trim(),
      ),
      {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(45_000),
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.trim(),
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          version_id: r.versionId,
          expected_version_revision: r.expectedVersionRevision,
          expected_record_revision: r.expectedRecordRevision,
          release_id: r.releaseId,
          audience: r.audience,
          public_title: r.publicTitle.trim(),
          public_category: r.publicCategory,
          authorization_basis: r.authorizationBasis.trim(),
          authorization_reference: r.authorizationReference.trim(),
          effective_from: r.effectiveFrom,
          request_id: r.requestId,
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
        'Publication is not permitted with your current assignment.',
      )
    }
    if (response.status === 409 && body.code === 'PT409') {
      throw new WorkspaceError(
        'conflict',
        'The record or version changed. Reload before publishing.',
      )
    }
    if (response.status === 400 || response.status === 409) {
      throw new WorkspaceError(
        'validation',
        typeof body.message === 'string' && body.message.trim()
          ? body.message
          : 'The publication request was rejected.',
      )
    }
    throw uncertain()
  }

  if (body.release_id !== r.releaseId || body.request_id !== r.requestId) {
    throw uncertain()
  }

  return {
    releaseId: r.releaseId,
    activeNow: body.active_now === true,
    supersededVersionId:
      typeof body.superseded_version_id === 'string'
        ? body.superseded_version_id
        : null,
  }
}

export function sendPublishAttempt(
  entry: PublishAttempt,
): Promise<PublishReceipt> {
  if (entry.status === 'sending' && entry.promise) return entry.promise
  if (entry.status === 'confirmed' && entry.receipt)
    return Promise.resolve(entry.receipt)

  const previouslyUncertain =
    entry.status === 'uncertain' && Boolean(entry.promise)

  entry.status = 'sending'
  entry.error = undefined
  entry.promise = invokePublish(entry.request)
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
              'Publication could not be confirmed. Retry the same request.',
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

export async function withdrawRelease(
  actorId: string,
  releaseId: string,
  expectedRecordRevision: number,
  reason: string,
): Promise<void> {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (
    error ||
    data.session?.user.id !== actorId ||
    data.session.user.is_anonymous
  ) {
    throw new WorkspaceError('denied', 'Sign in again before withdrawing.')
  }

  const response = await fetch(
    new URL(
      '/rest/v1/rpc/eacsc_withdraw_release',
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
        p_release_id: releaseId,
        p_expected_record_revision: expectedRecordRevision,
        p_withdrawal_reason: reason.trim(),
        p_request_id: crypto.randomUUID(),
      }),
    },
  )

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    throw new WorkspaceError(
      body.code === 'PT409' ? 'conflict' : 'validation',
      typeof body.message === 'string' && body.message.trim()
        ? body.message
        : 'The release could not be withdrawn.',
    )
  }
}
