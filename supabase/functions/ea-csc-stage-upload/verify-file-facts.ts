export class FileVerificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'FileVerificationError'
  }
}

export interface ExpectedFile {
  mime_type: string
  file_size_bytes: number
  sha256: string
}

export async function verifyFileFacts(
  bytes: Uint8Array,
  expected: ExpectedFile,
  allowedTypes: readonly string[],
): Promise<string> {
  if (!allowedTypes.includes(expected.mime_type)) {
    throw new FileVerificationError(
      'UNSUPPORTED_FILE_TYPE',
      'The prepared MIME type is unsupported by this verifier.',
    )
  }

  if (
    !Number.isSafeInteger(expected.file_size_bytes) ||
    expected.file_size_bytes < 1 ||
    expected.file_size_bytes > 10000000 ||
    !/^[0-9a-f]{64}$/.test(expected.sha256)
  ) {
    throw new FileVerificationError(
      'INVALID_EXPECTED_FILE',
      'Prepared file facts are invalid.',
    )
  }

  if (bytes.byteLength < 1 || bytes.byteLength > 10000000) {
    throw new FileVerificationError(
      'FILE_SIZE_LIMIT',
      'The file must contain 1 to 10,000,000 bytes.',
    )
  }

  if (bytes.byteLength !== expected.file_size_bytes) {
    throw new FileVerificationError(
      'SIZE_MISMATCH',
      'Stored size differs from the prepared file.',
    )
  }

  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')

  if (hash !== expected.sha256) {
    throw new FileVerificationError(
      'CHECKSUM_MISMATCH',
      'Stored bytes differ from the prepared file.',
    )
  }

  return hash
}
