import { encode as encodePng } from 'fast-png'
import { encode as encodeJpeg } from 'jpeg-js'
import {
  FileVerificationError,
  type ExpectedFile,
} from './verify-file-facts.ts'
import { verifyImage } from './verify-image.ts'

declare const Deno: {
  test(name: string, run: () => Promise<void>): void
}

function assert(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message)
}

const pixels = new Uint8Array([
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
])

const png = encodePng({
  width: 2,
  height: 2,
  data: pixels,
  channels: 4,
  depth: 8,
})

const jpeg = new Uint8Array(
  encodeJpeg({ width: 2, height: 2, data: pixels }, 80).data,
)

async function facts(
  bytes: Uint8Array,
  mime_type = 'image/png',
): Promise<ExpectedFile> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))

  return {
    mime_type,
    file_size_bytes: bytes.length,
    sha256: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join(''),
  }
}

async function denied(
  bytes: Uint8Array,
  code: string,
  expected?: ExpectedFile,
) {
  try {
    await verifyImage(bytes, expected ?? (await facts(bytes)))
  } catch (error) {
    assert(
      error instanceof FileVerificationError,
      'Expected a controlled verification error.',
    )
    assert(error.code === code, `Expected ${code}; received ${error.code}.`)
    return
  }

  throw new Error(`Expected rejection: ${code}.`)
}

function join(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  )
  let offset = 0

  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }

  return bytes
}

function chunk(type: string, content: Uint8Array) {
  const bytes = new Uint8Array(content.length + 12)
  const view = new DataView(bytes.buffer)

  view.setUint32(0, content.length)
  bytes.set(new TextEncoder().encode(type), 4)
  bytes.set(content, 8)

  let crc = 0xffffffff

  for (const value of bytes.subarray(4, bytes.length - 4)) {
    crc ^= value

    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }

  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0)
  return bytes
}

function resizeHeader(width: number, height: number) {
  const header = png.slice(16, 29)
  const view = new DataView(header.buffer)

  view.setUint32(0, width)
  view.setUint32(4, height)

  return join(png.slice(0, 8), chunk('IHDR', header), png.slice(33))
}

async function compressed(bytes: Uint8Array) {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new CompressionStream('deflate'))

  return new Uint8Array(await new Response(stream).arrayBuffer())
}

Deno.test('Image: a valid PNG is decoded', async () => {
  const result = await verifyImage(png, await facts(png))
  assert(
    result.width === 2 &&
      result.height === 2 &&
      result.detected_mime_type === 'image/png',
    'PNG facts differ.',
  )
})

Deno.test('Image: a valid JPEG is decoded', async () => {
  const result = await verifyImage(jpeg, await facts(jpeg, 'image/jpeg'))
  assert(
    result.width === 2 &&
      result.height === 2 &&
      result.detected_mime_type === 'image/jpeg',
    'JPEG facts differ.',
  )
})

Deno.test('Image: interlaced PNG is supported', async () => {
  const bytes = encodePng(
    { width: 2, height: 2, data: pixels, channels: 4, depth: 8 },
    { interlace: 'Adam7' },
  )
  await verifyImage(bytes, await facts(bytes))
})

Deno.test('Image: 16-bit PNG is supported', async () => {
  const bytes = encodePng({
    width: 2,
    height: 2,
    data: new Uint16Array(pixels.map((value) => (value ? 255 : 0))),
    channels: 4,
    depth: 16,
  })
  await verifyImage(bytes, await facts(bytes))
})

Deno.test('Image: indexed PNG palettes are supported', async () => {
  const bytes = encodePng({
    width: 2,
    height: 2,
    data: new Uint8Array([0, 1, 1, 0]),
    channels: 1,
    depth: 8,
    palette: [
      [255, 0, 0],
      [0, 255, 0],
    ],
  })
  await verifyImage(bytes, await facts(bytes))
})

Deno.test(
  'Image: verification preserves original PNG and JPEG bytes',
  async () => {
    for (const [bytes, mime] of [
      [png, 'image/png'],
      [jpeg, 'image/jpeg'],
    ] as const) {
      const copy = bytes.slice()
      const expected = await facts(bytes, mime)
      const result = await verifyImage(bytes, expected)

      assert(
        result.sha256 === expected.sha256 &&
          result.file_size_bytes === bytes.length &&
          bytes.every((value, i) => value === copy[i]),
        'Original image changed.',
      )
    }
  },
)

Deno.test('Image: prepared MIME must match the actual signature', async () => {
  await denied(png, 'MIME_MISMATCH', await facts(png, 'image/jpeg'))
  await denied(jpeg, 'MIME_MISMATCH', await facts(jpeg, 'image/png'))
})

Deno.test('Image: text pretending to be an image is rejected', async () => {
  await denied(
    new TextEncoder().encode('Fictional image test'),
    'INVALID_IMAGE',
  )
})

Deno.test('Image: a truncated PNG is rejected', async () => {
  await denied(png.slice(0, -6), 'INVALID_IMAGE')
})

Deno.test('Image: a truncated JPEG is rejected', async () => {
  const bytes = jpeg.slice(0, -2)
  await denied(bytes, 'INVALID_IMAGE', await facts(bytes, 'image/jpeg'))
})

