import { createHash } from 'node:crypto'
import { newAuroraId, type CustomDatabaseRecipeId, type ObjectTypeSchema } from '../customDatabases.js'
import type { VaultAnalysis } from './analyzer.js'
import { inferObsidianGroups, type InferredGroup } from './inference.js'

export const OBSIDIAN_IMPORT_PLAN_VERSION = 1 as const
export const OBSIDIAN_IMPORT_PLAN_TTL_MS = 30 * 60 * 1000

export type ObsidianGroupAdjustment =
  | { groupId: string; action: 'accept' }
  | { groupId: string; action: 'rename'; name: string }
  | { groupId: string; action: 'reject' }
  | { groupId: string; action: 'merge'; mergeWithGroupId: string }
  | { groupId: string; action: 'split'; splitBy: 'folder' | 'explicit_type' | 'property_signature' }

export type ObsidianImportGroup = {
  id: string
  key: string
  name: string
  recipeId: CustomDatabaseRecipeId | null
  confidence: number
  evidence: string[]
  samplePaths: string[]
  noteCount: number
  schema: ObjectTypeSchema[]
  objectTypeId: string
  decision: 'accept' | 'reject'
}
export type ObsidianImportEntry = {
  id: string
  relativePath: string
  sourceHash: string
  kind: 'note' | 'canvas'
  mapping: 'page' | 'custom' | 'template' | 'canvas'
  groupId: string | null
  objectId: string
}
export type ObsidianImportContainer = {
  folder: string
  title: string
  parentFolder: string | null
  objectId: string
  type: 'space' | 'page'
}
export type ObsidianImportPlan = {
  version: typeof OBSIDIAN_IMPORT_PLAN_VERSION
  planId: string
  planHash: string
  workspaceId: string
  vaultDisplayName: string
  rootIdentityHash: string
  inventoryHash: string
  hierarchyPolicy: 'spaces' | 'parents' | 'flatten'
  collisionPolicy: 'rename' | 'skip' | 'fail'
  attachmentPolicy: 'referenced' | 'skip'
  unsupportedPolicy: 'preserve' | 'skip'
  groups: ObsidianImportGroup[]
  containers: ObsidianImportContainer[]
  entries: ObsidianImportEntry[]
  adjustments: ObsidianGroupAdjustment[]
  counts: { notes: number; templates: number; canvases: number; attachments: number; customGroups: number; containers: number; pages: number; warnings: number }
  warnings: string[]
  requiresConfirmation: true
  createdAt: string
  expiresAt: string
}
export type BuildObsidianPlanOptions = {
  hierarchyPolicy?: ObsidianImportPlan['hierarchyPolicy']
  collisionPolicy?: ObsidianImportPlan['collisionPolicy']
  attachmentPolicy?: ObsidianImportPlan['attachmentPolicy']
  unsupportedPolicy?: ObsidianImportPlan['unsupportedPolicy']
  adjustments?: ObsidianGroupAdjustment[]
  ids?: { planId?: string }
  now?: string
  expiresAt?: string
}
export type StoredObsidianImportPlan = { plan: ObsidianImportPlan; analysis: VaultAnalysis }
export type ObsidianImportPlanPreview = {
  planId: string
  planHash: string
  workspaceId: string
  vaultDisplayName: string
  counts: ObsidianImportPlan['counts']
  policies: { hierarchy: ObsidianImportPlan['hierarchyPolicy']; collisions: ObsidianImportPlan['collisionPolicy']; attachments: ObsidianImportPlan['attachmentPolicy']; unsupported: ObsidianImportPlan['unsupportedPolicy'] }
  groups: Array<{ id: string; name: string; confidence: number; noteCount: number; decision: 'accept' | 'reject'; propertyCount: number; evidence: string[]; samplePaths: string[] }>
  warnings: string[]
  expiresAt: string
  requiresConfirmation: true
  nextAction: string
}

