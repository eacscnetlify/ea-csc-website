import { PDFDocument } from 'pdf-lib'
import { FileVerificationError, verifyPdf } from './verify-pdf.ts'

declare const Deno: {
  test(name: string, run: () => Promise<void>): void
}

function assert(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message)
}

async function facts(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))

  return {
    mime_type: 'application/pdf',
    file_size_bytes: bytes.length,
    sha256: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join(''),
  }
}

async function pdf(compressed = true, pages = 1) {
  const document = await PDFDocument.create()

  for (let i = 0; i < pages; i++) {
    document.addPage([400, 160])
  }

  return document.save({
    useObjectStreams: compressed,
    addDefaultPage: false,
  })
}

async function denied(
  bytes: Uint8Array,
  code: string,
  expected = undefined as Awaited<ReturnType<typeof facts>> | undefined,
) {
  try {
    await verifyPdf(bytes, expected ?? (await facts(bytes)))
  } catch (error) {
    assert(
      error instanceof FileVerificationError,
      'Expected a controlled verification error.',
    )
    assert(error.code === code, `Expected ${code}, received ${error.code}.`)
    return
  }

  throw new Error(`Expected rejection: ${code}.`)
}

Deno.test('PDF: classic cross-reference tables are accepted', async () => {
  const bytes = await pdf(false)
  const result = await verifyPdf(bytes, await facts(bytes))

  assert(
    result.page_count === 1 && result.detected_mime_type === 'application/pdf',
    'Expected one PDF page.',
  )
})

Deno.test(
  'PDF: compressed object streams and multiple pages are accepted',
  async () => {
    const bytes = await pdf(true, 3)
    const result = await verifyPdf(bytes, await facts(bytes))

    assert(result.page_count === 3, 'Expected three PDF pages.')
  },
)

Deno.test('PDF: original bytes and checksum remain unchanged', async () => {
  const bytes = await pdf()
  const original = bytes.slice()
  const expected = await facts(bytes)
  const result = await verifyPdf(bytes, expected)

  assert(
    bytes.every((b, i) => b === original[i]),
    'Original file was modified.',
  )
  assert(
    result.sha256 === expected.sha256 &&
      result.file_size_bytes === bytes.length,
    'File facts changed.',
  )
})

Deno.test('PDF: a mismatched prepared MIME type is rejected', async () => {
  const bytes = await pdf()

  await denied(bytes, 'UNSUPPORTED_FILE_TYPE', {
    ...(await facts(bytes)),
    mime_type: 'image/png',
  })
})

Deno.test('PDF: invalid prepared checksum metadata is rejected', async () => {
  const bytes = await pdf()

  await denied(bytes, 'INVALID_EXPECTED_FILE', {
    ...(await facts(bytes)),
    sha256: 'invalid',
  })
})

Deno.test('PDF: a different stored byte count is rejected', async () => {
  const bytes = await pdf()

  await denied(bytes, 'SIZE_MISMATCH', {
    ...(await facts(bytes)),
    file_size_bytes: bytes.length + 1,
  })
})

Deno.test('PDF: changed stored bytes are rejected before parsing', async () => {
  const bytes = await pdf()
  const expected = await facts(bytes)
  const changed = bytes.slice()

  changed[20] ^= 1

  await denied(changed, 'CHECKSUM_MISMATCH', expected)
})

Deno.test('PDF: empty files are rejected', async () => {
  const expected = await facts(await pdf())

  await denied(new Uint8Array(), 'FILE_SIZE_LIMIT', expected)
})

Deno.test('PDF: files over 10,000,000 bytes are rejected', async () => {
  const expected = await facts(await pdf())

  await denied(new Uint8Array(10000001), 'FILE_SIZE_LIMIT', expected)
})

Deno.test(
  'PDF: ordinary text with matching size and checksum is rejected',
  async () => {
    await denied(
      new TextEncoder().encode('Fictional text pretending to be a PDF.'),
      'INVALID_PDF',
    )
  },
)

Deno.test(
  'PDF: truncated files are rejected even with a matching new checksum',
  async () => {
    const bytes = await pdf()

    await denied(bytes.subarray(0, bytes.length - 20), 'INVALID_PDF')
  },
)

Deno.test(
  'PDF: forged headers and cross-reference markers are rejected by the parser',
  async () => {
    const forged =
      '%PDF-1.7\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n'

    await denied(new TextEncoder().encode(forged), 'INVALID_PDF')
  },
)

Deno.test('PDF: zero-page documents are rejected', async () => {
  await denied(await pdf(false, 0), 'INVALID_PDF')
})

Deno.test('PDF: zero-width pages are rejected', async () => {
  const document = await PDFDocument.create()

  document.addPage([0, 160])

  await denied(await document.save(), 'INVALID_PDF')
})

Deno.test('PDF: password-protected PDFs are rejected', async () => {
  const encoded =
    'JVBERi0xLjcKJcK1wrYKCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCgoyIDAgb2JqCjw8L1R5cGUvUGFnZXMvQ291bnQgMS9LaWRzWzQgMCBSXT4+CmVuZG9iagoKMyAwIG9iago8PD4+CmVuZG9iagoKNCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDQwMCAxNjBdL1JvdGF0ZSAwL1Jlc291cmNlcyAzIDAgUi9QYXJlbnQgMiAwIFI+PgplbmRvYmoKCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNiAwMDAwMCBuIAowMDAwMDAwMDYyIDAwMDAwIG4gCjAwMDAwMDAxMTQgMDAwMDAgbiAKMDAwMDAwMDEzNSAwMDAwMCBuIAoKdHJhaWxlcgo8PC9TaXplIDUvUm9vdCAxIDAgUi9JRFs8QzI5NUMyOTIzRTdFQzNCMDVDNTVDM0I0NTIzNTZCNTk+PDhCQjJEQzYyNTE4M0Y1MjNCMjVGNUU1MkQyQTM0NkY0Pl0vRW5jcnlwdDw8L0ZpbHRlci9TdGFuZGFyZC9SIDQvViA0L0xlbmd0aCAxMjgvUCAtNC9FbmNyeXB0TWV0YWRhdGEgdHJ1ZS9TdG1GL1N0ZENGL1N0ckYvU3RkQ0YvQ0Y8PC9TdGRDRjw8L0F1dGhFdmVudC9Eb2NPcGVuL0NGTS9BRVNWMi9MZW5ndGggMTY+Pj4+L088NUYxMUI5OTgwNzRENDJGNUU3MkExMEJBMzVDNEUwQkZGQjk1MkYzN0I4Q0QwQkZGOTFGRDJBRjQzNTlFODY4MT4vVTw2NjVBMDM5NjQyN0ZGRDVEQTFGRkU3QURFMEVEMzg5NTI4QkY0RTVFNEU3NThBNDE2NDAwNEU1NkZGRkEwMTA4Pj4+Pj4Kc3RhcnR4cmVmCjIyNgolJUVPRgo='

  const bytes = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0),
  )

  await denied(bytes, 'INVALID_PDF')
})
