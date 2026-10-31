import {
  ZipWriter,
  Uint8ArrayWriter,
  Uint8ArrayReader,
  type ZipWriterConstructorOptions,
} from 'zipjs'
import { FileVerificationError } from './verify-file-facts.ts'
import { verifyDocx } from './verify-docx.ts'

declare const Deno: {
  test(name: string, run: () => Promise<void>): void
}

const MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAIN =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const REL_MIME = 'application/vnd.openxmlformats-package.relationships+xml'
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

function assert(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message)
}

function parts(main = 'word/document.xml') {
  return new Map<string, Uint8Array>([
    [
      '[Content_Types].xml',
      encode(
        `<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="${REL_MIME}"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/${main}" ContentType="${MAIN}"/></Types>`,
      ),
    ],
    [
      '_rels/.rels',
      encode(
        `<Relationships xmlns="${REL_NS}"><Relationship Id="r1" Type="${OFFICE}officeDocument" Target="${main}"/></Relationships>`,
      ),
    ],
    [
      main,
      encode(
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD}"><w:body><w:p><w:r><w:t>Fictional DOCX verification</w:t></w:r></w:p></w:body></w:document>`,
      ),
    ],
  ])
}

async function pack(
  items: Map<string, Uint8Array>,
  options: ZipWriterConstructorOptions = {},
) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    useCompressionStream: true,
    level: 6,
    ...options,
  })

  for (const [name, bytes] of items) {
    await writer.add(name, new Uint8ArrayReader(bytes))
  }

  return writer.close()
}

async function facts(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))

  return {
    mime_type: MIME,
    file_size_bytes: bytes.length,
    sha256: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join(''),
  }
}

async function denied(bytes: Uint8Array, code: string) {
  try {
    await verifyDocx(bytes, await facts(bytes))
  } catch (error) {
    assert(
      error instanceof FileVerificationError,
      'Expected a controlled DOCX error.',
    )
    assert(
      error.code === code,
      `Expected ${code}; received ${error.code}: ${error.message}`,
    )
    return
  }

  throw new Error(`Expected rejection: ${code}.`)
}

function rels(target: string, type = OFFICE + 'hyperlink', mode = 'External') {
  return encode(
    `<Relationships xmlns="${REL_NS}"><Relationship Id="r2" Type="${type}" Target="${target}" TargetMode="${mode}"/></Relationships>`,
  )
}

Deno.test('DOCX: a minimal Word package is accepted', async () => {
  const bytes = await pack(parts())
  const result = await verifyDocx(bytes, await facts(bytes))
  assert(
    result.part_count === 3 &&
      result.main_part === 'word/document.xml' &&
      result.detected_mime_type === MIME,
    'Unexpected DOCX facts.',
  )
})

Deno.test(
  'DOCX: stored ZIP entries and an alternate main-part path are supported',
  async () => {
    const bytes = await pack(parts('document.xml'), { level: 0 })
    const result = await verifyDocx(bytes, await facts(bytes))
    assert(
      result.main_part === 'document.xml',
      'The root relationship was not followed.',
    )
  },
)

Deno.test('DOCX: strict OOXML namespaces are supported', async () => {
  const items = parts()
  items.set(
    '_rels/.rels',
    encode(
      decode(items.get('_rels/.rels')!).replace(
        OFFICE,
        'http://purl.oclc.org/ooxml/officeDocument/relationships/',
      ),
    ),
  )
  items.set(
    'word/document.xml',
    encode(
      decode(items.get('word/document.xml')!).replace(
        WORD,
        'http://purl.oclc.org/ooxml/wordprocessingml/main',
      ),
    ),
  )
  const bytes = await pack(items)
  await verifyDocx(bytes, await facts(bytes))
})

Deno.test('DOCX: UTF-16 XML with a BOM is supported', async () => {
  for (const little of [true, false]) {
    const items = parts()
    const text = decode(items.get('word/document.xml')!).replace(
      'UTF-8',
      'UTF-16',
    )
    const xml = new Uint8Array(2 + text.length * 2)
    const view = new DataView(xml.buffer)
    view.setUint16(0, 0xfeff, little)

    for (let i = 0; i < text.length; i++) {
      view.setUint16(2 + i * 2, text.charCodeAt(i), little)
    }

    items.set('word/document.xml', xml)
    const bytes = await pack(items)
    await verifyDocx(bytes, await facts(bytes))
  }
})

