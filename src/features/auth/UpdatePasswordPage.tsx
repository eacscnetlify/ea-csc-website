import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'
import { useAuth } from './useAuth'

export default function UpdatePasswordPage() {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'editing' | 'updated' | 'finished'>(
    'editing',
  )
  const [error, setError] = useState<string | null>(null)

  const [callbackFailed] = useState(() => {
    const query = new URLSearchParams(window.location.search)
    const fragment = new URLSearchParams(window.location.hash.slice(1))

    return (
      query.has('error') ||
      query.has('error_code') ||
      fragment.has('error') ||
      fragment.has('error_code')
    )
  })

  async function finishSignOut() {
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const { error: signOutError } = await getSupabaseClient().auth.signOut({
        scope: 'local',
      })

      if (signOutError) {
        setError(
          'Your password was updated, but sign-out could not be confirmed. Check your connection and try finishing again.',
        )
        return
      }

      setPhase('finished')
    } catch {
      setError(
        'Your password was updated, but sign-out could not be confirmed. Check your connection and try finishing again.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (busy || !auth.session) {
      return
    }

    setError(null)

    if (password.length < 8) {
      setError('Use at least eight characters.')
      return
    }

    if (new TextEncoder().encode(password).length > 72) {
      setError('This password is too long. Use a shorter passphrase.')
      return
    }

    if (password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    let passwordWasUpdated = false

    try {
      const client = getSupabaseClient()

      const { data: identity, error: identityError } =
        await client.auth.getUser()

      if (
        identityError ||
        !identity.user ||
        identity.user.id !== auth.session.user.id ||
        identity.user.is_anonymous
      ) {
        setError(
          'Your session could not be verified. Request a fresh recovery link.',
        )
        return
      }

      const { error: updateError } = await client.auth.updateUser({
        password,
      })

      if (updateError) {
        let message =
          'The password could not be updated. Request a fresh recovery link if your session has expired.'

        if (updateError.code === 'same_password') {
          message = 'Choose a password different from your current password.'
        } else if (updateError.code === 'weak_password') {
          message =
            'Choose a longer, stronger password that meets the account password requirements.'
        } else if (updateError.status === 429) {
          message = 'Too many attempts. Please wait before trying again.'
        }

        setError(message)
        return
      }

      passwordWasUpdated = true
      setPassword('')
      setConfirmation('')
      setPhase('updated')

      const { error: signOutError } = await client.auth.signOut({
        scope: 'local',
      })

      if (signOutError) {
        setError(
          'Your password was updated, but sign-out could not be confirmed. Check your connection and use Finish and sign out.',
        )
        return
      }

      setPhase('finished')
    } catch {
      setError(
        passwordWasUpdated
          ? 'Your password was updated, but sign-out could not be confirmed. Check your connection and use Finish and sign out.'
          : 'The password update could not be confirmed. Check your connection, then try signing in or request a fresh recovery link.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (phase !== 'editing') {
    return (
      <section className="mx-auto max-w-lg space-y-5">
        <h1 className="text-3xl font-bold">Password updated</h1>

        {phase === 'finished' ? (
          <>
            <p role="status">
              Your password was updated and this session was signed out. Sign in
              again using your new password.
            </p>
            <Link
              to="/login"
              className="inline-block font-semibold text-emerald-800 underline"
            >
              Go to officer sign-in
            </Link>
          </>
        ) : (
          <>
            <p role="status">
              Your password was updated. Finish signing out before continuing.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={finishSignOut}
              className="rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Finishing…' : 'Finish and sign out'}
            </button>
          </>
        )}

        {error && <p role="alert">{error}</p>}
      </section>
    )
  }

  if (auth.status === 'loading') {
    return <p role="status">Checking your password-update session…</p>
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

  if (
    callbackFailed ||
    auth.status !== 'signed-in' ||
    !auth.session ||
    auth.session.user.is_anonymous
  ) {
    return (
      <section className="mx-auto max-w-lg space-y-4">
        <h1 className="text-3xl font-bold">A valid session is required</h1>
        <p>
          Open a valid password-recovery link or sign in to update your own
          password. Recovery links can expire or have already been used.
        </p>
        <Link
          to="/auth/reset-password"
          className="inline-block font-semibold text-emerald-800 underline"
        >
          Request a recovery link
        </Link>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-lg space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Set your password</h1>
        <p className="wrap-break-word">
          Update the password for <strong>{auth.session.user.email}</strong>.
        </p>
        <p>
          Use at least eight characters. Your account may require additional
          password strength.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <legend className="sr-only">New password</legend>

          <div className="space-y-2">
            <label htmlFor="new-password" className="block font-semibold">
              New password
            </label>
            <input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-400 bg-white px-3 py-3 text-slate-950"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="confirm-password" className="block font-semibold">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full rounded-lg border border-slate-400 bg-white px-3 py-3 text-slate-950"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Updating password…' : 'Update password'}
          </button>
        </fieldset>

        {busy && <p role="status">Updating your password. Please wait.</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  )
}
