import { ZipReader, Uint8ArrayReader, type FileEntry } from 'zipjs'
import { SaxesParser, type SaxesTagNS } from 'saxes'
import {
  FileVerificationError,
  verifyFileFacts,
  type ExpectedFile,
} from './verify-file-facts.ts'

const MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAIN =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const REL_MIME = 'application/vnd.openxmlformats-package.relationships+xml'
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/',
]
const WORD = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]
const XML_LIMIT = 2 * 1024 * 1024
const XML_TOTAL = 8 * 1024 * 1024
const PART_LIMIT = 20 * 1024 * 1024
const TOTAL_LIMIT = 40 * 1024 * 1024

export interface DocxVerification {
  detected_mime_type: typeof MIME
  file_size_bytes: number
  sha256: string
  part_count: number
  main_part: string
  verifier_version: 'eacsc-docx-structure-v1'
}

function reject(code: string, message: string): never {
  throw new FileVerificationError(code, message)
}

function invalid(message: string): never {
  return reject('INVALID_DOCX', message)
}

function attr(tag: SaxesTagNS, name: string) {
  return (
    Object.values(tag.attributes).find((a) => a.uri === '' && a.local === name)
      ?.value ?? ''
  )
}

function partPath(source: string, target: string) {
  if (
    !target ||
    target.trim() !== target ||
    /\p{Cc}/u.test(target) ||
    target.includes('\\')
  ) {
    invalid('A package target is invalid.')
  }

  const base = source.split('/').map(encodeURIComponent).join('/')
  const url = new URL(target, `https://docx.invalid/${base}`)

  if (url.origin !== 'https://docx.invalid' || url.search || url.hash) {
    invalid('An internal relationship leaves the package or is ambiguous.')
  }

  const name = decodeURIComponent(url.pathname.slice(1))

  if (!name || name !== name.normalize('NFC')) {
    invalid('A package target is ambiguous.')
  }

  return name
}

interface Budget {
  elements: number
}

function parseXml(
  bytes: Uint8Array,
  budget: Budget,
  visit: (tag: SaxesTagNS, depth: number) => void,
) {
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? 'utf-16le'
      : bytes[0] === 254 && bytes[1] === 255
        ? 'utf-16be'
        : 'utf-8'

  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  const parser = new SaxesParser({ xmlns: true })
  let depth = 0

  parser.on('error', () => invalid('A DOCX XML part is malformed.'))

  parser.on('doctype', () =>
    reject(
      'UNSUPPORTED_DOCX_FEATURE',
      'DOCTYPE declarations are not supported.',
    ),
  )

  parser.on('xmldecl', (declaration) => {
    const declared = declaration.encoding?.toLowerCase().replace('-', '')

    if (
      declared &&
      !(encoding === 'utf-8'
        ? declared === 'utf8'
        : declared === 'utf16' || declared === encoding.replace('-', ''))
    ) {
      reject(
        'UNSUPPORTED_DOCX_FEATURE',
        'Use UTF-8 or correctly declared UTF-16 XML.',
      )
    }
  })

  parser.on('opentag', (tag) => {
    depth++

    if (
      depth > 64 ||
      ++budget.elements > 100000 ||
      Object.keys(tag.attributes).length > 256
    ) {
      reject(
        'DOCX_LIMIT',
        'DOCX XML complexity exceeds the verification limits.',
      )
    }

    if (
      Object.values(tag.attributes).some(
        (a) =>
          a.uri === 'http://www.w3.org/XML/1998/namespace' &&
          a.local === 'base',
      )
    ) {
      reject(
        'UNSUPPORTED_DOCX_FEATURE',
        'XML base overrides are not supported.',
      )
    }

    visit(tag, depth)
  })

  parser.on('closetag', () => {
    depth--
  })

  for (let offset = 0; offset < text.length; offset += 8192) {
    parser.write(text.slice(offset, offset + 8192))
  }

  parser.close()
}

