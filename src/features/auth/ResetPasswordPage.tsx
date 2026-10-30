import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const redirectTo = new URL(
        '/auth/update-password',
        window.location.origin,
      ).href

      const { error: requestError } =
        await getSupabaseClient().auth.resetPasswordForEmail(email.trim(), {
          redirectTo,
        })

      if (requestError) {
        setError(
          requestError.status === 429
            ? 'Too many recovery requests. Please wait before trying again.'
            : 'Recovery email could not be requested. Try again later or contact the account administrator.',
        )
        return
      }

      setRequested(true)
    } catch {
      setError(
        'The recovery request could not be completed. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-lg space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Reset your password</h1>
        <p>Enter the email address associated with your council account.</p>
      </div>

      {requested ? (
        <div role="status" className="space-y-3">
          <p>
            If an eligible account matches that address, check its inbox for a
            password-recovery link.
          </p>
          <p>
            Check your spam folder too. Use the newest recovery email and open
            its link on this computer.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            <legend className="sr-only">Password recovery request</legend>

            <div className="space-y-2">
              <label htmlFor="recovery-email" className="block font-semibold">
                Email address
              </label>
              <input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-slate-400 bg-white px-3 py-3 text-slate-950"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Requesting link…' : 'Request recovery link'}
            </button>
          </fieldset>

          {busy && <p role="status">Requesting a recovery link…</p>}
          {error && <p role="alert">{error}</p>}
        </form>
      )}

      <Link
        to="/login"
        className="inline-block font-semibold text-emerald-800 underline"
      >
        Back to officer sign-in
      </Link>
    </section>
  )
}
