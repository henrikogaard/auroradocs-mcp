/**
 * tools.ts — Tool execution logic for the MCP server.
 *
 * SECURITY: Every tool call receives the workspaceId and passes it through
 * to AuroraCloud client helpers which verify ownership before any read or write.
 * No cross-workspace or cross-user data leakage is possible.
 */
import {
  listObjectsPage,
  getObject,
  getContent,
  setContent,
  appendContentText,
  listProperties,
  listMembers,
  listTaskLists,
  listTaskStatuses,
  createObject,
  updateObjectTitle,
  deleteObject,
  upsertProperty,
  getTaskProps,
  updateTaskProps,
  getWorkspaceKnowledgeObjectServer,
  listWorkspaceRecentKnowledgeServer,
  listWorkspaceRelatedKnowledgeServer,
  listPlanningTasks,
  createPlanningTimeBlock,
  readCanvasContent,
  searchWorkspaceKnowledgeServer,
  searchObjectsPage,
  listAuroraObjectTypes,
  createAuroraObjectType,
  updateAuroraObjectType,
  listAuroraTemplates,
  createAuroraTemplate,
  createAuroraObjectFromTemplate,
} from './auroraClient.js'
import type { AuroraWorkspaceMember, AuroraTaskList, AuroraTaskProps, WorkspaceKnowledgeSource } from './auroraClient.js'
import { buildWeekPlan, normalizeCanvasContent } from './planningTools.js'
import type { McpCanvasReadResult, McpWeekPlan } from './planningTools.js'
import { getMcpToolCoverageAudit, getMcpWorkflowRecipes } from './toolCatalog.js'
import type { McpToolCoverageAudit, McpWorkflowRecipe } from './toolCatalog.js'
import { readBoundedInteger, readWorkspaceSelector } from './input.js'
import { ToolInputError, toSafeToolError } from './errors.js'
import { getProjectContext, listProjectChanges } from './projectContext.js'
import {
  CUSTOM_DATABASE_RECIPES,
  assertApplicableCustomDatabasePlan,
  buildCustomDatabasePlan,
  normalizeSchemaKey,
  summarizeCustomDatabasePlan,
  validateAdditiveObjectTypePatch,
  validateCustomDatabaseSchema,
} from './customDatabases.js'
import type {
  CustomDatabasePlan,
  CustomDatabaseRecipe,
  CustomDatabaseTemplateDefault,
  CustomDatabaseTemplateDefinition,
  ObjectTypeDef,
  ObjectTypeSchema,
  PropertyValueType,
} from './customDatabases.js'
import { resolveObsidianConfig } from './obsidian/config.js'
import { openAuthorizedVault } from './obsidian/vaultAccess.js'
import { analyzeObsidianVault } from './obsidian/analyzer.js'
import {
  buildObsidianImportPlan,
  getObsidianImportPlanPage,
  getStoredObsidianImportPlan,
  storeObsidianImportPlan,
  summarizeObsidianImportPlan,
} from './obsidian/importPlan.js'
import type { ObsidianGroupAdjustment, ObsidianImportPlanPreview } from './obsidian/importPlan.js'
import {
  decideObsidianImportConsent,
  type ObsidianConsentPreview,
  type ObsidianConsentRequest,
} from './obsidian/consent.js'
import { runObsidianImportBatch, type ObsidianImportBatchResult } from './obsidian/importer.js'
import { readImportJournal, summarizeImportJournal, type ObsidianImportStatus } from './obsidian/journal.js'
import type { StoredObsidianImportPlan } from './obsidian/importPlan.js'
import type {
  AuroraConnectionContext,
  Availability,
  GrantedWorkspace,
  ProjectChangesResult,
  ProjectContextResult,
  ToolErrorResult,
} from './contracts.js'

// ── Result types ─────────────────────────────────────────────────────────────

export type ToolResult =
  | { type: 'workspaces'; workspaces: GrantedWorkspace[] }
  | { type: 'objects'; objects: { id: string; title: string | null; type: string; icon: string | null }[] }
  | { type: 'object'; object: { id: string; title: string | null; type: string; icon: string | null }; availability: Availability; content: string | null; properties: Record<string, string> }
  | { type: 'created'; id: string; title: string }
  | { type: 'task_created'; id: string; title: string; status: string | null; task_list_name: string | null }
  | { type: 'task_updated'; id: string; title: string; changed_fields: string[] }
  | { type: 'object_updated'; id: string; changed_fields: string[] }
  | { type: 'updated'; id: string; title: string }
  | { type: 'deleted'; id: string }
  | { type: 'content_set'; id: string }
  | { type: 'content_appended'; id: string }
  | { type: 'property_set'; objectId: string; key: string; value: string }
  | { type: 'knowledge_sources'; sources: WorkspaceKnowledgeSource[] }
  | { type: 'mcp_tool_coverage'; audit: McpToolCoverageAudit }
  | { type: 'mcp_workflow_recipes'; recipes: McpWorkflowRecipe[] }
  | { type: 'object_types'; object_types: ObjectTypeDef[] }
  | { type: 'custom_database_recipes'; recipes: CustomDatabaseRecipe[] }
  | { type: 'custom_database_plan'; plan: CustomDatabasePlan; summary: string }
  | { type: 'custom_database_applied'; outcome: 'created' | 'updated' | 'reused'; object_type: ObjectTypeDef; template_id: string | null; plan_id: string; plan_hash: string }
  | { type: 'object_type_updated'; object_type: ObjectTypeDef }
  | { type: 'templates'; templates: { id: string; title: string | null; type: string; icon: string | null }[] }
  | { type: 'template_created'; template: { id: string; title: string | null; type: string; icon: string | null } }
  | { type: 'template_instantiated'; template_id: string; object_id: string }
  | { type: 'obsidian_import_plan'; plan: ObsidianImportPlanPreview }
  | { type: 'obsidian_import_plan_page'; page: ReturnType<typeof getObsidianImportPlanPage> }
  | { type: 'obsidian_import_confirmation_required'; plan_id: string; plan_hash: string; preview: ObsidianConsentPreview }
  | { type: 'obsidian_import_batch'; result: ObsidianImportBatchResult }
  | { type: 'obsidian_import_status'; status: ObsidianImportStatus }
  | { type: 'week_plan'; plan: McpWeekPlan }
  | { type: 'canvas'; canvas: McpCanvasReadResult }
  | { type: 'scheduled_task_block'; id: string; title: string | null; due_date: string; mode: string }
  | { type: 'members'; members: { id: string; name: string | null; email: string; role: string }[] }
  | { type: 'task_lists'; task_lists: { id: string; name: string }[] }
  | { type: 'task_statuses'; statuses: string[] }
  | ({ type: 'project_context' } & ProjectContextResult)
  | ({ type: 'project_changes' } & ProjectChangesResult)
  | { type: 'no_op'; message: string }
  | ToolErrorResult

export type McpToolCallResult = {
  content: [{ type: 'text'; text: string }]
  structuredContent: ToolResult
  isError: boolean
}

export type ToolExecutionOptions = {
  requestObsidianImportConsent?: ObsidianConsentRequest
  runObsidianImport?: (stored: StoredObsidianImportPlan, batchSize: number) => Promise<ObsidianImportBatchResult>
  now?: () => Date
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean)
  return []
}

function invalidInput(message: string): ToolErrorResult {
  return { type: 'error', code: 'invalid_input', message, retryable: false }
}

function notFound(message: string): ToolErrorResult {
  return { type: 'error', code: 'not_found', message, retryable: false }
}

