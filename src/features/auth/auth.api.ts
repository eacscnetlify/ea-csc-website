import { getSupabaseClient } from '../../lib/supabase'

const allowedRoles = [
  'author',
  'custodian',
  'reviewer',
  'approver',
  'publisher',
  'technical_admin',
]

export interface OfficerProfile {
  user_id: string
  full_name: string
  council_position: string | null
  functional_roles: string[]
  is_active: boolean
  revision_counter: number
  updated_at: string
}

function isKnownRole(value: unknown): value is string {
  return typeof value === 'string' && allowedRoles.includes(value)
}

function parseProfile(value: unknown, userId: string): OfficerProfile {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid profile response.')
  }

  const row = value as Record<string, unknown>
  const roles = row.functional_roles

  if (
    row.user_id !== userId ||
    typeof row.full_name !== 'string' ||
    !row.full_name.trim() ||
    (row.council_position !== null &&
      typeof row.council_position !== 'string') ||
    !Array.isArray(roles) ||
    !roles.every(isKnownRole) ||
    typeof row.is_active !== 'boolean' ||
    typeof row.revision_counter !== 'number' ||
    !Number.isSafeInteger(row.revision_counter) ||
    row.revision_counter < 1 ||
    typeof row.updated_at !== 'string' ||
    !Number.isFinite(Date.parse(row.updated_at))
  ) {
    throw new Error('Invalid profile response.')
  }

  return {
    user_id: userId,
    full_name: row.full_name,
    council_position: row.council_position,
    functional_roles: roles,
    is_active: row.is_active,
    revision_counter: row.revision_counter,
    updated_at: row.updated_at,
  }
}

export async function getOfficerProfile(
  userId: string,
  signal: AbortSignal,
): Promise<OfficerProfile | null> {
  const { data, error } = await getSupabaseClient()
    .from('app_users')
    .select(
      'user_id,full_name,council_position,functional_roles,is_active,revision_counter,updated_at',
    )
    .eq('user_id', userId)
    .abortSignal(signal)
    .maybeSingle()

  if (error) {
    throw new Error('Your application profile could not be loaded.')
  }

  return data === null ? null : parseProfile(data, userId)
}
