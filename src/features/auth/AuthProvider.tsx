import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
} from '@supabase/supabase-js'
import { getSupabaseClient } from '../../lib/supabase'
import { AuthContext } from './auth.context'
import type { AuthState } from './auth.context'

interface AuthConfiguration {
  client: SupabaseClient | null
  error: string | null
}

function readConfiguration(): AuthConfiguration {
  try {
    return {
      client: getSupabaseClient(),
      error: null,
    }
  } catch (error) {
    return {
      client: null,
      error:
        error instanceof Error
          ? error.message
          : 'Authentication configuration is unavailable.',
    }
  }
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [configuration] = useState(readConfiguration)

  const [authState, setAuthState] = useState<AuthState>(() => ({
    status: configuration.error ? 'error' : 'loading',
    session: null,
    error: configuration.error,
    isPasswordRecovery: false,
  }))

  useEffect(() => {
    const client = configuration.client

    if (!client) {
      return
    }

    let active = true
    let receivedAuthEvent = false

    const timeoutId = window.setTimeout(() => {
      if (!active || receivedAuthEvent) {
        return
      }

      setAuthState({
        status: 'error',
        session: null,
        error:
          'Checking your session took too long. Check your connection and reload the page.',
        isPasswordRecovery: false,
      })
    }, 10_000)

    function applySession(
      session: Session | null,
      event: AuthChangeEvent | null = null,
    ) {
      if (!active) {
        return
      }

      window.clearTimeout(timeoutId)

      setAuthState((current) => ({
        status: session ? 'signed-in' : 'signed-out',
        session,
        error: null,
        isPasswordRecovery:
          session !== null &&
          (event === 'PASSWORD_RECOVERY' ||
            (current.isPasswordRecovery &&
              current.session?.user.id === session.user.id)),
      }))
    }

    function reportSessionError() {
      if (!active || receivedAuthEvent) {
        return
      }

      window.clearTimeout(timeoutId)

      setAuthState({
        status: 'error',
        session: null,
        error:
          'Your session could not be checked. Check your connection and reload the page.',
        isPasswordRecovery: false,
      })
    }

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return
      }

      receivedAuthEvent = true
      applySession(session, event)
    })

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || receivedAuthEvent) {
          return
        }

        if (error) {
          reportSessionError()
          return
        }

        applySession(data.session)
      })
      .catch(reportSessionError)

    return () => {
      active = false
      window.clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [configuration.client])

  return (
    <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>
  )
}
