import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'
import { getOfficerProfile } from './auth.api'
import type { OfficerProfile } from './auth.api'
import { useAuth } from './useAuth'

type ProfileState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profile: OfficerProfile | null }

function SignOutButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const mounted = useRef(false)
  const submitting = useRef(false)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  async function handleSignOut() {
    if (submitting.current) {
      return
    }

    submitting.current = true
    setBusy(true)
    setError(false)

    try {
      const { error: signOutError } = await getSupabaseClient().auth.signOut({
        scope: 'local',
      })

      if (signOutError && mounted.current) {
        setError(true)
      }
    } catch {
      if (mounted.current) {
        setError(true)
      }
    } finally {
      submitting.current = false

      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={handleSignOut}
        className="rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>

      {error && (
        <p role="alert">
          Sign-out could not be fully completed. Check your connection and try
          again.
        </p>
      )}
    </div>
  )
}

function OfficerProfileGate({
  userId,
  email,
  children,
}: {
  userId: string
  email: string
  children: ReactNode
}) {
  const [state, setState] = useState<ProfileState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [checking, setChecking] = useState(true)
  const checkInFlight = useRef(true)

  const refreshAccess = useCallback(() => {
    // Coalesce focus events while the existing access check is running.
    if (checkInFlight.current) return
    checkInFlight.current = true
    setChecking(true)
    setAttempt((current) => current + 1)
  }, [])

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()

    const timeoutId = window.setTimeout(() => {
      controller.abort()
    }, 10_000)

    void getOfficerProfile(userId, controller.signal)
      .then((profile) => {
        if (!disposed) {
          setState({ status: 'ready', profile })
        }
      })
      .catch(() => {
        if (!disposed) {
          setState({ status: 'error' })
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
        if (!disposed) {
          checkInFlight.current = false
          setChecking(false)
        }
      })

    return () => {
      disposed = true
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [userId, attempt])

  useEffect(() => {
    window.addEventListener('focus', refreshAccess)

    return () => {
      window.removeEventListener('focus', refreshAccess)
    }
  }, [refreshAccess])

  const profile = state.status === 'ready' ? state.profile : null
  const hasAccess =
    profile?.is_active === true && profile.functional_roles.length > 0

  return (
    <div className="space-y-6">
      <section
        aria-label="Your account"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shadow-sm">
              {(profile?.full_name || email).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-base font-bold text-slate-900">
                  {profile?.full_name || email}
                </p>
                {profile?.council_position && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                    {profile.council_position}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-slate-500">
                Signed in as <span className="font-medium text-slate-700">{email}</span>
              </p>
              {profile && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Functions:
                  </span>
                  {profile.functional_roles.length > 0 ? (
                    profile.functional_roles.map((role) => (
                      <span
                        key={role}
                        className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800"
                      >
                        {role.replace('_', ' ')}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      Observer (Read-only)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {state.status === 'error' && (
        <section className="space-y-2">
          <h1 className="text-3xl font-bold">Access could not be checked</h1>
          <p role="alert">
            Your profile could not be loaded. Check your connection and use
            Refresh access to try again.
          </p>
        </section>
      )}

      {state.status === 'ready' && !profile && (
        <section className="space-y-2">
          <h1 className="text-3xl font-bold">
            Application profile unavailable
          </h1>
          <p>
            Your account is signed in, but no accessible application profile was
            found. Contact the account administrator.
          </p>
        </section>
      )}

      {profile && !profile.is_active && (
        <section className="space-y-2">
          <h1 className="text-3xl font-bold">Account inactive</h1>
          <p>
            Your account is signed in, but workspace access is inactive. Contact
            the account administrator.
          </p>
        </section>
      )}

      {profile &&
        profile.is_active &&
        profile.functional_roles.length === 0 && (
          <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-6">
            <h1 className="text-2xl font-bold text-slate-900">
              Student Observer Account
            </h1>
            <p className="text-sm text-slate-700">
              You are currently signed in as a <strong>Student Observer</strong>{' '}
              without an active council officer role. To access the Document
              Workspace, Review Queue, or Release Panel, please submit an officer
              role application for approval by the Council President.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link
                to="/account"
                className="rounded-lg bg-rose-800 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-900"
              >
                Apply for Officer Role
              </Link>
              <Link
                to="/"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Return to Home Lobby
              </Link>
            </div>
          </section>
        )}

      {hasAccess && (
        // Keep the last authorized view in place during revalidation. Inert
        // blocks interaction; a failed or denied check removes this view.
        <div inert={checking} aria-busy={checking}>
          {children}
        </div>
      )}
    </div>
  )
}

export default function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth()

  if (auth.status === 'loading') {
    return <p role="status">Checking your session…</p>
  }

  if (auth.status === 'error') {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold">Session unavailable</h1>
        <p role="alert">{auth.error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white"
        >
          Reload page
        </button>
      </section>
    )
  }

  if (auth.status !== 'signed-in' || !auth.session) {
    return <Navigate to="/login" replace />
  }

  if (auth.session.user.is_anonymous || auth.isPasswordRecovery) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold">Workspace access unavailable</h1>
        <p>
          A permanent account in a normal sign-in session is required. Complete
          any password recovery before opening the workspace.
        </p>
        <SignOutButton />
      </section>
    )
  }

  return (
    <OfficerProfileGate
      key={auth.session.user.id}
      userId={auth.session.user.id}
      email={auth.session.user.email ?? 'Council account'}
    >
      {children}
    </OfficerProfileGate>
  )
}
