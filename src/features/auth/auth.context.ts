import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in' | 'error'
  session: Session | null
  error: string | null
  isPasswordRecovery: boolean
}

export const AuthContext = createContext<AuthState | undefined>(undefined)
