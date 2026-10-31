import {
  FileVerificationError,
  type ExpectedFile,
} from './verify-file-facts.ts'
import { verifyPdf } from './verify-pdf.ts'
import { verifyImage } from './verify-image.ts'
import { verifyDocx } from './verify-docx.ts'

export function verifyUpload(bytes: Uint8Array, expected: ExpectedFile) {
  switch (expected.mime_type) {
    case 'application/pdf':
      return verifyPdf(bytes, expected)

    case 'image/jpeg':
    case 'image/png':
      return verifyImage(bytes, expected)

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return verifyDocx(bytes, expected)

    default:
      return Promise.reject(
        new FileVerificationError(
          'UNSUPPORTED_FILE_TYPE',
          'The prepared file type is unsupported.',
        ),
      )
  }
}
