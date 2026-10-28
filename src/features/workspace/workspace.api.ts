import { getPublicRecords } from '../records/records.api'
import { mockRecords, mockVersions } from '../records/records.mock'
import { waitForMockResponse } from '../../lib/mockRequest'
import type {
  PublicRecordItem,
  RecordItem,
  VersionItem,
} from '../records/records.types'
import { mockTurnoverItems } from '../turnover/turnover.mock'
import type { TurnoverItem } from '../turnover/turnover.types'

export interface MockWorkspaceRecord {
  record: RecordItem
  latestVersion: VersionItem | null
  versionCount: number
  currentPublicRecord: PublicRecordItem | null
}

export interface MockWorkspaceOverview {
  records: MockWorkspaceRecord[]
  turnoverItems: TurnoverItem[]
}

// This service is for the fictional workspace preview only.
// Authentication and position-based permissions are not implemented here.
export async function getMockWorkspaceOverview(): Promise<MockWorkspaceOverview> {
  const mode = await waitForMockResponse()

  if (mode === 'empty') {
    return {
      records: [],
      turnoverItems: [],
    }
  }

  const publicRecords = await getPublicRecords()

  const records: MockWorkspaceRecord[] = mockRecords.map((record) => {
    const versions = mockVersions
      .filter((version) => version.recordId === record.recordId)
      .sort((first, second) => second.versionNumber - first.versionNumber)

    const currentPublicRecord =
      publicRecords.find((item) => item.recordId === record.recordId) ?? null

    return {
      record,
      latestVersion: versions[0] ?? null,
      versionCount: versions.length,
      currentPublicRecord,
    }
  })

  return {
    records,
    turnoverItems: mockTurnoverItems,
  }
}
