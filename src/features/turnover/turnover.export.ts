import { formatManilaDateTime } from '../../lib/dates'
import type { InventoryRecord, TurnoverPackage } from './turnover.api'

export function prepareTurnoverExport(
  pkg: TurnoverPackage,
  records: InventoryRecord[],
  origin: string,
) {
  return {
    schema_version: 1,
    export_type: 'ea-csc-position-turnover',
    generated_on_device_at: new Date().toISOString(),
    display_timezone: 'Asia/Manila (UTC+8)',
    access_class: records.some((record) => record.access_class === 'restricted')
      ? 'restricted'
      : 'internal',
    reference_notice:
      'A dated reference copy of saved package data. Attachments are not embedded. Use the officer workspace for current permitted records. This export is not a complete backup.',
    inventory_basis: pkg.outgoing_confirmed_at
      ? 'Inventory frozen at outgoing confirmation'
      : 'Current permitted inventory for a saved Draft package',
    workspace_url: new URL('/officer', origin).href,
    package: {
      package_id: pkg.package_id,
      revision_counter: pkg.revision_counter,
      position_title: pkg.position_title,
      term_covered: pkg.term_covered,
      status: pkg.status,
      last_saved_at: pkg.updated_at,
      outgoing_officer_id: pkg.outgoing_officer_id,
      incoming_officer_id: pkg.incoming_officer_id,
      outgoing_confirmed_at: pkg.outgoing_confirmed_at,
      access_transferred_at: pkg.access_transferred_at,
      memorandum: {
        ongoing_projects: pkg.ongoing_projects,
        critical_deadlines: pkg.critical_deadlines,
        official_contacts: pkg.official_contacts,
        operational_lessons: pkg.operational_lessons,
        known_exceptions: pkg.known_exceptions,
      },
      acknowledgments: pkg.acknowledgments.map((ack) => ({
        ack_id: ack.ack_id,
        acknowledged_at: ack.acknowledged_at,
        exceptions_summary: ack.exceptions_summary,
      })),
    },
    inventory: records.map((record) => ({
      record_id: record.record_id,
      title: record.title,
      category: record.category,
      document_type: record.document_type,
      access_class: record.access_class,
      custodian_position: record.custodian_position,
      record_revision: record.revision,
      latest_permitted_state_at_inventory: record.current_state,
      versions: record.versions.map((version) => ({
        version_id: version.version_id,
        version_number: version.version_number,
        state_at_inventory: version.state,
      })),
    })),
  }
}

type ExportData = ReturnType<typeof prepareTurnoverExport>

export function turnoverExportFilename(data: ExportData) {
  return `EA_CSC_Turnover_${data.package.package_id}_r${data.package.revision_counter}`
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }

    return replacements[character]
  })
}

function dateText(value: string | null) {
  return value ? formatManilaDateTime(value) : 'Pending'
}