const CUSTOM_DATABASE_PLANS = new Map<string, CustomDatabasePlan>()

function cloneRecipe(recipe: CustomDatabaseRecipe): CustomDatabaseRecipe {
  return {
    ...recipe,
    schema: recipe.schema.map((field) => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) })),
    ...(recipe.template ? {
      template: {
        ...recipe.template,
        ...(recipe.template.defaults ? { defaults: recipe.template.defaults.map((value) => ({ ...value })) } : {}),
      },
    } : {}),
  }
}

function storeCustomDatabasePlan(plan: CustomDatabasePlan): void {
  const now = Date.now()
  for (const [key, value] of CUSTOM_DATABASE_PLANS) {
    if (Date.parse(value.expiresAt) <= now) CUSTOM_DATABASE_PLANS.delete(key)
  }
  while (CUSTOM_DATABASE_PLANS.size >= 100) {
    const oldest = CUSTOM_DATABASE_PLANS.keys().next().value as string | undefined
    if (!oldest) break
    CUSTOM_DATABASE_PLANS.delete(oldest)
  }
  CUSTOM_DATABASE_PLANS.set(`${plan.workspaceId}:${plan.planId}`, plan)
}

function optionalPresentation(input: Record<string, unknown>, key: 'icon' | 'color'): string | null | undefined {
  if (!Object.hasOwn(input, key)) return undefined
  const value = input[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new ToolInputError(`${key} must be text or null`)
  const trimmed = value.trim()
  return trimmed || null
}

function parseObjectTypeSchema(value: unknown, existing: ObjectTypeSchema[] = []): ObjectTypeSchema[] {
  if (!Array.isArray(value)) throw new ToolInputError('schema must be an array')
  const existingByKey = new Map(existing.map((field) => [normalizeSchemaKey(field.key), field]))
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ToolInputError(`schema field ${index + 1} must be an object`)
    const raw = entry as Record<string, unknown>
    const key = normalizeSchemaKey(String(raw['key'] ?? ''))
    const current = existingByKey.get(key)
    const valueType = (typeof raw['value_type'] === 'string' ? raw['value_type'] : current?.value_type) as PropertyValueType | undefined
    if (!valueType) throw new ToolInputError(`schema field "${key}" requires value_type`)
    const label = typeof raw['label'] === 'string' ? raw['label'] : current?.label
    if (!label) throw new ToolInputError(`schema field "${key}" requires label`)
    const required = typeof raw['required'] === 'boolean' ? raw['required'] : current?.required ?? false
    const next: ObjectTypeSchema = { key, label, value_type: valueType, required }
    const copyString = (property: 'storageType' | 'targetType' | 'formula') => {
      const rawValue = raw[property]
      const fallback = current?.[property]
      if (rawValue !== undefined) {
        if (typeof rawValue !== 'string') throw new ToolInputError(`${property} for "${key}" must be text`)
        next[property] = rawValue
      } else if (fallback !== undefined) next[property] = fallback
    }
    copyString('storageType'); copyString('targetType'); copyString('formula')
    if (raw['sensitive'] !== undefined) {
      if (typeof raw['sensitive'] !== 'boolean') throw new ToolInputError(`sensitive for "${key}" must be boolean`)
      next.sensitive = raw['sensitive']
    } else if (current?.sensitive !== undefined) next.sensitive = current.sensitive
    if (raw['options'] !== undefined) {
      if (!Array.isArray(raw['options'])) throw new ToolInputError(`options for "${key}" must be an array`)
      next.options = raw['options'].map((option) => String(option))
    } else if (current?.options) next.options = [...current.options]
    return next
  })
}

function parseTemplateDefaults(value: unknown): CustomDatabaseTemplateDefault[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new ToolInputError('template defaults must be an array')
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ToolInputError(`template default ${index + 1} must be an object`)
    const raw = entry as Record<string, unknown>
    const key = readString(raw['key'])
    const valueType = readString(raw['value_type'] ?? raw['valueType']) as PropertyValueType | null
    const defaultValue = raw['value']
    if (!key || !valueType) throw new ToolInputError(`template default ${index + 1} requires key and value_type`)
    if (defaultValue !== null && typeof defaultValue !== 'string' && typeof defaultValue !== 'number' && typeof defaultValue !== 'boolean') {
      throw new ToolInputError(`template default "${key}" has an unsupported value`)
    }
    return { key, valueType, value: defaultValue }
  })
}

function parseTemplateDefinition(value: unknown): CustomDatabaseTemplateDefinition | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolInputError('template must be an object or null')
  const raw = value as Record<string, unknown>
  const title = readString(raw['title'])
  if (!title) throw new ToolInputError('template title is required')
  if (raw['body'] !== undefined && typeof raw['body'] !== 'string') throw new ToolInputError('template body must be text')
  const icon = raw['icon'] === null ? null : raw['icon'] === undefined ? undefined : readString(raw['icon'])
  return { title, ...(icon !== undefined ? { icon } : {}), ...(raw['body'] !== undefined ? { body: raw['body'] as string } : {}), ...(raw['defaults'] !== undefined ? { defaults: parseTemplateDefaults(raw['defaults']) } : {}) }
}

function parseObsidianAdjustments(value: unknown): ObsidianGroupAdjustment[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 100) throw new ToolInputError('adjustments must be an array with at most 100 items')
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ToolInputError(`adjustment ${index + 1} must be an object`)
    const raw = entry as Record<string, unknown>
    const groupId = readString(raw['group_id'])
    const action = readString(raw['action'])
    if (!groupId || !action) throw new ToolInputError(`adjustment ${index + 1} requires group_id and action`)
    if (action === 'accept' || action === 'reject') return { groupId, action }
    if (action === 'rename') {
      const name = readString(raw['name'])
      if (!name) throw new ToolInputError('rename adjustment requires name')
      return { groupId, action, name }
    }
    if (action === 'merge') {
      const mergeWithGroupId = readString(raw['merge_with_group_id'])
      if (!mergeWithGroupId) throw new ToolInputError('merge adjustment requires merge_with_group_id')
      return { groupId, action, mergeWithGroupId }
    }
    if (action === 'split') {
      const splitBy = readString(raw['split_by'])
      if (splitBy !== 'folder' && splitBy !== 'explicit_type' && splitBy !== 'property_signature') {
        throw new ToolInputError('split adjustment requires split_by: folder, explicit_type, or property_signature')
      }
      return { groupId, action, splitBy }
    }
    throw new ToolInputError(`Unknown adjustment action: ${action}`)
  })
}

function readPolicy<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T): T {
  if (!Object.hasOwn(input, key)) return fallback
  const value = readString(input[key])
  if (!value || !allowed.includes(value as T)) throw new ToolInputError(`${key} must be one of: ${allowed.join(', ')}`)
  return value as T
}

function todayDateKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [, yearRaw, monthRaw, dayRaw] = match
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
}

function isTimeKey(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function weekPlanningDueDateForDay(dateKey: string, existingDueDate?: string | null): string {
  const time = existingDueDate?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/)?.[1]
  return time ? `${dateKey}T${time}` : dateKey
}

function buildWeekPlanningTimeBlockTaskInput(input: {
  title: string
  dateKey: string
  startTime: string
  durationMinutes: number
}): { title: string; due_date: string; labels: string[]; description: string } {
  const title = input.title.trim() || 'Time block'
  const durationMinutes = Number.isFinite(input.durationMinutes) && input.durationMinutes > 0
    ? Math.round(input.durationMinutes)
    : 30
  return {
    title,
    due_date: `${input.dateKey}T${input.startTime}`,
    labels: ['time-block', `duration:${durationMinutes}m`],
    description: `Duration: ${durationMinutes} minutes`,
  }
}