Deno.test('Image: forged JPEG markers are insufficient', async () => {
  const bytes = new Uint8Array([255, 216, 1, 2, 3, 255, 217])
  await denied(bytes, 'INVALID_IMAGE', await facts(bytes, 'image/jpeg'))
})

Deno.test('Image: invalid PNG chunk checksums are rejected', async () => {
  const bytes = png.slice()
  bytes[32] ^= 1
  await denied(bytes, 'INVALID_IMAGE')
})

Deno.test(
  'Image: dimensions over the pixel limit are rejected before decoding',
  async () => {
    await denied(resizeHeader(3000, 3000), 'IMAGE_LIMIT')
  },
)

Deno.test(
  'Image: dimensions over the side limit are rejected before decoding',
  async () => {
    await denied(resizeHeader(16385, 1), 'IMAGE_LIMIT')
  },
)

Deno.test('Image: zero-sized PNG dimensions are rejected', async () => {
  await denied(resizeHeader(0, 2), 'INVALID_IMAGE')
})

Deno.test('Image: animated PNG is rejected', async () => {
  const control = new Uint8Array(8)
  new DataView(control.buffer).setUint32(0, 1)

  await denied(
    join(png.slice(0, 33), chunk('acTL', control), png.slice(33)),
    'UNSUPPORTED_IMAGE_FEATURE',
  )
})

Deno.test(
  'Image: PNG decompression cannot exceed declared pixel data',
  async () => {
    const idat = chunk('IDAT', await compressed(new Uint8Array(100000)))

    await denied(
      join(png.slice(0, 33), idat, chunk('IEND', new Uint8Array())),
      'IMAGE_LIMIT',
    )
  },
)

Deno.test(
  'Image: oversized compressed PNG profile data is rejected',
  async () => {
    const profile = join(
      new TextEncoder().encode('Fictional'),
      new Uint8Array([0, 0]),
      await compressed(new Uint8Array(1048577)),
    )

    await denied(
      join(png.slice(0, 33), chunk('iCCP', profile), png.slice(33)),
      'IMAGE_LIMIT',
    )
  },
)

Deno.test('Image: bytes after the PNG ending are rejected', async () => {
  await denied(join(png, new Uint8Array([1])), 'INVALID_IMAGE')
})

Deno.test('Image: duplicate PNG headers are rejected', async () => {
  await denied(
    join(png.slice(0, 33), png.slice(8, 33), png.slice(33)),
    'INVALID_IMAGE',
  )
})

Deno.test('Image: unknown critical PNG chunks are rejected', async () => {
  await denied(
    join(png.slice(0, 33), chunk('ABCD', new Uint8Array()), png.slice(33)),
    'INVALID_IMAGE',
  )
})

Deno.test('Image: stored-byte checksum mismatches are rejected', async () => {
  const bytes = png.slice()
  bytes[32] ^= 1
  await denied(bytes, 'CHECKSUM_MISMATCH', await facts(png))
})

Deno.test('Image: missing PNG palette entries are rejected', async () => {
  const bytes = encodePng({
    width: 2,
    height: 2,
    data: new Uint8Array([0, 2, 1, 0]),
    channels: 1,
    depth: 8,
    palette: [
      [255, 0, 0],
      [0, 255, 0],
    ],
  })

  await denied(bytes, 'INVALID_IMAGE')
})

Deno.test(
  'Image: packed non-interlaced PNG palettes are supported',
  async () => {
    const bytes = encodePng({
      width: 4,
      height: 1,
      data: new Uint8Array([0b01010000]),
      channels: 1,
      depth: 1,
      palette: [
        [255, 0, 0],
        [0, 255, 0],
      ],
    })

    await verifyImage(bytes, await facts(bytes))
  },
)

Deno.test('Image: the JPEG decoder enforces the pixel limit', async () => {
  const bytes = jpeg.slice()
  const frame = bytes.findIndex(
    (value, i) => value === 255 && bytes[i + 1] === 192,
  )
  assert(frame >= 0, 'JPEG fixture has no baseline frame.')

  const view = new DataView(bytes.buffer)
  view.setUint16(frame + 5, 3000)
  view.setUint16(frame + 7, 3000)

  await denied(bytes, 'IMAGE_LIMIT', await facts(bytes, 'image/jpeg'))
})

Deno.test(
  'Image: low-bit-depth interlaced PNG requires re-export',
  async () => {
    const header = png.slice(16, 29)
    header[8] = 1
    header[9] = 3
    header[12] = 1

    await denied(
      join(png.slice(0, 8), chunk('IHDR', header), png.slice(33)),
      'UNSUPPORTED_IMAGE_FEATURE',
    )
  },
)

Deno.test(
  'Image: extra compressed streams cannot hide after PNG pixel data',
  async () => {
    const data = join(
      await compressed(new Uint8Array(18)),
      await compressed(new Uint8Array(100000)),
    )

    await denied(
      join(
        png.slice(0, 33),
        chunk('IDAT', data),
        chunk('IEND', new Uint8Array()),
      ),
      'INVALID_IMAGE',
    )
  },
)

Deno.test('Image: oversized uncompressed PNG text is rejected', async () => {
  const text = join(
    new TextEncoder().encode('Fictional'),
    new Uint8Array([0]),
    new Uint8Array(1048577).fill(65),
  )

  await denied(
    join(png.slice(0, 33), chunk('tEXt', text), png.slice(33)),
    'IMAGE_LIMIT',
  )
})