export function turnoverPrintHtml(data: ExportData) {
  const pkg = data.package

  const field = (label: string, value: unknown) =>
    `<div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value || 'Not recorded')}</dd>
    </div>`

  const section = (title: string, value: string) =>
    `<section>
      <h2>${escapeHtml(title)}</h2>
      <p class="memo">${escapeHtml(value || 'None recorded.')}</p>
    </section>`

  const inventory = data.inventory
    .map(
      (record) => `
        <article class="record">
          <h3>${escapeHtml(record.record_id)} — ${escapeHtml(record.title)}</h3>
          <dl>
            ${field('Category / type', `${record.category} / ${record.document_type}`)}
            ${field('Custodian position', record.custodian_position)}
            ${field('Access class', record.access_class)}
            ${field('Record revision at inventory', record.record_revision)}
            ${field('Latest permitted state at inventory', record.latest_permitted_state_at_inventory)}
          </dl>
          <p><strong>Version references at inventory</strong></p>
          <ul>
            ${
              record.versions
                .map(
                  (version) => `
                    <li>
                      Version ${version.version_number}: ${escapeHtml(version.state_at_inventory)}
                      <br>
                      Version ID: ${escapeHtml(version.version_id)}
                    </li>
                  `,
                )
                .join('') || '<li>No permitted versions recorded.</li>'
            }
          </ul>
        </article>
      `,
    )
    .join('')

  const receipts = pkg.acknowledgments
    .map(
      (ack) => `
        <article class="record">
          <dl>
            ${field('Receipt ID', ack.ack_id)}
            ${field('Incoming acknowledgment', dateText(ack.acknowledged_at))}
          </dl>
          <p class="memo">${escapeHtml(ack.exceptions_summary || 'No receipt exceptions recorded.')}</p>
        </article>
      `,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(turnoverExportFilename(data))}</title>
<style>
  @page {
    size: A4;
    margin: 16mm;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    color: #172532;
    background: white;
    font: 11pt/1.5 Arial, sans-serif;
    overflow-wrap: anywhere;
  }

  main {
    max-width: 180mm;
    margin: 12mm auto;
    padding: 0 5mm;
  }

  header {
    border-bottom: 3px solid #065f46;
    padding-bottom: 5mm;
  }

  h1 {
    font-size: 21pt;
    margin: 2mm 0;
  }

  h2 {
    font-size: 14pt;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 2mm;
    margin: 7mm 0 3mm;
  }

  h3 {
    font-size: 11pt;
    margin: 0 0 3mm;
  }

  h1, h2, h3 {
    break-after: avoid;
  }

  p {
    margin: 2mm 0;
  }

  .badge {
    display: inline-block;
    padding: 1mm 3mm;
    background: #ecfdf5;
    border: 1px solid #047857;
    font-weight: bold;
  }

  .notice {
    border-left: 3px solid #64748b;
    padding: 3mm;
    margin-top: 4mm;
    background: #f8fafc;
  }

  dl {
    margin: 3mm 0;
  }

  dl > div {
    display: grid;
    grid-template-columns: 53mm minmax(0, 1fr);
    gap: 3mm;
    padding: 1mm 0;
  }

  dt {
    font-weight: bold;
  }

  dd {
    margin: 0;
    white-space: pre-wrap;
  }

  .memo {
    white-space: pre-wrap;
  }

  .record {
    border-top: 1px solid #cbd5e1;
    padding: 4mm 0;
  }

  li {
    margin-bottom: 2mm;
  }

  footer {
    border-top: 1px solid #cbd5e1;
    padding-top: 3mm;
    margin-top: 8mm;
    font-size: 9pt;
  }

  @media print {
    main {
      max-width: none;
      padding: 0;
      margin: 0;
    }

    a {
      color: inherit;
    }
  }
</style>
</head>
<body>
<main>
  <header>
    <p>Engineering and Architecture College Student Council</p>
    <h1>Position Turnover Package</h1>
    <p class="badge">${escapeHtml(data.access_class.toUpperCase())} — Authorized officers only</p>
  </header>

  <dl>
    ${field('Position', pkg.position_title)}
    ${field('Term covered', pkg.term_covered)}
    ${field('Package ID', pkg.package_id)}
    ${field('Package revision', pkg.revision_counter)}
    ${field('Package status', pkg.status)}
    ${field('Last saved on server', dateText(pkg.last_saved_at))}
    ${field('Export prepared on device', dateText(data.generated_on_device_at))}
    ${field('Displayed timezone', data.display_timezone)}
  </dl>

  <div class="notice">
    <p>${escapeHtml(data.reference_notice)}</p>
    <p>${escapeHtml(data.inventory_basis)}</p>
  </div>

  <h2>Officers and transfer</h2>

  <dl>
    ${field('Outgoing account ID', pkg.outgoing_officer_id)}
    ${field('Incoming account ID', pkg.incoming_officer_id)}
    ${field('Outgoing confirmation', dateText(pkg.outgoing_confirmed_at))}
    ${field('Access transferred', dateText(pkg.access_transferred_at))}
  </dl>

  ${section('Ongoing projects and pending matters', pkg.memorandum.ongoing_projects)}
  ${section('Critical dates and recurring deadlines', pkg.memorandum.critical_deadlines)}
  ${section('Official institutional contacts', pkg.memorandum.official_contacts)}
  ${section('Recurring duties, lessons, and guidance', pkg.memorandum.operational_lessons)}
  ${section('Missing records, responsible persons, and follow-up', pkg.memorandum.known_exceptions)}

  <h2>Position inventory (${data.inventory.length})</h2>

  ${inventory || '<p>No permitted inventory records were returned.</p>'}

  <p>
    Locate the record IDs above in the
    <a href="${escapeHtml(data.workspace_url)}">officer workspace</a>.
    Access requires current authorization.
  </p>

  <h2>Incoming receipt</h2>

  ${receipts || '<p>Incoming acknowledgment is pending.</p>'}

  <footer>
    Saved package ${escapeHtml(pkg.package_id)} ·
    revision ${pkg.revision_counter}.
    The package status and record states are separate;
    handover does not approve or publish Draft documents.
  </footer>
</main>
</body>
</html>`
}
