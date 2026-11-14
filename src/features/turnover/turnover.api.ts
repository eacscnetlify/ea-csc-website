import { getSupabaseClient } from '../../lib/supabase'

export interface InventoryRecord {
  record_id: string
  title: string
  category: string
  document_type: string
  access_class: string
  custodian_position: string
  revision: number
  versions_count: number
  current_state: string
  versions: {
    version_id: string
    version_number: number
    state: string
  }[]
}

export interface TurnoverPerson {
  user_id: string
  full_name: string
  council_position: string | null
}

export interface TurnoverMemo {
  position_title: string
  term_covered: string
  incoming_officer_id: string | null
  ongoing_projects: string
  critical_deadlines: string
  official_contacts: string
  operational_lessons: string
  known_exceptions: string
}

export interface PackageSummary {
  package_id: string
  position_title: string
  term_covered: string
  status: 'draft' | 'acknowledged' | 'archived'
  revision_counter: number
  outgoing_officer_id: string
  incoming_officer_id: string | null
  outgoing_confirmed_at: string | null
  access_transferred_at: string | null
  updated_at: string
  outgoing_profile_revision: number
  incoming_profile_revision: number | null
}

export interface TurnoverPackage extends TurnoverMemo {
  package_id: string
  status: PackageSummary['status']
  revision_counter: number
  outgoing_officer_id: string
  outgoing_confirmed_at: string | null
  access_transferred_at: string | null
  updated_at: string
  inventory_snapshot: InventoryRecord[]
  acknowledgments: {
    ack_id: string
    acknowledged_at: string
    exceptions_summary: string
  }[]
}

export class TurnoverError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'TurnoverError'
    this.code = code
    this.status = status
  }
}

async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error, status } = await getSupabaseClient().rpc(name, args)

  if (error) {
    throw new TurnoverError(error.message, error.code, status)
  }

  if (data === null) {
    throw new TurnoverError('Empty server response.', '', 0)
  }

  return data as T
}

export const listTurnoverPackages = () =>
  rpc<PackageSummary[]>('eacsc_list_turnover_packages')

export const getTurnoverPackage = (packageId: string) =>
  rpc<TurnoverPackage>('eacsc_get_turnover_package', {
    p_package_id: packageId,
  })

export const getTurnoverDirectory = () =>
  rpc<TurnoverPerson[]>('eacsc_turnover_directory')

export async function fetchPositionInventory(position: string) {
  const result = await rpc<{ inventory: InventoryRecord[] }>(
    'eacsc_get_position_inventory',
    { p_position: position },
  )

  return result.inventory
}

export interface TurnoverResult {
  package_id: string
  revision_counter: number
  audit_event_uuid: string
  request_id: string
}

export function runTurnoverCommand(
  name: string,
  args: Record<string, unknown>,
) {
  return rpc<TurnoverResult>(name, args)
}

export function memoArguments(memo: TurnoverMemo) {
  return {
    p_position_title: memo.position_title,
    p_term_covered: memo.term_covered,
    p_incoming_officer_id: memo.incoming_officer_id || null,
    p_ongoing_projects: memo.ongoing_projects,
    p_critical_deadlines: memo.critical_deadlines,
    p_official_contacts: memo.official_contacts,
    p_operational_lessons: memo.operational_lessons,
    p_known_exceptions: memo.known_exceptions,
  }
}
