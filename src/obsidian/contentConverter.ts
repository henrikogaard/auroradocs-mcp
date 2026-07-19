import { extractWikiLinks, safeVaultReference } from './links.js'
import type { ResolvedVaultLink } from './analyzer.js'

export type AttachmentDestination = { attachmentId: string; url: string }
export type MarkdownConversionContext = {
  sourcePath: string
  objectIdsByPath: Map<string, string>
  resolvedLinks: ResolvedVaultLink[]
  attachmentsByPath: Map<string, AttachmentDestination>
}
export type MarkdownConversionResult = {
  document: Record<string, unknown>
  warnings: string[]
  referencedAttachmentIds: string[]
}

type JsonNode = { type: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; text?: string; content?: JsonNode[] }

function textNode(text: string, marks?: JsonNode['marks']): JsonNode {
  return { type: 'text', text, ...(marks?.length ? { marks } : {}) }
}

function inlineNodes(source: string, context: MarkdownConversionContext, warnings: string[], attachmentIds: Set<string>): JsonNode[] {
  const nodes: JsonNode[] = []
  const expression = /(!\[\[[^\]\n]+\]\]|\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]+\)|\[[^\]\n]+\]\([^)\n]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g
  let cursor = 0
  for (const match of source.matchAll(expression)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(textNode(source.slice(cursor, index)))
    const raw = match[0]
    if (raw.startsWith('[[') || raw.startsWith('![[')) {
      const wiki = extractWikiLinks(raw)[0]
      if (!wiki) nodes.push(textNode(raw))
      else if (wiki.embed) {
        const assetPath = context.attachmentsByPath.has(wiki.target)
          ? wiki.target
          : safeVaultReference(context.sourcePath, wiki.target)
        const attachment = assetPath ? context.attachmentsByPath.get(assetPath) : undefined
        if (attachment) {
          attachmentIds.add(attachment.attachmentId)
          nodes.push({ type: 'attachment', attrs: { id: attachment.attachmentId, href: attachment.url, label: wiki.alias ?? wiki.target } })
        } else {
          const resolved = context.resolvedLinks.find((link) => link.sourcePath === context.sourcePath && link.target === wiki.target && link.anchor === wiki.anchor)
          const objectId = resolved?.resolvedPath ? context.objectIdsByPath.get(resolved.resolvedPath) : undefined
          if (objectId) {
            nodes.push(textNode(wiki.alias ?? wiki.target, [{ type: 'link', attrs: { href: `/object/${objectId}` } }]))
            warnings.push(`Embedded note ${wiki.target} became an object link.`)
          } else {
            nodes.push(textNode(raw))
            warnings.push(`Unresolved attachment embed ${wiki.target} was preserved as readable text.`)
          }
        }
      } else {
        const resolved = context.resolvedLinks.find((link) => link.sourcePath === context.sourcePath && link.target === wiki.target && link.anchor === wiki.anchor)
        const objectId = resolved?.resolvedPath ? context.objectIdsByPath.get(resolved.resolvedPath) : undefined
        const label = wiki.alias ?? wiki.target
        if (objectId) {
          nodes.push(textNode(label, [{ type: 'link', attrs: { href: `/object/${objectId}` } }]))
          if (wiki.anchor) warnings.push(`Anchor ${wiki.anchor} on ${wiki.target} was reduced to an object-level link.`)
        } else {
          nodes.push(textNode(label))
          warnings.push(`${resolved?.status === 'ambiguous' ? 'Ambiguous' : 'Broken'} wiki link ${wiki.target} was preserved as readable text.`)
        }
      }
    } else if (raw.startsWith('![')) {
      const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(raw)
      const target = image?.[2]?.trim().replace(/^<|>$/g, '') ?? ''
      const assetPath = context.attachmentsByPath.has(target) ? target : safeVaultReference(context.sourcePath, target)
      const attachment = assetPath ? context.attachmentsByPath.get(assetPath) : undefined
      if (attachment) {
        attachmentIds.add(attachment.attachmentId)
        nodes.push({ type: 'attachment', attrs: { id: attachment.attachmentId, href: attachment.url, label: image?.[1] || target } })
      } else {
        nodes.push(textNode(raw)); warnings.push(`Unresolved attachment ${target} was preserved as readable text.`)
      }
    } else if (raw.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw)
      nodes.push(textNode(link?.[1] ?? raw, link ? [{ type: 'link', attrs: { href: link[2] } }] : undefined))
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      nodes.push(textNode(raw.slice(2, -2), [{ type: 'bold' }]))
    } else if (raw.startsWith('`')) {
      nodes.push(textNode(raw.slice(1, -1), [{ type: 'code' }]))
    } else {
      nodes.push(textNode(raw.slice(1, -1), [{ type: 'italic' }]))
    }
    cursor = index + raw.length
  }
  if (cursor < source.length) nodes.push(textNode(source.slice(cursor)))
  return nodes.length ? nodes : []
}

