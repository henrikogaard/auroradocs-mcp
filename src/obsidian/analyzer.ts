import { createHash } from 'node:crypto'
import path from 'node:path'
import { analyzeMarkdown } from './markdown.js'
import { parseFrontmatter } from './frontmatter.js'
import { safeVaultReference, type WikiLinkReference } from './links.js'
import type { AuthorizedVault, VaultSourceFile } from './vaultAccess.js'

export type FrontmatterShape = 'null' | 'boolean' | 'number' | 'string' | 'string_array' | 'array' | 'object'
export type AnalyzedNote = {
  relativePath: string
  folder: string
  title: string
  aliases: string[]
  tags: string[]
  frontmatter: Record<string, unknown>
  frontmatterShapes: Record<string, FrontmatterShape>
  body: string
  headings: string[]
  blockIds: string[]
  sourceHash: string
  isTemplate: boolean
  wikiLinks: WikiLinkReference[]
  assetReferences: string[]
  warnings: string[]
}
export type ResolvedVaultLink = WikiLinkReference & {
  sourcePath: string
  status: 'resolved' | 'broken' | 'ambiguous'
  resolvedPath: string | null
}
export type AnalyzedAttachment = { relativePath: string; sourceHash: string; sizeBytes: number; referencedBy: string[] }
export type AnalyzedCanvas = {
  relativePath: string
  title: string
  sourceHash: string
  nodes: unknown[]
  edges: unknown[]
  referencedPaths: string[]
  warnings: string[]
}
export type VaultAnalysis = {
  analyzedAt: string
  vaultDisplayName: string
  rootIdentityHash: string
  inventoryHash: string
  templatesFolder: string | null
  notes: AnalyzedNote[]
  canvases: AnalyzedCanvas[]
  attachments: AnalyzedAttachment[]
  links: ResolvedVaultLink[]
  warnings: string[]
}
export type VaultAnalysisSummary = {
  vaultDisplayName: string
  inventoryHash: string
  rootIdentityHash: string
  counts: { notes: number; templates: number; canvases: number; attachments: number; brokenLinks: number; ambiguousLinks: number; warnings: number }
  folders: string[]
  frontmatterKeys: Array<{ key: string; shapes: FrontmatterShape[]; occurrences: number }>
  warnings: string[]
  requiresConfirmation: true
}
export const OBSIDIAN_VAULT_TOTAL_SOURCE_MAX_BYTES = 256 * 1024 * 1024

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function shapeOf(value: unknown): FrontmatterShape {
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.every((entry) => typeof entry === 'string') ? 'string_array' : 'array'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  return 'object'
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[ ,]+/).map((entry) => entry.replace(/^#/, '').trim()).filter(Boolean)
  return []
}

function noteTitle(relativePath: string, frontmatter: Record<string, unknown>): string {
  const explicit = typeof frontmatter['title'] === 'string' ? frontmatter['title'].trim() : ''
  return explicit || path.posix.basename(relativePath, path.posix.extname(relativePath))
}

function parseTemplatesFolder(text: string, warnings: string[]): string | null {
  try {
    const value = JSON.parse(text) as { folder?: unknown }
    if (typeof value.folder !== 'string') return null
    const normalized = path.posix.normalize(value.folder.trim()).replace(/^\.\//, '').replace(/\/$/, '')
    if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
      warnings.push('The Obsidian Templates folder setting was invalid and ignored.')
      return null
    }
    return normalized
  } catch {
    warnings.push('The Obsidian Templates configuration was invalid and ignored.')
    return null
  }
}

function parseCanvas(file: VaultSourceFile, text: string): AnalyzedCanvas {
  const warnings: string[] = []
  let nodes: unknown[] = []
  let edges: unknown[] = []
  const referencedPaths: string[] = []
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (Array.isArray(parsed['nodes'])) nodes = parsed['nodes'].slice(0, 10_000)
    else warnings.push('Canvas nodes were missing or invalid.')
    if (Array.isArray(parsed['edges'])) edges = parsed['edges'].slice(0, 20_000)
    else warnings.push('Canvas edges were missing or invalid.')
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      const filePath = (node as Record<string, unknown>)['file']
      if (typeof filePath === 'string' && filePath.trim()) referencedPaths.push(filePath.trim())
    }
  } catch {
    warnings.push('Canvas JSON was invalid and will be imported as readable fallback text.')
  }
  return {
    relativePath: file.relativePath,
    title: path.posix.basename(file.relativePath, '.canvas'),
    sourceHash: sha256(text), nodes, edges, referencedPaths, warnings,
  }
}

