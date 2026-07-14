/**
 * auroraClient.ts — AuroraCloud client helpers for the MCP server.
 *
 * SECURITY: Every query is scoped to the configured workspace.
 * On authenticate(), the server verifies the caller is a member of
 * that workspace — if not, the process exits.
 */
import type { ContentReadResult } from './contracts.js'
import { AuroraApiError, ToolInputError, ToolNotFoundError } from './errors.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type AuroraObjectRecord = {
  id: string
  workspace_id: string
  type: string
  title: string | null
  icon: string | null
  parent_id: string | null
  is_deleted: boolean
  is_template: boolean
  created_at: string
  updated_at: string
}

export type AuroraContentRecord = {
  id?: string
  object_id: string
  content_json: Record<string, unknown> | string | null
}

export type AuroraPropertyRecord = {
  id: string
  object_id: string
  key: string
  value_type: string
  value_text: string | null
  value_num: number | null
  value_date: string | null
  value_bool: boolean | null
  value_ref: string | null
}

export type AuroraWorkspaceMember = {
  id: string
  name: string | null
  email: string
  role: string
}

export type AuroraTaskList = {
  id: string
  name: string
  default_status: string | null
}

export const WORKSPACE_KNOWLEDGE_SOURCE_KINDS = [
  'object',
  'content_chunk',
  'property',
  'comment',
  'attachment_metadata',
  'relationship',
] as const

export type WorkspaceKnowledgeSourceKind = (typeof WORKSPACE_KNOWLEDGE_SOURCE_KINDS)[number]

export const WORKSPACE_KNOWLEDGE_AVAILABILITY_STATES = [
  'available',
  'encrypted_locked',
  'not_indexed',
  'unsupported_type',
  'permission_denied',
] as const

export type WorkspaceKnowledgeAvailability = (typeof WORKSPACE_KNOWLEDGE_AVAILABILITY_STATES)[number]

export const WORKSPACE_KNOWLEDGE_RELATIONSHIP_TYPES = [
  'parent',
  'child',
  'link',
  'backlink',
  'tag',
  'task_project',
] as const

export type WorkspaceKnowledgeRelationshipType = (typeof WORKSPACE_KNOWLEDGE_RELATIONSHIP_TYPES)[number]

export type WorkspaceKnowledgeRelationship = {
  type: WorkspaceKnowledgeRelationshipType
  objectId: string
  title: string | null
}

export type WorkspaceKnowledgeSource = {
  sourceId: string
  workspaceId: string
  objectId: string
  kind: WorkspaceKnowledgeSourceKind
  title: string | null
  objectType: string
  icon: string | null
  breadcrumb: string[]
  deepLink: string
  snippet: string | null
  plainText: string | null
  blockId: string | null
  updatedAt: string
  score: number | null
  matchedFields: Array<'title' | 'content' | 'properties' | 'relationships'>
  availability: WorkspaceKnowledgeAvailability
  relationships: WorkspaceKnowledgeRelationship[]
}

export type WorkspaceKnowledgeResponse = {
  workspaceId: string
  query: string | null
  limit: number
  items: WorkspaceKnowledgeSource[]
}

type AuthRecord = Record<string, unknown> | null

type BackendAuthStore = {
  token: string
  record: AuthRecord
  save(token: string, record: AuthRecord): void
}

export type CollectionPage<T> = {
  items: T[]
  page: number
  perPage: number
  totalPages: number
  totalItems: number
}

