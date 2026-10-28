import type { TurnoverItem } from './turnover.types'

// Fictional development information only.
// Do not include passwords, recovery codes, or personal contact details.

export const mockTurnoverItems: TurnoverItem[] = [
  {
    turnoverId: 'TURNOVER-2026-SECRETARY-0001',
    positionId: 'POS-SECRETARY',
    positionTitle: 'Council Secretary',
    termCovered: 'Sample 2026-2027 term',
    recordIds: ['EACSC-2026-MIN-0001', 'EACSC-2026-TURN-0001'],
    pendingMatters: [
      {
        matterId: 'PENDING-2026-0001',
        summary: 'Complete review of the sample council meeting minutes.',
        nextAction:
          'Check the draft against the sample meeting notes before completing review.',
        responsiblePosition: 'Council Secretary',
        relatedRecordIds: ['EACSC-2026-MIN-0001'],
        dueAt: null,
      },
    ],
    recurringDuties: [
      'Maintain the council records index.',
      'Track pending reviews and release decisions.',
      'Prepare an updated turnover inventory at the end of the term.',
    ],
    officialContacts: [
      {
        office: 'Sample EA-CSC Secretariat',
        purpose: 'Sample records and turnover coordination.',
        publicContactDetails: 'records@example.invalid',
      },
    ],
    knownExceptions: [
      'No document files or signed turnover acknowledgments are attached in this prototype.',
    ],
  },
]