function resolveWikiLinks(notes: AnalyzedNote[]): ResolvedVaultLink[] {
  const byPath = new Map<string, string>()
  const byBase = new Map<string, string[]>()
  for (const note of notes) {
    const pathKey = note.relativePath.replace(/\.md$/i, '').toLocaleLowerCase()
    byPath.set(pathKey, note.relativePath)
    const base = path.posix.basename(pathKey)
    byBase.set(base, [...(byBase.get(base) ?? []), note.relativePath])
    for (const alias of note.aliases) {
      const key = alias.toLocaleLowerCase()
      byBase.set(key, [...(byBase.get(key) ?? []), note.relativePath])
    }
  }
  return notes.flatMap((note) => note.wikiLinks.map((link): ResolvedVaultLink => {
    const normalizedTarget = link.target.replace(/\.md$/i, '').replace(/^\.\//, '').toLocaleLowerCase()
    const direct = byPath.get(normalizedTarget)
    const relativeTarget = safeVaultReference(note.relativePath, `${link.target.replace(/\.md$/i, '')}.md`)
    const relative = relativeTarget ? byPath.get(relativeTarget.replace(/\.md$/i, '').toLocaleLowerCase()) : undefined
    const candidates = direct || relative ? [direct ?? relative as string] : byBase.get(path.posix.basename(normalizedTarget)) ?? []
    const unique = [...new Set(candidates)]
    return {
      ...link, sourcePath: note.relativePath,
      status: unique.length === 1 ? 'resolved' : unique.length === 0 ? 'broken' : 'ambiguous',
      resolvedPath: unique.length === 1 ? unique[0] ?? null : null,
    }
  }))
}

export async function analyzeObsidianVault(vault: AuthorizedVault, now = new Date()): Promise<VaultAnalysis> {
  const sourceFiles = await vault.listSourceFiles()
  if (sourceFiles.reduce((total, file) => total + file.sizeBytes, 0) > OBSIDIAN_VAULT_TOTAL_SOURCE_MAX_BYTES) {
    throw new Error('Obsidian vault source files exceed the 256 MiB analysis limit.')
  }
  const warnings: string[] = []
  const sources = new Map<string, string>()
  for (const file of sourceFiles) sources.set(file.relativePath, (await vault.readText(file.relativePath)).text)
  const templatesConfig = sources.get('.obsidian/templates.json')
  const templatesFolder = templatesConfig === undefined ? null : parseTemplatesFolder(templatesConfig, warnings)
  const notes: AnalyzedNote[] = []
  const canvases: AnalyzedCanvas[] = []
  for (const file of sourceFiles) {
    const text = sources.get(file.relativePath) ?? ''
    if (file.kind === 'canvas') { canvases.push(parseCanvas(file, text)); continue }
    if (file.kind !== 'markdown') continue
    const parsed = parseFrontmatter(text)
    const markdown = analyzeMarkdown(parsed.body)
    const tags = [...new Map([
      ...strings(parsed.data['tags']), ...strings(parsed.data['tag']), ...markdown.inlineTags,
    ].map((tag) => [tag.toLocaleLowerCase(), tag])).values()]
    const assetReferences = [
      ...markdown.assets.map((asset) => safeVaultReference(file.relativePath, asset.target)),
      ...markdown.wikiLinks.filter((link) => link.embed && !/\.md$/i.test(link.target)).map((link) => safeVaultReference(file.relativePath, link.target)),
    ].filter((value): value is string => Boolean(value))
    const noteWarnings = [...parsed.warnings, ...markdown.warnings]
    if (noteWarnings.length) warnings.push(...noteWarnings.map((warning) => `${file.relativePath}: ${warning}`))
    notes.push({
      relativePath: file.relativePath,
      folder: path.posix.dirname(file.relativePath) === '.' ? '' : path.posix.dirname(file.relativePath),
      title: noteTitle(file.relativePath, parsed.data),
      aliases: [...new Set([...strings(parsed.data['aliases']), ...strings(parsed.data['alias'])])],
      tags, frontmatter: parsed.data,
      frontmatterShapes: Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, shapeOf(value)])),
      body: parsed.body, headings: markdown.headings, blockIds: markdown.blockIds,
      sourceHash: sha256(text),
      isTemplate: Boolean(templatesFolder && (file.relativePath === `${templatesFolder}.md` || file.relativePath.startsWith(`${templatesFolder}/`))),
      wikiLinks: markdown.wikiLinks, assetReferences: [...new Set(assetReferences)], warnings: noteWarnings,
    })
  }
  const notePaths = new Set(notes.map((note) => note.relativePath.toLocaleLowerCase()))
  const canvasPaths = new Set(canvases.map((canvas) => canvas.relativePath.toLocaleLowerCase()))
  const assetSources = new Map<string, Set<string>>()
  for (const note of notes) for (const asset of note.assetReferences) {
    if (!notePaths.has(asset.toLocaleLowerCase()) && !canvasPaths.has(asset.toLocaleLowerCase())) {
      const current = assetSources.get(asset) ?? new Set<string>(); current.add(note.relativePath); assetSources.set(asset, current)
    }
  }
  for (const canvas of canvases) for (const target of canvas.referencedPaths) {
    const resolved = safeVaultReference(canvas.relativePath, target)
    if (resolved && !notePaths.has(resolved.toLocaleLowerCase()) && !canvasPaths.has(resolved.toLocaleLowerCase())) {
      const current = assetSources.get(resolved) ?? new Set<string>(); current.add(canvas.relativePath); assetSources.set(resolved, current)
    }
  }
  const attachments: AnalyzedAttachment[] = []
  for (const [relativePath, referencedBy] of [...assetSources.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    try {
      const bytes = await vault.readAsset(relativePath)
      attachments.push({ relativePath, sourceHash: sha256(bytes), sizeBytes: bytes.length, referencedBy: [...referencedBy].sort() })
    } catch {
      warnings.push(`${relativePath}: referenced attachment was missing or unavailable.`)
    }
  }
  warnings.push(...canvases.flatMap((canvas) => canvas.warnings.map((warning) => `${canvas.relativePath}: ${warning}`)))
  const links = resolveWikiLinks(notes)
  const inventoryRows = [
    ...notes.map((note) => `${note.relativePath}\0${note.sourceHash}`),
    ...canvases.map((canvas) => `${canvas.relativePath}\0${canvas.sourceHash}`),
    ...attachments.map((asset) => `${asset.relativePath}\0${asset.sourceHash}`),
    ...(templatesConfig === undefined ? [] : [`.obsidian/templates.json\0${sha256(templatesConfig)}`]),
  ].sort()
  return {
    analyzedAt: now.toISOString(), vaultDisplayName: vault.displayName, rootIdentityHash: vault.identityHash,
    inventoryHash: sha256(inventoryRows.join('\n')), templatesFolder, notes, canvases, attachments, links,
    warnings: [...new Set(warnings)].slice(0, 500),
  }
}

