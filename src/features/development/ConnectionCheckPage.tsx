import { useState } from 'react'
import { Link } from 'react-router'
import { getSupabaseClient } from '../../lib/supabase'

interface ConnectionResponse {
  status: 'ok'
  service: 'ea-csc-records'
  server_time: string
}

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'error'; message: string }
  | {
      status: 'success'
      response: ConnectionResponse
    }

function isConnectionResponse(value: unknown): value is ConnectionResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'ok' &&
    'service' in value &&
    value.service === 'ea-csc-records' &&
    'server_time' in value &&
    typeof value.server_time === 'string' &&
    Number.isFinite(Date.parse(value.server_time))
  )
}

export default function ConnectionCheckPage() {
  const [state, setState] = useState<CheckState>({
    status: 'idle',
  })

  async function checkConnection() {
    setState({ status: 'checking' })

    try {
      const supabase = getSupabaseClient()

      const { data, error } = await supabase
        .rpc('eacsc_connection_check')
        .abortSignal(AbortSignal.timeout(10000))

      if (error) {
        throw new Error(error.message)
      }

      const response: unknown = data

      if (!isConnectionResponse(response)) {
        throw new Error(
          'The database returned an unexpected connection-check response.',
        )
      }

      setState({ status: 'success', response })
    } catch (error) {
      setState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The connection check failed.',
      })
    }
  }

  return (
    <section aria-labelledby="connection-heading">
      <Link
        to="/"
        className="rounded font-semibold text-green-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
      >
        Back to public library
      </Link>

      <p className="mt-6 text-sm font-semibold text-green-800">
        DEVELOPMENT CHECK
      </p>

      <h1
        id="connection-heading"
        className="mt-2 text-3xl font-bold text-slate-900"
      >
        Supabase connection
      </h1>

      <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
        This check calls the database using the project publishable key. It
        retrieves connection status and server time without reading application
        records.
      </p>

      <button
        type="button"
        onClick={checkConnection}
        disabled={state.status === 'checking'}
        className="mt-6 rounded-lg bg-green-800 px-5 py-3 font-semibold text-white hover:bg-green-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 disabled:cursor-wait disabled:opacity-60"
      >
        {state.status === 'checking' ? 'Checking…' : 'Check connection'}
      </button>

      <div className="mt-6" aria-busy={state.status === 'checking'}>
        {state.status === 'idle' && (
          <p className="text-sm text-slate-600">
            Select Check connection to start.
          </p>
        )}

        {state.status === 'checking' && (
          <p role="status" className="text-slate-600">
            Contacting Supabase…
          </p>
        )}

        {state.status === 'error' && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-5"
          >
            <h2 className="font-bold text-red-900">Connection check failed</h2>
            <p className="mt-2 wrap-break-word text-sm leading-6 text-red-800">
              {state.message}
            </p>
          </div>
        )}

        {state.status === 'success' && (
          <div
            role="status"
            className="rounded-xl border border-green-200 bg-green-50 p-5"
          >
            <h2 className="text-lg font-bold text-green-900">
              Connected successfully
            </h2>

            <dl className="mt-4 space-y-4 text-sm text-green-950">
              <div>
                <dt className="font-semibold">Service</dt>
                <dd className="mt-1">{state.response.service}</dd>
              </div>

              <div>
                <dt className="font-semibold">Database time in Asia Manila</dt>
                <dd className="mt-1">
                  <time dateTime={state.response.server_time}>
                    {new Intl.DateTimeFormat('en-PH', {
                      dateStyle: 'medium',
                      timeStyle: 'medium',
                      timeZone: 'Asia/Manila',
                    }).format(new Date(state.response.server_time))}
                  </time>
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </section>
  )
}