const PLAN_STORE = new Map<string, StoredObsidianImportPlan>()

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonical(entry)]))
  return value
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
function groupId(key: string): string { return `group_${hash(key).slice(0, 12)}` }
function planBehavior(plan: Omit<ObsidianImportPlan, 'planHash'> | ObsidianImportPlan) {
  return {
    version: plan.version, planId: plan.planId, workspaceId: plan.workspaceId,
    rootIdentityHash: plan.rootIdentityHash, inventoryHash: plan.inventoryHash,
    hierarchyPolicy: plan.hierarchyPolicy, collisionPolicy: plan.collisionPolicy,
    attachmentPolicy: plan.attachmentPolicy, unsupportedPolicy: plan.unsupportedPolicy,
    groups: plan.groups, containers: plan.containers, entries: plan.entries, adjustments: plan.adjustments,
    requiresConfirmation: plan.requiresConfirmation, expiresAt: plan.expiresAt,
  }
}
export function hashObsidianImportPlan(plan: Omit<ObsidianImportPlan, 'planHash'> | ObsidianImportPlan): string {
  return hash(planBehavior(plan))
}

function initialGroups(inferred: InferredGroup[]): ObsidianImportGroup[] {
  return inferred.map((group) => ({
    id: groupId(group.key), key: group.key, name: group.name, recipeId: group.recipeId,
    confidence: group.confidence, evidence: group.evidence, samplePaths: group.notePaths.slice(0, 5),
    noteCount: group.notePaths.length, schema: group.schema, objectTypeId: newAuroraId(), decision: 'accept',
  }))
}

function applyAdjustments(
  groups: ObsidianImportGroup[],
  noteMembership: Map<string, string>,
  analysis: VaultAnalysis,
  adjustments: ObsidianGroupAdjustment[],
): { groups: ObsidianImportGroup[]; membership: Map<string, string> } {
  const output = groups.map((group) => ({ ...group, evidence: [...group.evidence], samplePaths: [...group.samplePaths], schema: group.schema.map((field) => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) })) }))
  const membership = new Map(noteMembership)
  for (const adjustment of adjustments) {
    const index = output.findIndex((group) => group.id === adjustment.groupId)
    if (index < 0) throw new Error(`Adjustment references unknown group ${adjustment.groupId}`)
    const group = output[index]!
    if (adjustment.action === 'accept') group.decision = 'accept'
    if (adjustment.action === 'reject') group.decision = 'reject'
    if (adjustment.action === 'rename') {
      const name = adjustment.name.trim()
      if (!name || name.length > 120) throw new Error('Adjusted group name must be 1-120 characters')
      group.name = name
    }
    if (adjustment.action === 'merge') {
      const target = output.find((candidate) => candidate.id === adjustment.mergeWithGroupId)
      if (!target || target.id === group.id) throw new Error('Merge adjustment must reference another existing group')
      for (const [notePath, current] of membership) if (current === group.key) membership.set(notePath, target.key)
      target.noteCount += group.noteCount
      target.samplePaths = [...new Set([...target.samplePaths, ...group.samplePaths])].slice(0, 5)
      target.evidence.push(`Merged from ${group.name} by approved adjustment.`)
      group.decision = 'reject'
    }
    if (adjustment.action === 'split') {
      const members = analysis.notes.filter((note) => membership.get(note.relativePath) === group.key)
      const partitions = new Map<string, typeof members>()
      for (const note of members) {
        const partition = adjustment.splitBy === 'folder'
          ? note.folder || 'root'
          : adjustment.splitBy === 'explicit_type'
            ? String(note.frontmatter['type'] ?? note.frontmatter['kind'] ?? 'untyped')
            : Object.keys(note.frontmatter).sort().join(',') || 'no-properties'
        partitions.set(partition, [...(partitions.get(partition) ?? []), note])
      }
      if (partitions.size > 1) {
        output.splice(index, 1)
        for (const [partition, notes] of [...partitions.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
          const key = `${group.key}:${adjustment.splitBy}:${partition}`
          const split: ObsidianImportGroup = {
            ...group, id: groupId(key), key, name: `${group.name} - ${partition}`, objectTypeId: newAuroraId(),
            noteCount: notes.length, samplePaths: notes.map((note) => note.relativePath).slice(0, 5),
            evidence: [...group.evidence, `Split by ${adjustment.splitBy}: ${partition}.`],
          }
          output.push(split)
          for (const note of notes) membership.set(note.relativePath, key)
        }
      }
    }
  }
  return { groups: output.sort((left, right) => left.name.localeCompare(right.name, 'en')), membership }
}

