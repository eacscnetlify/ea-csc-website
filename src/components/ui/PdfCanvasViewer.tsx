import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export function PdfCanvasViewer({ blob }: { blob: Blob }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let cancelled = false
    let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null

    async function render() {
      setRendering(true)
      setError(null)
      try {
        const buffer = await blob.arrayBuffer()
        const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer) })
        pdfDoc = await task.promise
        if (cancelled) return

        setPageCount(pdfDoc.numPages)
        const host = containerRef.current
        if (!host) return
        host.innerHTML = ''

        const availableWidth = Math.max(host.clientWidth - 16, 260)
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          if (cancelled) return
          const page = await pdfDoc.getPage(pageNum)
          const baseViewport = page.getViewport({ scale: 1 })
          const scale = availableWidth / baseViewport.width
          const viewport = page.getViewport({ scale })

          const wrapper = document.createElement('div')
          wrapper.className =
            'mb-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs'

          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.style.height = `${Math.floor(viewport.height)}px`
          canvas.className = 'block mx-auto'

          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            await page.render({ canvasContext: ctx, viewport, canvas }).promise
          }

          const footer = document.createElement('div')
          footer.className =
            'border-t border-slate-100 bg-slate-50 px-3 py-1 text-center text-[11px] font-medium text-slate-500'
          footer.textContent = `Page ${pageNum} of ${pdfDoc.numPages}`

          wrapper.appendChild(canvas)
          wrapper.appendChild(footer)
          host.appendChild(wrapper)
        }
      } catch {
        if (!cancelled) {
          setError('Could not render PDF preview on this device. Tap Download to open it directly.')
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    }

    void render()

    return () => {
      cancelled = true
      if (pdfDoc) {
        void pdfDoc.cleanup()
      }
    }
  }, [blob])

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-slate-700">
        <p className="font-semibold text-rose-900">{error}</p>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-y-auto px-1 py-2">
      {rendering && (
        <p className="mb-2 text-center text-xs font-medium text-slate-500">
          Rendering PDF pages{pageCount > 0 ? ` (${pageCount} total)` : ''}…
        </p>
      )}
      <div ref={containerRef} className="mx-auto w-full max-w-3xl" />
    </div>
  )
}
