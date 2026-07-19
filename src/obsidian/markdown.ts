import { extractMarkdownAssets, extractWikiLinks, type LocalAssetReference, type WikiLinkReference } from './links.js'

export type MarkdownInventory = {
  headings: string[]
  blockIds: string[]
  inlineTags: string[]
  wikiLinks: WikiLinkReference[]
  assets: LocalAssetReference[]
  warnings: string[]
}

export function analyzeMarkdown(markdown: string): MarkdownInventory {
  const headings: string[] = []
  const blockIds: string[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line)?.[1]
    if (heading) headings.push(heading.replace(/\s+#+\s*$/, '').trim())
    const blockId = /(?:^|\s)\^([A-Za-z0-9-]{1,128})\s*$/.exec(line)?.[1]
    if (blockId) blockIds.push(blockId)
  }
  const inlineTags = [...new Set(Array.from(markdown.matchAll(/(^|[\s(])#([\p{L}\p{N}_/-]{1,100})/gu), (match) => match[2] ?? '')
    .filter((tag) => tag && !/^\d+$/.test(tag)))]
  const warnings: string[] = []
  if (/<%[\s\S]*?%>|\{\{[^}\n]+\}\}/.test(markdown)) warnings.push('Dynamic Templater or template syntax was preserved but will not be executed.')
  if (/```(?:dataview|dataviewjs|javascript|js)\b/i.test(markdown)) warnings.push('Executable or dynamic plugin block was preserved but will not be executed.')
  if (/%%\s*excalidraw/i.test(markdown)) warnings.push('Excalidraw metadata was preserved as readable source with limited conversion fidelity.')
  return { headings, blockIds, inlineTags, wikiLinks: extractWikiLinks(markdown), assets: extractMarkdownAssets(markdown), warnings }
}
