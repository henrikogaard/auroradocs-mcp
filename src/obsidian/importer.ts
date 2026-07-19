import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  createAuroraObjectStable,
  createAuroraObjectType,
  getAuroraImportCapabilities,
  listAuroraObjectTypes,
  setAuroraContentStable,
  uploadAuroraMcpAttachment,
  upsertAuroraPropertyStable,
} from '../auroraClient.js'
import type { AuroraAttachmentUpload, AuroraImportCapabilities, AuroraObjectRecord } from '../auroraClient.js'
import { validateCustomDatabaseSchema, type ObjectTypeDef, type ObjectTypeSchema, type PropertyValueType } from '../customDatabases.js'
import { AuroraApiError } from '../errors.js'
import { analyzeObsidianVault, type AnalyzedNote } from './analyzer.js'
import { convertObsidianCanvas } from './canvasConverter.js'
import { convertObsidianMarkdown, type AttachmentDestination } from './contentConverter.js'
import { assertCurrentObsidianImportPlan, type ObsidianImportContainer, type ObsidianImportEntry, type StoredObsidianImportPlan } from './importPlan.js'
import { createImportJournal, readImportJournal, writeImportJournal, type ImportJournal } from './journal.js'
import { normalizeSchemaKey } from '../customDatabases.js'
import type { AuthorizedVault } from './vaultAccess.js'

export type ObsidianImportDependencies = {
  getCapabilities(workspaceId: string): Promise<AuroraImportCapabilities>
  listObjectTypes(workspaceId: string): Promise<ObjectTypeDef[]>
  createObjectType(workspaceId: string, input: { id: string; name: string; icon: string | null; color: string | null; schema: ObjectTypeSchema[] }): Promise<ObjectTypeDef>
  createObject(workspaceId: string, input: { id: string; type: string; title: string; icon?: string | null; parentId?: string | null; isTemplate?: boolean }): Promise<AuroraObjectRecord>
  setContent(workspaceId: string, objectId: string, content: Record<string, unknown>): Promise<void>
  upsertProperty(workspaceId: string, objectId: string, key: string, valueType: PropertyValueType, value: string | number | boolean | null): Promise<void>
  uploadAttachment(input: { workspaceId: string; objectId: string; fileName: string; mimeType: string; bytes: Buffer; idempotencyKey: string }): Promise<AuroraAttachmentUpload>
  now(): Date
}
export type ObsidianImportWarning = { code: string; entryId?: string }
export type ObsidianImportBatchResult = {
  status: 'blocked' | 'in_progress' | 'partial' | 'complete'
  planId: string
  planHash: string
  completed: number
  failed: number
  remaining: number
  nextCursor: number | null
  warnings: ObsidianImportWarning[]
}

