/**
 * tools.ts — Tool execution logic for the MCP server.
 *
 * SECURITY: Every tool call receives the workspaceId and passes it through
 * to AuroraCloud client helpers which verify ownership before any read or write.
 * No cross-workspace or cross-user data leakage is possible.
 */
import {
  listObjects,
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
} from './auroraClient.js'
import type { AuroraWorkspaceMember, AuroraTaskList, AuroraTaskProps, WorkspaceKnowledgeSource } from './auroraClient.js'
import { buildWeekPlan, normalizeCanvasContent } from './planningTools.js'
import type { McpCanvasReadResult, McpWeekPlan } from './planningTools.js'
import { getMcpToolCoverageAudit, getMcpWorkflowRecipes } from './toolCatalog.js'
import type { McpToolCoverageAudit, McpWorkflowRecipe } from './toolCatalog.js'

// ── Result types ─────────────────────────────────────────────────────────────

export type ToolResult =
  | { type: 'objects'; objects: { id: string; title: string | null; type: string; icon: string | null }[] }
  | { type: 'object'; object: { id: string; title: string | null; type: string; icon: string | null }; content: string | null; properties: Record<string, string> }
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
  | { type: 'week_plan'; plan: McpWeekPlan }
  | { type: 'canvas'; canvas: McpCanvasReadResult }
  | { type: 'scheduled_task_block'; id: string; title: string | null; due_date: string; mode: string }
  | { type: 'members'; members: { id: string; name: string | null; email: string; role: string }[] }
  | { type: 'task_lists'; task_lists: { id: string; name: string }[] }
  | { type: 'task_statuses'; statuses: string[] }
  | { type: 'no_op'; message: string }
  | { type: 'error'; message: string }

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

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  workspaceId: string,
): Promise<ToolResult> {
  try {
    switch (name) {
      // ── Read tools ─────────────────────────────────────────────────────

      case 'search':
      case 'search_objects': {
        const query = String(input['query'] ?? '').toLowerCase()
        const typeFilter = input['type'] ? String(input['type']) : undefined
        const all = await listObjects(workspaceId, typeFilter)
        const matches = all
          .filter((o) => (o.title ?? '').toLowerCase().includes(query))
          .slice(0, 10)
          .map((o) => ({ id: o.id, title: o.title, type: o.type, icon: o.icon }))
        return { type: 'objects', objects: matches }
      }

      case 'list_objects': {
        const typeFilter = input['type'] ? String(input['type']) : undefined
        const limit = typeof input['limit'] === 'number' ? input['limit'] : 20
        const all = await listObjects(workspaceId, typeFilter)
        const results = all
          .filter((o) => !o.is_template)
          .slice(0, limit)
          .map((o) => ({ id: o.id, title: o.title, type: o.type, icon: o.icon }))
        return { type: 'objects', objects: results }
      }

      case 'list_recent': {
        const typeFilter = input['type'] ? String(input['type']) : undefined
        const limit = typeof input['limit'] === 'number' ? input['limit'] : 20
        const all = await listObjects(workspaceId, typeFilter)
        const results = all
          .filter((o) => !o.is_template)
          .slice(0, limit)
          .map((o) => ({ id: o.id, title: o.title, type: o.type, icon: o.icon }))
        return { type: 'objects', objects: results }
      }

      case 'wiki_search': {
        const query = readString(input['query'])
        if (!query) return { type: 'error', message: 'Query is required' }
        const limit = typeof input['limit'] === 'number' ? input['limit'] : 20
        const sources = await searchWorkspaceKnowledgeServer(workspaceId, query, limit)
        return { type: 'knowledge_sources', sources }
      }

      case 'wiki_get_page': {
        const id = readString(input['id'])
        if (!id) return { type: 'error', message: 'Object ID is required' }
        const includeFullText = Boolean(input['includeFullText'])
        const source = await getWorkspaceKnowledgeObjectServer(workspaceId, id, includeFullText)
        if (!source) return { type: 'error', message: `Object ${id} not found in this workspace` }
        return { type: 'knowledge_sources', sources: [source] }
      }

      case 'wiki_related': {
        const id = readString(input['id'])
        if (!id) return { type: 'error', message: 'Object ID is required' }
        const limit = typeof input['limit'] === 'number' ? input['limit'] : 6
        const sources = await listWorkspaceRelatedKnowledgeServer(workspaceId, id, limit)
        return { type: 'knowledge_sources', sources }
      }

      case 'wiki_recent': {
        const limit = typeof input['limit'] === 'number' ? input['limit'] : 6
        const sources = await listWorkspaceRecentKnowledgeServer(workspaceId, limit)
        return { type: 'knowledge_sources', sources }
      }

      case 'get_object': {
        const id = String(input['id'] ?? '')
        const obj = await getObject(id, workspaceId)
        if (!obj) return { type: 'error', message: `Object ${id} not found in this workspace` }

        const content = await getContent(id, workspaceId)
        // Detect E2EE content
        const displayContent = content && (content.startsWith('v1:') || content.startsWith('v2:'))
          ? '[Content is end-to-end encrypted and cannot be read by the MCP server]'
          : content

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
          content: displayContent ?? null,
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

      case 'list_week_plan': {
        const anchorDate = readString(input['anchor_date']) ?? todayDateKey()
        if (!isDateKey(anchorDate)) {
          return { type: 'error', message: 'anchor_date must be a valid date formatted YYYY-MM-DD' }
        }

        const includeUnscheduled = input['include_unscheduled'] !== false
        const unscheduledLimit = typeof input['unscheduled_limit'] === 'number' ? input['unscheduled_limit'] : 12
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
            unscheduledLimit,
          }),
        }
      }

      case 'read_canvas': {
        const id = readString(input['id'])
        if (!id) return { type: 'error', message: 'Canvas object ID is required' }
        const result = await readCanvasContent(workspaceId, id)
        if (!result) return { type: 'error', message: `Canvas ${id} not found in this workspace` }
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
          return { type: 'error', message: 'mode must be schedule_existing_task or create_time_block' }
        }
        if (!date || !isDateKey(date)) {
          return { type: 'error', message: 'date must be a valid date formatted YYYY-MM-DD' }
        }

        const startTime = readString(input['start_time'])
        if (startTime && !isTimeKey(startTime)) {
          return { type: 'error', message: 'start_time must be a valid time formatted HH:mm' }
        }

        if (mode === 'schedule_existing_task') {
          const taskId = readString(input['task_id'])
          if (!taskId) return { type: 'error', message: 'task_id is required for schedule_existing_task' }

          const object = await getObject(taskId, workspaceId)
          if (!object) return { type: 'error', message: `Object ${taskId} not found in this workspace` }
          if (object.type !== 'task') return { type: 'error', message: `${taskId} is not a task` }

          const props = await getTaskProps(taskId, workspaceId)
          if (props.status === 'Done') return { type: 'error', message: 'Completed tasks cannot be scheduled' }

          const dueDate = startTime ? `${date}T${startTime}` : weekPlanningDueDateForDay(date, props.due_date)
          await updateTaskProps(taskId, workspaceId, { due_date: dueDate })
          return { type: 'scheduled_task_block', id: taskId, title: object.title, due_date: dueDate, mode }
        }

        const title = readString(input['title'])
        if (!title) return { type: 'error', message: 'title is required for create_time_block' }

        const durationRaw = input['duration_minutes']
        if (
          durationRaw !== undefined
          && (typeof durationRaw !== 'number' || !Number.isFinite(durationRaw) || durationRaw <= 0)
        ) {
          return { type: 'error', message: 'duration_minutes must be a positive number' }
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
        if (type === 'task') return { type: 'error', message: 'Use create_task for tasks' }
        const title = String(input['title'] ?? 'Untitled')
        const obj = await createObject(workspaceId, type, title)
        return { type: 'created', id: obj.id, title: obj.title ?? title }
      }

      case 'create_task': {
        const title = readString(input['title'])
        if (!title) return { type: 'error', message: 'Task title is required' }

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
        if (!id) return { type: 'error', message: 'Task ID is required' }

        const obj = await getObject(id, workspaceId)
        if (!obj) return { type: 'error', message: `Object ${id} not found in this workspace` }
        if (obj.type !== 'task') return { type: 'error', message: `${id} is not a task` }

        const changedFields: string[] = []
        if ('title' in input) {
          const newTitle = readString(input['title'])
          if (!newTitle) return { type: 'error', message: 'Task title cannot be empty' }
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
        if (!id) return { type: 'error', message: 'Object ID is required' }

        const obj = await getObject(id, workspaceId)
        if (!obj) return { type: 'error', message: `Object ${id} not found in this workspace` }

        const changedFields: string[] = []
        if ('title' in input) {
          const title = readString(input['title'])
          if (!title) return { type: 'error', message: 'Object title cannot be empty' }
          await updateObjectTitle(id, title, workspaceId)
          changedFields.push('title')
        }
        if ('text' in input || 'content' in input) {
          const text = readString(input['text'] ?? input['content'])
          if (!text) return { type: 'error', message: 'Object content cannot be empty' }
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
        if (!id) return { type: 'error', message: 'Object ID is required' }
        if (!text) return { type: 'error', message: 'Text is required' }
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
        return { type: 'error', message: `Unknown tool: ${name}` }
    }
  } catch (err) {
    return { type: 'error', message: err instanceof Error ? err.message : String(err) }
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
      if (!normalized) throw new Error(`Unknown priority: ${raw}`)
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
      if (!match) throw new Error(`Could not resolve task list: ${query}`)
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
        if (!m) throw new Error(`Could not resolve assignee: ${q}`)
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
        result.content ? `\n\n${result.content}` : '\n*(no content)*',
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
      return result.audit.areas.map((area) => {
        const lines = [
          `## ${area.label} (${area.status})`,
          area.implementedTools.length ? `Implemented: ${area.implementedTools.join(', ')}` : 'Implemented: none',
        ]
        if (area.missingTools.length) {
          lines.push('Missing:')
          lines.push(...area.missingTools.map((tool) => `- [${tool.priority}] ${tool.name}: ${tool.reason}`))
        }
        return lines.join('\n')
      }).join('\n\n')
    case 'mcp_workflow_recipes':
      return result.recipes.map((recipe) => [
        `## ${recipe.id}: ${recipe.title}`,
        recipe.goal,
        `Scopes: ${recipe.requiredScopes.join(', ')}`,
        `Tools: ${recipe.toolSteps.join(' -> ')}`,
        `Prompt: ${recipe.prompt}`,
      ].join('\n')).join('\n\n')
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
    case 'no_op':
      return result.message
    case 'error':
      return `Error: ${result.message}`
  }
}
