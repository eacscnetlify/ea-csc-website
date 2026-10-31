import { decode as decodePng } from 'fast-png'
import { decode as decodeJpeg } from 'jpeg-js'
import {
  FileVerificationError,
  verifyFileFacts,
  type ExpectedFile,
} from './verify-file-facts.ts'

const MAX_PIXELS = 8000000
const MAX_SIDE = 16384
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function reject(code: string, message: string): never {
  throw new FileVerificationError(code, message)
}

function dimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    reject('INVALID_IMAGE', 'The image dimensions are invalid.')
  }

  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    reject(
      'IMAGE_LIMIT',
      'Use an image of at most 8,000,000 pixels and 16,384 pixels on either side.',
    )
  }
}

async function inflatedSize(data: Uint8Array, limit: number): Promise<number> {
  const reader = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader()

  let size = 0
  let finished = false

  try {
    while (true) {
      const { value, done } = await reader.read()

      if (done) {
        finished = true
        break
      }

      size += value.byteLength

      if (size > limit) {
        reject('IMAGE_LIMIT', 'PNG decompression exceeds its allowed size.')
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  return size
}

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  )

  let position = 0

  for (const part of parts) {
    result.set(part, position)
    position += part.length
  }

  return result
}

async function pngPreflight(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = new TextDecoder('ascii')
  const data: Uint8Array[] = []

  let width = 0
  let height = 0
  let depth = 0
  let channels = 0
  let interlace = 0
  let color = 0
  let paletteEntries = 0
  let position = 8
  let chunks = 0
  let sawData = false
  let dataEnded = false
  let ended = false
  let metadataSize = 0

  const unique = new Set<string>()

  while (position < bytes.length) {
    if (++chunks > 4096 || position + 12 > bytes.length) {
      reject('INVALID_IMAGE', 'Invalid PNG chunk layout.')
    }

    const length = view.getUint32(position)
    const type = text.decode(bytes.subarray(position + 4, position + 8))
    const end = position + 12 + length

    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      type[2] !== type[2].toUpperCase() ||
      end > bytes.length
    ) {
      reject('INVALID_IMAGE', 'Invalid PNG chunk.')
    }

    const content = bytes.subarray(position + 8, end - 4)

    if (chunks === 1 && (type !== 'IHDR' || length !== 13)) {
      reject('INVALID_IMAGE', 'The PNG header is invalid.')
    }

    if (['IHDR', 'PLTE', 'tRNS', 'iCCP', 'IEND'].includes(type)) {
      if (unique.has(type)) {
        reject('INVALID_IMAGE', 'The PNG contains a repeated singleton chunk.')
      }
      unique.add(type)
    }

    if (type === 'IHDR') {
      if (chunks !== 1 || length !== 13) {
        reject('INVALID_IMAGE', 'The PNG header is invalid.')
      }

      width = view.getUint32(position + 8)
      height = view.getUint32(position + 12)
      dimensions(width, height)

      depth = content[8]
      color = content[9]

      const layouts: Record<number, [number, number[]]> = {
        0: [1, [1, 2, 4, 8, 16]],
        2: [3, [8, 16]],
        3: [1, [1, 2, 4, 8]],
        4: [2, [8, 16]],
        6: [4, [8, 16]],
      }

      const layout = layouts[color]

      if (
        !layout ||
        !layout[1].includes(depth) ||
        content[10] !== 0 ||
        content[11] !== 0 ||
        content[12] > 1
      ) {
        reject('INVALID_IMAGE', 'Unsupported PNG header values.')
      }

      channels = layout[0]
      interlace = content[12]

      if (interlace && depth < 8) {
        reject(
          'UNSUPPORTED_IMAGE_FEATURE',
          'Re-export this low-bit-depth interlaced PNG as an 8-bit PNG.',
        )
      }
    } else if (type === 'IDAT') {
      if (dataEnded) {
        reject('INVALID_IMAGE', 'PNG image data chunks must be consecutive.')
      }

      sawData = true
      data.push(content)
    } else {
      if (sawData) dataEnded = true

      if (['acTL', 'fcTL', 'fdAT'].includes(type)) {
        reject(
          'UNSUPPORTED_IMAGE_FEATURE',
          'Use a static PNG rather than an animated PNG.',
        )
      }

      if (
        type === 'PLTE' &&
        (sawData || length < 3 || length > 768 || length % 3 !== 0)
      ) {
        reject('INVALID_IMAGE', 'The PNG palette is invalid.')
      }

      if (type === 'tRNS' && (sawData || length > 256)) {
        reject('INVALID_IMAGE', 'PNG transparency metadata is invalid.')
      }

      if (type === 'PLTE') {
        paletteEntries = length / 3

        if (
          color === 0 ||
          color === 4 ||
          (color === 3 && paletteEntries > 2 ** depth)
        ) {
          reject(
            'INVALID_IMAGE',
            'The PNG palette does not match its color type.',
          )
        }
      }

      if (
        type === 'tRNS' &&
        !(
          (color === 0 && length === 2) ||
          (color === 2 && length === 6) ||
          (color === 3 &&
            paletteEntries > 0 &&
            length > 0 &&
            length <= paletteEntries)
        )
      ) {
        reject('INVALID_IMAGE', 'The PNG transparency values are invalid.')
      }

      if (['iCCP', 'zTXt', 'iTXt', 'tEXt'].includes(type)) {
        const separator = content.indexOf(0)

        if (separator < 1 || separator > 79) {
          reject('INVALID_IMAGE', 'PNG compressed metadata is invalid.')
        }

        let start = separator + 2
        let compressed = type !== 'tEXt'

        if (type === 'tEXt') start = separator + 1

        if (type === 'iTXt') {
          const flag = content[separator + 1]

          if (flag > 1 || content[separator + 2] !== 0) {
            reject('INVALID_IMAGE', 'PNG text compression is invalid.')
          }

          compressed = flag === 1

          const languageEnd = content.indexOf(0, separator + 3)
          const translatedEnd = content.indexOf(0, languageEnd + 1)

          if (languageEnd < 0 || translatedEnd < 0) {
            reject('INVALID_IMAGE', 'PNG international text is invalid.')
          }

          start = translatedEnd + 1
        } else if (type !== 'tEXt' && content[separator + 1] !== 0) {
          reject('INVALID_IMAGE', 'PNG metadata compression is invalid.')
        }

        metadataSize += compressed
          ? await inflatedSize(content.subarray(start), 1048576)
          : content.length - start

        if (metadataSize > 1048576) {
          reject(
            'IMAGE_LIMIT',
            'PNG expanded text and profile data exceed 1 MiB.',
          )
        }
      }

      if (type === 'IEND') {
        if (length !== 0 || !sawData || end !== bytes.length) {
          reject('INVALID_IMAGE', 'The PNG ending is invalid.')
        }
        ended = true
      } else if (type !== 'PLTE' && type[0] === type[0].toUpperCase()) {
        reject('INVALID_IMAGE', 'Unknown critical PNG chunk.')
      }
    }

    position = end
    if (ended) break
  }

  if (!ended || !width || !height || !sawData) {
    reject('INVALID_IMAGE', 'The PNG is incomplete.')
  }

  if (color === 3 && !paletteEntries) {
    reject('INVALID_IMAGE', 'The indexed PNG has no palette.')
  }

  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]]

  let expectedSize = 0

  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx))
    const h = Math.max(0, Math.ceil((height - y) / dy))

    if (w && h) {
      expectedSize += (Math.ceil((w * channels * depth) / 8) + 1) * h
    }
  }

  const actual = await inflatedSize(concat(data), expectedSize)

  if (actual !== expectedSize) {
    reject('INVALID_IMAGE', 'The PNG pixel data length is invalid.')
  }

  return {
    width,
    height,
    depth,
    channels,
    color,
    interlace,
    paletteEntries,
  }
}