function defaults(): ObsidianImportDependencies {
  return {
    getCapabilities: getAuroraImportCapabilities,
    listObjectTypes: listAuroraObjectTypes,
    createObjectType: createAuroraObjectType,
    createObject: createAuroraObjectStable,
    setContent: setAuroraContentStable,
    upsertProperty: upsertAuroraPropertyStable,
    uploadAttachment: uploadAuroraMcpAttachment,
    now: () => new Date(),
  }
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
function schemasEqual(left: ObjectTypeSchema[], right: ObjectTypeSchema[]): boolean {
  return JSON.stringify(validateCustomDatabaseSchema(left)) === JSON.stringify(validateCustomDatabaseSchema(right))
}
function safeErrorCode(error: unknown): string {
  if (error instanceof AuroraApiError) {
    if (error.status === 429) return 'rate_limited'
    if (error.status === 401) return 'authentication_failed'
    if (error.status === 403) return 'permission_denied'
    if (error.status === 404) return 'not_found'
    if (error.status === 409) return 'conflict'
    if (error.status === 413) return 'limit_exceeded'
    if (error.status >= 500 || error.status === 0) return 'upstream_unavailable'
  }
  return 'import_operation_failed'
}
function blocked(stored: StoredObsidianImportPlan, code: string): ObsidianImportBatchResult {
  return { status: 'blocked', planId: stored.plan.planId, planHash: stored.plan.planHash, completed: 0, failed: 0, remaining: stored.plan.entries.length, nextCursor: null, warnings: [{ code }] }
}

function attachmentJournalKey(sourceHash: string): string { return `attachment_${sourceHash}` }

function validateCapabilities(
  capability: AuroraImportCapabilities,
  stored: StoredObsidianImportPlan,
  journal: ImportJournal | null,
): string | null {
  if (capability.workspaceId !== stored.plan.workspaceId) return 'foreign_workspace_capability'
  if (capability.e2ee.importBlocked || capability.e2ee.enabled) return 'e2ee_import_blocked'
  if (!['owner', 'admin', 'editor'].includes(capability.role)) return 'role_not_writable'
  for (const scope of ['read:objects', 'write:objects', 'write:content']) if (!capability.scopes.includes(scope)) return `missing_scope_${scope.replace(':', '_')}`
  if (stored.plan.attachmentPolicy === 'referenced' && stored.analysis.attachments.length) {
    if (!capability.storage.available) return 'attachment_storage_unavailable'
    const remainingAttachments = stored.analysis.attachments.filter(
      (item) => journal?.attachments[attachmentJournalKey(item.sourceHash)]?.status !== 'complete',
    )
    const totalBytes = remainingAttachments.reduce((sum, item) => sum + item.sizeBytes, 0)
    if (remainingAttachments.some((item) => item.sizeBytes > capability.upload.maxBytes)) return 'attachment_too_large'
    if (totalBytes > capability.upload.remainingBytes) return 'attachment_quota_exceeded'
  }
  return null
}

function resultFromJournal(stored: StoredObsidianImportPlan, journal: ImportJournal, warnings: ObsidianImportWarning[]): ObsidianImportBatchResult {
  const values = Object.values(journal.entries)
  const completed = values.filter((entry) => entry.status === 'complete').length
  const attachmentValues = stored.plan.attachmentPolicy === 'referenced'
    ? stored.analysis.attachments.map((attachment) => journal.attachments[attachmentJournalKey(attachment.sourceHash)])
    : []
  const failed = values.filter((entry) => entry.status === 'failed').length
    + attachmentValues.filter((entry) => entry?.status === 'failed').length
  const remaining = stored.plan.entries.length - completed
    + attachmentValues.filter((entry) => entry?.status !== 'complete').length
  const status = remaining === 0 && failed === 0 ? 'complete' : failed > 0 ? 'partial' : 'in_progress'
  journal.status = status
  return {
    status, planId: stored.plan.planId, planHash: stored.plan.planHash,
    completed, failed, remaining, nextCursor: status === 'complete' ? null : journal.cursor,
    warnings: [...new Map(warnings.map((warning) => [`${warning.code}:${warning.entryId ?? ''}`, warning])).values()].slice(0, 100),
  }
}

function selectPendingEntries(
  entries: ObsidianImportEntry[],
  journal: ImportJournal,
  batchSize: number,
): { entries: ObsidianImportEntry[]; nextCursor: number } {
  if (!entries.length) return { entries: [], nextCursor: 0 }
  const start = ((journal.cursor % entries.length) + entries.length) % entries.length
  const selected: ObsidianImportEntry[] = []
  let nextCursor = start
  for (let offset = 0; offset < entries.length && selected.length < batchSize; offset += 1) {
    const index = (start + offset) % entries.length
    const entry = entries[index]!
    nextCursor = (index + 1) % entries.length
    if (journal.entries[entry.id]?.status !== 'complete') selected.push(entry)
  }
  return { entries: selected, nextCursor }
}

function containerJournalKey(container: ObsidianImportContainer): string { return `container_${digest(container.folder).slice(0, 16)}` }
function entryFolder(entry: ObsidianImportEntry, stored: StoredObsidianImportPlan): string {
  if (entry.kind === 'canvas') return path.posix.dirname(entry.relativePath) === '.' ? '' : path.posix.dirname(entry.relativePath)
  return stored.analysis.notes.find((note) => note.relativePath === entry.relativePath)?.folder ?? ''
}
function neededContainers(entries: ObsidianImportEntry[], stored: StoredObsidianImportPlan): ObsidianImportContainer[] {
  const folders = new Set(entries.map((entry) => entryFolder(entry, stored)).filter(Boolean))
  const required = new Set<string>()
  for (const folder of folders) {
    const parts = folder.split('/')
    for (let index = 1; index <= parts.length; index += 1) required.add(parts.slice(0, index).join('/'))
  }
  return stored.plan.containers.filter((container) => required.has(container.folder))
    .sort((left, right) => left.folder.split('/').length - right.folder.split('/').length || left.folder.localeCompare(right.folder, 'en'))
}

function renamedTypeName(name: string, existing: ObjectTypeDef[]): string {
  const names = new Set(existing.map((entry) => entry.name.toLocaleLowerCase()))
  if (!names.has(`${name} (Imported)`.toLocaleLowerCase())) return `${name} (Imported)`
  for (let index = 2; index <= 100; index += 1) {
    const candidate = `${name} (Imported ${index})`
    if (!names.has(candidate.toLocaleLowerCase())) return candidate
  }
  throw new Error('Unable to choose a collision-free object type name')
}

function mimeType(relativePath: string): string {
  const extension = path.posix.extname(relativePath).toLocaleLowerCase()
  return ({
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.zip': 'application/zip',
  } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

function propertyValue(note: AnalyzedNote, field: ObjectTypeSchema, stored: StoredObsidianImportPlan): string | number | boolean | null | undefined {
  const source = new Map(Object.entries(note.frontmatter).map(([key, value]) => [normalizeSchemaKey(key), value]))
  if (field.key === 'tags') return note.tags.length ? JSON.stringify(note.tags) : undefined
  const value = source.get(field.key)
  if (value === undefined || value === null || field.value_type === 'formula') return undefined
  if (field.value_type === 'number' || field.value_type === 'progress') return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  if (field.value_type === 'boolean') return typeof value === 'boolean' ? value : undefined
  if (field.value_type === 'multi_select') return Array.isArray(value) ? JSON.stringify(value.map(String)) : JSON.stringify(String(value).split(',').map((entry) => entry.trim()).filter(Boolean))
  if (field.value_type === 'relation' || field.value_type === 'person') {
    if (typeof value !== 'string') return undefined
    const target = /^\[\[([^\]|#^]+)/.exec(value)?.[1]?.trim()
    const link = target ? stored.analysis.links.find((entry) => entry.sourcePath === note.relativePath && entry.target === target && entry.status === 'resolved') : undefined
    return link?.resolvedPath ? stored.plan.entries.find((entry) => entry.relativePath === link.resolvedPath)?.objectId : undefined
  }
  return typeof value === 'string' ? value : Array.isArray(value) ? JSON.stringify(value) : String(value)
}

export async function runObsidianImportBatch(
  stored: StoredObsidianImportPlan,
  vault: AuthorizedVault,
  stateDir: string,
  options: { batchSize?: number; dependencies?: ObsidianImportDependencies } = {},
): Promise<ObsidianImportBatchResult> {
  const dependencies = options.dependencies ?? defaults()
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 50, 100))
  let currentAnalysis
  try {
    currentAnalysis = await analyzeObsidianVault(vault, dependencies.now())
    assertCurrentObsidianImportPlan(stored.plan, currentAnalysis, stored.plan.workspaceId, dependencies.now())
  } catch {
    return blocked(stored, 'stale_plan')
  }
  let journal = await readImportJournal(stateDir, stored.plan.planId)
  if (
    journal && (
      journal.planHash !== stored.plan.planHash || journal.workspaceId !== stored.plan.workspaceId
      || journal.rootIdentityHash !== stored.plan.rootIdentityHash || journal.inventoryHash !== stored.plan.inventoryHash
    )
  ) return blocked(stored, 'journal_mismatch')
  let capability: AuroraImportCapabilities
  try { capability = await dependencies.getCapabilities(stored.plan.workspaceId) } catch { return blocked(stored, 'preflight_unavailable') }
  const capabilityBlock = validateCapabilities(capability, stored, journal)
  if (capabilityBlock) return blocked(stored, capabilityBlock)
  if (!journal) journal = createImportJournal({
    planId: stored.plan.planId, planHash: stored.plan.planHash, workspaceId: stored.plan.workspaceId,
    rootIdentityHash: stored.plan.rootIdentityHash, inventoryHash: stored.plan.inventoryHash,
  }, dependencies.now())
  if (journal.status === 'complete') return resultFromJournal(stored, journal, [])
  journal.status = 'in_progress'; journal.updatedAt = dependencies.now().toISOString()
  await writeImportJournal(stateDir, journal)

  const warnings: ObsidianImportWarning[] = []
  const selection = selectPendingEntries(stored.plan.entries, journal, batchSize)
  const pending = selection.entries
  let existingTypes: ObjectTypeDef[]
  try { existingTypes = await dependencies.listObjectTypes(stored.plan.workspaceId) } catch { return blocked(stored, 'object_type_preflight_failed') }
  const neededGroupIds = new Set(pending.map((entry) => entry.groupId).filter((value): value is string => Boolean(value)))

  for (const group of stored.plan.groups.filter((candidate) => candidate.decision === 'accept' && neededGroupIds.has(candidate.id))) {
    if (journal.groups[group.id]?.status === 'complete') continue
    const plannedExisting = existingTypes.find((entry) => entry.id === group.objectTypeId)
    const nameMatch = existingTypes.find((entry) => entry.name.toLocaleLowerCase() === group.name.toLocaleLowerCase())
    if (!plannedExisting && nameMatch && !schemasEqual(nameMatch.schema, group.schema) && stored.plan.collisionPolicy === 'fail') {
      journal.status = 'blocked'; journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
      return blocked(stored, 'object_type_collision')
    }
  }

  const groupTypeIds = new Map<string, string>()
  for (const group of stored.plan.groups.filter((candidate) => candidate.decision === 'accept')) {
    const completed = journal.groups[group.id]
    if (completed?.status === 'complete') { groupTypeIds.set(group.id, completed.objectTypeId); continue }
    if (!neededGroupIds.has(group.id)) continue
    try {
      const plannedExisting = existingTypes.find((entry) => entry.id === group.objectTypeId)
      const nameMatch = existingTypes.find((entry) => entry.name.toLocaleLowerCase() === group.name.toLocaleLowerCase())
      if (plannedExisting) {
        if (!schemasEqual(plannedExisting.schema, group.schema)) throw new Error('planned type mismatch')
        groupTypeIds.set(group.id, plannedExisting.id)
      } else if (nameMatch && schemasEqual(nameMatch.schema, group.schema)) {
        groupTypeIds.set(group.id, nameMatch.id)
      } else if (nameMatch && stored.plan.collisionPolicy === 'skip') {
        journal.groups[group.id] = { objectTypeId: '', status: 'failed', errorCode: 'collision_skipped' }
        warnings.push({ code: 'object_type_collision_skipped' })
        continue
      } else {
        const created = await dependencies.createObjectType(stored.plan.workspaceId, {
          id: group.objectTypeId,
          name: nameMatch ? renamedTypeName(group.name, existingTypes) : group.name,
          icon: null, color: null, schema: group.schema,
        })
        groupTypeIds.set(group.id, created.id); existingTypes.push(created)
      }
      journal.groups[group.id] = { objectTypeId: groupTypeIds.get(group.id)!, status: 'complete' }
    } catch (error) {
      const code = safeErrorCode(error); journal.groups[group.id] = { objectTypeId: group.objectTypeId, status: 'failed', errorCode: code }
      warnings.push({ code })
    }
    journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
  }

  const containers = neededContainers(pending, stored)
  const containerIds = new Map<string, string>()
  for (const container of stored.plan.containers) {
    const saved = journal.containers[containerJournalKey(container)]
    if (saved?.status === 'complete') containerIds.set(container.folder, saved.objectId)
  }
  for (const container of containers) {
    const key = containerJournalKey(container)
    if (journal.containers[key]?.status === 'complete') continue
    if (container.parentFolder && !containerIds.has(container.parentFolder)) {
      journal.containers[key] = { objectId: container.objectId, status: 'failed', errorCode: 'parent_container_prerequisite_failed' }
      warnings.push({ code: 'parent_container_prerequisite_failed' })
      journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
      continue
    }
    try {
      const object = await dependencies.createObject(stored.plan.workspaceId, {
        id: container.objectId, type: container.type, title: container.title,
        parentId: container.parentFolder ? containerIds.get(container.parentFolder) ?? null : null,
      })
      containerIds.set(container.folder, object.id)
      journal.containers[key] = { objectId: object.id, status: 'complete' }
    } catch (error) {
      const code = safeErrorCode(error); journal.containers[key] = { objectId: container.objectId, status: 'failed', errorCode: code }; warnings.push({ code })
    }
    journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
  }

  for (const entry of pending) {
    const previous = journal.entries[entry.id]
    if (previous?.status === 'complete' || previous?.phase === 'object') continue
    const note = entry.kind === 'note' ? stored.analysis.notes.find((candidate) => candidate.relativePath === entry.relativePath) : null
    const canvas = entry.kind === 'canvas' ? stored.analysis.canvases.find((candidate) => candidate.relativePath === entry.relativePath) : null
    const groupTypeId = entry.groupId ? groupTypeIds.get(entry.groupId) : null
    if (entry.groupId && !groupTypeId) {
      const code = journal.groups[entry.groupId]?.errorCode ?? 'object_type_prerequisite_failed'
      journal.entries[entry.id] = { sourceHash: entry.sourceHash, objectId: entry.objectId, phase: 'pending', status: 'failed', warningCodes: [], errorCode: code }
      warnings.push({ code, entryId: entry.id })
      journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
      continue
    }
    const type = entry.mapping === 'canvas' ? 'canvas' : groupTypeId ? `custom:${groupTypeId}` : 'page'
    const title = note?.title ?? canvas?.title ?? path.posix.basename(entry.relativePath, path.posix.extname(entry.relativePath))
    const folder = entryFolder(entry, stored)
    if (stored.plan.hierarchyPolicy !== 'flatten' && folder && !containerIds.has(folder)) {
      const code = 'container_prerequisite_failed'
      journal.entries[entry.id] = { sourceHash: entry.sourceHash, objectId: entry.objectId, phase: 'pending', status: 'failed', warningCodes: [], errorCode: code }
      warnings.push({ code, entryId: entry.id })
      journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
      continue
    }
    try {
      await dependencies.createObject(stored.plan.workspaceId, {
        id: entry.objectId, type, title,
        parentId: stored.plan.hierarchyPolicy === 'flatten' ? null : containerIds.get(folder) ?? null,
        isTemplate: entry.mapping === 'template',
      })
      journal.entries[entry.id] = { sourceHash: entry.sourceHash, objectId: entry.objectId, phase: 'object', status: 'pending', warningCodes: [] }
    } catch (error) {
      const code = safeErrorCode(error)
      journal.entries[entry.id] = { sourceHash: entry.sourceHash, objectId: entry.objectId, phase: 'pending', status: 'failed', warningCodes: [], errorCode: code }
      warnings.push({ code, entryId: entry.id })
    }
    journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
  }

  if (stored.plan.attachmentPolicy === 'referenced') {
    const attachmentBatch = stored.analysis.attachments
      .filter((item) => journal.attachments[attachmentJournalKey(item.sourceHash)]?.status !== 'complete')
      .filter((item) => item.referencedBy.some((source) => {
        const entry = stored.plan.entries.find((candidate) => candidate.relativePath === source)
        return Boolean(entry && (journal.entries[entry.id]?.phase === 'object' || journal.entries[entry.id]?.status === 'complete'))
      }))
      .slice(0, batchSize)
    for (const attachment of attachmentBatch) {
      const key = attachmentJournalKey(attachment.sourceHash)
      if (journal.attachments[key]?.status === 'complete') continue
      const parentEntry = attachment.referencedBy.map((source) => stored.plan.entries.find((entry) => entry.relativePath === source))
        .find((entry) => entry && journal?.entries[entry.id]?.phase === 'object' || entry && journal?.entries[entry.id]?.status === 'complete')
      if (!parentEntry) continue
      try {
        const bytes = await vault.readAsset(attachment.relativePath, capability.upload.maxBytes)
        const uploaded = await dependencies.uploadAttachment({
          workspaceId: stored.plan.workspaceId, objectId: parentEntry.objectId,
          fileName: path.posix.basename(attachment.relativePath), mimeType: mimeType(attachment.relativePath), bytes,
          idempotencyKey: `obsidian:${digest(`${stored.plan.planHash}:${attachment.sourceHash}`).slice(0, 64)}`,
        })
        journal.attachments[key] = { attachmentId: uploaded.id, parentObjectId: parentEntry.objectId, status: 'complete' }
      } catch (error) {
        const code = safeErrorCode(error); journal.attachments[key] = { attachmentId: '', parentObjectId: parentEntry.objectId, status: 'failed', errorCode: code }; warnings.push({ code })
      }
      journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
    }
  }

  const attachmentDestinations = new Map<string, AttachmentDestination>()
  for (const attachment of stored.analysis.attachments) {
    const saved = journal.attachments[attachmentJournalKey(attachment.sourceHash)]
    if (saved?.status === 'complete') attachmentDestinations.set(attachment.relativePath, { attachmentId: saved.attachmentId, url: `/api/files/attachments/${saved.attachmentId}/${encodeURIComponent(path.posix.basename(attachment.relativePath))}` })
  }
  const objectIdsByPath = new Map(stored.plan.entries.map((entry) => [entry.relativePath, entry.objectId]))
  for (const entry of pending) {
    const state = journal.entries[entry.id]
    if (!state || state.status === 'complete' || state.phase !== 'object') continue
    try {
      if (entry.kind === 'canvas') {
        const canvas = stored.analysis.canvases.find((candidate) => candidate.relativePath === entry.relativePath)
        if (!canvas) throw new Error('canvas missing')
        const converted = convertObsidianCanvas(canvas, { objectIdsByPath, attachmentsByPath: attachmentDestinations, unsupportedPolicy: stored.plan.unsupportedPolicy })
        await dependencies.setContent(stored.plan.workspaceId, entry.objectId, converted.content)
        if (converted.warnings.length) state.warningCodes.push('canvas_fidelity_warning')
      } else {
        const note = stored.analysis.notes.find((candidate) => candidate.relativePath === entry.relativePath)
        if (!note) throw new Error('note missing')
        if (stored.plan.attachmentPolicy === 'referenced') {
          const missingAttachment = stored.analysis.attachments.find(
            (attachment) => attachment.referencedBy.includes(entry.relativePath)
              && journal.attachments[attachmentJournalKey(attachment.sourceHash)]?.status !== 'complete',
          )
          if (missingAttachment) throw new Error('attachment prerequisite failed')
        }
        const converted = convertObsidianMarkdown(note.body, {
          sourcePath: note.relativePath, objectIdsByPath,
          resolvedLinks: stored.analysis.links.filter((link) => link.sourcePath === note.relativePath),
          attachmentsByPath: attachmentDestinations,
          unsupportedPolicy: stored.plan.unsupportedPolicy,
        })
        await dependencies.setContent(stored.plan.workspaceId, entry.objectId, converted.document)
        if (converted.warnings.length) state.warningCodes.push('markdown_fidelity_warning')
        const group = entry.groupId ? stored.plan.groups.find((candidate) => candidate.id === entry.groupId) : undefined
        const fields = group?.schema ?? []
        for (const field of fields) {
          const value = propertyValue(note, field, stored)
          if (value !== undefined) await dependencies.upsertProperty(stored.plan.workspaceId, entry.objectId, field.key, field.value_type, value)
        }
        if (!fields.some((field) => field.key === 'tags') && note.tags.length) {
          await dependencies.upsertProperty(stored.plan.workspaceId, entry.objectId, 'tags', 'multi_select', JSON.stringify(note.tags))
        }
      }
      state.phase = 'content'; state.status = 'complete'; delete state.errorCode
    } catch (error) {
      const code = safeErrorCode(error); state.status = 'failed'; state.errorCode = code; warnings.push({ code, entryId: entry.id })
      if (code === 'rate_limited') {
        journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal); break
      }
    }
    journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
  }
  journal.cursor = selection.nextCursor
  const result = resultFromJournal(stored, journal, warnings)
  journal.updatedAt = dependencies.now().toISOString(); await writeImportJournal(stateDir, journal)
  return result
}
