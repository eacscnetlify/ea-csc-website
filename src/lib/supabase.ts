import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client
  }

  const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!projectUrl || projectUrl.includes('your-project-ref')) {
    throw new Error(
      'Set VITE_SUPABASE_URL in .env.local, then restart the development server.',
    )
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(projectUrl)
  } catch {
    throw new Error('VITE_SUPABASE_URL must contain a valid HTTPS project URL.')
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.pathname !== '/' ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error(
      'Use the HTTPS project URL without a database password, API path, or query parameters.',
    )
  }

  if (
    !publishableKey?.startsWith('sb_publishable_') ||
    publishableKey.includes('replace_with')
  ) {
    throw new Error(
      'Set VITE_SUPABASE_PUBLISHABLE_KEY to your project publishable key, then restart the development server.',
    )
  }

  client = createClient(projectUrl, publishableKey)

  return client
}