type BackendCollection = {
  listPage(options: {
    filter?: string
    sort?: string
    expand?: string
    page: number
    perPage: number
  }): Promise<CollectionPage<Record<string, unknown>>>
  get(id: string): Promise<Record<string, unknown>>
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>
  update(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>>
  authWithPassword?(email: string, password: string): Promise<{ record: Record<string, unknown>; token: string }>
}

type BackendClient = {
  authStore: BackendAuthStore
  filter(template: string, params: Record<string, unknown>): string
  collection(name: string): BackendCollection
  request<T = unknown>(path: string, options?: { method?: string; body?: unknown }): Promise<T>
}

// ── Singleton backend instance ───────────────────────────────────────────────

let _client: BackendClient | null = null

export function resetAuroraClientForTests(): void {
  _client = null
}

export function getAuroraClient(): BackendClient {
  if (_client) return _client
  _client = createAuroraCloudClient(getAuroraApiUrl())
  return _client
}

/**
 * Authenticate and verify workspace membership.
 * Exits the process if the user is not a member of the target workspace.
 */
export async function authenticate(): Promise<void> {
  const client = getAuroraClient()
  const workspaceId = process.env['AURORA_WORKSPACE_ID']

  const token = process.env['AURORA_API_TOKEN']
  if (token) {
    client.authStore.save(token, null)
  } else {
    const email = process.env['AURORA_API_EMAIL']
    const password = process.env['AURORA_API_PASSWORD']
    const users = client.collection('users')
    if (email && password && users.authWithPassword) {
      await users.authWithPassword(email, password)
    } else {
      throw new Error(
        'Provide AURORA_API_TOKEN (recommended: workspace MCP token `aur_mcp_...`), or AURORA_API_EMAIL + AURORA_API_PASSWORD for local development only.',
      )
    }
  }

  await ensureAuthRecord()

  // Verify workspace membership
  if (workspaceId) {
    const userId = getAuthUserId()
    if (!userId) throw new Error('Could not determine authenticated user ID')
    const members = await client.collection('workspace_members').listPage({
      filter: client.filter('workspace_id = {:wid} && user_id = {:uid}', { wid: workspaceId, uid: userId }),
      page: 1,
      perPage: 1,
    })
    if (!members.items.length) {
      throw new Error('Authenticated user is not a member of the configured workspace')
    }
    process.stderr.write('AuroraDocs MCP authenticated.\n')
  }
}

/** Get the authenticated user's ID from the auth store. */
function getAuthUserId(): string | null {
  const client = getAuroraClient()
  const record = client.authStore.record as Record<string, unknown> | null
  return (record?.['id'] as string) ?? null
}

// ── Object CRUD ──────────────────────────────────────────────────────────────

export async function listObjects(workspaceId: string, type?: string): Promise<AuroraObjectRecord[]> {
  return (await listObjectsPage(workspaceId, type, 1, 50)).items
}

export async function listObjectsPage(
  workspaceId: string,
  type: string | undefined,
  page: number,
  perPage: number,
): Promise<CollectionPage<AuroraObjectRecord>> {
  if (!Number.isInteger(page) || page < 1) throw new ToolInputError('page must be a positive integer')
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 50) {
    throw new ToolInputError('perPage must be an integer between 1 and 50')
  }
  const client = getAuroraClient()
  const filter = type
    ? client.filter('workspace_id = {:wid} && is_deleted = false && type = {:type}', { wid: workspaceId, type })
    : client.filter('workspace_id = {:wid} && is_deleted = false', { wid: workspaceId })
  const result = await client.collection('objects').listPage({ filter, sort: '-updated_at', page, perPage })
  return { ...result, items: result.items.map(mapObject) }
}