export function buildObsidianImportPlan(analysis: VaultAnalysis, workspaceId: string, options: BuildObsidianPlanOptions = {}): ObsidianImportPlan {
  const targetWorkspace = workspaceId.trim()
  if (!targetWorkspace) throw new Error('Destination workspace is required')
  const planId = options.ids?.planId ?? newAuroraId()
  const inferred = inferObsidianGroups(analysis)
  const initial = initialGroups(inferred.groups)
  const byKey = new Map(initial.map((group) => [group.key, group]))
  const noteMembership = new Map<string, string>()
  for (const [notePath, key] of inferred.noteGroupKeys) if (byKey.has(key)) noteMembership.set(notePath, key)
  const adjustments = options.adjustments?.map((adjustment) => ({ ...adjustment })) ?? []
  const adjusted = applyAdjustments(initial, noteMembership, analysis, adjustments)
  const adjustedByKey = new Map(adjusted.groups.map((group) => [group.key, group]))
  const entries: ObsidianImportEntry[] = [
    ...analysis.notes.map((note) => {
      const key = adjusted.membership.get(note.relativePath)
      const group = key ? adjustedByKey.get(key) : undefined
      const accepted = group?.decision === 'accept'
      return {
        id: `entry_${hash(`${planId}:${note.relativePath}:${note.sourceHash}`).slice(0, 12)}`,
        relativePath: note.relativePath, sourceHash: note.sourceHash, kind: 'note' as const,
        mapping: note.isTemplate && accepted ? 'template' as const : accepted ? 'custom' as const : 'page' as const,
        groupId: accepted ? group?.id ?? null : null,
        objectId: newAuroraId(),
      }
    }),
    ...analysis.canvases.map((canvas) => ({
      id: `entry_${hash(`${planId}:${canvas.relativePath}:${canvas.sourceHash}`).slice(0, 12)}`,
      relativePath: canvas.relativePath, sourceHash: canvas.sourceHash, kind: 'canvas' as const,
      mapping: 'canvas' as const, groupId: null, objectId: newAuroraId(),
    })),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'))
  const folders = [...new Set(analysis.notes.map((note) => note.folder).filter(Boolean))]
  const allFolders = new Set<string>()
  for (const folder of folders) {
    const segments = folder.split('/')
    for (let index = 1; index <= segments.length; index += 1) allFolders.add(segments.slice(0, index).join('/'))
  }
  const containers: ObsidianImportContainer[] = options.hierarchyPolicy === 'flatten' ? [] : [...allFolders].sort().map((folder) => ({
    folder,
    title: folder.split('/').at(-1) ?? folder,
    parentFolder: folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : null,
    objectId: newAuroraId(),
    type: options.hierarchyPolicy === 'parents' ? 'page' : 'space',
  }))
  const createdAt = options.now ?? new Date().toISOString()
  const createdMillis = Date.parse(createdAt)
  if (!Number.isFinite(createdMillis)) throw new Error('Plan creation time must be an ISO timestamp')
  const expiresAt = options.expiresAt ?? new Date(createdMillis + OBSIDIAN_IMPORT_PLAN_TTL_MS).toISOString()
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= createdMillis) throw new Error('Plan expiry must follow creation')
  const withoutHash: Omit<ObsidianImportPlan, 'planHash'> = {
    version: OBSIDIAN_IMPORT_PLAN_VERSION, planId, workspaceId: targetWorkspace,
    vaultDisplayName: analysis.vaultDisplayName, rootIdentityHash: analysis.rootIdentityHash, inventoryHash: analysis.inventoryHash,
    hierarchyPolicy: options.hierarchyPolicy ?? 'spaces', collisionPolicy: options.collisionPolicy ?? 'rename',
    attachmentPolicy: options.attachmentPolicy ?? 'referenced', unsupportedPolicy: options.unsupportedPolicy ?? 'preserve',
    groups: adjusted.groups, containers, entries, adjustments,
    counts: {
      notes: analysis.notes.length, templates: entries.filter((entry) => entry.mapping === 'template').length,
      canvases: analysis.canvases.length, attachments: options.attachmentPolicy === 'skip' ? 0 : analysis.attachments.length,
      customGroups: adjusted.groups.filter((group) => group.decision === 'accept').length,
      containers: containers.length,
      pages: entries.filter((entry) => entry.mapping === 'page').length, warnings: analysis.warnings.length,
    },
    warnings: analysis.warnings.slice(0, 100), requiresConfirmation: true, createdAt, expiresAt,
  }
  return { ...withoutHash, planHash: hashObsidianImportPlan(withoutHash) }
}

