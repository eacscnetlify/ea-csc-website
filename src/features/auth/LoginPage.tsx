import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'
import { getOfficerProfile } from './auth.api'
import { useAuth } from './useAuth'

export default function LoginPage() {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [redirectPath, setRedirectPath] = useState<string | null>(null)
  const mounted = useRef(false)
  const submitting = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (auth.status !== 'signed-in' || !auth.session?.user.id) return
    const controller = new AbortController()
    void getOfficerProfile(auth.session.user.id, controller.signal)
      .then((prof) => {
        if (!mounted.current) return
        if (prof && prof.is_active && prof.functional_roles.length > 0) {
          setRedirectPath('/officer')
        } else {
          setRedirectPath('/account')
        }
      })
      .catch(() => {
        if (mounted.current) setRedirectPath('/account')
      })
    return () => controller.abort()
  }, [auth.status, auth.session])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return

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
            'This account has not confirmed its email. Please check your inbox or contact the administrator.'
        } else if (signInError.status === 429) {
          message = 'Too many attempts. Please wait before trying again.'
        }
        if (mounted.current) setError(message)
        return
      }

      if (!data.session && mounted.current) {
        setError('Sign-in did not create a session. Please try again.')
      }

      if (mounted.current) setPassword('')
    } catch {
      if (mounted.current) {
        setError('Sign-in is unavailable. Check your connection and try again.')
      }
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }

  if (auth.status === 'loading') {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Checking your session…
      </div>
    )
  }

  if (auth.status === 'error') {
    return (
      <section className="mx-auto max-w-lg space-y-4 rounded-xl border border-red-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-slate-900">Sign-in unavailable</h1>
        <p role="alert" className="text-sm text-red-700">{auth.error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-rose-800 px-5 py-2.5 text-sm font-semibold text-white"
        >
          Reload page
        </button>
      </section>
    )
  }

  if (auth.status === 'signed-in') {
    if (!redirectPath) {
      return (
        <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Loading your council access…
        </div>
      )
    }
    return <Navigate to={redirectPath} replace />
  }

  return (
    <section className="mx-auto max-w-lg py-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-950 px-6 py-5 text-white border-b-4 border-rose-800 flex items-center gap-4">
          <img
            src="/eacsc-logo-2026.jpg"
            alt="CatSU EA-CSC 2026 Seal"
            className="h-14 w-14 rounded-full border-2 border-slate-400 object-cover shadow"
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-rose-400">
              CatSU EA-CSC Portal
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Sign In</h1>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-slate-600">
            Sign in with your student or council officer account. New student
            members start as Observers and can request an officer role inside.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <fieldset disabled={busy} className="space-y-4">
              <legend className="sr-only">Account credentials</legend>

              <div className="space-y-1.5">
                <label
                  htmlFor="officer-email"
                  className="block text-sm font-semibold text-slate-800"
                >
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950 focus:border-rose-700 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="officer-password"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    Password
                  </label>
                  <Link
                    to="/auth/reset-password"
                    className="text-xs font-semibold text-rose-800 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="officer-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 pr-11 text-sm text-slate-950 focus:border-rose-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800"
                  >
                    {showPassword ? (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-rose-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-900 disabled:opacity-60"
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </fieldset>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800"
              >
                {error}
              </p>
            )}
          </form>

          <div className="border-t border-slate-100 pt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-600">
              New student?{' '}
              <Link to="/signup" className="font-semibold text-rose-800 underline">
                Create account
              </Link>
            </span>
            <Link to="/" className="font-semibold text-slate-600 hover:text-slate-900">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