Deno.test(
  'DOCX: ordinary external hyperlinks are accepted without fetching them',
  async () => {
    const items = parts()
    items.set(
      'word/_rels/document.xml.rels',
      rels('https://example.invalid/fictional'),
    )
    const bytes = await pack(items)
    await verifyDocx(bytes, await facts(bytes))
  },
)

Deno.test('DOCX: original bytes and SHA-256 remain unchanged', async () => {
  const bytes = await pack(parts())
  const copy = bytes.slice()
  const expected = await facts(bytes)
  const result = await verifyDocx(bytes, expected)
  assert(
    result.sha256 === expected.sha256 &&
      bytes.every((value, i) => value === copy[i]),
    'Original DOCX changed.',
  )
})

Deno.test('DOCX: plain text and forged ZIP markers are rejected', async () => {
  await denied(encode('Fictional plain text'), 'INVALID_DOCX')
  await denied(new Uint8Array([80, 75, 3, 4, 0, 0, 0]), 'INVALID_DOCX')
})

Deno.test('DOCX: a generic ZIP is not a Word document', async () => {
  await denied(
    await pack(new Map([['note.xml', encode('<note/>')]])),
    'INVALID_DOCX',
  )
})

Deno.test('DOCX: missing content types are rejected', async () => {
  const items = parts()
  items.delete('[Content_Types].xml')
  await denied(await pack(items), 'INVALID_DOCX')
})

Deno.test('DOCX: missing root relationships are rejected', async () => {
  const items = parts()
  items.delete('_rels/.rels')
  await denied(await pack(items), 'INVALID_DOCX')
})

Deno.test('DOCX: missing main-document targets are rejected', async () => {
  const items = parts()
  items.delete('word/document.xml')
  await denied(await pack(items), 'INVALID_DOCX')
})

Deno.test('DOCX: wrong main-document content types are rejected', async () => {
  const items = parts()
  items.set(
    '[Content_Types].xml',
    encode(
      decode(items.get('[Content_Types].xml')!).replace(
        MAIN,
        'application/xml',
      ),
    ),
  )
  await denied(await pack(items), 'INVALID_DOCX')
})

Deno.test('DOCX: macro-enabled content types are rejected', async () => {
  const items = parts()
  items.set(
    '[Content_Types].xml',
    encode(
      decode(items.get('[Content_Types].xml')!).replace(
        MAIN,
        'application/vnd.ms-word.document.macroEnabled.main+xml',
      ),
    ),
  )
  await denied(await pack(items), 'UNSUPPORTED_DOCX_FEATURE')
})

Deno.test('DOCX: known VBA parts are rejected', async () => {
  const items = parts()
  items.set('word/vbaProject.bin', encode('Fictional'))
  await denied(await pack(items), 'UNSUPPORTED_DOCX_FEATURE')
})

Deno.test('DOCX: embedded OLE/package parts are rejected', async () => {
  const items = parts()
  items.set('word/embeddings/object.bin', encode('Fictional'))
  await denied(await pack(items), 'UNSUPPORTED_DOCX_FEATURE')
})

Deno.test('DOCX: remote image relationships are rejected', async () => {
  const items = parts()
  items.set(
    'word/_rels/document.xml.rels',
    rels('https://example.invalid/image.png', OFFICE + 'image'),
  )
  await denied(await pack(items), 'UNSUPPORTED_DOCX_FEATURE')
})

Deno.test('DOCX: script hyperlinks are rejected', async () => {
  const items = parts()
  items.set('word/_rels/document.xml.rels', rels('javascript:alert(1)'))
  await denied(await pack(items), 'UNSUPPORTED_DOCX_FEATURE')
})

Deno.test(
  'DOCX: missing internal relationship targets are rejected',
  async () => {
    const items = parts()
    items.set(
      'word/_rels/document.xml.rels',
      rels('media/missing.bin', OFFICE + 'image', 'Internal'),
    )
    await denied(await pack(items), 'INVALID_DOCX')
  },
)

