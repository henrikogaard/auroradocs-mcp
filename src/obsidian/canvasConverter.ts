import { createHash } from 'node:crypto'
import { safeVaultReference } from './links.js'
import type { AnalyzedCanvas } from './analyzer.js'
import type { AttachmentDestination } from './contentConverter.js'

type CanvasCard = {
  id: string; type: string; x: number | null; y: number | null; width: number | null; height: number | null
  text: string | null; color: string | null; objectId: string | null; attachmentId: string | null; url: string | null
}
type CanvasFrame = { id: string; label: string | null; x: number | null; y: number | null; width: number | null; height: number | null; color: string | null }
type CanvasEdge = { id: string; fromCard: string | null; toCard: string | null; fromSide: string | null; toSide: string | null; label: string | null; color: string | null; arrow: string | null }

function string(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function safeId(value: unknown, fallback: string): string {
  const candidate = string(value)?.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)
  return candidate || fallback
}
function fallbackId(seed: string): string { return `canvas_${createHash('sha256').update(seed).digest('hex').slice(0, 12)}` }

export function convertObsidianCanvas(
  canvas: AnalyzedCanvas,
  context: { objectIdsByPath: Map<string, string>; attachmentsByPath: Map<string, AttachmentDestination>; unsupportedPolicy?: 'preserve' | 'skip' },
): { content: { type: 'canvas'; version: 1; cards: CanvasCard[]; edges: CanvasEdge[]; frames: CanvasFrame[] }; warnings: string[] } {
  const warnings = [...canvas.warnings]
  const cards: CanvasCard[] = []
  const frames: CanvasFrame[] = []
  const edges: CanvasEdge[] = []
  const used = new Set<string>()
  const firstMappedId = new Map<string, string>()
  for (const [index, rawNode] of canvas.nodes.entries()) {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) { warnings.push(`Canvas node ${index + 1} was invalid.`); continue }
    const node = rawNode as Record<string, unknown>
    const originalId = safeId(node['id'], fallbackId(`${canvas.relativePath}:node:${index}`))
    let id = originalId
    if (used.has(id)) { id = fallbackId(`${canvas.relativePath}:${originalId}:${index}`); warnings.push(`Duplicate Canvas node ID ${originalId} was remapped.`) }
    used.add(id); if (!firstMappedId.has(originalId)) firstMappedId.set(originalId, id)
    const common = { id, x: number(node['x']), y: number(node['y']), width: number(node['width']), height: number(node['height']), color: string(node['color']) }
    const type = string(node['type']) ?? 'unknown'
    if (type === 'group') {
      frames.push({ ...common, label: string(node['label']) }); continue
    }
    if (type === 'text') {
      cards.push({ ...common, type: 'text', text: string(node['text']) ?? '', objectId: null, attachmentId: null, url: null }); continue
    }
    if (type === 'link') {
      cards.push({ ...common, type: 'link', text: string(node['label']), objectId: null, attachmentId: null, url: string(node['url']) }); continue
    }
    if (type === 'file') {
      const file = string(node['file'])
      const resolved = file && (context.objectIdsByPath.has(file) || context.attachmentsByPath.has(file))
        ? file : file ? safeVaultReference(canvas.relativePath, file) : null
      const objectId = resolved ? context.objectIdsByPath.get(resolved) ?? null : null
      const attachment = resolved ? context.attachmentsByPath.get(resolved) : undefined
      if (!objectId && !attachment && context.unsupportedPolicy === 'skip') {
        warnings.push(`Unresolved Canvas file node ${file ?? id} was skipped.`)
        if (firstMappedId.get(originalId) === id) firstMappedId.delete(originalId)
        continue
      }
      if (!objectId && !attachment) warnings.push(`Unresolved Canvas file node ${file ?? id} was preserved as text.`)
      cards.push({
        ...common, type: objectId ? 'object' : attachment ? 'attachment' : 'text',
        text: objectId || attachment ? null : file ?? `Unsupported file node ${id}`,
        objectId, attachmentId: attachment?.attachmentId ?? null, url: attachment?.url ?? null,
      })
      continue
    }
    if (context.unsupportedPolicy === 'skip') {
      warnings.push(`Unsupported Canvas node type ${type} was skipped.`)
      if (firstMappedId.get(originalId) === id) firstMappedId.delete(originalId)
      continue
    }
    warnings.push(`Unsupported Canvas node type ${type} was preserved as readable text.`)
    cards.push({ ...common, type: 'text', text: `[Unsupported Canvas node: ${type}]`, objectId: null, attachmentId: null, url: null })
  }
  for (const [index, rawEdge] of canvas.edges.entries()) {
    if (!rawEdge || typeof rawEdge !== 'object' || Array.isArray(rawEdge)) { warnings.push(`Canvas edge ${index + 1} was invalid.`); continue }
    const edge = rawEdge as Record<string, unknown>
    const fromOriginal = safeId(edge['fromNode'] ?? edge['fromCard'], '')
    const toOriginal = safeId(edge['toNode'] ?? edge['toCard'], '')
    const fromCard = firstMappedId.get(fromOriginal) ?? null
    const toCard = firstMappedId.get(toOriginal) ?? null
    if (!fromCard || !toCard) {
      warnings.push(`Canvas edge ${string(edge['id']) ?? index + 1} has an unresolved endpoint${context.unsupportedPolicy === 'skip' ? ' and was skipped' : ''}.`)
      if (context.unsupportedPolicy === 'skip') continue
    }
    edges.push({
      id: safeId(edge['id'], fallbackId(`${canvas.relativePath}:edge:${index}`)), fromCard, toCard,
      fromSide: string(edge['fromSide']), toSide: string(edge['toSide']), label: string(edge['label']),
      color: string(edge['color']), arrow: string(edge['toEnd'] ?? edge['arrow']),
    })
  }
  return { content: { type: 'canvas', version: 1, cards, edges, frames }, warnings: [...new Set(warnings)] }
}
