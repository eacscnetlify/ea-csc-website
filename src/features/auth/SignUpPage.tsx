import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'
import { ensureObserverProfile } from './auth.api'

const PROGRAMS = [
  'BS Civil Engineering',
  'BS Electronics Engineering',
  'BS Computer Engineering',
  'BS Architecture',
]

export default function SignUpPage() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [degreeProgram, setDegreeProgram] = useState(PROGRAMS[0])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmNotice, setConfirmNotice] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setConfirmNotice(null)

    try {
      const client = getSupabaseClient()
      const trimmedName = fullName.trim()
      const trimmedSid = studentId.trim()
      const trimmedEmail = email.trim()

      const { data: availData, error: availError } = await client.rpc(
        'eacsc_check_signup_availability',
        {
          p_full_name: trimmedName,
          p_student_id: trimmedSid,
        },
      )
      if (!availError && availData) {
        const avail = availData as {
          name_taken?: boolean
          student_id_taken?: boolean
        }
        if (avail.name_taken) {
          setError(
            'An account with this full name already exists. Please sign in or contact the Council President.',
          )
          return
        }
        if (avail.student_id_taken) {
          setError(
            'This Student ID is already registered. Please sign in or reset your password.',
          )
          return
        }
      }

      const { data, error: signUpError } = await client.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            full_name: trimmedName,
            student_id: trimmedSid,
            degree_program: degreeProgram,
          },
          emailRedirectTo: `${window.location.origin}/account`,
        },
      })

      if (signUpError) {
        if (/already registered|already exists/i.test(signUpError.message)) {
          setError(
            'This email address is already registered. Please sign in or use Forgot Password.',
          )
        } else {
          setError(signUpError.message)
        }
        return
      }

      if (
        data.user &&
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0
      ) {
        setError(
          'This email address is already registered. Please sign in or use Forgot Password.',
        )
        return
      }

      if (data.session) {
        await ensureObserverProfile({
          fullName: trimmedName,
          studentId: trimmedSid,
          degreeProgram,
        })
        void navigate('/account', { replace: true })
      } else {
        setConfirmNotice(
          'Account created! Please check your email inbox for a verification link, then sign in to access your Observer account and request an officer role.',
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account creation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-xl py-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-950 px-6 py-5 text-white border-b-4 border-rose-800 flex items-center gap-4">
          <img
            src="/eacsc-logo-2026.jpg"
            alt="CatSU EA-CSC 2026 Seal"
            className="h-14 w-14 rounded-full border-2 border-slate-400 object-cover shadow"
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-rose-400">
              CatSU College of Engineering & Architecture
            </p>
            <h1 className="text-2xl font-bold tracking-tight">
              Create Student Account
            </h1>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-lg border border-cyan-200 bg-cyan-50/70 px-4 py-3 text-sm text-cyan-950">
            New accounts start as <strong>Student Observer</strong>. Once signed in,
            you can submit an <strong>Officer Role Application</strong> for approval by
            the Council President.
          </div>

          {confirmNotice ? (
            <div
              role="status"
              className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
            >
              <p className="font-semibold">{confirmNotice}</p>
              <Link
                to="/login"
                className="inline-block rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Go to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <fieldset disabled={busy} className="space-y-4">
                <div>
                  <label
                    htmlFor="signup-name"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    Full Name
                  </label>
                  <input
                    id="signup-name"
                    type="text"
                    required
                    placeholder="e.g., Sunny Daniel Soneja"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-rose-700 focus:outline-none"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="signup-student-id"
                      className="block text-sm font-semibold text-slate-800"
                    >
                      Student ID Number
                    </label>
                    <input
                      id="signup-student-id"
                      type="text"
                      required
                      placeholder="e.g., 2024-71909"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-rose-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="signup-program"
                      className="block text-sm font-semibold text-slate-800"
                    >
                      Degree Program
                    </label>
                    <select
                      id="signup-program"
                      value={degreeProgram}
                      onChange={(e) => setDegreeProgram(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-rose-700 focus:outline-none"
                    >
                      {PROGRAMS.map((prog) => (
                        <option key={prog} value={prog}>
                          {prog}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="signup-email"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    Email Address
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    required
                    placeholder="student@catsu.edu.ph"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-rose-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="signup-password"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    Password (minimum 8 characters)
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 pr-11 text-sm focus:border-rose-700 focus:outline-none"
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
              </fieldset>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-rose-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-900 disabled:opacity-50"
              >
                {busy ? 'Creating Account…' : 'Create Observer Account'}
              </button>
            </form>
          )}

          <div className="border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-rose-800 underline">
              Sign In here
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
