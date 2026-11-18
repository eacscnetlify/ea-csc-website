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
  const client = getSupabaseClient()
  const [{ data, error }, linksRes] = await Promise.all([
    client.rpc('eacsc_public_catalog', { p_limit: 100, p_offset: 0 }),
    client.rpc('eacsc_get_public_external_links'),
  ])

  if (error || !Array.isArray(data)) {
    throw new Error('Public catalog could not be loaded.')
  }

  const linkMap = new Map<string, string>()
  if (Array.isArray(linksRes.data)) {
    for (const row of linksRes.data as Array<{ version_id?: string; external_url?: string }>) {
      if (row.version_id && row.external_url) {
        linkMap.set(row.version_id, row.external_url)
      }
    }
  }

  return (data as CatalogRow[])
    .map((row) => ({
      ...mapCatalogRow(row),
      externalUrl: linkMap.get(row.version_id) ?? null,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

interface PublicDetailRow {
  record_id: string
  title: string
  summary: string
  category: string
  document_type: string
  originating_office: string
  public_contact: string
  release_id: string
  version_id: string
  version_number: number
  state: 'Approved' | 'Superseded'
  approved_at: string | null
  released_at: string
  effective_at: string
  change_summary: string
}

interface PublicRecordDetailResponse {
  current: PublicDetailRow | null
  history: PublicDetailRow[]
}

function mapDetailRow(row: PublicDetailRow): PublicRecordItem {
  return {
    recordId: row.record_id,
    title: row.title,
    summary: row.summary || 'Authorized public release.',
    category: row.category as RecordCategory,
    documentType: (row.document_type ||
      'Other') as PublicRecordItem['documentType'],
    originatingOffice: row.originating_office || 'EA-CSC',
    publicContact: row.public_contact || 'EA-CSC Secretariat',
    releaseId: row.release_id,
    versionId: row.version_id,
    versionNumber: row.version_number,
    state: row.state,
    approvedAt: row.approved_at,
    releasedAt: row.released_at,
    effectiveAt: row.effective_at,
    changeSummary: row.change_summary || 'Current authorized public release.',
  }
}

export async function getPublicRecord(
  recordId: string,
): Promise<PublicRecordItem | null> {
  const { data, error } = await getSupabaseClient().rpc(
    'eacsc_public_record_detail',
    { p_record_id: recordId },
  )

  if (error) {
    throw new Error('Could not load public record metadata.')
  }

  const detail = data as PublicRecordDetailResponse | null
  return detail?.current ? mapDetailRow(detail.current) : null
}

export async function getPublicRecordHistory(
  recordId: string,
): Promise<PublicRecordItem[]> {
  const { data, error } = await getSupabaseClient().rpc(
    'eacsc_public_record_detail',
    { p_record_id: recordId },
  )

  if (error) {
    throw new Error('Could not load public record version history.')
  }

  const detail = data as PublicRecordDetailResponse | null
  return Array.isArray(detail?.history) ? detail.history.map(mapDetailRow) : []
}