Deno.test('DOCX: duplicate relationship IDs are rejected', async () => {
  const items = parts()
  const xml = decode(items.get('_rels/.rels')!)
  items.set(
    '_rels/.rels',
    encode(
      xml.replace(
        '</Relationships>',
        `<Relationship Id="r1" Type="${OFFICE}officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
    ),
  )
  await denied(await pack(items), 'INVALID_DOCX')
})

Deno.test('DOCX: ambiguous case-only part names are rejected', async () => {
  const items = parts()
  items.set('WORD/document.xml', encode('<root/>'))
  await denied(await pack(items), 'INVALID_DOCX')
})

Deno.test('DOCX: malformed XML is rejected', async () => {
  const items = parts()
  items.set('word/document.xml', encode('<broken>'))
  await denied(await pack(items), 'INVALID_DOCX')
})

Deno.test('DOCX: a document without a Word body is rejected', async () => {
  const items = parts()
  items.set('word/document.xml', encode(`<w:document xmlns:w="${WORD}"/>`))
  await denied(await pack(items), 'INVALID_DOCX')
})

Deno.test(
  'DOCX: DTD and external entity declarations are rejected',
  async () => {
    const items = parts()
    items.set(
      'word/document.xml',
      encode(
        `<!DOCTYPE w:document [<!ENTITY x SYSTEM "https://example.invalid/entity">]><w:document xmlns:w="${WORD}"><w:body>&x;</w:body></w:document>`,
      ),
    )
    await denied(await pack(items), 'UNSUPPORTED_DOCX_FEATURE')
  },
)

Deno.test('DOCX: XML base overrides are rejected', async () => {
  const items = parts()
  items.set(
    'word/document.xml',
    encode(
      `<w:document xmlns:w="${WORD}" xml:base="https://example.invalid/"><w:body/></w:document>`,
    ),
  )
  await denied(await pack(items), 'UNSUPPORTED_DOCX_FEATURE')
})

Deno.test('DOCX: password-encrypted ZIP entries are rejected', async () => {
  await denied(
    await pack(parts(), {
      password: 'fictional-test-password',
      zipCrypto: true,
    }),
    'UNSUPPORTED_DOCX_FEATURE',
  )
})

Deno.test('DOCX: corrupted stored bytes fail ZIP CRC validation', async () => {
  const bytes = await pack(parts(), { level: 0 })
  const offset = new TextDecoder('latin1')
    .decode(bytes)
    .indexOf('Fictional DOCX')
  assert(offset >= 0, 'Stored test text was not found.')
  bytes[offset] ^= 1
  await denied(bytes, 'INVALID_DOCX')
})

Deno.test(
  'DOCX: conflicting local and central ZIP filenames are rejected',
  async () => {
    const bytes = await pack(parts(), { level: 0 })
    const view = new DataView(bytes.buffer)
    let changed = false

    for (let i = 0; i + 30 < bytes.length; i++) {
      if (view.getUint32(i, true) !== 0x04034b50) continue
      const length = view.getUint16(i + 26, true)
      if (
        decode(bytes.subarray(i + 30, i + 30 + length)) !== 'word/document.xml'
      )
        continue

      bytes[i + 30] = 87
      changed = true
      break
    }

    assert(changed, 'Local test filename was not found.')
    await denied(bytes, 'INVALID_DOCX')
  },
)

Deno.test('DOCX: deeply nested XML is rejected', async () => {
  const items = parts()
  items.set(
    'word/document.xml',
    encode(
      `<w:document xmlns:w="${WORD}"><w:body>${'<w:p>'.repeat(70)}${'</w:p>'.repeat(70)}</w:body></w:document>`,
    ),
  )
  await denied(await pack(items), 'DOCX_LIMIT')
})

Deno.test(
  'DOCX: oversized XML parts are rejected before XML parsing',
  async () => {
    const items = parts()
    items.set('word/document.xml', new Uint8Array(2 * 1024 * 1024 + 1).fill(65))
    await denied(await pack(items), 'DOCX_LIMIT')
  },
)

Deno.test(
  'DOCX: lying ZIP size fields are rejected by the ZIP reader',
  async () => {
    const items = parts()
    items.set(
      'word/media/fixture.bin',
      new Uint8Array(3 * 1024 * 1024).fill(65),
    )

    const bytes = await pack(items, { dataDescriptor: false })
    const view = new DataView(bytes.buffer)
    let changed = false

    for (let i = 0; i + 46 < bytes.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue
      const length = view.getUint16(i + 28, true)
      if (
        decode(bytes.subarray(i + 46, i + 46 + length)) !==
        'word/media/fixture.bin'
      )
        continue

      const local = view.getUint32(i + 42, true)
      view.setUint32(i + 24, 100, true)
      view.setUint32(local + 22, 100, true)
      changed = true
      break
    }

    assert(changed, 'ZIP fixture size fields were not found.')
    await denied(bytes, 'INVALID_DOCX')
  },
)

Deno.test(
  'DOCX: a default XML main-document content type is supported',
  async () => {
    const items = parts()
    items.set(
      '[Content_Types].xml',
      encode(
        `<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="${REL_MIME}"/><Default Extension="xml" ContentType="${MAIN}"/></Types>`,
      ),
    )
    const bytes = await pack(items)
    await verifyDocx(bytes, await facts(bytes))
  },
)

Deno.test(
  'DOCX: incorrectly cased relationship-part layouts are rejected',
  async () => {
    const items = parts()
    items.set('word/_rels/document.xml.RELS', rels('https://example.invalid/'))
    await denied(await pack(items), 'INVALID_DOCX')
  },
)

Deno.test('DOCX: aggregate XML decompression cannot exceed 8 MiB', async () => {
  const items = parts()
  const xml = encode('<root>' + 'A'.repeat(1800000) + '</root>')

  for (let i = 0; i < 5; i++) {
    items.set(`customXml/item${i}.xml`, xml)
  }

  await denied(await pack(items), 'DOCX_LIMIT')
})

Deno.test('DOCX: archives cannot contain over 1,000 entries', async () => {
  const items = parts()

  for (let i = 0; i < 998; i++) {
    items.set(`data/item${i}.bin`, new Uint8Array())
  }

  await denied(await pack(items), 'DOCX_LIMIT')
})

Deno.test('DOCX: the aggregate XML element budget is enforced', async () => {
  const items = parts()
  items.set(
    'word/document.xml',
    encode(
      `<w:document xmlns:w="${WORD}"><w:body>${'<w:p/>'.repeat(100001)}</w:body></w:document>`,
    ),
  )
  await denied(await pack(items), 'DOCX_LIMIT')
})

Deno.test('DOCX: individual expanded parts cannot exceed 20 MiB', async () => {
  const items = parts()
  items.set('word/media/large.bin', new Uint8Array(20 * 1024 * 1024 + 1))
  await denied(await pack(items), 'DOCX_LIMIT')
})

Deno.test('DOCX: total expanded content cannot exceed 40 MiB', async () => {
  const items = parts()
  const data = new Uint8Array(15 * 1024 * 1024)

  for (let i = 0; i < 3; i++) {
    items.set(`word/media/large${i}.bin`, data)
  }

  await denied(await pack(items), 'DOCX_LIMIT')
})

Deno.test(
  'DOCX: multiple office-document relationships are rejected',
  async () => {
    const items = parts()
    const xml = decode(parts().get('_rels/.rels')!)
    items.set(
      '_rels/.rels',
      encode(
        xml.replace(
          '</Relationships>',
          `<Relationship Id="r2" Type="${OFFICE}officeDocument" Target="word/document.xml"/></Relationships>`,
        ),
      ),
    )
    await denied(await pack(items), 'INVALID_DOCX')
  },
)

Deno.test(
  'DOCX: Unicode text and predefined XML entities are supported',
  async () => {
    const items = parts()
    items.set(
      'word/document.xml',
      encode(
        decode(items.get('word/document.xml')!).replace(
          'Fictional DOCX verification',
          'Fictional &amp; café ñ',
        ),
      ),
    )
    const bytes = await pack(items)
    await verifyDocx(bytes, await facts(bytes))
  },
)

Deno.test('DOCX: symbolic-link ZIP entries are rejected', async () => {
  await denied(
    await pack(parts(), { unixMode: 0o120777 }),
    'UNSUPPORTED_DOCX_FEATURE',
  )
})

Deno.test(
  'DOCX: traversal filenames are rejected without filesystem extraction',
  async () => {
    const items = parts()
    const name = 'word/media/fixture.bin'
    items.set(name, encode('Fictional'))

    const bytes = await pack(items, { level: 0 })
    const view = new DataView(bytes.buffer)
    let changed = false
    const replacement = encode('../' + 'x'.repeat(name.length - 7) + '.bin')

    for (let i = 0; i + 46 < bytes.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue
      const length = view.getUint16(i + 28, true)
      if (decode(bytes.subarray(i + 46, i + 46 + length)) !== name) continue

      const local = view.getUint32(i + 42, true)
      bytes.set(replacement, i + 46)
      bytes.set(replacement, local + 30)
      changed = true
      break
    }

    assert(changed, 'Traversal fixture metadata was not found.')
    await denied(bytes, 'INVALID_DOCX')
  },
)

Deno.test('DOCX: Unicode main-part names are supported', async () => {
  const bytes = await pack(parts('word/é.xml'))
  const result = await verifyDocx(bytes, await facts(bytes))
  assert(result.main_part === 'word/é.xml', 'The Unicode part name changed.')
})