function paragraph(text: string, context: MarkdownConversionContext, warnings: string[], attachmentIds: Set<string>): JsonNode {
  return { type: 'paragraph', content: inlineNodes(text, context, warnings, attachmentIds) }
}

export function convertObsidianMarkdown(markdown: string, context: MarkdownConversionContext): MarkdownConversionResult {
  const warnings: string[] = []
  const attachmentIds = new Set<string>()
  const content: JsonNode[] = []
  const lines = markdown.split(/\r?\n/)
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? ''
    if (!line.trim()) { index += 1; continue }
    const fence = /^```([^\s`]*)\s*$/.exec(line)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) { code.push(lines[index] ?? ''); index += 1 }
      if (index < lines.length) index += 1
      else warnings.push('Unclosed fenced code block was preserved.')
      content.push({ type: 'codeBlock', attrs: { language: fence[1] || null }, content: code.length ? [textNode(code.join('\n'))] : [] })
      continue
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      content.push({ type: 'heading', attrs: { level: heading[1]?.length ?? 1 }, content: inlineNodes(heading[2] ?? '', context, warnings, attachmentIds) })
      index += 1; continue
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) { quote.push((lines[index] ?? '').replace(/^>\s?/, '')); index += 1 }
      content.push({ type: 'blockquote', content: quote.map((entry) => paragraph(entry, context, warnings, attachmentIds)) })
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: Array<{ text: string; checked: boolean | null }> = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? '')) {
        const raw = (lines[index] ?? '').replace(/^\s*[-*+]\s+/, '')
        const task = /^\[([ xX])\]\s+(.*)$/.exec(raw)
        items.push({ text: task?.[2] ?? raw, checked: task ? task[1]?.toLowerCase() === 'x' : null })
        index += 1
      }
      const taskList = items.every((item) => item.checked !== null)
      content.push({
        type: taskList ? 'taskList' : 'bulletList',
        content: items.map((item) => ({
          type: taskList ? 'taskItem' : 'listItem',
          ...(taskList ? { attrs: { checked: item.checked } } : {}),
          content: [paragraph(item.text, context, warnings, attachmentIds)],
        })),
      })
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? '')) { items.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, '')); index += 1 }
      content.push({ type: 'orderedList', content: items.map((item) => ({ type: 'listItem', content: [paragraph(item, context, warnings, attachmentIds)] })) })
      continue
    }
    if (line.includes('|') && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[index + 1] ?? '')) {
      const rows: string[][] = []
      const parseRow = (value: string) => value.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      rows.push(parseRow(line)); index += 2
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) { rows.push(parseRow(lines[index] ?? '')); index += 1 }
      content.push({ type: 'table', content: rows.map((row, rowIndex) => ({
        type: 'tableRow', content: row.map((cell) => ({ type: rowIndex === 0 ? 'tableHeader' : 'tableCell', content: [paragraph(cell, context, warnings, attachmentIds)] })),
      })) })
      continue
    }
    const paragraphLines = [line]
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() && !/^(#{1,6})\s|^```|^>|^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(lines[index] ?? '')) {
      if ((lines[index] ?? '').includes('|') && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[index + 1] ?? '')) break
      paragraphLines.push(lines[index] ?? ''); index += 1
    }
    content.push(paragraph(paragraphLines.join('\n'), context, warnings, attachmentIds))
  }
  return { document: { type: 'doc', content }, warnings: [...new Set(warnings)], referencedAttachmentIds: [...attachmentIds] }
}