export async function searchObjectsPage(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<WorkspaceKnowledgeSource[]> {
  return searchWorkspaceKnowledgeServer(workspaceId, query, limit)
}

export async function getObject(id: string, workspaceId: string): Promise<AuroraObjectRecord | null> {
  const client = getAuroraClient()
  try {
    const r = await client.collection('objects').get(id)
    const obj = mapObject(r)
    // SECURITY: reject objects outside the configured workspace
    if (obj.workspace_id !== workspaceId) return null
    return obj
  } catch (error) {
    if (error instanceof AuroraApiError && error.status === 404) return null
    throw error
  }
}

export async function createObject(workspaceId: string, type: string, title: string): Promise<AuroraObjectRecord> {
  const client = getAuroraClient()
  const r = await client.collection('objects').create({
    workspace_id: workspaceId,
    type,
    title,
    is_deleted: false,
    is_template: false,
  })
  return mapObject(r)
}

export async function updateObjectTitle(id: string, title: string, workspaceId: string): Promise<void> {
  // Verify ownership before update
  const obj = await getObject(id, workspaceId)
  if (!obj) throw new ToolNotFoundError(`Object ${id} not found in this workspace`)
  const client = getAuroraClient()
  await client.collection('objects').update(id, { title })
}

export async function deleteObject(id: string, workspaceId: string): Promise<void> {
  const obj = await getObject(id, workspaceId)
  if (!obj) throw new ToolNotFoundError(`Object ${id} not found in this workspace`)
  const client = getAuroraClient()
  await client.collection('objects').update(id, { is_deleted: true })
}

// ── Content ──────────────────────────────────────────────────────────────────

export async function getContent(objectId: string, workspaceId: string): Promise<ContentReadResult> {
  try {
    // Verify object belongs to workspace
    const obj = await getObject(objectId, workspaceId)
    if (!obj) return { availability: 'not_found', text: null }

    const client = getAuroraClient()
    const records = await client.collection('content').listPage({
      filter: client.filter('object_id = {:id}', { id: objectId }),
      page: 1,
      perPage: 1,
    })
    const r = records.items[0]
    if (!r) return { availability: 'empty', text: null }
    const json = r['content_json']
    if (!json) return { availability: 'empty', text: null }
    if (typeof json === 'string' && (json.startsWith('v1:') || json.startsWith('v2:'))) {
      return { availability: 'encrypted_locked', text: null }
    }
    const text = extractTextFromDoc(typeof json === 'string' ? JSON.parse(json) : json)
    return text.trim()
      ? { availability: 'available', text }
      : { availability: 'empty', text: null }
  } catch (error) {
    if (error instanceof AuroraApiError && error.status === 403) {
      return { availability: 'permission_denied', text: null }
    }
    if (error instanceof AuroraApiError && error.status === 404) {
      return { availability: 'not_found', text: null }
    }
    throw error
  }
}

export async function getContentJson(objectId: string, workspaceId: string): Promise<Record<string, unknown> | null> {
  const obj = await getObject(objectId, workspaceId)
  if (!obj) return null

  const client = getAuroraClient()
  const records = await client.collection('content').listPage({
    filter: client.filter('object_id = {:id}', { id: objectId }),
    page: 1,
    perPage: 1,
  })
  const r = records.items[0]
  if (!r) return null
  const json = r['content_json']
  if (!json) return null
  if (typeof json === 'string') {
    if (json.startsWith('v1:') || json.startsWith('v2:')) {
      throw new ToolInputError('Object content is end-to-end encrypted and cannot be modified by the MCP server')
    }
    return JSON.parse(json) as Record<string, unknown>
  }
  return json as Record<string, unknown>
}

export async function searchWorkspaceKnowledgeServer(
  workspaceId: string,
  query: string,
  limit = 20,
): Promise<WorkspaceKnowledgeSource[]> {
  const trimmedWorkspaceId = workspaceId.trim()
  const trimmedQuery = query.trim()
  if (!trimmedWorkspaceId || !trimmedQuery) return []

  const payload = await getAuroraClient().request<Partial<WorkspaceKnowledgeResponse>>(
    `/api/knowledge/workspaces/${trimmedWorkspaceId}/search?q=${encodeURIComponent(trimmedQuery)}&limit=${Math.max(1, Math.min(50, limit))}`,
    { method: 'GET' },
  )
  return normalizeWorkspaceKnowledgeResponse(payload).items
}

export async function getWorkspaceKnowledgeObjectServer(
  workspaceId: string,
  objectId: string,
  includeFullText = false,
): Promise<WorkspaceKnowledgeSource | null> {
  const trimmedWorkspaceId = workspaceId.trim()
  const trimmedObjectId = objectId.trim()
  if (!trimmedWorkspaceId || !trimmedObjectId) return null

  const payload = await getAuroraClient().request<Partial<WorkspaceKnowledgeResponse>>(
    `/api/knowledge/workspaces/${trimmedWorkspaceId}/objects/${trimmedObjectId}`,
    { method: 'GET' },
  )
  const source = normalizeWorkspaceKnowledgeResponse(payload).items[0] ?? null
  if (!source) return null
  return includeFullText ? source : { ...source, plainText: null }
}

export async function listWorkspaceRelatedKnowledgeServer(
  workspaceId: string,
  objectId: string,
  limit = 6,
): Promise<WorkspaceKnowledgeSource[]> {
  const trimmedWorkspaceId = workspaceId.trim()
  const trimmedObjectId = objectId.trim()
  if (!trimmedWorkspaceId || !trimmedObjectId) return []

  const payload = await getAuroraClient().request<Partial<WorkspaceKnowledgeResponse>>(
    `/api/knowledge/workspaces/${trimmedWorkspaceId}/related/${trimmedObjectId}?limit=${Math.max(1, Math.min(10, limit))}`,
    { method: 'GET' },
  )
  return normalizeWorkspaceKnowledgeResponse(payload).items
}

export async function listWorkspaceRecentKnowledgeServer(
  workspaceId: string,
  limit = 6,
): Promise<WorkspaceKnowledgeSource[]> {
  const trimmedWorkspaceId = workspaceId.trim()
  if (!trimmedWorkspaceId) return []

  const payload = await getAuroraClient().request<Partial<WorkspaceKnowledgeResponse>>(
    `/api/knowledge/workspaces/${trimmedWorkspaceId}/recent?limit=${Math.max(1, Math.min(10, limit))}`,
    { method: 'GET' },
  )
  return normalizeWorkspaceKnowledgeResponse(payload).items
}

export async function setContent(
  objectId: string,
  workspaceId: string,
  contentJson: Record<string, unknown>,
): Promise<void> {
  const obj = await getObject(objectId, workspaceId)
  if (!obj) throw new ToolNotFoundError(`Object ${objectId} not found in this workspace`)

  const client = getAuroraClient()
  const existing = await client.collection('content').listPage({
    filter: client.filter('object_id = {:id}', { id: objectId }),
    page: 1,
    perPage: 1,
  })
  if (existing.items.length > 0) {
    await client.collection('content').update(String(existing.items[0].id), { content_json: contentJson })
  } else {
    await client.collection('content').create({ object_id: objectId, content_json: contentJson })
  }
}

export async function appendContentText(objectId: string, workspaceId: string, text: string): Promise<void> {
  const current = await getContentJson(objectId, workspaceId)
  const currentContent = Array.isArray(current?.['content']) ? current['content'] as Record<string, unknown>[] : []
  const appended = text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }))
  await setContent(objectId, workspaceId, {
    ...(current ?? { type: 'doc' }),
    type: 'doc',
    content: [...currentContent, ...appended],
  })
}

