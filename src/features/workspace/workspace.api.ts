import { getSupabaseClient } from '../../lib/supabase'
import { getOfficerProfile } from '../auth/auth.api'
import type { OfficerProfile } from '../auth/auth.api'

export interface AssignedRecord {
  recordId: string
  title: string
  category: string
  accessClass: 'public' | 'internal' | 'restricted'
  custodianPosition: string
  revision: number
}
export interface AssignedVersion {
  versionId: string
  recordId: string
  versionNumber: number
  revision: number
  state: 'Draft' | 'For Review' | 'Approved' | 'Superseded'
  notes: string
  updatedAt: string
}
export interface DraftRequest {
  actorId: string
  recordId: string
  versionId: string
  expectedRevision: number
  notes: string
  requestId: string
}
export interface DraftReceipt {
  versionId: string
  recordId: string
  revision: number
  notes: string
  requestId: string
  auditEventId: string
  updatedAt: string
}
export class WorkspaceError extends Error {
  kind: 'load' | 'denied' | 'conflict' | 'validation' | 'uncertain'
  constructor(kind: WorkspaceError['kind'], message: string) {
    super(message)
    this.name = 'WorkspaceError'
    this.kind = kind
  }
}
const recordColumns =
  'record_id,title,category,access_class,custodian_position,revision_counter'
const versionColumns =
  'version_id,record_id,version_number,revision_counter,state,change_summary,updated_at'
const pageSize = 20
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WorkspaceError(
      'load',
      'The workspace response was incomplete. Reload the records.',
    )
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new WorkspaceError(
      'load',
      'The workspace response was incomplete. Reload the records.',
    )
  return value
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new WorkspaceError(
      'load',
      'An invalid version revision was returned. Reload the records.',
    )
  return value
}
function timestamp(value: unknown): string {
  const result = text(value)
  if (!Number.isFinite(Date.parse(result)))
    throw new WorkspaceError('load', 'An invalid update time was returned.')
  return result
}
function recordRow(value: unknown): AssignedRecord {
  const row = object(value)
  if (!['public', 'internal', 'restricted'].includes(String(row.access_class)))
    throw new WorkspaceError(
      'load',
      'An unknown access classification was returned.',
    )
  return {
    recordId: text(row.record_id),
    title: text(row.title),
    category: text(row.category),
    accessClass: row.access_class as AssignedRecord['accessClass'],
    custodianPosition: text(row.custodian_position),
    revision: positive(row.revision_counter),
  }
}
function versionRow(value: unknown, recordId: string): AssignedVersion {
  const row = object(value)
  if (
    row.record_id !== recordId ||
    !['Draft', 'For Review', 'Approved', 'Superseded'].includes(
      String(row.state),
    ) ||
    typeof row.version_id !== 'string' ||
    !uuid.test(row.version_id)
  )
    throw new WorkspaceError('load', 'An invalid record version was returned.')
  return {
    versionId: row.version_id,
    recordId,
    versionNumber: positive(row.version_number),
    revision: positive(row.revision_counter),
    state: row.state as AssignedVersion['state'],
    notes: text(row.change_summary),
    updatedAt: timestamp(row.updated_at),
  }
}
function active(profile: OfficerProfile | null): OfficerProfile {
  if (!profile?.is_active || profile.functional_roles.length === 0)
    throw new WorkspaceError(
      'denied',
      'Workspace access has changed. Use Refresh access above to check your account.',
    )
  return profile
}

export async function getAssignedRecords(
  userId: string,
  page: number,
  signal: AbortSignal,
) {
  const client = getSupabaseClient()
  const [profile, result] = await Promise.all([
    getOfficerProfile(userId, signal),
    client
      .from('master_records')
      .select(recordColumns)
      .order('record_id')
      .range(page * pageSize, page * pageSize + pageSize)
      .abortSignal(signal),
  ])
  active(profile)
  if (result.error || !Array.isArray(result.data))
    throw new WorkspaceError(
      'load',
      'Assigned records could not be loaded. Check your connection and try again.',
    )
  return {
    records: result.data.slice(0, pageSize).map(recordRow),
    hasNext: result.data.length > pageSize,
  }
}