export function summarizeVaultAnalysis(analysis: VaultAnalysis): VaultAnalysisSummary {
  const keyStats = new Map<string, { shapes: Set<FrontmatterShape>; occurrences: number }>()
  for (const note of analysis.notes) for (const [key, shape] of Object.entries(note.frontmatterShapes)) {
    const stat = keyStats.get(key) ?? { shapes: new Set<FrontmatterShape>(), occurrences: 0 }
    stat.shapes.add(shape); stat.occurrences += 1; keyStats.set(key, stat)
  }
  return {
    vaultDisplayName: analysis.vaultDisplayName,
    inventoryHash: analysis.inventoryHash,
    rootIdentityHash: analysis.rootIdentityHash,
    counts: {
      notes: analysis.notes.length,
      templates: analysis.notes.filter((note) => note.isTemplate).length,
      canvases: analysis.canvases.length,
      attachments: analysis.attachments.length,
      brokenLinks: analysis.links.filter((link) => link.status === 'broken').length,
      ambiguousLinks: analysis.links.filter((link) => link.status === 'ambiguous').length,
      warnings: analysis.warnings.length,
    },
    folders: [...new Set(analysis.notes.map((note) => note.folder).filter(Boolean))].sort().slice(0, 100),
    frontmatterKeys: [...keyStats.entries()].sort(([left], [right]) => left.localeCompare(right, 'en')).slice(0, 100)
      .map(([key, value]) => ({ key, shapes: [...value.shapes].sort(), occurrences: value.occurrences })),
    warnings: analysis.warnings.slice(0, 50),
    requiresConfirmation: true,
  }
}