function matchTaskList(query: string, lists: AuroraTaskList[]): AuroraTaskList | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const exact = lists.find((l) => l.id.toLowerCase() === q || l.name.trim().toLowerCase() === q)
  if (exact) return exact
  const partial = lists.filter((l) => l.name.toLowerCase().includes(q))
  return partial.length === 1 ? partial[0] : null
}

function matchMember(query: string, members: AuroraWorkspaceMember[]): AuroraWorkspaceMember | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const exact = members.find((m) => {
    const name = m.name?.trim().toLowerCase() ?? ''
    const email = m.email.trim().toLowerCase()
    const local = email.split('@')[0] ?? ''
    return m.id.toLowerCase() === q || email === q || local === q || name === q
  })
  if (exact) return exact
  const partial = members.filter((m) => {
    const name = m.name?.trim().toLowerCase() ?? ''
    const email = m.email.trim().toLowerCase()
    return name.includes(q) || email.includes(q)
  })
  return partial.length === 1 ? partial[0] : null
}

function normalizePriority(value: string): string | null {
  const v = value.toLowerCase()
  if (v === 'low') return 'Low'
  if (v === 'medium') return 'Medium'
  if (v === 'high') return 'High'
  if (v === 'urgent') return 'Urgent'
  return null
}

// ── Tool execution ───────────────────────────────────────────────────────────

function normalizeConnectionContext(context: AuroraConnectionContext | string): AuroraConnectionContext {
  return typeof context === 'string'
    ? { kind: 'legacy_workspace', defaultWorkspaceId: context, workspaces: [] }
    : context
}

export function resolveWorkspace(
  context: AuroraConnectionContext,
  input: Record<string, unknown>,
): string {
  const hasSelector = Object.hasOwn(input, 'workspace_id') || Object.hasOwn(input, 'workspace_alias')

  if (context.kind === 'legacy_workspace') {
    if (!hasSelector) return context.defaultWorkspaceId
    const parsed = readWorkspaceSelector(input)
    if (!parsed.ok) throw new ToolInputError(parsed.message)
    const selector = 'workspaceId' in parsed.value ? parsed.value.workspaceId : parsed.value.workspaceAlias
    if (selector !== context.defaultWorkspaceId) {
      throw new ToolInputError('Legacy credentials are restricted to the configured workspace')
    }
    return context.defaultWorkspaceId
  }

  if (!hasSelector) {
    throw new ToolInputError('workspace_id or workspace_alias is required')
  }
  const parsed = readWorkspaceSelector(input)
  if (!parsed.ok) throw new ToolInputError(parsed.message)
  const matches = context.workspaces.filter((workspace) => (
    'workspaceId' in parsed.value
      ? workspace.workspaceId === parsed.value.workspaceId
      : workspace.alias === parsed.value.workspaceAlias
  ))
  if (matches.length !== 1) {
    throw new ToolInputError('Workspace selector does not match an available grant')
  }
  return matches[0].workspaceId
}

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  connection: AuroraConnectionContext | string,
  options: ToolExecutionOptions = {},
): Promise<ToolResult> {
  try {
    const context = normalizeConnectionContext(connection)
    if (name === 'list_workspaces') return { type: 'workspaces', workspaces: context.workspaces }
    if (name === 'get_mcp_tool_coverage' || name === 'get_mcp_workflow_recipes' || name === 'get_custom_database_recipes') {
      return await executeToolCallUnsafe(name, input, context.kind === 'legacy_workspace' ? context.defaultWorkspaceId : '', options)
    }
    return await executeToolCallUnsafe(name, input, resolveWorkspace(context, input), options)
  } catch (error) {
    return toSafeToolError(error)
  }
}

