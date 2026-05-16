const orderedListPattern = /^\s*\d+\.\s+/
const unorderedListPattern = /^\s*[-*+]\s+/
const headingPattern = /^(#{1,6})\s+(.*)$/
const fencePattern = /^```([\w-]*)\s*$/
const quotePattern = /^\s*>\s?/
const hrPattern = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) {
    return ''
  }
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return trimmed
  }
  return ''
}

function renderMarkdownInline(source: string): string {
  const placeholders: string[] = []
  const store = (html: string) => {
    const token = `@@MD_TOKEN_${placeholders.length}@@`
    placeholders.push(html)
    return token
  }

  let output = source

  output = output.replace(/`([^`\n]+)`/g, (_, code: string) => store(`<code>${escapeHtml(code)}</code>`))
  output = output.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => {
    const safeUrl = sanitizeUrl(url)
    if (!safeUrl) {
      return `${label} (${url})`
    }
    return store(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`,
    )
  })

  output = escapeHtml(output)
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  output = output.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  output = output.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  output = output.replace(/(^|[^\w\\])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  output = output.replace(/(^|[^\w\\])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')

  return output.replace(/@@MD_TOKEN_(\d+)@@/g, (_, index: string) => placeholders[Number(index)] ?? '')
}

function collectParagraph(lines: string[], start: number): { html: string; nextIndex: number } {
  const buffer: string[] = []
  let index = start

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      break
    }
    if (
      fencePattern.test(line) ||
      headingPattern.test(line) ||
      orderedListPattern.test(line) ||
      unorderedListPattern.test(line) ||
      quotePattern.test(line) ||
      hrPattern.test(line)
    ) {
      break
    }
    buffer.push(line.trimEnd())
    index += 1
  }

  const html = `<p>${buffer.map((line) => renderMarkdownInline(line)).join('<br />')}</p>`
  return { html, nextIndex: index }
}

export function renderMarkdown(source: string | undefined): string {
  if (!source?.trim()) {
    return ''
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const fenceMatch = line.match(fencePattern)
    if (fenceMatch) {
      const language = fenceMatch[1]?.trim()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : ''
      blocks.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    const headingMatch = line.match(headingPattern)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6)
      blocks.push(`<h${level}>${renderMarkdownInline(headingMatch[2].trim())}</h${level}>`)
      index += 1
      continue
    }

    if (hrPattern.test(line)) {
      blocks.push('<hr />')
      index += 1
      continue
    }

    if (quotePattern.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && quotePattern.test(lines[index])) {
        quoteLines.push(lines[index].replace(quotePattern, ''))
        index += 1
      }
      blocks.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`)
      continue
    }

    if (unorderedListPattern.test(line)) {
      const items: string[] = []
      while (index < lines.length && unorderedListPattern.test(lines[index])) {
        items.push(`<li>${renderMarkdownInline(lines[index].replace(unorderedListPattern, '').trim())}</li>`)
        index += 1
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (orderedListPattern.test(line)) {
      const items: string[] = []
      while (index < lines.length && orderedListPattern.test(lines[index])) {
        items.push(`<li>${renderMarkdownInline(lines[index].replace(orderedListPattern, '').trim())}</li>`)
        index += 1
      }
      blocks.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    const paragraph = collectParagraph(lines, index)
    blocks.push(paragraph.html)
    index = paragraph.nextIndex
  }

  return blocks.join('')
}