export async function getAssignedVersions(
  userId: string,
  recordId: string,
  signal: AbortSignal,
) {
  const client = getSupabaseClient()
  const [profile, master, versions, assignments] = await Promise.all([
    getOfficerProfile(userId, signal),
    client
      .from('master_records')
      .select(recordColumns)
      .eq('record_id', recordId)
      .abortSignal(signal)
      .maybeSingle(),
    client
      .from('record_versions')
      .select(versionColumns)
      .eq('record_id', recordId)
      .order('version_number', { ascending: false })
      .limit(101)
      .abortSignal(signal),
    client
      .from('record_assignments')
      .select(
        'record_id,user_id,assignment_function,is_active,allow_restricted',
      )
      .eq('record_id', recordId)
      .eq('user_id', userId)
      .abortSignal(signal),
  ])
  const currentProfile = active(profile)
  if (
    master.error ||
    versions.error ||
    assignments.error ||
    !Array.isArray(versions.data) ||
    !Array.isArray(assignments.data)
  )
    throw new WorkspaceError(
      'load',
      'The selected record could not be loaded. Reload its versions.',
    )
  if (!master.data)
    throw new WorkspaceError(
      'denied',
      'This record is no longer accessible. Reload the record list.',
    )
  const record = recordRow(master.data)
  const canEditDraft = assignments.data.some((value: unknown) => {
    const row = object(value)
    return (
      row.record_id === recordId &&
      row.user_id === userId &&
      row.is_active === true &&
      ['author', 'custodian'].includes(String(row.assignment_function)) &&
      currentProfile.functional_roles.includes(
        String(row.assignment_function),
      ) &&
      (record.accessClass !== 'restricted' || row.allow_restricted === true)
    )
  })
  return {
    record,
    versions: versions.data
      .slice(0, 100)
      .map((v: unknown) => versionRow(v, recordId)),
    truncated: versions.data.length > 100,
    canEditDraft,
  }
}

export async function updateDraftNotes(
  request: DraftRequest,
): Promise<DraftReceipt> {
  const uncertain = () =>
    new WorkspaceError(
      'uncertain',
      'The save could not be confirmed. Keep this page open and use Retry same save to check the original request.',
    )
  if (
    !uuid.test(request.versionId) ||
    !uuid.test(request.requestId) ||
    !request.notes.trim() ||
    [...request.notes].length > 2000 ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 1 ||
    request.expectedRevision >= 2147483647
  )
    throw new WorkspaceError(
      'validation',
      'Enter changed notes with at most 2,000 characters.',
    )
  const client = getSupabaseClient()
  const { data, error } = await client.auth.getSession()
  if (
    error ||
    data.session?.user.id !== request.actorId ||
    data.session.user.is_anonymous
  )
    throw new WorkspaceError(
      'denied',
      'Your sign-in session changed. Sign in again before editing.',
    )
  let response: Response
  try {
    // A single fetch avoids SDK write retries. Explicit user retries reuse the
    // immutable request ID, expected revision and notes stored by the editor.
    response = await fetch(
      new URL(
        '/rest/v1/rpc/eacsc_update_draft_notes',
        import.meta.env.VITE_SUPABASE_URL.trim(),
      ),
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.trim(),
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          p_version_id: request.versionId,
          p_expected_revision: request.expectedRevision,
          p_change_summary: request.notes,
          p_request_id: request.requestId,
        }),
      },
    )
  } catch {
    throw uncertain()
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw uncertain()
  }
  let row: Record<string, unknown>
  try {
    row = object(body)
  } catch {
    throw uncertain()
  }
  if (!response.ok) {
    if (response.status === 409 && row.code === 'PT409')
      throw new WorkspaceError(
        'conflict',
        'Another edit was saved first. Reload the latest version, review its notes, then make a new edit.',
      )
    if (
      row.code === '42501' ||
      response.status === 401 ||
      response.status === 403
    )
      throw new WorkspaceError(
        'denied',
        'This save is not permitted with your current account and record assignment. Refresh access and reload the records.',
      )
    if (row.code === '55000')
      throw new WorkspaceError(
        'denied',
        'Only Draft notes can be changed. Reload this record to check its current state.',
      )
    if (row.code === '22023')
      throw new WorkspaceError(
        'validation',
        'The save was rejected. Check that the notes changed, contain text and are at most 2,000 characters, then reload the version before trying a new edit.',
      )
    throw uncertain()
  }
  // A malformed success reply is uncertain: never claim that no write occurred.
  if (
    row.version_id !== request.versionId ||
    row.record_id !== request.recordId ||
    row.request_id !== request.requestId ||
    row.state !== 'Draft' ||
    row.change_summary !== request.notes.trim() ||
    row.revision_counter !== request.expectedRevision + 1 ||
    typeof row.audit_event_uuid !== 'string' ||
    !uuid.test(row.audit_event_uuid) ||
    typeof row.updated_at !== 'string' ||
    !Number.isFinite(Date.parse(row.updated_at))
  )
    throw uncertain()
  return {
    versionId: request.versionId,
    recordId: request.recordId,
    revision: row.revision_counter as number,
    notes: row.change_summary as string,
    requestId: request.requestId,
    auditEventId: row.audit_event_uuid,
    updatedAt: row.updated_at,
  }
}
