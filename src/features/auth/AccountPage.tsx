import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { formatManilaDateTime } from '../../lib/dates'
import { getSupabaseClient } from '../../lib/supabase'
import { ensureObserverProfile, getOfficerProfile } from './auth.api'
import type { OfficerProfile } from './auth.api'
import { useAuth } from './useAuth'

interface RoleRequestRow {
  request_id: string
  applicant_user_id: string
  applicant_name: string
  applicant_email: string
  desired_position: string
  requested_roles: string[]
  student_id: string
  degree_program: string
  justification: string
  status: 'pending' | 'approved' | 'declined'
  review_note: string | null
  reviewed_at: string | null
  created_at: string
}

const POSITION_PRESETS: Array<{
  group: 'Executive Officers' | 'Board Members' | 'Advisory' | 'System Administration'
  label: string
  roles: string[]
}> = [
  // Executive Officers
  { group: 'Executive Officers', label: 'President', roles: ['approver', 'reviewer', 'author', 'custodian'] },
  { group: 'Executive Officers', label: 'Internal Vice President', roles: ['reviewer', 'author'] },
  { group: 'Executive Officers', label: 'External Vice President', roles: ['reviewer', 'author'] },
  { group: 'Executive Officers', label: 'Executive Secretary', roles: ['custodian', 'author', 'approver', 'reviewer'] },
  { group: 'Executive Officers', label: 'Executive Treasurer', roles: ['custodian', 'author'] },
  { group: 'Executive Officers', label: 'Executive Auditor', roles: ['reviewer'] },
  { group: 'Executive Officers', label: 'Business Manager', roles: ['author'] },
  { group: 'Executive Officers', label: 'Public Relations Officer', roles: ['publisher', 'author'] },
  { group: 'Executive Officers', label: 'Board of Director', roles: ['reviewer'] },

  // Board Members
  { group: 'Board Members', label: 'Assistant Secretary', roles: ['custodian', 'author'] },
  { group: 'Board Members', label: 'File Inventory Manager', roles: ['custodian'] },
  { group: 'Board Members', label: 'Auxiliary Secretary', roles: ['author'] },
  { group: 'Board Members', label: 'Assistant Treasurer', roles: ['author'] },
  { group: 'Board Members', label: 'Assistant Auditor', roles: ['reviewer'] },
  { group: 'Board Members', label: 'Graphic Designer', roles: ['author'] },
  { group: 'Board Members', label: 'Editorial', roles: ['author', 'publisher'] },
  { group: 'Board Members', label: 'Documentary Team', roles: ['author'] },
  { group: 'Board Members', label: 'Logistics Coordinator', roles: ['author'] },
  { group: 'Board Members', label: 'Procurement Officer', roles: ['author'] },
  { group: 'Board Members', label: 'Event Chairperson', roles: ['author'] },
  { group: 'Board Members', label: 'Event Organizer', roles: ['author'] },
  { group: 'Board Members', label: 'Assistant Organizer', roles: ['author'] },
  { group: 'Board Members', label: 'Ways and Means', roles: ['author'] },
  { group: 'Board Members', label: 'First Year Representative', roles: ['author'] },
  { group: 'Board Members', label: 'Second Year Representative', roles: ['author'] },
  { group: 'Board Members', label: 'Third Year Representative', roles: ['author'] },
  { group: 'Board Members', label: 'Fourth Year Representative', roles: ['author'] },

  // Advisory & Admin
  { group: 'Advisory', label: 'Adviser', roles: ['reviewer', 'approver'] },
  { group: 'System Administration', label: 'Technical Administrator', roles: ['technical_admin', 'custodian'] },
]

const POSITION_GROUPS = [
  'Executive Officers',
  'Board Members',
  'Advisory',
  'System Administration',
] as const