export function assertCurrentObsidianImportPlan(plan: ObsidianImportPlan, analysis: VaultAnalysis, workspaceId: string, now = new Date()): void {
  if (plan.version !== OBSIDIAN_IMPORT_PLAN_VERSION) throw new Error('Unsupported Obsidian import plan version')
  if (plan.workspaceId !== workspaceId) throw new Error('Obsidian import plan belongs to another workspace')
  if (now.getTime() >= Date.parse(plan.expiresAt)) throw new Error('Obsidian import plan has expired')
  if (hashObsidianImportPlan(plan) !== plan.planHash) throw new Error('Obsidian import plan hash does not match its contents')
  if (analysis.rootIdentityHash !== plan.rootIdentityHash) throw new Error('Authorized vault root identity changed')
  if (analysis.inventoryHash !== plan.inventoryHash) throw new Error('Vault inventory changed; the import plan is stale')
}

export function storeObsidianImportPlan(plan: ObsidianImportPlan, analysis: VaultAnalysis): void {
  const now = Date.now()
  for (const [key, stored] of PLAN_STORE) if (Date.parse(stored.plan.expiresAt) <= now) PLAN_STORE.delete(key)
  while (PLAN_STORE.size >= 20) { const key = PLAN_STORE.keys().next().value as string | undefined; if (!key) break; PLAN_STORE.delete(key) }
  PLAN_STORE.set(`${plan.workspaceId}:${plan.planId}`, { plan, analysis })
}
export function getStoredObsidianImportPlan(workspaceId: string, planId: string): StoredObsidianImportPlan | null {
  return PLAN_STORE.get(`${workspaceId}:${planId}`) ?? null
}

export function getObsidianImportPlanPage(plan: ObsidianImportPlan, section: 'groups' | 'entries' | 'warnings', page = 1, perPage = 50) {
  if (!Number.isInteger(page) || page < 1) throw new Error('page must be a positive integer')
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) throw new Error('per_page must be an integer between 1 and 100')
  const source: unknown[] = section === 'groups' ? plan.groups : section === 'entries' ? plan.entries : plan.warnings
  const start = (page - 1) * perPage
  return {
    planId: plan.planId, planHash: plan.planHash, section, page, perPage, total: source.length,
    items: source.slice(start, start + perPage), hasMore: start + perPage < source.length,
    expiresAt: plan.expiresAt, requiresConfirmation: true as const,
  }
}

export function summarizeObsidianImportPlan(plan: ObsidianImportPlan): ObsidianImportPlanPreview {
  return {
    planId: plan.planId, planHash: plan.planHash, workspaceId: plan.workspaceId,
    vaultDisplayName: plan.vaultDisplayName, counts: plan.counts,
    policies: {
      hierarchy: plan.hierarchyPolicy, collisions: plan.collisionPolicy,
      attachments: plan.attachmentPolicy, unsupported: plan.unsupportedPolicy,
    },
    groups: plan.groups.map((group) => ({
      id: group.id, name: group.name, confidence: group.confidence, noteCount: group.noteCount,
      decision: group.decision, propertyCount: group.schema.length,
      evidence: group.evidence.slice(0, 5), samplePaths: group.samplePaths.slice(0, 5),
    })),
    warnings: plan.warnings.slice(0, 25), expiresAt: plan.expiresAt, requiresConfirmation: true,
    nextAction: 'Review or adjust the plan, then explicitly confirm the exact plan ID and hash before import.',
  }
}
