import { type ReactNode } from 'react'

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const tokenRegex =
    /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let idx = 0

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    const key = `${keyPrefix}-${idx++}`

    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-950">
          {renderInline(token.slice(2, -2), `${key}-b`)}
        </strong>,
      )
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={key} className="italic">
          {renderInline(token.slice(1, -1), `${key}-i`)}
        </em>,
      )
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-200/80 px-1 py-0.5 font-mono text-[12px] text-slate-900"
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (linkMatch) {
        const [, label, href] = linkMatch
        nodes.push(
          <a
            key={key}
            href={href}
            target={href.startsWith('http') ? '_blank' : undefined}
            rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
            className="font-medium text-emerald-800 underline hover:text-emerald-950"
          >
            {label}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

export function MarkdownMessage({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++
      blocks.push(
        <pre
          key={`code-${i}`}
          className="overflow-x-auto rounded-lg bg-slate-900 p-2.5 font-mono text-xs text-slate-100"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} className="my-2 border-slate-200" />)
      i++
      continue
    }

    // Headings (# .. ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed)
    if (headingMatch) {
      const level = headingMatch[1].length
      const content = headingMatch[2]
      const cls =
        level <= 2
          ? 'mt-2 text-sm font-bold text-slate-950'
          : 'mt-1.5 text-[13px] font-bold text-slate-900'
      blocks.push(
        <h4 key={`h-${i}`} className={cls}>
          {renderInline(content, `h-${i}`)}
        </h4>,
      )
      i++
      continue
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2))
        i++
      }
      blocks.push(
        <blockquote
          key={`bq-${i}`}
          className="border-l-2 border-emerald-700 pl-2.5 text-slate-700 italic"
        >
          {renderInline(quoteLines.join(' '), `bq-${i}`)}
        </blockquote>,
      )
      continue
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc space-y-1 pl-4">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul-${i}-${idx}`)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal space-y-1 pl-4">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol-${i}-${idx}`)}</li>
          ))}
        </ol>,
      )
      continue
    }

    // Paragraph (collect consecutive non-block lines)
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4}\s+|[-*•]\s+|\d+\.\s+|>\s+|```|-{3,}$|\*{3,}$)/.test(
        lines[i].trim(),
      )
    ) {
      paraLines.push(lines[i].trim())
      i++
    }
    blocks.push(
      <p key={`p-${i}`}>{renderInline(paraLines.join(' '), `p-${i}`)}</p>,
    )
  }

  return <div className="space-y-2">{blocks}</div>
}