export async function verifyImage(bytes: Uint8Array, expected: ExpectedFile) {
  const hash = await verifyFileFacts(bytes, expected, [
    'image/png',
    'image/jpeg',
  ])

  const png = PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  const jpeg = bytes[0] === 255 && bytes[1] === 216
  const detected = png ? 'image/png' : jpeg ? 'image/jpeg' : null

  if (!detected) {
    reject('INVALID_IMAGE', 'The file has no supported image signature.')
  }

  if (detected !== expected.mime_type) {
    reject('MIME_MISMATCH', 'Image bytes differ from the prepared MIME type.')
  }

  try {
    let width: number
    let height: number

    if (png) {
      const planned = await pngPreflight(bytes)
      const image = decodePng(bytes, { checkCrc: true })

      width = image.width
      height = image.height

      const rowSize = Math.ceil((width * planned.channels * planned.depth) / 8)
      const elements = (rowSize * height) / (planned.depth === 16 ? 2 : 1)

      if (
        width !== planned.width ||
        height !== planned.height ||
        image.data.length !== elements
      ) {
        reject('INVALID_IMAGE', 'PNG decoded pixels are invalid.')
      }

      if (planned.color === 3) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const bit = x * planned.depth
            const index =
              (image.data[y * rowSize + Math.floor(bit / 8)] >>
                (8 - planned.depth - (bit % 8))) &
              ((1 << planned.depth) - 1)

            if (index >= planned.paletteEntries) {
              reject(
                'INVALID_IMAGE',
                'A PNG pixel refers to a missing palette entry.',
              )
            }
          }
        }
      }
    } else {
      if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217) {
        reject('INVALID_IMAGE', 'The JPEG ending is invalid.')
      }

      const image = decodeJpeg(bytes, {
        useTArray: true,
        tolerantDecoding: false,
        maxResolutionInMP: 8,
        maxMemoryUsageInMB: 96,
      })

      width = image.width
      height = image.height

      if (image.data.length !== width * height * 4) {
        reject('INVALID_IMAGE', 'JPEG decoded pixels are invalid.')
      }
    }

    dimensions(width, height)

    return {
      detected_mime_type: detected,
      file_size_bytes: bytes.length,
      sha256: hash,
      width,
      height,
      verifier_version: 'eacsc-image-structure-v1' as const,
    }
  } catch (error) {
    if (error instanceof FileVerificationError) throw error

    if (
      error instanceof Error &&
      /^max(?:ResolutionInMP|MemoryUsageInMB) limit exceeded/.test(
        error.message,
      )
    ) {
      reject('IMAGE_LIMIT', 'The JPEG exceeds the decoding resource limits.')
    }

    reject(
      'INVALID_IMAGE',
      'The image could not be decoded within the verification limits.',
    )
  }
}
