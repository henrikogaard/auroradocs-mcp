import path from 'node:path'

export type WikiLinkReference = {
  raw: string
  target: string
  alias: string | null
  anchor: string | null
  embed: boolean
}

export type LocalAssetReference = { raw: string; target: string }

export function extractWikiLinks(markdown: string): WikiLinkReference[] {
  const output: WikiLinkReference[] = []
  const expression = /(!)?\[\[([^\]\n]{1,2048})\]\]/g
  for (const match of markdown.matchAll(expression)) {
    const inner = (match[2] ?? '').trim()
    const [targetPart, aliasPart] = inner.split('|', 2)
    const targetWithAnchor = (targetPart ?? '').trim()
    if (!targetWithAnchor) continue
    const anchorIndex = targetWithAnchor.search(/[#^]/)
    const target = (anchorIndex >= 0 ? targetWithAnchor.slice(0, anchorIndex) : targetWithAnchor).trim()
    const anchor = anchorIndex >= 0 ? targetWithAnchor.slice(anchorIndex).trim() : null
    if (!target) continue
    output.push({
      raw: match[0], target, alias: aliasPart?.trim() || null, anchor,
      embed: match[1] === '!',
    })
  }
  return output
}

export function extractMarkdownAssets(markdown: string): LocalAssetReference[] {
  const output: LocalAssetReference[] = []
  const expression = /!\[[^\]\n]*\]\(([^)\n]{1,4096})\)/g
  for (const match of markdown.matchAll(expression)) {
    const rawTarget = (match[1] ?? '').trim().replace(/^<|>$/g, '')
    const target = rawTarget.split(/\s+["']/)[0] ?? ''
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue
    output.push({ raw: match[0], target })
  }
  return output
}

export function safeVaultReference(sourcePath: string, target: string): string | null {
  if (!target || path.posix.isAbsolute(target) || target.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  const decoded = (() => { try { return decodeURIComponent(target) } catch { return target } })()
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), decoded))
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) return null
  return normalized.replace(/^\.\//, '')
}
