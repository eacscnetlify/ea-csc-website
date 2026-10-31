import { PDFDocument } from 'pdf-lib'
import {
  FileVerificationError,
  verifyFileFacts,
  type ExpectedFile,
} from './verify-file-facts.ts'

export { FileVerificationError }
export type ExpectedPdf = ExpectedFile

export interface PdfVerification {
  detected_mime_type: 'application/pdf'
  file_size_bytes: number
  sha256: string
  page_count: number
  verifier_version: 'eacsc-pdf-structure-v1'
}

function reject(code: string, message: string): never {
  throw new FileVerificationError(code, message)
}

export async function verifyPdf(
  bytes: Uint8Array,
  expected: ExpectedPdf,
): Promise<PdfVerification> {
  const hash = await verifyFileFacts(bytes, expected, ['application/pdf'])
  const decoder = new TextDecoder('latin1')
  const header = decoder.decode(bytes.subarray(0, 8))
  const tail = decoder
    .decode(bytes.subarray(Math.max(0, bytes.length - 2048)))
    .replaceAll('\0', ' ')

  const ending = /startxref\s+(\d+)\s+%%EOF[\t\n\f\r ]*$/.exec(tail)

  if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(header) || !ending) {
    reject('INVALID_PDF', 'The file lacks the expected PDF header or ending.')
  }

  const offset = Number(ending[1])
  const target = decoder.decode(bytes.subarray(offset, offset + 80))

  if (
    !Number.isSafeInteger(offset) ||
    offset < 8 ||
    offset >= bytes.length ||
    !/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(target)
  ) {
    reject('INVALID_PDF', 'The PDF cross-reference location is invalid.')
  }

  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    })

    const pages = document.getPages()

    if (pages.length === 0) {
      reject('INVALID_PDF', 'The PDF contains no readable pages.')
    }

    for (const page of pages) {
      const { width, height } = page.getSize()

      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        reject('INVALID_PDF', 'The PDF contains an invalid page size.')
      }
    }

    return {
      detected_mime_type: 'application/pdf',
      file_size_bytes: bytes.byteLength,
      sha256: hash,
      page_count: pages.length,
      verifier_version: 'eacsc-pdf-structure-v1',
    }
  } catch (error) {
    if (error instanceof FileVerificationError) throw error

    reject('INVALID_PDF', 'The file could not be parsed as an unencrypted PDF.')
  }
}