async function executeToolCallUnsafe(
  name: string,
  input: Record<string, unknown>,
  workspaceId: string,
  options: ToolExecutionOptions,
): Promise<ToolResult> {
  switch (name) {
      // ── Read tools ─────────────────────────────────────────────────────

      case 'search':
      case 'search_objects': {
        const query = String(input['query'] ?? '').trim()
        const typeFilter = input['type'] ? String(input['type']) : undefined
        const limit = readBoundedInteger(input, 'limit', { defaultValue: 10, min: 1, max: 50 })
        if (!limit.ok) return invalidInput(limit.message)
        const sources = await searchObjectsPage(workspaceId, query, limit.value)
        const matches = [...new Map(
          sources
            .filter((source) => !typeFilter || source.objectType === typeFilter)
            .map((source) => [source.objectId, {
              id: source.objectId,
              title: source.title,
              type: source.objectType,
              icon: source.icon,
            }]),
        ).values()].slice(0, limit.value)
        return { type: 'objects', objects: matches }
      }

      case 'list_objects': {
        const typeFilter = input['type'] ? String(input['type']) : undefined
        const limit = readBoundedInteger(input, 'limit', { defaultValue: 20, min: 1, max: 50 })
        if (!limit.ok) return invalidInput(limit.message)
        const page = await listObjectsPage(workspaceId, typeFilter, 1, limit.value)
        const results = page.items
          .filter((o) => !o.is_template)
          .map((o) => ({ id: o.id, title: o.title, type: o.type, icon: o.icon }))
        return { type: 'objects', objects: results }
      }

      case 'list_recent': {
        const typeFilter = input['type'] ? String(input['type']) : undefined
        const limit = readBoundedInteger(input, 'limit', { defaultValue: 20, min: 1, max: 50 })
        if (!limit.ok) return invalidInput(limit.message)
        const page = await listObjectsPage(workspaceId, typeFilter, 1, limit.value)
        const results = page.items
          .filter((o) => !o.is_template)
          .map((o) => ({ id: o.id, title: o.title, type: o.type, icon: o.icon }))
        return { type: 'objects', objects: results }
      }

      case 'wiki_search': {
        const query = readString(input['query'])
        if (!query) return invalidInput('Query is required')
        const limit = readBoundedInteger(input, 'limit', { defaultValue: 20, min: 1, max: 50 })
        if (!limit.ok) return invalidInput(limit.message)
        const sources = await searchWorkspaceKnowledgeServer(workspaceId, query, limit.value)
        return { type: 'knowledge_sources', sources }
      }

      case 'wiki_get_page': {
        const id = readString(input['id'])
        if (!id) return invalidInput('Object ID is required')
        const includeFullText = Boolean(input['includeFullText'])
        const source = await getWorkspaceKnowledgeObjectServer(workspaceId, id, includeFullText)
        if (!source) return notFound(`Object ${id} not found in this workspace`)
        return { type: 'knowledge_sources', sources: [source] }
      }

      case 'wiki_related': {
        const id = readString(input['id'])
        if (!id) return invalidInput('Object ID is required')
        const limit = readBoundedInteger(input, 'limit', { defaultValue: 6, min: 1, max: 10 })
        if (!limit.ok) return invalidInput(limit.message)
        const sources = await listWorkspaceRelatedKnowledgeServer(workspaceId, id, limit.value)
        return { type: 'knowledge_sources', sources }
      }

      case 'wiki_recent': {
        const limit = readBoundedInteger(input, 'limit', { defaultValue: 6, min: 1, max: 10 })
        if (!limit.ok) return invalidInput(limit.message)
        const sources = await listWorkspaceRecentKnowledgeServer(workspaceId, limit.value)
        return { type: 'knowledge_sources', sources }
      }

      case 'get_object': {
        const id = String(input['id'] ?? '')
        const obj = await getObject(id, workspaceId)
        if (!obj) return notFound(`Object ${id} not found in this workspace`)

        const content = await getContent(id, workspaceId)

        // Include properties
        const rawProps = await listProperties([id], workspaceId)
        const properties: Record<string, string> = {}
        for (const p of rawProps) {
          properties[p.key] =
            p.value_text
            ?? p.value_date
            ?? (p.value_num != null ? String(p.value_num) : null)
            ?? (p.value_bool != null ? String(p.value_bool) : null)
            ?? p.value_ref
            ?? ''
        }

        return {
          type: 'object',
          object: { id: obj.id, title: obj.title, type: obj.type, icon: obj.icon },
          availability: content.availability,
          content: content.text,
          properties,
        }
      }

      case 'list_workspace_members': {
        const members = await listMembers(workspaceId)
        return { type: 'members', members }
      }

      case 'list_task_lists': {
        const lists = await listTaskLists(workspaceId)
        return { type: 'task_lists', task_lists: lists.map((l) => ({ id: l.id, name: l.name })) }
      }

      case 'list_task_statuses': {
        const statuses = await listTaskStatuses(workspaceId)
        return { type: 'task_statuses', statuses }
      }

      case 'get_mcp_tool_coverage':
        return { type: 'mcp_tool_coverage', audit: getMcpToolCoverageAudit() }

      case 'get_mcp_workflow_recipes':
        return { type: 'mcp_workflow_recipes', recipes: getMcpWorkflowRecipes() }

      case 'get_custom_database_recipes':
        return { type: 'custom_database_recipes', recipes: CUSTOM_DATABASE_RECIPES.map(cloneRecipe) }

      case 'analyze_obsidian_vault': {
        let config
        try { config = resolveObsidianConfig() } catch (error) {
          throw new ToolInputError(error instanceof Error ? error.message : 'Obsidian vault authorization is unavailable')
        }
        const vault = await openAuthorizedVault(config)
        const analysis = await analyzeObsidianVault(vault)
        const plan = buildObsidianImportPlan(analysis, workspaceId, {
          hierarchyPolicy: readPolicy(input, 'hierarchy_policy', ['spaces', 'parents', 'flatten'] as const, 'spaces'),
          collisionPolicy: readPolicy(input, 'collision_policy', ['rename', 'skip', 'fail'] as const, 'rename'),
          attachmentPolicy: readPolicy(input, 'attachment_policy', ['referenced', 'skip'] as const, 'referenced'),
          unsupportedPolicy: readPolicy(input, 'unsupported_policy', ['preserve', 'skip'] as const, 'preserve'),
          adjustments: parseObsidianAdjustments(input['adjustments']),
        })
        storeObsidianImportPlan(plan, analysis)
        return { type: 'obsidian_import_plan', plan: summarizeObsidianImportPlan(plan) }
      }

      case 'get_obsidian_import_plan': {
        const planId = readString(input['plan_id'])
        if (!planId) return invalidInput('Plan ID is required')
        const stored = getStoredObsidianImportPlan(workspaceId, planId)
        if (!stored) return notFound('Obsidian import plan was not found for this workspace')
        if (Date.now() >= Date.parse(stored.plan.expiresAt)) return invalidInput('Obsidian import plan has expired; analyze the vault again')
        const section = readString(input['section']) ?? 'groups'
        if (section !== 'groups' && section !== 'entries' && section !== 'warnings') return invalidInput('section must be groups, entries, or warnings')
        const page = readBoundedInteger(input, 'page', { defaultValue: 1, min: 1, max: 10_000 })
        if (!page.ok) return invalidInput(page.message)
        const perPage = readBoundedInteger(input, 'per_page', { defaultValue: 50, min: 1, max: 100 })
        if (!perPage.ok) return invalidInput(perPage.message)
        return { type: 'obsidian_import_plan_page', page: getObsidianImportPlanPage(stored.plan, section, page.value, perPage.value) }
      }

      case 'import_obsidian_vault': {
        const planId = readString(input['plan_id'])
        const planHash = readString(input['plan_hash'])
        if (!planId || !planHash) return invalidInput('Plan ID and plan hash are required')
        if (input['confirmed'] !== undefined && typeof input['confirmed'] !== 'boolean') return invalidInput('confirmed must be a boolean')
        const batchSize = readBoundedInteger(input, 'batch_size', { defaultValue: 50, min: 1, max: 100 })
        if (!batchSize.ok) return invalidInput(batchSize.message)
        const stored = getStoredObsidianImportPlan(workspaceId, planId)
        if (!stored || stored.plan.planHash !== planHash) return invalidInput('The Obsidian import plan is missing or does not match the approved hash')
        const now = options.now?.() ?? new Date()
        if (now.getTime() >= Date.parse(stored.plan.expiresAt)) return invalidInput('Obsidian import plan has expired; analyze the vault again')
        const summary = summarizeObsidianImportPlan(stored.plan)
        const preview: ObsidianConsentPreview = {
          planId: summary.planId, planHash: summary.planHash,
          vaultDisplayName: summary.vaultDisplayName, workspaceId: summary.workspaceId,
          counts: {
            notes: summary.counts.notes, templates: summary.counts.templates,
            canvases: summary.counts.canvases, attachments: summary.counts.attachments,
            customGroups: summary.counts.customGroups,
          },
          policies: summary.policies,
          acceptedGroupCount: stored.plan.groups.filter((group) => group.decision === 'accept').length,
        }
        const consent = await decideObsidianImportConsent({
          confirmed: input['confirmed'], preview,
          requestConsent: options.requestObsidianImportConsent,
        })
        if (consent.outcome === 'confirmation_required') {
          return { type: 'obsidian_import_confirmation_required', plan_id: planId, plan_hash: planHash, preview }
        }
        if (consent.outcome !== 'accepted') {
          const message = consent.outcome === 'adjustment_required'
            ? 'Import not started. Re-analyze with the requested policy or group changes, then review the new plan.'
            : 'Obsidian import was not approved; no AuroraDocs writes were performed.'
          return { type: 'no_op', message }
        }
        const run = options.runObsidianImport ?? (async (approved, size) => {
          let config
          try { config = resolveObsidianConfig() } catch (error) {
            throw new ToolInputError(error instanceof Error ? error.message : 'Obsidian vault authorization is unavailable')
          }
          const vault = await openAuthorizedVault(config)
          return runObsidianImportBatch(approved, vault, config.stateDir, { batchSize: size })
        })
        return { type: 'obsidian_import_batch', result: await run(stored, batchSize.value) }
      }

      case 'get_obsidian_import_status': {
        const planId = readString(input['plan_id'])
        if (!planId) return invalidInput('Plan ID is required')
        const stored = getStoredObsidianImportPlan(workspaceId, planId)
        if (!stored) return notFound('Obsidian import plan was not found for this workspace')
        let config
        try { config = resolveObsidianConfig() } catch (error) {
          throw new ToolInputError(error instanceof Error ? error.message : 'Obsidian vault authorization is unavailable')
        }
        const journal = await readImportJournal(config.stateDir, planId)
        if (journal && journal.workspaceId !== workspaceId) return notFound('Obsidian import status was not found for this workspace')
        return { type: 'obsidian_import_status', status: summarizeImportJournal(stored.plan, journal) }
      }

      case 'list_object_types': {
        const objectTypes = await listAuroraObjectTypes(workspaceId)
        return { type: 'object_types', object_types: objectTypes }
      }

      case 'plan_custom_database': {
        const recipeId = readString(input['recipe_id'])
        const recipe = recipeId ? CUSTOM_DATABASE_RECIPES.find((entry) => entry.id === recipeId) : undefined
        if (recipeId && !recipe) return invalidInput(`Unknown custom database recipe: ${recipeId}`)
        const name = readString(input['name']) ?? recipe?.name ?? null
        if (!name) return invalidInput('Custom database name is required')
        const schema = input['schema'] === undefined
          ? recipe?.schema.map((field) => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) }))
          : parseObjectTypeSchema(input['schema'])
        if (!schema) return invalidInput('A free-form custom database requires a schema')
        const template = Object.hasOwn(input, 'template')
          ? parseTemplateDefinition(input['template'])
          : recipe?.template ? cloneRecipe(recipe).template ?? null : null
        const objectTypes = await listAuroraObjectTypes(workspaceId)
        const requestedIcon = optionalPresentation(input, 'icon')
        const requestedColor = optionalPresentation(input, 'color')
        const plan = buildCustomDatabasePlan({
          workspaceId, name,
          icon: requestedIcon === undefined ? recipe?.icon ?? null : requestedIcon,
          color: requestedColor === undefined ? recipe?.color ?? null : requestedColor,
          schema, template,
          source: recipe ? { kind: 'recipe', value: recipe.id } : { kind: 'free_form', value: name },
          existingTypes: objectTypes,
          assumptions: Array.isArray(input['assumptions']) ? input['assumptions'].map((entry) => String(entry).trim()).filter(Boolean).slice(0, 20) : [],
        })
        storeCustomDatabasePlan(plan)
        return { type: 'custom_database_plan', plan, summary: summarizeCustomDatabasePlan(plan) }
      }

      case 'apply_custom_database_plan': {
        const planId = readString(input['plan_id'])
        const planHash = readString(input['plan_hash'])
        if (!planId || !planHash) return invalidInput('Plan ID and plan hash are required')
        const plan = CUSTOM_DATABASE_PLANS.get(`${workspaceId}:${planId}`)
        if (!plan || plan.planHash !== planHash) return invalidInput('The custom database plan is missing, expired, or does not match the approved hash')
        const existingTypes = await listAuroraObjectTypes(workspaceId)
        const applicable = assertApplicableCustomDatabasePlan(plan, workspaceId, existingTypes)
        let objectType: ObjectTypeDef
        let outcome: 'created' | 'updated' | 'reused'
        if (applicable.outcome === 'create') {
          objectType = await createAuroraObjectType(workspaceId, {
            id: plan.operation.objectTypeId, name: plan.name, icon: plan.icon, color: plan.color, schema: plan.schema,
          })
          outcome = 'created'
        } else if (applicable.outcome === 'update') {
          objectType = await updateAuroraObjectType(workspaceId, plan.operation.objectTypeId, {
            name: plan.name, icon: plan.icon, color: plan.color, schema: plan.schema,
          })
          outcome = 'updated'
        } else {
          objectType = applicable.existing as ObjectTypeDef
          outcome = 'reused'
        }
        let templateId: string | null = null
        if (plan.template) {
          const template = await createAuroraTemplate({
            workspaceId, objectId: plan.template.objectId, type: `custom:${objectType.id}`,
            title: plan.template.title, icon: plan.template.icon, body: plan.template.body, defaults: plan.template.defaults,
          })
          templateId = template.id
        }
        return { type: 'custom_database_applied', outcome, object_type: objectType, template_id: templateId, plan_id: plan.planId, plan_hash: plan.planHash }
      }

      case 'update_object_type': {
        const id = readString(input['id'])
        if (!id) return invalidInput('Object type ID is required')
        const objectTypes = await listAuroraObjectTypes(workspaceId)
        const existing = objectTypes.find((entry) => entry.id === id)
        if (!existing) return notFound(`Object type ${id} not found in this workspace`)
        const name = Object.hasOwn(input, 'name') ? readString(input['name']) : existing.name
        if (!name) return invalidInput('Object type name cannot be empty')
        if (objectTypes.some((entry) => entry.id !== id && entry.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
          return invalidInput(`Another object type already uses the name "${name}"`)
        }
        const proposed = input['schema'] === undefined ? existing.schema : parseObjectTypeSchema(input['schema'], existing.schema)
        const normalized = validateCustomDatabaseSchema(proposed, { existingTypes: objectTypes, selfTargetType: `custom:${id}` })
        const schema = validateAdditiveObjectTypePatch(existing.schema, normalized)
        const icon = optionalPresentation(input, 'icon')
        const color = optionalPresentation(input, 'color')
        const updated = await updateAuroraObjectType(workspaceId, id, {
          name, icon: icon === undefined ? existing.icon : icon, color: color === undefined ? existing.color : color, schema,
        })
        return { type: 'object_type_updated', object_type: updated }
      }

      case 'list_templates': {
        const type = readString(input['type']) ?? undefined
        const templates = await listAuroraTemplates(workspaceId, type)
        return { type: 'templates', templates: templates.map((template) => ({ id: template.id, title: template.title, type: template.type, icon: template.icon })) }
      }

      case 'create_template': {
        const type = readString(input['type'])
        const title = readString(input['title'])
        if (!type || !title) return invalidInput('Template type and title are required')
        if (input['body'] !== undefined && typeof input['body'] !== 'string') return invalidInput('Template body must be text')
        const template = await createAuroraTemplate({
          workspaceId, objectId: readString(input['object_id']) ?? undefined, type, title,
          icon: optionalPresentation(input, 'icon'), body: input['body'] as string | undefined,
          defaults: parseTemplateDefaults(input['defaults']),
        })
        return { type: 'template_created', template: { id: template.id, title: template.title, type: template.type, icon: template.icon } }
      }

      case 'create_from_template': {
        const templateId = readString(input['template_id'])
        if (!templateId) return invalidInput('Template ID is required')
        const objectId = await createAuroraObjectFromTemplate(workspaceId, templateId, readString(input['object_id']) ?? undefined)
        return { type: 'template_instantiated', template_id: templateId, object_id: objectId }
      }

      case 'get_project_context': {
        const projectId = readString(input['project_id'])
        const query = readString(input['query'])
        if ((projectId === null) === (query === null)) {
          return invalidInput('Exactly one of project_id or query is required')
        }
        const activityDays = readBoundedInteger(input, 'activity_days', { defaultValue: 14, min: 1, max: 90 })
        if (!activityDays.ok) return invalidInput(activityDays.message)
        const taskLimit = readBoundedInteger(input, 'task_limit', { defaultValue: 20, min: 1, max: 50 })
        if (!taskLimit.ok) return invalidInput(taskLimit.message)
        const sourceLimit = readBoundedInteger(input, 'source_limit', { defaultValue: 10, min: 1, max: 25 })
        if (!sourceLimit.ok) return invalidInput(sourceLimit.message)
        const result = await getProjectContext(workspaceId, {
          ...(projectId ? { projectId } : { query: query as string }),
          activityDays: activityDays.value,
          taskLimit: taskLimit.value,
          sourceLimit: sourceLimit.value,
        })
        return { type: 'project_context', ...result }
      }

      case 'list_project_changes': {
        const projectId = readString(input['project_id'])
        if (!projectId) return invalidInput('project_id is required')
        const cursor = readString(input['cursor'])
        if (!cursor) return invalidInput('cursor is required')
        const limit = readBoundedInteger(input, 'limit', { defaultValue: 50, min: 1, max: 100 })
        if (!limit.ok) return invalidInput(limit.message)
        const result = await listProjectChanges(workspaceId, { projectId, cursor, limit: limit.value })
        return { type: 'project_changes', ...result }
      }

      case 'list_week_plan': {
        const anchorDate = readString(input['anchor_date']) ?? todayDateKey()
        if (!isDateKey(anchorDate)) {
          return invalidInput('anchor_date must be a valid date formatted YYYY-MM-DD')
        }

        const includeUnscheduled = input['include_unscheduled'] !== false
        const unscheduledLimit = readBoundedInteger(input, 'unscheduled_limit', { defaultValue: 12, min: 1, max: 50 })
        if (!unscheduledLimit.ok) return invalidInput(unscheduledLimit.message)
        const tasks = await listPlanningTasks(workspaceId)
        return {
          type: 'week_plan',
          plan: buildWeekPlan(tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            due_date: task.due_date,
            updated_at: task.updated_at,
            labels: task.labels,
          })), {
            anchorDate,
            includeUnscheduled,
            unscheduledLimit: unscheduledLimit.value,
          }),
        }
      }

      case 'read_canvas': {
        const id = readString(input['id'])
        if (!id) return invalidInput('Canvas object ID is required')
        const result = await readCanvasContent(workspaceId, id)
        if (!result) return notFound(`Canvas ${id} not found in this workspace`)
        const includeText = input['include_text'] !== false
        return {
          type: 'canvas',
          canvas: normalizeCanvasContent(
            { id: result.object.id, title: result.object.title, type: result.object.type },
            result.contentJson,
            { includeText },
          ),
        }
      }

      case 'schedule_task_block': {
        const mode = readString(input['mode'])
        const date = readString(input['date'])
        if (mode !== 'schedule_existing_task' && mode !== 'create_time_block') {
          return invalidInput('mode must be schedule_existing_task or create_time_block')
        }
        if (!date || !isDateKey(date)) {
          return invalidInput('date must be a valid date formatted YYYY-MM-DD')
        }

        const startTime = readString(input['start_time'])
        if (startTime && !isTimeKey(startTime)) {
          return invalidInput('start_time must be a valid time formatted HH:mm')
        }

        if (mode === 'schedule_existing_task') {
          const taskId = readString(input['task_id'])
          if (!taskId) return invalidInput('task_id is required for schedule_existing_task')

          const object = await getObject(taskId, workspaceId)
          if (!object) return notFound(`Object ${taskId} not found in this workspace`)
          if (object.type !== 'task') return invalidInput(`${taskId} is not a task`)

          const props = await getTaskProps(taskId, workspaceId)
          if (props.status === 'Done') return invalidInput('Completed tasks cannot be scheduled')

          const dueDate = startTime ? `${date}T${startTime}` : weekPlanningDueDateForDay(date, props.due_date)
          await updateTaskProps(taskId, workspaceId, { due_date: dueDate })
          return { type: 'scheduled_task_block', id: taskId, title: object.title, due_date: dueDate, mode }
        }

        const title = readString(input['title'])
        if (!title) return invalidInput('title is required for create_time_block')

        const durationRaw = input['duration_minutes']
        if (
          durationRaw !== undefined
          && (typeof durationRaw !== 'number' || !Number.isFinite(durationRaw) || durationRaw <= 0)
        ) {
          return invalidInput('duration_minutes must be a positive number')
        }

        const blockInput = buildWeekPlanningTimeBlockTaskInput({
          title,
          dateKey: date,
          startTime: startTime ?? '09:00',
          durationMinutes: typeof durationRaw === 'number' ? durationRaw : 30,
        })
        const object = await createPlanningTimeBlock(workspaceId, {
          title: blockInput.title,
          dueDate: blockInput.due_date,
          labels: blockInput.labels,
          description: blockInput.description,
        })
        return { type: 'scheduled_task_block', id: object.id, title: object.title, due_date: blockInput.due_date, mode }
      }

      // ── Write tools ────────────────────────────────────────────────────

      case 'create_object': {
        const type = String(input['type'] ?? 'page')
        if (type === 'task') return invalidInput('Use create_task for tasks')
        const title = String(input['title'] ?? 'Untitled')
        const obj = await createObject(workspaceId, type, title)
        return { type: 'created', id: obj.id, title: obj.title ?? title }
      }

      case 'create_task': {
        const title = readString(input['title'])
        if (!title) return invalidInput('Task title is required')

        const obj = await createObject(workspaceId, 'task', title)

        // Resolve task fields
        const patch = await resolveTaskInput(input, workspaceId)
        if (Object.keys(patch).length > 0) {
          await updateTaskProps(obj.id, workspaceId, patch)
        }

        const taskListName = patch.task_list_id
          ? (await listTaskLists(workspaceId)).find((l) => l.id === patch.task_list_id)?.name ?? null
          : null

        return { type: 'task_created', id: obj.id, title, status: patch.status ?? null, task_list_name: taskListName }
      }

      case 'update_task': {
        const id = readString(input['id'])
        if (!id) return invalidInput('Task ID is required')

        const obj = await getObject(id, workspaceId)
        if (!obj) return notFound(`Object ${id} not found in this workspace`)
        if (obj.type !== 'task') return invalidInput(`${id} is not a task`)

        const changedFields: string[] = []
        if ('title' in input) {
          const newTitle = readString(input['title'])
          if (!newTitle) return invalidInput('Task title cannot be empty')
          await updateObjectTitle(id, newTitle, workspaceId)
          changedFields.push('title')
        }

        const patch = await resolveTaskInput(input, workspaceId)
        if (Object.keys(patch).length > 0) {
          await updateTaskProps(id, workspaceId, patch)
          if (patch.status !== undefined) changedFields.push('status')
          if (patch.priority !== undefined) changedFields.push('priority')
          if (patch.due_date !== undefined) changedFields.push('due_date')
          if (patch.assignees !== undefined) changedFields.push('assignees')
          if (patch.labels !== undefined) changedFields.push('labels')
          if (patch.description !== undefined) changedFields.push('description')
          if (patch.task_list_id !== undefined) changedFields.push('task_list')
        }

        return { type: 'task_updated', id, title: obj.title ?? id, changed_fields: changedFields }
      }

      case 'update_object_title': {
        const id = String(input['id'] ?? '')
        const title = String(input['title'] ?? '')
        await updateObjectTitle(id, title, workspaceId)
        return { type: 'updated', id, title }
      }

      case 'update_object': {
        const id = readString(input['id'])
        if (!id) return invalidInput('Object ID is required')

        const obj = await getObject(id, workspaceId)
        if (!obj) return notFound(`Object ${id} not found in this workspace`)

        const changedFields: string[] = []
        if ('title' in input) {
          const title = readString(input['title'])
          if (!title) return invalidInput('Object title cannot be empty')
          await updateObjectTitle(id, title, workspaceId)
          changedFields.push('title')
        }
        if ('text' in input || 'content' in input) {
          const text = readString(input['text'] ?? input['content'])
          if (!text) return invalidInput('Object content cannot be empty')
          await setContent(id, workspaceId, textToTipTapDoc(text))
          changedFields.push('content')
        }

        return changedFields.length
          ? { type: 'object_updated', id, changed_fields: changedFields }
          : { type: 'no_op', message: `No updates supplied for ${id}` }
      }

      case 'set_content': {
        const id = String(input['id'] ?? '')
        const text = String(input['text'] ?? '')
        // Build a minimal TipTap document from plain text
        const doc = textToTipTapDoc(text)
        await setContent(id, workspaceId, doc)
        return { type: 'content_set', id }
      }

      case 'append_block': {
        const id = readString(input['id'])
        const text = readString(input['text'] ?? input['content'])
        if (!id) return invalidInput('Object ID is required')
        if (!text) return invalidInput('Text is required')
        await appendContentText(id, workspaceId, text)
        return { type: 'content_appended', id }
      }

      case 'delete_object': {
        const id = String(input['id'] ?? '')
        await deleteObject(id, workspaceId)
        return { type: 'deleted', id }
      }

      case 'set_property': {
        const objectId = String(input['object_id'] ?? '')
        const key = String(input['key'] ?? '')
        const valueType = String(input['value_type'] ?? 'text')
        const value = String(input['value'] ?? '')
        await upsertProperty(objectId, workspaceId, key, valueType, value)
        return { type: 'property_set', objectId, key, value }
      }

      case 'navigate_to':
        return { type: 'no_op', message: 'Navigation is not supported in the MCP server context.' }

      default:
        return invalidInput(`Unknown tool: ${name}`)
  }
}

