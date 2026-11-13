import { getSupabaseClient } from '../../lib/supabase'
import type { PublicRecordItem, RecordCategory } from './records.types'

interface CatalogRow {
  record_id: string
  title: string
  category: string
  version_id: string
  version_number: number
  approved_at: string | null
  released_at: string
}

function mapCatalogRow(row: CatalogRow): PublicRecordItem {
  return {
    recordId: row.record_id,
    title: row.title,
    summary: 'Authorized public release.',
    category: row.category as RecordCategory,
    documentType: 'Other',
    originatingOffice: 'EA-CSC',
    publicContact: 'EA-CSC Secretariat',
    releaseId: row.version_id,
    versionId: row.version_id,
    versionNumber: row.version_number,
    state: 'Approved',
    approvedAt: row.approved_at,
    releasedAt: row.released_at,
    effectiveAt: row.released_at,
    changeSummary: 'Current authorized public release.',
  }
}

export async function getPublicRecords(): Promise<PublicRecordItem[]> {
  const { data, error } = await getSupabaseClient().rpc(
    'eacsc_public_catalog',
    { p_limit: 100, p_offset: 0 },
  )

  if (error || !Array.isArray(data)) {
    throw new Error('Public catalog could not be loaded.')
  }

  return (data as CatalogRow[])
    .map(mapCatalogRow)
    .sort((a, b) => a.title.localeCompare(b.title))
}

export async function getPublicRecord(
  recordId: string,
): Promise<PublicRecordItem | null> {
  const items = await getPublicRecords()
  return items.find((item) => item.recordId === recordId) ?? null
}

export async function getPublicRecordHistory(
  recordId: string,
): Promise<PublicRecordItem[]> {
  void recordId
  return []
}
