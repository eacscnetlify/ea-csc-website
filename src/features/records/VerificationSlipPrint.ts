import type { PublicRecordItem } from './records.types'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function printVerificationSlip(
  record: PublicRecordItem,
  sha256?: string,
) {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.append(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) {
    iframe.remove()
    return
  }

  const printedAt = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date())

  const recordUrl = `${window.location.origin}/records/${encodeURIComponent(record.recordId)}`

  doc.open()
  doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Verification Slip — ${escapeHtml(record.recordId)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 36px; line-height: 1.5; }
    .header { border-bottom: 3px solid #7f1d1d; padding-bottom: 12px; margin-bottom: 20px; }
    .org { font-size: 11px; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase; color: #166534; }
    h1 { font-size: 20px; margin: 6px 0 4px; }
    .sub { font-size: 12px; color: #475569; margin: 0; }
    .badge { display: inline-block; background: #dcfce7; color: #14532d; font-size: 11px; font-weight: bold; padding: 3px 10px; border-radius: 999px; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th, td { border: 1px solid #cbd5e1; padding: 9px 12px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; width: 32%; font-weight: bold; color: #334155; }
    .mono { font-family: Consolas, monospace; font-size: 11px; word-break: break-all; }
    .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #cbd5e1; font-size: 11px; color: #475569; }
  </style>
</head>
<body>
  <div class="header">
    <div class="org">Catanduanes State University · College of Engineering &amp; Architecture Student Council</div>
    <h1>Official Document Verification Slip</h1>
    <p class="sub">EA-CSC Institutional Information and Document Governance System (IIDGS)</p>
    <span class="badge">ACTIVE VERIFIED PUBLIC RELEASE · VERSION ${record.versionNumber}</span>
  </div>
  <table>
    <tr><th>Record Identifier</th><td class="mono">${escapeHtml(record.recordId)}</td></tr>
    <tr><th>Document Title</th><td><strong>${escapeHtml(record.title)}</strong></td></tr>
    <tr><th>Category &amp; Type</th><td>${escapeHtml(record.category)} — ${escapeHtml(record.documentType)}</td></tr>
    <tr><th>Originating Office</th><td>${escapeHtml(record.originatingOffice)}</td></tr>
    <tr><th>Release State</th><td>${escapeHtml(record.state)} (Version ${record.versionNumber})</td></tr>
    <tr><th>Effective Date</th><td>${escapeHtml(record.effectiveAt)}</td></tr>
    <tr><th>Public Contact</th><td>${escapeHtml(record.publicContact)}</td></tr>
    <tr><th>Official Portal Link</th><td class="mono">${escapeHtml(recordUrl)}</td></tr>
    ${sha256 ? `<tr><th>SHA-256 Checksum</th><td class="mono">${escapeHtml(sha256)}</td></tr>` : ''}
  </table>
  <div class="footer">
    Printed on ${escapeHtml(printedAt)} (Asia/Manila) via EA-CSC IIDGS Public Portal. Verify live status anytime at the official portal link above.
  </div>
</body>
</html>`)
  doc.close()

  iframe.contentWindow?.focus()
  iframe.contentWindow?.print()
  window.setTimeout(() => iframe.remove(), 2000)
}