export async function verifyDocx(
  bytes: Uint8Array,
  expected: ExpectedFile,
): Promise<DocxVerification> {
  const hash = await verifyFileFacts(bytes, expected, [MIME])

  if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) {
    invalid('The DOCX is not a supported ZIP package.')
  }

  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
    useCompressionStream: true,
    strictness: 'strict',
    filenameValidation: 'strict',
    checkCrc32: true,
    checkOverlappingEntry: true,
  })

  try {
    const files = new Map<string, FileEntry>()
    const names = new Set<string>()
    let count = 0
    let declaredTotal = 0
    let actualTotal = 0
    let xmlTotal = 0

    for await (const entry of reader.getEntriesGenerator()) {
      if (++count > 1000) {
        reject('DOCX_LIMIT', 'The DOCX contains more than 1,000 ZIP entries.')
      }

      const name = entry.filename

      if (entry.directory && !name.endsWith('/')) {
        invalid('A ZIP directory name is ambiguous.')
      }

      const path = entry.directory ? name.slice(0, -1) : name

      if (
        !path ||
        path.length > 512 ||
        path !== path.normalize('NFC') ||
        /\p{Cc}/u.test(path) ||
        path.includes('\\') ||
        path.includes(':') ||
        path.startsWith('/') ||
        path.split('/').some((p) => !p || p === '.' || p === '..')
      ) {
        invalid('The DOCX contains an invalid part name.')
      }

      const key = path.toLowerCase()

      if (names.has(key)) {
        invalid('The DOCX contains duplicate or ambiguous part names.')
      }

      names.add(key)

      if (
        entry.encrypted ||
        entry.symlink ||
        ![0, 8].includes(entry.compressionMethod)
      ) {
        reject(
          'UNSUPPORTED_DOCX_FEATURE',
          'Encrypted, linked, or unsupported ZIP entries are not accepted.',
        )
      }

      if (
        entry.diskNumberStart !== 0 ||
        !Number.isSafeInteger(entry.compressedSize) ||
        entry.compressedSize < 0 ||
        entry.compressedSize > bytes.length ||
        !Number.isSafeInteger(entry.offset) ||
        entry.offset < 0 ||
        entry.offset >= bytes.length
      ) {
        invalid('A ZIP entry has invalid bounds.')
      }

      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 0 ||
        entry.uncompressedSize > PART_LIMIT
      ) {
        reject('DOCX_LIMIT', 'A DOCX part exceeds 20 MiB.')
      }

      declaredTotal += entry.uncompressedSize

      if (declaredTotal > TOTAL_LIMIT) {
        reject('DOCX_LIMIT', 'Expanded DOCX content exceeds 40 MiB.')
      }

      if (entry.directory) {
        if (entry.uncompressedSize !== 0) {
          invalid('A DOCX directory contains data.')
        }
        continue
      }

      if (
        /(^|\/)(?:vbaProject[^/]*|vbaData[^/]*|activeX|embeddings)(?:\/|$)/i.test(
          path,
        )
      ) {
        reject(
          'UNSUPPORTED_DOCX_FEATURE',
          'Macro, ActiveX, and embedded object parts are not accepted.',
        )
      }

      files.set(name, entry)
    }

    const budget: Budget = { elements: 0 }

    const read = async (entry: FileEntry, xml: boolean) => {
      const limit = xml ? XML_LIMIT : PART_LIMIT

      if (entry.uncompressedSize > limit) {
        reject('DOCX_LIMIT', 'A DOCX XML part exceeds 2 MiB.')
      }

      let size = 0
      const chunks: Uint8Array[] = []

      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            size += chunk.length
            actualTotal += chunk.length
            if (xml) xmlTotal += chunk.length

            if (
              size > limit ||
              size > entry.uncompressedSize ||
              actualTotal > TOTAL_LIMIT ||
              xmlTotal > XML_TOTAL
            ) {
              reject(
                'DOCX_LIMIT',
                'DOCX decompression exceeds its allowed size.',
              )
            }

            if (xml) chunks.push(new Uint8Array(chunk))
          },
        }),
        { signal: AbortSignal.timeout(15000) },
      )

      if (size !== entry.uncompressedSize) {
        invalid('A DOCX part has an inconsistent size.')
      }

      if (!xml) return new Uint8Array()

      const result = new Uint8Array(size)
      let offset = 0

      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }

      return result
    }

    const ct = files.get('[Content_Types].xml')

    if (!ct || !files.has('_rels/.rels')) {
      invalid('Required DOCX package parts are missing.')
    }

    const defaults = new Map<string, string>()
    const overrides = new Map<string, string>()

    parseXml(await read(ct, true), budget, (tag, depth) => {
      if (
        tag.uri !== CT_NS ||
        (depth === 1
          ? tag.local !== 'Types'
          : depth !== 2 || !['Default', 'Override'].includes(tag.local))
      ) {
        invalid('DOCX content types are invalid.')
      }

      if (depth === 1) return

      const type = attr(tag, 'ContentType').toLowerCase()

      if (
        !type ||
        /(?:macroenabled|vbaproject|vbadata|activex|oleobject)/i.test(type)
      ) {
        reject(
          'UNSUPPORTED_DOCX_FEATURE',
          'Macro or active content types are not accepted.',
        )
      }

      if (tag.local === 'Default') {
        const extension = attr(tag, 'Extension').toLowerCase()

        if (!/^[a-z0-9]+$/.test(extension) || defaults.has(extension)) {
          invalid('A default content type is ambiguous.')
        }

        defaults.set(extension, type)
      } else {
        const target = attr(tag, 'PartName')

        if (!target.startsWith('/')) {
          invalid('A content-type part name is invalid.')
        }

        const name = partPath('', target)

        if (!files.has(name) || overrides.has(name)) {
          invalid('A content-type override has no unique part.')
        }

        overrides.set(name, type)
      }
    })

    const contentType = (name: string) =>
      overrides.get(name) ??
      defaults.get(name.split('.').at(-1)?.toLowerCase() ?? '') ??
      ''

    const xmlParts = new Map<string, Uint8Array>()

    for (const [name, entry] of files) {
      if (name === '[Content_Types].xml') continue

      const type = contentType(name)

      if (!type) invalid('A DOCX part has no declared content type.')

      const xml = type.endsWith('+xml') || type.endsWith('/xml')

      if (/\.(?:xml|rels)$/i.test(name) && !xml) {
        invalid('An XML part has an inconsistent content type.')
      }

      if (/\.rels$/i.test(name) && type !== REL_MIME) {
        invalid('A relationship part has an inconsistent content type.')
      }

      const data = await read(entry, xml)
      if (xml) xmlParts.set(name, data)
    }

    let mainPart = ''

    for (const [name, data] of xmlParts) {
      if (contentType(name) !== REL_MIME) continue

      const match = /^(?:(.*)\/)?_rels\/([^/]+)\.rels$/.exec(name)
      const source =
        name === '_rels/.rels'
          ? ''
          : match
            ? `${match[1] ? match[1] + '/' : ''}${match[2]}`
            : null

      if (source === null || (source && !files.has(source))) {
        invalid('A relationship part has no source part.')
      }

      const ids = new Set<string>()

      parseXml(data, budget, (tag, depth) => {
        if (
          tag.uri !== REL_NS ||
          (depth === 1
            ? tag.local !== 'Relationships'
            : depth !== 2 || tag.local !== 'Relationship')
        ) {
          invalid('DOCX relationships are malformed.')
        }

        if (depth === 1) return

        const id = attr(tag, 'Id')
        const type = attr(tag, 'Type')
        const target = attr(tag, 'Target')
        const mode = attr(tag, 'TargetMode') || 'Internal'

        if (
          !id ||
          ids.has(id) ||
          !type ||
          !target ||
          !['Internal', 'External'].includes(mode)
        ) {
          invalid('A DOCX relationship is incomplete or duplicated.')
        }

        ids.add(id)

        if (
          /\/(?:vbaProject|vbaData|oleObject|package|control|aFChunk|attachedTemplate|subDocument)$/i.test(
            type,
          )
        ) {
          reject(
            'UNSUPPORTED_DOCX_FEATURE',
            'An active or embedded document relationship is not accepted.',
          )
        }

        if (mode === 'External') {
          const url = new URL(target)

          if (
            !OFFICE.some((base) => type === base + 'hyperlink') ||
            !['http:', 'https:', 'mailto:'].includes(url.protocol) ||
            url.username ||
            url.password
          ) {
            reject(
              'UNSUPPORTED_DOCX_FEATURE',
              'Only ordinary web and email hyperlinks may be external.',
            )
          }
        } else {
          const destination = partPath(source, target)

          if (!files.has(destination)) {
            invalid('An internal DOCX relationship target is missing.')
          }

          if (
            !source &&
            OFFICE.some((base) => type === base + 'officeDocument')
          ) {
            if (mainPart) invalid('The DOCX has multiple main documents.')
            mainPart = destination
          }
        }
      })
    }

    if (
      !mainPart ||
      contentType(mainPart) !== MAIN ||
      !xmlParts.has(mainPart)
    ) {
      invalid('The package has no DOCX main document.')
    }

    let bodyCount = 0
    let mainNamespace = ''

    for (const [name, data] of xmlParts) {
      if (contentType(name) === REL_MIME) continue

      parseXml(data, budget, (tag, depth) => {
        if (name !== mainPart) return

        if (depth === 1) {
          if (tag.local !== 'document' || !WORD.includes(tag.uri)) {
            invalid('The Word document root is invalid.')
          }
          mainNamespace = tag.uri
        }

        if (depth === 2 && tag.local === 'body' && tag.uri === mainNamespace) {
          bodyCount++
        }
      })
    }

    if (bodyCount !== 1) invalid('The Word document needs exactly one body.')

    return {
      detected_mime_type: MIME,
      file_size_bytes: bytes.length,
      sha256: hash,
      part_count: files.size,
      main_part: mainPart,
      verifier_version: 'eacsc-docx-structure-v1',
    }
  } catch (error) {
    if (error instanceof FileVerificationError) throw error
    invalid('The DOCX package or XML structure could not be verified.')
  } finally {
    await reader.close()
  }
}
