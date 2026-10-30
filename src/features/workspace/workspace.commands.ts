import { updateDraftNotes, WorkspaceError } from './workspace.api'
import type { DraftReceipt, DraftRequest } from './workspace.api'

export interface DraftAttempt {
  readonly request: Readonly<DraftRequest>
  status: 'sending' | 'uncertain' | 'confirmed' | 'rejected'
  receipt?: DraftReceipt
  error?: WorkspaceError
  promise?: Promise<DraftReceipt>
}
// Memory only, isolated by actor and version. Survives profile-gate remounts,
// never writes private notes to local/session storage or a public mock service.
const attempts = new Map<string, DraftAttempt>()
const key = (actorId: string, versionId: string) => `${actorId}:${versionId}`
export const findDraftAttempt = (actorId: string, versionId: string) =>
  attempts.get(key(actorId, versionId))
export function createDraftAttempt(request: DraftRequest): DraftAttempt {
  const previous = findDraftAttempt(request.actorId, request.versionId)
  if (previous && previous.status !== 'rejected') return previous
  const attempt: DraftAttempt = {
    request: Object.freeze({ ...request }),
    status: 'uncertain',
  }
  attempts.set(key(request.actorId, request.versionId), attempt)
  return attempt
}
export function forgetDraftAttempt(attempt: DraftAttempt) {
  if (attempt.status === 'sending' || attempt.status === 'uncertain') return
  if (
    findDraftAttempt(attempt.request.actorId, attempt.request.versionId) ===
    attempt
  )
    attempts.delete(key(attempt.request.actorId, attempt.request.versionId))
}
export function sendDraftAttempt(attempt: DraftAttempt): Promise<DraftReceipt> {
  if (attempt.status === 'sending' && attempt.promise) return attempt.promise
  if (attempt.status === 'confirmed' && attempt.receipt)
    return Promise.resolve(attempt.receipt)
  attempt.status = 'sending'
  attempt.error = undefined
  const promise = updateDraftNotes({ ...attempt.request })
    .then((receipt) => {
      attempt.status = 'confirmed'
      attempt.receipt = receipt
      return receipt
    })
    .catch((error: unknown) => {
      const failure =
        error instanceof WorkspaceError
          ? error
          : new WorkspaceError(
              'uncertain',
              'The save could not be confirmed. Retry the same save before making another edit.',
            )
      attempt.status = failure.kind === 'uncertain' ? 'uncertain' : 'rejected'
      attempt.error = failure
      if (attempt.status === 'rejected') forgetDraftAttempt(attempt)
      throw failure
    })
  attempt.promise = promise
  return promise
}