export default function AccountPage() {
  const { status, session } = useAuth()
  const [profile, setProfile] = useState<OfficerProfile | null>(null)
  const [requests, setRequests] = useState<RoleRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Role request form state
  const [selectedPreset, setSelectedPreset] = useState(POSITION_PRESETS[0].label)
  const [studentId, setStudentId] = useState('')
  const [degreeProgram, setDegreeProgram] = useState('')
  const [justification, setJustification] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!session?.user.id) return
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    try {
      let prof = await getOfficerProfile(session.user.id, controller.signal)
      if (!prof) {
        const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>
        await ensureObserverProfile({
          fullName: typeof meta.full_name === 'string' ? meta.full_name : undefined,
          studentId: typeof meta.student_id === 'string' ? meta.student_id : undefined,
          degreeProgram:
            typeof meta.degree_program === 'string' ? meta.degree_program : undefined,
        })
        prof = await getOfficerProfile(session.user.id, controller.signal)
      }
      setProfile(prof)
      if (prof?.student_id) setStudentId(prof.student_id)
      if (prof?.degree_program) setDegreeProgram(prof.degree_program)

      const { data: reqData, error: reqErr } = await getSupabaseClient().rpc(
        'eacsc_list_role_requests',
      )
      if (!reqErr && Array.isArray(reqData)) {
        setRequests(reqData as RoleRequestRow[])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load account.')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (status !== 'signed-in') return
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [status, loadData])

  if (status === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Loading your account…
      </div>
    )
  }

  if (status !== 'signed-in' || !session) {
    return <Navigate to="/login" replace />
  }

  const isPresident = profile?.functional_roles.includes('approver') ?? false
  const isObserver = (profile?.functional_roles.length ?? 0) === 0
  const pendingRequests = requests.filter((r) => r.status === 'pending')

  async function handleRoleRequest(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setNotice(null)

    try {
      const preset =
        POSITION_PRESETS.find((p) => p.label === selectedPreset) ??
        POSITION_PRESETS[0]
      const { error: rpcErr } = await getSupabaseClient().rpc(
        'eacsc_submit_role_request',
        {
          p_desired_position: preset.label,
          p_requested_roles: preset.roles,
          p_student_id: studentId.trim(),
          p_degree_program: degreeProgram.trim(),
          p_justification: justification.trim(),
        },
      )
      if (rpcErr) throw new Error(rpcErr.message)
      setJustification('')
      setNotice(
        'Your officer role application has been submitted to the Council President for review.',
      )
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDecision(requestId: string, decision: 'approved' | 'declined') {
    setDecidingId(requestId)
    setError(null)
    setNotice(null)
    try {
      const { error: rpcErr } = await getSupabaseClient().rpc(
        'eacsc_decide_role_request',
        {
          p_request_id: requestId,
          p_decision: decision,
          p_review_note:
            decision === 'approved'
              ? 'Approved by Council President.'
              : 'Declined by Council President.',
        },
      )
      if (rpcErr) throw new Error(rpcErr.message)
      setNotice(`Role application ${decision}.`)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed.')
    } finally {
      setDecidingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Account & Role Management
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage your CatSU student verification, password recovery, and council role assignments.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900"
        >
          {error}
        </div>
      )}

      {/* CatSU Portal Style Identity Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-lg font-bold text-white">
              {(profile?.full_name ?? session.user.email ?? 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {profile?.full_name ?? session.user.email}
              </h2>
              <p className="text-xs text-slate-500">
                {profile?.council_position || 'Student Observer'}
                {profile?.student_id ? ` · ID: ${profile.student_id}` : ''}
                {profile?.degree_program ? ` · ${profile.degree_program}` : ''}
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Email Verified
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Email Address
            </p>
            <p className="mt-1 font-medium text-slate-900">{session.user.email}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Assigned Council Roles
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {isObserver ? (
                <span className="rounded-md bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                  Student Observer (Unassigned)
                </span>
              ) : (
                profile?.functional_roles.map((r) => (
                  <span
                    key={r}
                    className="rounded-md bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-900 uppercase"
                  >
                    {r.replace('_', ' ')}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Link
            to="/auth/reset-password"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Change / Reset Password
          </Link>
          {!isObserver && (
            <Link
              to="/officer"
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Open Document Workspace →
            </Link>
          )}
        </div>
      </div>

      {/* President's Role Approval Console */}
      {isPresident && (
        <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                President’s Role Approval Console
              </h2>
              <p className="text-xs text-slate-600">
                Review and approve officer role applications submitted by CatSU students.
              </p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              {pendingRequests.length} Pending
            </span>
          </div>

          {pendingRequests.length === 0 ? (
            <p className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
              No pending officer role requests right now.
            </p>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((req) => (
                <div
                  key={req.request_id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-start justify-between gap-4"
                >
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900">
                      {req.applicant_name}{' '}
                      <span className="font-normal text-slate-500">
                        ({req.applicant_email})
                      </span>
                    </p>
                    <p className="text-xs font-semibold text-rose-800">
                      Applying for: {req.desired_position} ({req.requested_roles.join(', ')})
                    </p>
                    {(req.student_id || req.degree_program) && (
                      <p className="text-xs text-slate-600">
                        Student ID: {req.student_id || '—'} · {req.degree_program || '—'}
                      </p>
                    )}
                    {req.justification && (
                      <p className="mt-1 text-sm text-slate-700 italic">
                        “{req.justification}”
                      </p>
                    )}
                    <p className="text-[11px] text-slate-400">
                      Submitted {formatManilaDateTime(req.created_at)}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={decidingId === req.request_id}
                      onClick={() => void handleDecision(req.request_id, 'approved')}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      Approve Role
                    </button>
                    <button
                      type="button"
                      disabled={decidingId === req.request_id}
                      onClick={() => void handleDecision(req.request_id, 'declined')}
                      className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Apply for Council Role Form (Visible for Observers or Officers requesting additional roles) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Apply for Council Officer Role
          </h2>
          <p className="text-xs text-slate-600">
            Select your appointed EA-CSC position. The Council President will verify and activate your officer access.
          </p>
        </div>

        <form onSubmit={handleRoleRequest} className="space-y-4">
          <div>
            <label
              htmlFor="role-preset"
              className="block text-sm font-semibold text-slate-800"
            >
              Council Position & Role Package
            </label>
            <select
              id="role-preset"
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-rose-700 focus:outline-none"
            >
              {POSITION_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {POSITION_PRESETS.filter((p) => p.group === group).map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label} ({p.roles.map((r) => r.replace('_', ' ')).join(', ')})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="req-student-id"
                className="block text-sm font-semibold text-slate-800"
              >
                Student ID
              </label>
              <input
                id="req-student-id"
                type="text"
                required
                placeholder="2024-71909"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-rose-700 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="req-program"
                className="block text-sm font-semibold text-slate-800"
              >
                Degree Program
              </label>
              <input
                id="req-program"
                type="text"
                required
                placeholder="BS Electronics Engineering"
                value={degreeProgram}
                onChange={(e) => setDegreeProgram(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-rose-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="req-justification"
              className="block text-sm font-semibold text-slate-800"
            >
              Appointment Reference / Justification
            </label>
            <textarea
              id="req-justification"
              rows={2}
              required
              placeholder="e.g., Elected VP Internal for AY 2026-2027, or Appointed Committee Head for Engineering Week."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-rose-700 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || loading}
            className="rounded-lg bg-rose-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-900 disabled:opacity-50"
          >
            {submitting ? 'Submitting Request…' : 'Submit Role Application'}
          </button>
        </form>

        {requests.filter((r) => r.applicant_user_id === session.user.id).length > 0 && (
          <div className="pt-4 border-t border-slate-100 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Your Submitted Applications
            </h3>
            {requests
              .filter((r) => r.applicant_user_id === session.user.id)
              .map((r) => (
                <div
                  key={r.request_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm"
                >
                  <div>
                    <span className="font-semibold text-slate-900">
                      {r.desired_position}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {formatManilaDateTime(r.created_at)}
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                      r.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-800'
                        : r.status === 'declined'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Role Capabilities & Account Security Reference */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Role Capabilities &amp; Security Reference
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Quick overview of what each functional role unlocks across the EA-CSC IIDGS portal.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
            <p className="font-bold text-slate-900 uppercase">Author</p>
            <p className="mt-1 leading-relaxed text-slate-600">
              Create and edit Draft notes, upload PDF/DOCX/PNG/JPEG files (up to 10 MB), and submit versions for 6-point review.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
            <p className="font-bold text-slate-900 uppercase">Custodian</p>
            <p className="mt-1 leading-relaxed text-slate-600">
              Maintain assigned council records, compile Update Bulletins, and prepare end-of-term Turnover packages.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
            <p className="font-bold text-slate-900 uppercase">Reviewer</p>
            <p className="mt-1 leading-relaxed text-slate-600">
              Inspect non-authored submissions in Review Queue, run the 6-point verification checklist, or Return for Correction.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
            <p className="font-bold text-slate-900 uppercase">Approver</p>
            <p className="mt-1 leading-relaxed text-slate-600">
              Grant Substantive Approval after all 6 checklist points pass, and review pending officer role applications.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
            <p className="font-bold text-slate-900 uppercase">Publisher</p>
            <p className="mt-1 leading-relaxed text-slate-600">
              Publish Approved releases immediately or on a schedule, supersede prior versions, or execute emergency Withdrawals.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
            <p className="font-bold text-slate-900 uppercase">Technical Admin</p>
            <p className="mt-1 leading-relaxed text-slate-600">
              Transfer document custody, update officer roles, and deactivate outgoing accounts during Access Transfer.
            </p>
          </div>
        </div>

        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
          <strong>Tip:</strong> After the Council President approves your role application, click{' '}
          <strong>Refresh</strong> in the top bar to sync your new Officer Operations menu immediately.
        </p>
      </div>
    </div>
  )
}