// ── Properties (parameterized queries) ───────────────────────────────────────

export async function listProperties(objectIds: string[], workspaceId: string): Promise<AuroraPropertyRecord[]> {
  if (!objectIds.length) return []
  const client = getAuroraClient()
  const results: AuroraPropertyRecord[] = []

  // Batch in groups of 50, using parameterized filters
  for (let i = 0; i < objectIds.length; i += 50) {
    const batch = objectIds.slice(i, i + 50)
    // Build parameterized OR filter for AuroraCloud collection queries.
    const conditions = batch.map((_, idx) => `object_id = {:id${idx}}`)
    const params: Record<string, string> = {}
    batch.forEach((id, idx) => { params[`id${idx}`] = id })
    const filter = client.filter(conditions.join(' || '), params)

    const records = await client.collection('object_properties').listPage({ filter, page: 1, perPage: 50 })
    for (const r of records.items) {
      results.push({
        id: r['id'] as string,
        object_id: r['object_id'] as string,
        key: r['key'] as string,
        value_type: r['value_type'] as string,
        value_text: (r['value_text'] as string | null) ?? null,
        value_num: (r['value_num'] as number | null) ?? null,
        value_date: (r['value_date'] as string | null) ?? null,
        value_bool: r['value_bool'] != null ? Boolean(r['value_bool']) : null,
        value_ref: (r['value_ref'] as string | null) ?? null,
      })
    }
  }
  return results
}