// ── Task input resolution ────────────────────────────────────────────────────

async function resolveTaskInput(
  input: Record<string, unknown>,
  workspaceId: string,
): Promise<Partial<AuroraTaskProps>> {
  const patch: Partial<AuroraTaskProps> = {}

  if ('status' in input) {
    const raw = readString(input['status'])
    if (raw) {
      const statuses = await listTaskStatuses(workspaceId)
      const match = statuses.find((s) => s.toLowerCase() === raw.toLowerCase())
      patch.status = match ?? raw
    }
  }

  if ('priority' in input) {
    const raw = readString(input['priority'])
    if (raw === null) patch.priority = null
    else {
      const normalized = normalizePriority(raw)
      if (!normalized) throw new ToolInputError(`Unknown priority: ${raw}`)
      patch.priority = normalized
    }
  }

  if ('due_date' in input) {
    const raw = readString(input['due_date'])
    // Normalize space-separated datetime to ISO
    patch.due_date = raw && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(raw) ? raw.replace(/\s+/, 'T') : raw
  }

  if ('description' in input) {
    patch.description = readString(input['description'])
  }

  if ('labels' in input || 'tags' in input) {
    patch.labels = readStringArray(input['labels'] ?? input['tags'])
  }

  if ('task_list' in input) {
    const query = readString(input['task_list'])
    if (query === null) {
      patch.task_list_id = null
    } else {
      const lists = await listTaskLists(workspaceId)
      const match = matchTaskList(query, lists)
      if (!match) throw new ToolInputError(`Could not resolve task list: ${query}`)
      patch.task_list_id = match.id
      // Apply default status if not explicitly set
      if (patch.status === undefined && match.default_status) {
        patch.status = match.default_status
      }
    }
  }

  if ('assignees' in input || 'assignee' in input) {
    const queries = [...readStringArray(input['assignees']), ...readStringArray(input['assignee'])]
    if (!queries.length) {
      patch.assignees = []
    } else {
      const members = await listMembers(workspaceId)
      const resolved = queries.map((q) => {
        const m = matchMember(q, members)
        if (!m) throw new ToolInputError(`Could not resolve assignee: ${q}`)
        return m.id
      })
      patch.assignees = [...new Set(resolved)]
    }
  }

  return patch
}

