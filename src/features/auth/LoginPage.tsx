import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'
import { useAuth } from './useAuth'

export default function LoginPage() {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const submitting = useRef(false)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting.current) {
      return
    }

    submitting.current = true
    setBusy(true)
    setError(null)

    try {
      const { data, error: signInError } =
        await getSupabaseClient().auth.signInWithPassword({
          email: email.trim(),
          password,
        })

      if (signInError) {
        let message = 'Sign-in failed. Check your connection and try again.'

        if (signInError.code === 'invalid_credentials') {
          message = 'The email or password is incorrect.'
        } else if (signInError.code === 'email_not_confirmed') {
          message =
            'This account has not confirmed its email. Contact the account administrator.'
        } else if (signInError.status === 429) {
          message = 'Too many attempts. Please wait before trying again.'
        }

        if (mounted.current) {
          setError(message)
        }

        return
      }

      if (!data.session && mounted.current) {
        setError('Sign-in did not create a session. Please try again.')
      }

      if (mounted.current) {
        setPassword('')
      }
    } catch {
      if (mounted.current) {
        setError('Sign-in is unavailable. Check your connection and try again.')
      }
    } finally {
      submitting.current = false

      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  if (auth.status === 'loading') {
    return <p role="status">Checking your session…</p>
  }

  if (auth.status === 'error') {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold">Officer sign-in unavailable</h1>
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

  if (auth.status === 'signed-in') {
    return <Navigate to="/officer" replace />
  }

  return (
    <section className="mx-auto max-w-lg space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Officer sign-in</h1>
        <p>
          Sign in with your assigned council account. Workspace access also
          requires an active application profile.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <legend className="sr-only">Account credentials</legend>

          <div className="space-y-2">
            <label htmlFor="officer-email" className="block font-semibold">
              Email address
            </label>
            <input
              id="officer-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-400 bg-white px-3 py-3 text-slate-950"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="officer-password" className="block font-semibold">
              Password
            </label>
            <input
              id="officer-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-400 bg-white px-3 py-3 text-slate-950"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </fieldset>

        {busy && <p role="status">Signing in. Please wait.</p>}
        {error && <p role="alert">{error}</p>}
      </form>

      <Link to="/" className="font-semibold text-emerald-800 underline">
        Back to public library
      </Link>
    </section>
  )
}