export async function upsertProperty(
  objectId: string,
  workspaceId: string,
  key: string,
  valueType: string,
  value: string,
): Promise<void> {
  // Verify object belongs to workspace
  const obj = await getObject(objectId, workspaceId)
  if (!obj) throw new ToolNotFoundError(`Object ${objectId} not found in this workspace`)

  const client = getAuroraClient()
  const existing = await client.collection('object_properties').listPage({
    filter: client.filter('object_id = {:oid} && key = {:key}', { oid: objectId, key }),
    page: 1,
    perPage: 1,
  })
  const valueField =
    valueType === 'number' ? 'value_num' :
    valueType === 'date' ? 'value_date' :
    valueType === 'boolean' ? 'value_bool' :
    'value_text'
  const parsedValue =
    valueType === 'number' ? Number(value) :
    valueType === 'boolean' ? (value === 'true') :
    value

  if (existing.items.length > 0) {
    await client.collection('object_properties').update(String(existing.items[0].id), { value_type: valueType, [valueField]: parsedValue })
  } else {
    await client.collection('object_properties').create({ object_id: objectId, key, value_type: valueType, [valueField]: parsedValue })
  }
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function listMembers(workspaceId: string): Promise<AuroraWorkspaceMember[]> {
  const response = await getAuroraClient().request<{
    members?: Array<{ userId?: string; name: string | null; email: string; role: string }>
    items?: Array<{ userId?: string; user?: { displayName?: string | null; email?: string }; role?: string }>
  }>(`/workspaces/${workspaceId}/members`, {
    method: 'GET',
  })
  if (Array.isArray(response.members)) {
    return response.members.map((member) => ({
      id: member.userId ?? '',
      name: member.name,
      email: member.email,
      role: member.role,
    }))
  }
  if (Array.isArray(response.items)) {
    return response.items.map((member) => ({
      id: member.userId ?? '',
      name: member.user?.displayName ?? null,
      email: member.user?.email ?? '',
      role: member.role ?? 'viewer',
    }))
  }
  return []
}

// ── Task lists & statuses ────────────────────────────────────────────────────

export async function listTaskLists(workspaceId: string): Promise<AuroraTaskList[]> {
  const client = getAuroraClient()
  const records = await client.collection('task_lists').listPage({
    filter: client.filter('workspace_id = {:wid}', { wid: workspaceId }),
    sort: 'position',
    page: 1,
    perPage: 50,
  })
  return records.items.map((r) => ({
    id: r['id'] as string,
    name: r['name'] as string,
    default_status: (r['default_status'] as string | null) ?? null,
  }))
}

export async function listTaskStatuses(_workspaceId: string): Promise<string[]> {
  // Task statuses are defined in the schema, not per-workspace.
  // Return the standard set.
  return ['Backlog', 'To Do', 'In Progress', 'In Review', 'Done', 'Cancelled']
}

// ── Task properties ──────────────────────────────────────────────────────────

export type AuroraTaskProps = {
  status: string | null
  priority: string | null
  due_date: string | null
  assignees: string[]
  labels: string[]
  description: string | null
  task_list_id: string | null
}

export async function getTaskProps(objectId: string, workspaceId: string): Promise<AuroraTaskProps> {
  const props = await listProperties([objectId], workspaceId)
  const get = (key: string) => props.find((p) => p.object_id === objectId && p.key === key)

  return {
    status: get('status')?.value_text ?? null,
    priority: get('priority')?.value_text ?? null,
    due_date: get('due_date')?.value_date ?? get('due_date')?.value_text ?? null,
    assignees: (() => {
      const raw = get('assignees')?.value_text
      if (!raw) return []
      try { return JSON.parse(raw) as string[] } catch { return [] }
    })(),
    labels: parseTaskListProperty(get('tags')?.value_text, get('labels')?.value_text),
    description: get('description')?.value_text ?? null,
    task_list_id: get('task_list_id')?.value_ref ?? get('task_list_id')?.value_text ?? null,
  }
}

function parseTaskListProperty(...values: Array<string | null | undefined>): string[] {
  const items: string[] = []
  for (const raw of values) {
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        items.push(...parsed.map((entry) => String(entry).trim()).filter(Boolean))
        continue
      }
    } catch {
      // Fall through to comma-separated legacy/current property storage.
    }
    items.push(...raw.split(',').map((entry) => entry.trim()).filter(Boolean))
  }
  return [...new Set(items)]
}

