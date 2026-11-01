import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../../lib/supabase'
import type { AssignedVersion } from '../workspace/workspace.api'

interface ReviewComment {
  commentId: string
  versionNumber: number
  text: string
  reviewedRevision: number
  returnedRevision: number
  createdAt: string
}

type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; comments: ReviewComment[]; truncated: boolean }

async function loadReviewHistory(
  userId: string,
  recordId: string,
  versions: AssignedVersion[],
  signal: AbortSignal,
): Promise<ReviewComment[]> {
  const client = getSupabaseClient()

  async function checkActor() {
    const { data, error } = await client.auth.getSession()
    if (
      signal.aborted ||
      error ||
      data.session?.user.id !== userId ||
      data.session.user.is_anonymous
    ) {
      throw new Error('Session changed.')
    }
  }

  await checkActor()
  if (versions.length === 0) return []

  const { data, error } = await client
    .from('review_comments')
    .select(
      'comment_id,record_id,version_id,comment_text,reviewed_revision,returned_revision,created_at',
    )
    .eq('record_id', recordId)
    .in(
      'version_id',
      versions.map((v) => v.versionId),
    )
    .order('created_at', { ascending: false })
    .order('comment_id', { ascending: false })
    .limit(51)
    .abortSignal(signal)

  await checkActor()
  if (error || !Array.isArray(data)) {
    throw new Error('History unavailable.')
  }

  return data.map((row: Record<string, unknown>) => {
    const version = versions.find((v) => v.versionId === row.version_id)

    if (
      !version ||
      row.record_id !== recordId ||
      typeof row.comment_id !== 'string' ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.comment_id) ||
      typeof row.comment_text !== 'string' ||
      !row.comment_text.trim() ||
      [...row.comment_text].length > 2000 ||
      typeof row.reviewed_revision !== 'number' ||
      !Number.isSafeInteger(row.reviewed_revision) ||
      row.reviewed_revision < 1 ||
      row.returned_revision !== row.reviewed_revision + 1 ||
      typeof row.created_at !== 'string' ||
      !Number.isFinite(Date.parse(row.created_at))
    ) {
      throw new Error('Invalid review history.')
    }

    return {
      commentId: row.comment_id,
      versionNumber: version.versionNumber,
      text: row.comment_text,
      reviewedRevision: row.reviewed_revision,
      returnedRevision: row.returned_revision as number,
      createdAt: row.created_at,
    }
  })
}

export default function ReviewHistory({
  userId,
  recordId,
  versions,
}: {
  userId: string
  recordId: string
  versions: AssignedVersion[]
}) {
  const [state, setState] = useState<HistoryState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10_000)

    void loadReviewHistory(userId, recordId, versions, controller.signal)
      .then((comments) => {
        if (!disposed) {
          setState({
            status: 'ready',
            comments: comments.slice(0, 50),
            truncated: comments.length > 50,
          })
        }
      })
      .catch(() => {
        if (!disposed) setState({ status: 'error' })
      })
      .finally(() => window.clearTimeout(timer))

    return () => {
      disposed = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [userId, recordId, versions, attempt])

  return (
    <section
      aria-label="Review return history"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
    >
      <h3 className="text-xl font-bold">Review return history</h3>

      {state.status === 'loading' && (
        <p role="status">Loading review comments…</p>
      )}

      {state.status === 'error' && (
        <div className="space-y-2">
          <p role="alert">
            Review comments could not be loaded. Check your connection and
            current access.
          </p>
          <button
            type="button"
            className="rounded-lg border border-emerald-800 px-4 py-2 font-semibold"
            onClick={() => {
              setState({ status: 'loading' })
              setAttempt((n) => n + 1)
            }}
          >
            Reload review comments
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {state.comments.length === 0 ? (
            <p>
              No return comments are available for the versions shown below.
            </p>
          ) : (
            <ul className="list-none space-y-4 p-0">
              {state.comments.map((comment) => (
                <li
                  key={comment.commentId}
                  className="space-y-2 border-l-4 border-amber-400 pl-4"
                >
                  <h4 className="font-semibold">
                    Version {comment.versionNumber} — returned for correction
                  </h4>
                  <p className="text-sm text-slate-600">
                    Reviewed edit revision {comment.reviewedRevision} · Returned
                    as edit revision {comment.returnedRevision}
                  </p>
                  <p className="whitespace-pre-wrap wrap-break-word">
                    {comment.text}
                  </p>
                  <time
                    className="block text-sm text-slate-600"
                    dateTime={comment.createdAt}
                  >
                    {new Intl.DateTimeFormat('en-PH', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Manila',
                    }).format(new Date(comment.createdAt))}
                  </time>
                </li>
              ))}
            </ul>
          )}

          {state.truncated && (
            <p className="text-sm text-slate-600">
              Showing the latest 50 return comments for the versions shown
              below.
            </p>
          )}
        </>
      )}
    </section>
  )
}
