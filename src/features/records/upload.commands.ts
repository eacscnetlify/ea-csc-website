import {
  acceptUpload,
  inspectUpload,
  prepareUpload,
  stageUpload,
  UploadError,
} from './upload.api'
import type { PreparedUpload, UploadReceipt, UploadRequest } from './upload.api'

export interface UploadAttempt {
  readonly request: Readonly<UploadRequest>
  status: 'ready' | 'sending' | 'uncertain' | 'rejected' | 'confirmed'
  phase:
    | 'Preparing upload'
    | 'Checking previous result'
    | 'Uploading file bytes'
    | 'Verifying and accepting Draft'
  prepared?: PreparedUpload
  receipt?: UploadReceipt
  error?: UploadError
  controller?: AbortController
  promise?: Promise<void>
  acceptanceUncertain: boolean
}
// Private file and notes stay in memory, isolated by actor and record. No writes
// to localStorage/sessionStorage and no automatic retries from React effects.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const attempts = new Map<string, UploadAttempt>()
const listeners = new Set<() => void>()
let revision = 0
const key = (actorId: string, recordId: string) => `${actorId}:${recordId}`
export const uploadSnapshot = () => revision
export function subscribeUploads(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function changed() {
  revision++
  listeners.forEach((listener) => listener())
}
export const findUploadAttempt = (actorId: string, recordId: string) =>
  attempts.get(key(actorId, recordId))

export function createUploadAttempt(request: UploadRequest): UploadAttempt {
  const existing = findUploadAttempt(request.actorId, request.recordId)
  if (existing) return existing
  if (
    !uuid.test(request.actorId) ||
    !uuid.test(request.prepareId) ||
    !uuid.test(request.acceptId) ||
    request.prepareId === request.acceptId ||
    !/^EACSC-[1-9][0-9]{3}-[A-Z]{2,10}-[0-9]{4}$/.test(request.recordId) ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 1 ||
    request.expectedRevision >= 2147483647 ||
    !request.notes.trim() ||
    Array.from(request.notes).length > 2000 ||
    ![
      'initial_capture',
      'preventable_correction',
      'legitimate_change',
    ].includes(request.classification) ||
    !/^[0-9a-f]{64}$/.test(request.sha256)
  )
    throw new UploadError(
      'validation',
      'Check the selected record, file and notes before uploading.',
    )
  const attempt: UploadAttempt = {
    request: Object.freeze({ ...request, notes: request.notes.trim() }),
    status: 'ready',
    phase: 'Preparing upload',
    acceptanceUncertain: false,
  }
  attempts.set(key(request.actorId, request.recordId), attempt)
  changed()
  return attempt
}

export function forgetUploadAttempt(attempt: UploadAttempt) {
  if (!['confirmed', 'rejected'].includes(attempt.status)) return
  if (
    findUploadAttempt(attempt.request.actorId, attempt.request.recordId) ===
    attempt
  ) {
    attempts.delete(key(attempt.request.actorId, attempt.request.recordId))
    changed()
  }
}
export function pauseUpload(attempt: UploadAttempt) {
  attempt.controller?.abort()
}

export function sendUploadAttempt(attempt: UploadAttempt): Promise<void> {
  if (attempt.status === 'sending' && attempt.promise) return attempt.promise
  if (attempt.status === 'confirmed' || attempt.status === 'rejected')
    return Promise.resolve()
  const controller = new AbortController()
  attempt.controller = controller
  attempt.status = 'sending'
  attempt.error = undefined
  changed()
  function phase(value: UploadAttempt['phase']) {
    attempt.phase = value
    changed()
    controller.signal.throwIfAborted()
  }
  const promise = (async () => {
    try {
      if (!attempt.prepared) {
        phase('Preparing upload')
        attempt.prepared = await prepareUpload(
          attempt.request,
          controller.signal,
        )
      }
      phase('Checking previous result')
      const earlier = await inspectUpload(
        attempt.request,
        attempt.prepared,
        controller.signal,
      )
      if (earlier) attempt.receipt = earlier
      else {
        // A ready context confirms this acceptance has not committed yet.
        attempt.acceptanceUncertain = false
        phase('Uploading file bytes')
        await stageUpload(attempt.request, attempt.prepared, controller.signal)
        phase('Verifying and accepting Draft')
        attempt.acceptanceUncertain = true
        try {
          attempt.receipt = await acceptUpload(
            attempt.request,
            attempt.prepared,
            controller.signal,
          )
        } catch (error) {
          // Explicit validation/conflict replies are definitive. A denial or a
          // lost reply after acceptance may hide a commit; preserve that attempt.
          if (
            error instanceof UploadError &&
            [400, 409, 422].includes(error.status)
          )
            attempt.acceptanceUncertain = false
          throw error
        }
      }
      attempt.status = 'confirmed'
      attempt.acceptanceUncertain = false
    } catch (error) {
      const failure =
        error instanceof UploadError
          ? error
          : new UploadError(
              'uncertain',
              'Waiting stopped before the result was confirmed. Retry the same upload to recover its result.',
            )
      attempt.error = failure
      attempt.status =
        failure.kind === 'uncertain' || attempt.acceptanceUncertain
          ? 'uncertain'
          : 'rejected'
    } finally {
      attempt.controller = undefined
      changed()
    }
  })()
  attempt.promise = promise
  return promise
}