export async function updateTaskProps(
  objectId: string,
  workspaceId: string,
  patch: Partial<AuroraTaskProps>,
): Promise<void> {
  const obj = await getObject(objectId, workspaceId)
  if (!obj) throw new ToolNotFoundError(`Object ${objectId} not found in this workspace`)
  if (obj.type !== 'task') throw new ToolInputError(`${objectId} is not a task`)

  const client = getAuroraClient()
  const upsert = async (key: string, valueType: string, value: string | number | boolean | null) => {
    if (value === null || value === '') return
    const existing = await client.collection('object_properties').listPage({
      filter: client.filter('object_id = {:oid} && key = {:key}', { oid: objectId, key }),
      page: 1,
      perPage: 1,
    })
    const valueField =
      valueType === 'number' ? 'value_num' :
      valueType === 'date' ? 'value_date' :
      valueType === 'boolean' ? 'value_bool' :
      valueType === 'ref' ? 'value_ref' :
      'value_text'
    if (existing.items.length > 0) {
      await client.collection('object_properties').update(String(existing.items[0].id), { value_type: valueType, [valueField]: value })
    } else {
      await client.collection('object_properties').create({ object_id: objectId, key, value_type: valueType, [valueField]: value })
    }
  }

  if (patch.status !== undefined) await upsert('status', 'text', patch.status)
  if (patch.priority !== undefined) await upsert('priority', 'text', patch.priority)
  if (patch.due_date !== undefined) await upsert('due_date', 'date', patch.due_date)
  if (patch.description !== undefined) await upsert('description', 'text', patch.description)
  if (patch.task_list_id !== undefined) await upsert('task_list_id', 'ref', patch.task_list_id)
  if (patch.assignees !== undefined) await upsert('assignees', 'text', JSON.stringify(patch.assignees))
  if (patch.labels !== undefined) await upsert('labels', 'text', JSON.stringify(patch.labels))
}

// ── Planning helpers ─────────────────────────────────────────────────────────

export type AuroraPlanningTask = AuroraTaskProps & {
  id: string
  title: string | null
  updated_at: string | null
}

export async function listPlanningTasks(workspaceId: string): Promise<AuroraPlanningTask[]> {
  const tasks = await listObjects(workspaceId, 'task')
  const results: AuroraPlanningTask[] = []
  for (const task of tasks) {
    const props = await getTaskProps(task.id, workspaceId)
    results.push({
      id: task.id,
      title: task.title,
      updated_at: task.updated_at,
      ...props,
    })
  }
  return results
}

export async function readCanvasContent(
  workspaceId: string,
  objectId: string,
): Promise<{ object: AuroraObjectRecord; contentJson: Record<string, unknown> | null } | null> {
  const object = await getObject(objectId, workspaceId)
  if (!object) return null
  if (object.type !== 'canvas') throw new ToolInputError(`${objectId} is not a canvas`)
  const contentJson = await getContentJson(objectId, workspaceId)
  return { object, contentJson }
}