// ── Content helpers ──────────────────────────────────────────────────────────

function textToTipTapDoc(text: string): Record<string, unknown> {
  const paragraphs = text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }))
  return { type: 'doc', content: paragraphs }
}

// ── Format result for MCP text response ──────────────────────────────────────

export function formatToolResult(result: ToolResult): string {
  switch (result.type) {
    case 'workspaces':
      if (!result.workspaces.length) return 'No granted workspaces.'
      return result.workspaces.map((workspace) => `- ${workspace.name} (${workspace.alias}, ${workspace.workspaceId})`).join('\n')
    case 'objects':
      if (!result.objects.length) return 'No objects found.'
      return result.objects.map((o) => `- [${o.type}] ${o.title ?? '(Untitled)'} (${o.id})`).join('\n')
    case 'object': {
      const propLines = Object.entries(result.properties)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
      return [
        `**${result.object.title ?? 'Untitled'}** (${result.object.type}, ${result.object.id})`,
        propLines ? `\nProperties:\n${propLines}` : '',
        result.content
          ? `\n\n${result.content}`
          : result.availability === 'encrypted_locked'
            ? '\n*(content is end-to-end encrypted and locked)*'
            : result.availability === 'permission_denied'
              ? '\n*(permission denied for content)*'
              : result.availability === 'not_found'
                ? '\n*(content not found)*'
                : '\n*(no content)*',
      ].join('')
    }
    case 'created':
      return `Created: "${result.title}" (${result.id})`
    case 'task_created':
      return `Task created: "${result.title}" (${result.id})${result.status ? ` [${result.status}]` : ''}${result.task_list_name ? ` in ${result.task_list_name}` : ''}`
    case 'task_updated':
      return `Task updated: "${result.title}" (${result.id}) — changed: ${result.changed_fields.join(', ') || 'nothing'}`
    case 'object_updated':
      return `Object updated: ${result.id} — changed: ${result.changed_fields.join(', ') || 'nothing'}`
    case 'updated':
      return `Updated: "${result.title}" (${result.id})`
    case 'deleted':
      return `Deleted: ${result.id} (soft-deleted)`
    case 'content_set':
      return `Content set on ${result.id}`
    case 'content_appended':
      return `Content appended to ${result.id}`
    case 'property_set':
      return `Set property "${result.key}" = "${result.value}" on ${result.objectId}`
    case 'knowledge_sources':
      if (!result.sources.length) return 'No matching workspace sources.'
      return result.sources.map((source, index) => {
        const header = `[${index + 1}] ${source.title ?? '(Untitled)'} (${source.objectType}, ${source.objectId})`
        const lines = [
          header,
          `  sourceId: ${source.sourceId}`,
          `  deepLink: ${source.deepLink}`,
          `  updatedAt: ${source.updatedAt}`,
          `  availability: ${source.availability}`,
        ]
        if (source.snippet) lines.push(`  snippet: ${source.snippet}`)
        if (source.matchedFields.length) lines.push(`  matchedFields: ${source.matchedFields.join(', ')}`)
        if (source.plainText) {
          lines.push('  content:')
          lines.push(...source.plainText.split('\n').map((line) => `    ${line}`))
        }
        return lines.join('\n')
      }).join('\n\n')
    case 'mcp_tool_coverage':
      return JSON.stringify(result.audit, null, 2)
    case 'mcp_workflow_recipes':
      return result.recipes.map((recipe) => [
        `## ${recipe.id}: ${recipe.title}`,
        recipe.goal,
        `Scopes: ${recipe.requiredScopes.join(', ')}`,
        `Tools: ${recipe.toolSteps.join(' -> ')}`,
        `Prompt: ${recipe.prompt}`,
      ].join('\n')).join('\n\n')
    case 'object_types':
      return result.object_types.length
        ? result.object_types.map((entry) => `- ${entry.name} (${entry.id}): ${entry.schema.length} properties`).join('\n')
        : 'No custom object types found.'
    case 'custom_database_recipes':
      return result.recipes.map((entry) => `- ${entry.name} (${entry.id}): ${entry.description}`).join('\n')
    case 'custom_database_plan':
      return `${result.summary}\nPlan ID: ${result.plan.planId}\nPlan hash: ${result.plan.planHash}\nExpires: ${result.plan.expiresAt}`
    case 'custom_database_applied':
      return `Custom database ${result.outcome}: ${result.object_type.name} (${result.object_type.id})${result.template_id ? `; template ${result.template_id}` : ''}`
    case 'object_type_updated':
      return `Object type updated: ${result.object_type.name} (${result.object_type.id})`
    case 'templates':
      return result.templates.length ? result.templates.map((entry) => `- ${entry.title ?? '(Untitled)'} [${entry.type}] (${entry.id})`).join('\n') : 'No templates found.'
    case 'template_created':
      return `Template created: ${result.template.title ?? '(Untitled)'} (${result.template.id})`
    case 'template_instantiated':
      return `Created ${result.object_id} from template ${result.template_id}`
    case 'obsidian_import_plan':
      return [
        `Obsidian plan ${result.plan.planId} (${result.plan.planHash})`,
        `Vault: ${result.plan.vaultDisplayName}; workspace: ${result.plan.workspaceId}`,
        `Notes: ${result.plan.counts.notes}; templates: ${result.plan.counts.templates}; Canvas: ${result.plan.counts.canvases}; attachments: ${result.plan.counts.attachments}`,
        `Groups: ${result.plan.groups.map((group) => `${group.name} (${group.noteCount})`).join(', ') || 'none'}`,
        result.plan.nextAction,
      ].join('\n')
    case 'obsidian_import_plan_page':
      return JSON.stringify(result.page, null, 2)
    case 'obsidian_import_confirmation_required':
      return [
        `Confirmation required for Obsidian plan ${result.plan_id} (${result.plan_hash}).`,
        `Vault: ${result.preview.vaultDisplayName}; workspace: ${result.preview.workspaceId}.`,
        `Notes: ${result.preview.counts.notes}; templates: ${result.preview.counts.templates}; Canvas: ${result.preview.counts.canvases}; attachments: ${result.preview.counts.attachments}.`,
        'Present this plan to the user and wait for a later user message. Then call import_obsidian_vault with the exact plan_id, plan_hash, and confirmed: true.',
      ].join('\n')
    case 'obsidian_import_batch':
      return [
        `Obsidian import ${result.result.status}: ${result.result.completed} complete, ${result.result.failed} failed, ${result.result.remaining} remaining.`,
        `Plan: ${result.result.planId} (${result.result.planHash}).`,
        result.result.nextCursor === null ? 'No next cursor.' : `Next cursor: ${result.result.nextCursor}.`,
        result.result.warnings.length ? `Warnings: ${result.result.warnings.map((warning) => warning.code).join(', ')}` : 'Warnings: none.',
      ].join('\n')
    case 'obsidian_import_status':
      return [
        `Obsidian import ${result.status.status}: ${result.status.completed} complete, ${result.status.failed} failed, ${result.status.remaining} remaining.`,
        `Plan: ${result.status.planId} (${result.status.planHash}).`,
        result.status.nextAction,
      ].join('\n')
    case 'week_plan':
      return [
        `Week ${result.plan.range.start} to ${result.plan.range.end}`,
        ...result.plan.days.map((day) => {
          const tasks = day.tasks.length
            ? day.tasks.map((task) => {
              const block = task.timeBlock.isTimeBlock
                ? ` [time block${task.timeBlock.durationMinutes ? `, ${task.timeBlock.durationMinutes}m` : ''}]`
                : ''
              return `  - ${task.title ?? '(Untitled)'} (${task.id})${task.due_date ? ` due ${task.due_date}` : ''}${block}`
            }).join('\n')
            : '  - No scheduled tasks'
          return `${day.date}\n${tasks}`
        }),
        result.plan.unscheduled.length
          ? `Unscheduled\n${result.plan.unscheduled.map((task) => `  - ${task.title ?? '(Untitled)'} (${task.id})`).join('\n')}`
          : 'Unscheduled\n  - None',
      ].join('\n\n')
    case 'canvas': {
      const cardLines = result.canvas.cards.length
        ? result.canvas.cards.map((card) => {
          const ref = card.objectId ? ` object=${card.objectId}${card.objectTitle ? ` (${card.objectTitle})` : ''}` : ''
          const text = card.text ? ` text="${card.text}"` : ''
          return `- ${card.id} [${card.type}] x=${card.x ?? '?'} y=${card.y ?? '?'} w=${card.width ?? '?'} h=${card.height ?? '?'}${ref}${text}`
        })
        : ['- No cards']
      const edgeLines = result.canvas.edges.length
        ? result.canvas.edges.map((edge) => `- ${edge.id}: ${edge.fromCard ?? '?'} -> ${edge.toCard ?? '?'}${edge.label ? ` (${edge.label})` : ''}`)
        : ['- No edges']
      const warningLines = result.canvas.warnings.length
        ? ['Warnings:', ...result.canvas.warnings.map((warning) => `- ${warning}`)]
        : []
      return [
        `Canvas: ${result.canvas.canvas.title ?? '(Untitled)'} (${result.canvas.canvas.id})`,
        'Cards:',
        ...cardLines,
        'Edges:',
        ...edgeLines,
        ...warningLines,
      ].join('\n')
    }
    case 'scheduled_task_block':
      return `Scheduled: ${result.title ?? '(Untitled)'} (${result.id}) due ${result.due_date} via ${result.mode}`
    case 'members':
      if (!result.members.length) return 'No members found.'
      return result.members.map((m) => `- ${m.name ?? m.email} (${m.role}, ${m.id})`).join('\n')
    case 'task_lists':
      if (!result.task_lists.length) return 'No task lists found.'
      return result.task_lists.map((l) => `- ${l.name} (${l.id})`).join('\n')
    case 'task_statuses':
      return result.statuses.join(', ')
    case 'project_context': {
      const header = [
        `Workspace: ${result.workspace.name} (${result.workspace.id})`,
        result.status === 'ok'
          ? `Project: ${result.project.title} (${result.project.id})`
          : result.status === 'ambiguous'
            ? 'Project: ambiguous query'
            : 'Project: not found',
        `As of: ${result.asOf}`,
      ]
      if (result.status === 'ambiguous') {
        return [...header, 'Candidates:', ...result.candidates.map((candidate) => `- ${candidate.title} (${candidate.id})`)].join('\n')
      }
      if (result.status === 'not_found') return header.join('\n')
      return [
        ...header,
        'Blockers:',
        ...(result.project.blockers.length ? result.project.blockers.map((item) => `- ${item}`) : ['- None']),
        'Next actions:',
        ...(result.project.nextActions.length ? result.project.nextActions.map((item) => `- ${item}`) : ['- None']),
        'Citations:',
        ...(result.project.sources.length
          ? result.project.sources.map((source) => `- ${source.title ?? '(Untitled)'} [${source.sourceId}] ${source.deepLink}`)
          : ['- None']),
      ].join('\n')
    }
    case 'project_changes': {
      const header = [
        `Workspace: ${result.workspace.name} (${result.workspace.id})`,
        result.status === 'ok' ? `Project: ${result.project.title} (${result.project.id})` : 'Project: not found',
        `As of: ${result.asOf}`,
      ]
      if (result.status === 'not_found') return header.join('\n')
      return [
        ...header,
        'Changes:',
        ...(result.items.length
          ? result.items.map((item) => `- ${item.updatedAt} ${item.type}: ${item.title ?? item.id} (${item.id})`)
          : ['- None']),
        `Next cursor: ${result.nextCursor ?? 'none'}`,
        `Has more: ${result.hasMore}`,
      ].join('\n')
    }
    case 'no_op':
      return result.message
    case 'error':
      return `Error: ${result.message}`
  }
}

export function toMcpToolCallResult(result: ToolResult): McpToolCallResult {
  return {
    content: [{ type: 'text', text: formatToolResult(result) }],
    structuredContent: result,
    isError: result.type === 'error',
  }
}
