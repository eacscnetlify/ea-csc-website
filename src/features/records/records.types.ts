export const RECORD_CATEGORIES = [
  'Governance and legislation',
  'Secretariat and proceedings',
  'Activities and CBO records',
  'Financial archives',
  'Forms and official information',
  'Turnover and continuity',
] as const

export type RecordCategory = (typeof RECORD_CATEGORIES)[number]

export type AccessClass = 'public' | 'internal' | 'restricted'

export type VersionState = 'Draft' | 'For Review' | 'Approved' | 'Superseded'

export type DocumentType =
  | 'Form'
  | 'Policy'
  | 'Resolution'
  | 'Minutes'
  | 'Proposal'
  | 'Report'
  | 'Announcement'
  | 'Turnover memorandum'
  | 'Other'

export interface RecordItem {
  recordId: string
  title: string
  summary: string
  category: RecordCategory
  documentType: DocumentType
  originatingOffice: string
  custodianPosition: string
  accessClass: AccessClass
  createdAt: string
  publicContact: string
  currentPublicReleaseId: string | null
}

export interface VersionItem {
  versionId: string
  recordId: string
  versionNumber: number
  revisionCounter: number
  state: VersionState
  approvedAt: string | null
  changeSummary: string
  previousVersionId: string | null
  storageKey: string | null
}

export interface ReleaseItem {
  releaseId: string
  recordId: string
  versionId: string
  audience: 'public' | 'internal'
  releasedAt: string
  effectiveAt: string
  withdrawnAt: string | null
  allowPublicHistory: boolean
}

export interface PublicRecordItem {
  recordId: string
  title: string
  summary: string
  category: RecordCategory
  documentType: DocumentType
  originatingOffice: string
  publicContact: string
  releaseId: string
  versionId: string
  versionNumber: number
  state: 'Approved' | 'Superseded'
  approvedAt: string | null
  releasedAt: string
  effectiveAt: string
  changeSummary: string
}
