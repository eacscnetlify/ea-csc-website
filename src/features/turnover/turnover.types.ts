export interface PendingMatter {
  matterId: string
  summary: string
  nextAction: string
  responsiblePosition: string
  relatedRecordIds: string[]
  dueAt: string | null
}

export interface OfficialContact {
  office: string
  purpose: string
  publicContactDetails: string
}

export interface TurnoverItem {
  turnoverId: string
  positionId: string
  positionTitle: string
  termCovered: string
  recordIds: string[]
  pendingMatters: PendingMatter[]
  recurringDuties: string[]
  officialContacts: OfficialContact[]
  knownExceptions: string[]
}
