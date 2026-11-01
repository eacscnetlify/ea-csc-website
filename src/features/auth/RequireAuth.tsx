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
        className="space-y-3 rounded-xl border border-slate-300 bg-white p-5"
      >
        <p className="wrap-break-word">
          Signed in as <strong>{email}</strong>
        </p>

        {profile && (
          <>
            <p>{profile.full_name}</p>
            <p>
              Assigned functions:{' '}
              {profile.functional_roles.join(', ') || 'None'}
            </p>
          </>
        )}

        <div className="flex flex-wrap items-start gap-3">
          <button
            type="button"
            disabled={checking}
            onClick={refreshAccess}
            className="rounded-lg border border-slate-400 px-5 py-3 font-semibold disabled:opacity-60"
          >
            Refresh access
          </button>
          <SignOutButton />
        </div>

        <Link
          to="/"
          className="inline-block font-semibold text-emerald-800 underline"
        >
          Public library
        </Link>
        <p role="status" className="min-h-6 text-sm text-slate-600">
          {checking ? 'Checking account access…' : ''}
        </p>
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
          <section className="space-y-2">
            <h1 className="text-3xl font-bold">
              No workspace function assigned
            </h1>
            <p>
              Contact the account administrator to check your assigned
              functions.
            </p>
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