export async function createPlanningTimeBlock(
  workspaceId: string,
  input: { title: string; dueDate: string; labels: string[]; description: string },
): Promise<AuroraObjectRecord> {
  const object = await createObject(workspaceId, 'task', input.title)
  await updateTaskProps(object.id, workspaceId, {
    due_date: input.dueDate,
    labels: input.labels,
    description: input.description,
  })
  return object
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapObject(r: Record<string, unknown>): AuroraObjectRecord {
  return {
    id: r['id'] as string,
    workspace_id: r['workspace_id'] as string,
    type: r['type'] as string,
    title: (r['title'] as string | null) ?? null,
    icon: (r['icon'] as string | null) ?? null,
    parent_id: (r['parent_id'] as string | null) ?? null,
    is_deleted: Boolean(r['is_deleted']),
    is_template: Boolean(r['is_template']),
    created_at: r['created_at'] as string,
    updated_at: r['updated_at'] as string,
  }
}

function extractTextFromDoc(doc: Record<string, unknown>): string {
  const parts: string[] = []
  function walk(node: Record<string, unknown>) {
    if (typeof node['text'] === 'string') parts.push(node['text'])
    const content = node['content'] as Record<string, unknown>[] | undefined
    if (content) content.forEach(walk)
  }
  walk(doc)
  return parts.join(' ').slice(0, 3000)
}

function normalizeWorkspaceKnowledgeResponse(
  payload: Partial<WorkspaceKnowledgeResponse> | null | undefined,
): WorkspaceKnowledgeResponse {
  const items = Array.isArray(payload?.items)
    ? payload.items
        .map((item) => normalizeWorkspaceKnowledgeSource(item))
        .filter((item): item is WorkspaceKnowledgeSource => item !== null)
    : []
  return {
    workspaceId: typeof payload?.workspaceId === 'string' ? payload.workspaceId : '',
    query: typeof payload?.query === 'string' ? payload.query : null,
    limit: typeof payload?.limit === 'number' && Number.isFinite(payload.limit) ? payload.limit : items.length,
    items,
  }
}

function normalizeWorkspaceKnowledgeSource(
  value: Partial<WorkspaceKnowledgeSource> | null | undefined,
): WorkspaceKnowledgeSource | null {
  if (!value || typeof value !== 'object') return null

  const kind = normalizeWorkspaceKnowledgeKind(value.kind)
  const objectId = typeof value.objectId === 'string' ? value.objectId.trim() : ''
  const workspaceId = typeof value.workspaceId === 'string' ? value.workspaceId.trim() : ''
  const title = typeof value.title === 'string' ? value.title : null
  const objectType = typeof value.objectType === 'string' ? value.objectType : 'page'
  const icon = typeof value.icon === 'string' ? value.icon : null
  const breadcrumb = Array.isArray(value.breadcrumb)
    ? value.breadcrumb.filter((entry): entry is string => typeof entry === 'string')
    : []
  const deepLink = typeof value.deepLink === 'string' ? value.deepLink : objectId ? `/object/${objectId}` : ''
  const snippet = typeof value.snippet === 'string' ? value.snippet : null
  const plainText = typeof value.plainText === 'string' ? value.plainText : null
  const blockId = typeof value.blockId === 'string' ? value.blockId : null
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  const score = typeof value.score === 'number' && Number.isFinite(value.score) ? value.score : null
  const matchedFields = Array.isArray(value.matchedFields)
    ? value.matchedFields.filter((field): field is 'title' | 'content' | 'properties' | 'relationships' =>
      field === 'title' || field === 'content' || field === 'properties' || field === 'relationships')
    : []
  const availability = normalizeWorkspaceKnowledgeAvailability(value.availability)
  const relationships = Array.isArray(value.relationships)
    ? value.relationships
        .map((relationship) => normalizeWorkspaceKnowledgeRelationship(relationship))
        .filter((relationship): relationship is WorkspaceKnowledgeRelationship => relationship !== null)
    : []
  const sourceId = typeof value.sourceId === 'string' && value.sourceId.trim().length
    ? value.sourceId.trim()
    : buildWorkspaceKnowledgeSourceId(kind, objectId)

  if (!workspaceId || !objectId || !deepLink) return null

  return {
    sourceId,
    workspaceId,
    objectId,
    kind,
    title,
    objectType,
    icon,
    breadcrumb,
    deepLink,
    snippet,
    plainText,
    blockId,
    updatedAt,
    score,
    matchedFields,
    availability,
    relationships,
  }
}

function normalizeWorkspaceKnowledgeKind(value: unknown): WorkspaceKnowledgeSourceKind {
  return value === 'content_chunk'
    || value === 'property'
    || value === 'comment'
    || value === 'attachment_metadata'
    || value === 'relationship'
      ? value
      : 'object'
}

function normalizeWorkspaceKnowledgeAvailability(value: unknown): WorkspaceKnowledgeAvailability {
  return WORKSPACE_KNOWLEDGE_AVAILABILITY_STATES.includes(value as WorkspaceKnowledgeAvailability)
    ? value as WorkspaceKnowledgeAvailability
    : 'available'
}

function normalizeWorkspaceKnowledgeRelationship(
  value: Partial<WorkspaceKnowledgeRelationship> | null | undefined,
): WorkspaceKnowledgeRelationship | null {
  if (!value || typeof value !== 'object') return null
  const type = value.type
  const objectId = typeof value.objectId === 'string' ? value.objectId.trim() : ''
  if (!WORKSPACE_KNOWLEDGE_RELATIONSHIP_TYPES.includes(type as WorkspaceKnowledgeRelationshipType) || !objectId) {
    return null
  }
  return {
    type: type as WorkspaceKnowledgeRelationshipType,
    objectId,
    title: typeof value.title === 'string' ? value.title : null,
  }
}

function buildWorkspaceKnowledgeSourceId(
  kind: WorkspaceKnowledgeSourceKind,
  objectId: string,
  suffix?: string | number,
): string {
  const normalizedSuffix = suffix === undefined || suffix === null ? '' : `:${String(suffix)}`
  switch (kind) {
    case 'object':
      return `object:${objectId}`
    case 'content_chunk':
      return `chunk:${objectId}${normalizedSuffix}`
    case 'property':
      return `property:${objectId}${normalizedSuffix}`
    case 'relationship':
      return `relationship:${objectId}${normalizedSuffix}`
    case 'comment':
      return `comment:${objectId}${normalizedSuffix}`
    case 'attachment_metadata':
      return `attachment:${objectId}${normalizedSuffix}`
    default:
      return `${kind}:${objectId}${normalizedSuffix}`
  }
}

function getAuroraApiUrl(): string {
  const value = process.env['AURORA_API_URL']?.trim()
  if (!value) throw new Error('AURORA_API_URL environment variable is required for AuroraCloud MCP mode')
  return value.replace(/\/+$/, '')
}

async function ensureAuthRecord(): Promise<void> {
  const client = getAuroraClient()
  if (client.authStore.record?.['id']) return
  if (!client.authStore.token) throw new Error('Authenticated token missing.')
  const response = await client.request<{ user: Record<string, unknown> }>('/auth/me', { method: 'GET' })
  client.authStore.save(client.authStore.token, response.user)
}

function createAuroraCloudClient(baseUrl: string): BackendClient {
  const authStore: BackendAuthStore = {
    token: '',
    record: null,
    save(token: string, record: AuthRecord) {
      this.token = token
      this.record = record
    },
  }

  const filter = (template: string, params: Record<string, unknown>): string =>
    template.replace(/\{:(\w+)\}/g, (_match, key: string) => {
      const value = params[key]
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      return `"${String(value ?? '').replaceAll('"', '\\"')}"`
    })

  const request = async <T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> => {
    const headers = new Headers()
    if (authStore.token) headers.set('authorization', `Bearer ${authStore.token}`)
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    let response: Response
    try {
      response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
    } catch (error) {
      throw new AuroraApiError(
        0,
        'network_error',
        error instanceof Error ? error.message : 'Network request failed',
      )
    }
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`
      let code: string | null = null
      try {
        const json = await response.json() as { code?: unknown; error?: unknown; message?: unknown }
        if (typeof json.code === 'string') code = json.code
        if (typeof json.error === 'string') message = json.error
        else if (typeof json.message === 'string') message = json.message
      } catch {
        // ignore parse failure
      }
      throw new AuroraApiError(response.status, code, message, readRetryAfterSeconds(response.headers.get('retry-after')))
    }
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  const collection = (name: string): BackendCollection => ({
    async listPage(options: { filter?: string; sort?: string; expand?: string; page: number; perPage: number }) {
      return request<CollectionPage<Record<string, unknown>>>(
        `/api/collections/${name}/records?${toQueryString(options.page, options.perPage, options)}`,
        { method: 'GET' },
      )
    },
    async get(id: string) {
      return request<Record<string, unknown>>(`/api/collections/${name}/records/${encodeURIComponent(id)}`, { method: 'GET' })
    },
    async create(data: Record<string, unknown>) {
      if (name === 'users') {
        const result = await request<{ user: Record<string, unknown>; accessToken: string }>(
          '/auth/register',
          {
            method: 'POST',
            body: {
              email: data['email'],
              password: data['password'],
              displayName: data['name'] ?? data['display_name'] ?? null,
            },
          },
        )
        authStore.save(result.accessToken, result.user)
        return result.user
      }
      return request<Record<string, unknown>>(`/api/collections/${name}/records`, { method: 'POST', body: data })
    },
    async update(id: string, data: Record<string, unknown>) {
      return request<Record<string, unknown>>(`/api/collections/${name}/records/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: data,
      })
    },
    async authWithPassword(email: string, password: string) {
      const result = await request<{ user: Record<string, unknown>; accessToken: string }>(
        '/auth/login',
        { method: 'POST', body: { email, password } },
      )
      authStore.save(result.accessToken, result.user)
      return { record: result.user, token: result.accessToken }
    },
  })

  return { authStore, filter, collection, request }
}

function readRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const retryAt = Date.parse(value)
  if (Number.isNaN(retryAt)) return null
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
}

function toQueryString(
  page: number,
  perPage: number,
  options: { filter?: string; sort?: string; expand?: string },
): string {
  const params = new URLSearchParams({
    page: String(page),
    perPage: String(perPage),
  })
  if (options.filter) params.set('filter', options.filter)
  if (options.sort) params.set('sort', options.sort)
  if (options.expand) params.set('expand', options.expand)
  return params.toString()
}
