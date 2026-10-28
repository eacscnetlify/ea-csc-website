import { mockRecords, mockReleases, mockVersions } from './records.mock'
import type { PublicRecordItem, RecordItem, ReleaseItem } from './records.types'

// Simulate a short request so the pages can display a loading state.
function waitForMockResponse(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 250)
  })
}

function hasDateArrived(value: string, now: number): boolean {
  const timestamp = Date.parse(value)

  return Number.isFinite(timestamp) && timestamp <= now
}

function resolvePublicRelease(
  record: RecordItem,
  release: ReleaseItem,
  now: number,
  forHistory: boolean,
): PublicRecordItem | null {
  if (record.accessClass !== 'public') {
    return null
  }

  if (release.recordId !== record.recordId) {
    return null
  }

  if (release.audience !== 'public' || release.withdrawnAt !== null) {
    return null
  }

  if (
    !hasDateArrived(release.releasedAt, now) ||
    !hasDateArrived(release.effectiveAt, now)
  ) {
    return null
  }

  if (forHistory && !release.allowPublicHistory) {
    return null
  }

  const version = mockVersions.find(
    (item) =>
      item.versionId === release.versionId && item.recordId === record.recordId,
  )

  if (!version) {
    return null
  }

  if (version.state !== 'Approved' && version.state !== 'Superseded') {
    return null
  }

  if (!forHistory && version.state !== 'Approved') {
    return null
  }

  // Select public fields explicitly.
  // Internal fields such as storageKey are not returned by this service.
  return {
    recordId: record.recordId,
    title: record.title,
    summary: record.summary,
    category: record.category,
    documentType: record.documentType,
    originatingOffice: record.originatingOffice,
    publicContact: record.publicContact,
    releaseId: release.releaseId,
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    state: version.state,
    approvedAt: version.approvedAt,
    releasedAt: release.releasedAt,
    effectiveAt: release.effectiveAt,
    changeSummary: version.changeSummary,
  }
}

function findCurrentPublicRecord(
  record: RecordItem,
  now: number,
): PublicRecordItem | null {
  if (record.currentPublicReleaseId === null) {
    return null
  }

  const release = mockReleases.find(
    (item) => item.releaseId === record.currentPublicReleaseId,
  )

  if (!release) {
    return null
  }

  return resolvePublicRelease(record, release, now, false)
}

export async function getPublicRecords(): Promise<PublicRecordItem[]> {
  await waitForMockResponse()

  const now = Date.now()

  return mockRecords
    .map((record) => findCurrentPublicRecord(record, now))
    .filter((item): item is PublicRecordItem => item !== null)
    .sort((first, second) => first.title.localeCompare(second.title))
}

export async function getPublicRecord(
  recordId: string,
): Promise<PublicRecordItem | null> {
  await waitForMockResponse()

  const record = mockRecords.find((item) => item.recordId === recordId)

  if (!record) {
    return null
  }

  return findCurrentPublicRecord(record, Date.now())
}

export async function getPublicRecordHistory(
  recordId: string,
): Promise<PublicRecordItem[]> {
  await waitForMockResponse()

  const now = Date.now()
  const record = mockRecords.find((item) => item.recordId === recordId)

  if (!record || !findCurrentPublicRecord(record, now)) {
    return []
  }

  return mockReleases
    .filter(
      (release) =>
        release.recordId === record.recordId &&
        release.releaseId !== record.currentPublicReleaseId,
    )
    .map((release) => resolvePublicRelease(record, release, now, true))
    .filter((item): item is PublicRecordItem => item !== null)
    .sort((first, second) => second.versionNumber - first.versionNumber)
}
