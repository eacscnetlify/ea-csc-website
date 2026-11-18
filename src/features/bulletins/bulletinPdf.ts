import { jsPDF } from 'jspdf'
import { formatManilaDateTime } from '../../lib/dates'

export interface BulletinCandidate {
  releaseId: string
  recordId: string
  versionId: string
  versionNumber: number
  publicTitle: string
  publicCategory: string
  audience: 'public' | 'internal'
  releasedAt: string
  effectiveFrom: string
  approvedAt: string | null
  summaryNote: string
}

export interface BulletinDraftInput {
  bulletinId: string
  issueVersion: number
  title: string
  audience: 'public' | 'internal'
  coverageStart: string
  coverageEnd: string
  cutoffAt: string
  executiveContext: string
  instructions: string
  officialContact: string
  preparerName: string
  items: BulletinCandidate[]
}

export function buildBulletinPdfBlob(input: BulletinDraftInput): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 48
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const contentWidth = pageWidth - margin * 2
  let y = 52

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 54) {
      doc.addPage()
      y = 52
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(6, 95, 70)
  const orgLines = doc.splitTextToSize(
    'CATANDUANES STATE UNIVERSITY — ENGINEERING AND ARCHITECTURE COLLEGE STUDENT COUNCIL',
    contentWidth,
  ) as string[]
  doc.text(orgLines, margin, y)
  y += orgLines.length * 13 + 8

  doc.setFontSize(18)
  doc.setTextColor(15, 23, 42)
  const titleLines = doc.splitTextToSize(
    input.title.trim() || 'EA-CSC Update Bulletin',
    contentWidth,
  ) as string[]
  doc.text(titleLines, margin, y)
  y += titleLines.length * 22 + 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(71, 85, 105)
  doc.text(
    `Bulletin ID: ${input.bulletinId} (Issue v${input.issueVersion})  |  Audience: ${input.audience.toUpperCase()}  |  Timezone: Asia/Manila (PST, UTC+8)`,
    margin,
    y,
    { maxWidth: contentWidth },
  )
  y += 14
  doc.text(
    `Coverage: ${input.coverageStart} to ${input.coverageEnd}  |  Cutoff: ${formatManilaDateTime(input.cutoffAt)}`,
    margin,
    y,
    { maxWidth: contentWidth },
  )
  y += 18

  doc.setDrawColor(203, 213, 225)
  doc.line(margin, y, pageWidth - margin, y)
  y += 18

  if (input.executiveContext.trim()) {
    ensureSpace(50)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(15, 23, 42)
    doc.text('Executive context', margin, y)
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const lines = doc.splitTextToSize(
      input.executiveContext.trim(),
      contentWidth,
    ) as string[]
    doc.text(lines, margin, y)
    y += lines.length * 13 + 10
  }

  if (input.instructions.trim()) {
    ensureSpace(50)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(15, 23, 42)
    doc.text('Instructions & required actions', margin, y)
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const lines = doc.splitTextToSize(
      input.instructions.trim(),
      contentWidth,
    ) as string[]
    doc.text(lines, margin, y)
    y += lines.length * 13 + 12
  }

  ensureSpace(40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42)
  doc.text(`Included authorized releases (${input.items.length})`, margin, y)
  y += 18

  for (const item of input.items) {
    const noteLines = doc.splitTextToSize(
      item.summaryNote,
      contentWidth - 16,
    ) as string[]
    const blockHeight = 56 + noteLines.length * 12
    ensureSpace(blockHeight)

    doc.setDrawColor(226, 232, 240)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(margin, y - 10, contentWidth, blockHeight, 4, 4, 'FD')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(15, 23, 42)
    doc.text(
      `${item.recordId} (v${item.versionNumber}) — ${item.publicTitle}`,
      margin + 10,
      y + 4,
      { maxWidth: contentWidth - 20 },
    )

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.8)
    doc.setTextColor(71, 85, 105)
    doc.text(
      `Category: ${item.publicCategory}  |  Released: ${formatManilaDateTime(item.releasedAt)}`,
      margin + 10,
      y + 18,
      { maxWidth: contentWidth - 20 },
    )

    doc.setTextColor(30, 41, 59)
    doc.text(noteLines, margin + 10, y + 32)
    y += blockHeight + 10
  }

  ensureSpace(75)
  y += 6
  doc.setDrawColor(203, 213, 225)
  doc.line(margin, y, pageWidth - margin, y)
  y += 16

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.8)
  doc.setTextColor(71, 85, 105)
  const limitation = doc.splitTextToSize(
    'Reference limitation: This bulletin summarizes the included authorized releases as of the stated cutoff timestamp. Consult the EA-CSC Records Portal for later revisions, replacements, or withdrawals.',
    contentWidth,
  ) as string[]
  doc.text(limitation, margin, y)
  y += limitation.length * 12 + 10

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(
    `Prepared by: ${input.preparerName}  |  Official contact: ${input.officialContact.trim() || 'EA-CSC Secretariat'}`,
    margin,
    y,
    { maxWidth: contentWidth },
  )

  return doc.output('blob')
}
