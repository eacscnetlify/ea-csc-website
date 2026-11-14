import { useEffect, useRef, useState } from 'react'
import { fetchPositionInventory, getTurnoverPackage } from './turnover.api'
import {
  prepareTurnoverExport,
  turnoverExportFilename,
  turnoverPrintHtml,
} from './turnover.export'

export default function TurnoverExportPanel({
  packageId,
}: {
  packageId: string
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const working = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  async function exportPackage(format: 'json' | 'print') {
    if (working.current) return

    let popup: Window | null = null

    if (format === 'print') {
      popup = window.open('', '_blank', 'width=1000,height=750')

      if (!popup) {
        setError('Allow the print window for this site, then try again.')
        return
      }

      popup.opener = null
      popup.document.title = 'Preparing turnover package'
      popup.document.body.textContent =
        'Checking access and loading the saved package…'
    }

    working.current = true
    setBusy(true)
    setError('')
    setNotice('')

    try {
      const pkg = await getTurnoverPackage(packageId)

      const records = pkg.outgoing_confirmed_at
        ? pkg.inventory_snapshot
        : await fetchPositionInventory(pkg.position_title)

      const data = prepareTurnoverExport(pkg, records, window.location.origin)

      if (!mounted.current) {
        popup?.close()
        return
      }

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: 'application/json;charset=utf-8',
        })

        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')

        link.href = url
        link.download = `${turnoverExportFilename(data)}.json`

        document.body.append(link)
        link.click()
        link.remove()

        window.setTimeout(() => {
          URL.revokeObjectURL(url)
        }, 1000)

        setNotice(
          `JSON export prepared from saved package revision ${pkg.revision_counter}.`,
        )
      } else if (popup && !popup.closed) {
        popup.document.open()
        popup.document.write(turnoverPrintHtml(data))
        popup.document.close()

        await popup.document.fonts.ready

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 150)
        })

        if (!mounted.current || popup.closed) return

        popup.focus()
        popup.print()

        setNotice(
          `Print view prepared from saved package revision ${pkg.revision_counter}. Choose Save as PDF to retain a PDF copy.`,
        )
      }
    } catch (failure) {
      if (popup && !popup.closed) {
        popup.document.body.textContent =
          'The export could not be prepared. Close this window and check the message in the Turnover workspace.'
      }

      if (mounted.current) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Export failed. Check access and try again.',
        )
      }
    } finally {
      working.current = false

      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  const buttonClass =
    'rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 disabled:opacity-50'

  return (
    <section
      aria-labelledby="turnover-export-heading"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
    >
      <h2 id="turnover-export-heading" className="text-xl font-bold">
        Export saved position package
      </h2>

      <p className="text-sm text-slate-600">
        Exports reload saved data and check your current access. Unsaved form
        changes are excluded. Attachments are referenced, not embedded.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportPackage('json')}
          className={buttonClass}
        >
          Download JSON
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void exportPackage('print')}
          className={buttonClass}
        >
          Print / Save PDF
        </button>
      </div>

      {busy && <p role="status">Preparing the saved package…</p>}

      {notice && (
        <p role="status" className="text-sm text-emerald-900">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">
          {error}
        </p>
      )}
    </section>
  )
}
