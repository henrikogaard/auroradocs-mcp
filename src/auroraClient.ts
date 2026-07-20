/**
 * auroraClient.ts — AuroraCloud client helpers for the MCP server.
 *
 * SECURITY: Client credentials discover only independently granted workspaces.
 * Legacy credentials verify membership in their configured default workspace.
 * Tool execution resolves a granted or verified workspace before data access.
 */
import type { AuroraConnectionContext, ContentReadResult, GrantedWorkspace } from './contracts.js'
import { AuroraApiError, ToolInputError, ToolNotFoundError } from './errors.js'
import type {
  CustomDatabaseTemplateDefault,
  ObjectTypeDef,
  ObjectTypeSchema,
  PropertyValueType,
} from './customDatabases.js'

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

export type AuroraTemplateInput = {
  workspaceId: string
  objectId?: string
  type: string
  title: string
  icon?: string | null
  body?: string
  defaults?: CustomDatabaseTemplateDefault[]
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
  updatedAt: string | null
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
  request<T = unknown>(path: string, options?: { method?: string; body?: unknown; rawBody?: BodyInit; headers?: HeadersInit }): Promise<T>
}

// ── Singleton backend instance ───────────────────────────────────────────────

let _client: BackendClient | null = null

export function resetAuroraClientForTests(): void {
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error('resetAuroraClientForTests is only available in test environments')
  }
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
export type AuthenticateOptions = {
  token?: string
  workspaceId?: string
}

export async function listGrantedWorkspaces(): Promise<GrantedWorkspace[]> {
  const response = await getAuroraClient().request<{ items?: unknown }>('/api/mcp/workspaces', { method: 'GET' })
  if (!Array.isArray(response.items)) throw new Error('Invalid granted workspace response')
  return response.items.map((item) => mapGrantedWorkspace(item))
}

export function authenticate(): Promise<void>
export function authenticate(options: AuthenticateOptions): Promise<AuroraConnectionContext>
export async function authenticate(options: AuthenticateOptions = {}): Promise<AuroraConnectionContext | void> {
  const client = getAuroraClient()
  const workspaceId = options.workspaceId ?? process.env['AURORA_WORKSPACE_ID']

  const token = options.token ?? process.env['AURORA_API_TOKEN']
  if (token) {
    client.authStore.save(token, null)
    if (token.startsWith('aur_mcp_client_')) {
      const workspaces = await listGrantedWorkspaces()
      process.stderr.write('AuroraDocs MCP authenticated.\n')
      return { kind: 'client', workspaces }
    }
    if (!workspaceId) throw new Error('AURORA_WORKSPACE_ID environment variable is required for legacy credentials')
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
    if (!workspaceId) throw new Error('AURORA_WORKSPACE_ID environment variable is required for email/password credentials')
  }

  await ensureAuthRecord()

  // Verify workspace membership
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
  return { kind: 'legacy_workspace', defaultWorkspaceId: workspaceId, workspaces: [] }
}

function mapGrantedWorkspace(value: unknown): GrantedWorkspace {
  if (!value || typeof value !== 'object') throw new Error('Invalid granted workspace')
  const item = value as Record<string, unknown>
  const fields = ['workspaceId', 'alias', 'name', 'role', 'grantId'] as const
  for (const field of fields) {
    if (typeof item[field] !== 'string' || !(item[field] as string).trim()) {
      throw new Error('Invalid granted workspace')
    }
  }
  if (!Array.isArray(item['scopes']) || !item['scopes'].every((scope) => typeof scope === 'string')) {
    throw new Error('Invalid granted workspace')
  }
  if (item['expiresAt'] !== null && (typeof item['expiresAt'] !== 'string' || !item['expiresAt'].trim())) {
    throw new Error('Invalid granted workspace')
  }
  return {
    workspaceId: item['workspaceId'] as string,
    alias: item['alias'] as string,
    name: item['name'] as string,
    role: item['role'] as string,
    scopes: [...item['scopes']] as string[],
    grantId: item['grantId'] as string,
    expiresAt: item['expiresAt'] as string | null,
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
  options: { excludeTemplates?: boolean } = {},
): Promise<CollectionPage<AuroraObjectRecord>> {
  if (!Number.isInteger(page) || page < 1) throw new ToolInputError('page must be a positive integer')
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 50) {
    throw new ToolInputError('perPage must be an integer between 1 and 50')
  }
  const client = getAuroraClient()
  const filters = ['workspace_id = {:wid}', 'is_deleted = false']
  const params: Record<string, unknown> = { wid: workspaceId }
  if (type) {
    filters.push('type = {:type}')
    params.type = type
  }
  if (options.excludeTemplates) filters.push('is_template = false')
  const filter = client.filter(filters.join(' && '), params)
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

export async function createObject(
  workspaceId: string,
  type: string,
  title: string,
  options: { id?: string; icon?: string | null; parentId?: string | null; isTemplate?: boolean } = {},
): Promise<AuroraObjectRecord> {
  const client = getAuroraClient()
  const r = await client.collection('objects').create({
    ...(options.id ? { id: options.id } : {}),
    workspace_id: workspaceId,
    type,
    title,
    ...(options.icon !== undefined ? { icon: options.icon ?? '' } : {}),
    ...(options.parentId !== undefined ? { parent_id: options.parentId ?? '' } : {}),
    is_deleted: false,
    is_template: options.isTemplate ?? false,
  })
  return mapObject(r)
}

export async function createAuroraObjectStable(
  workspaceId: string,
  input: { id: string; type: string; title: string; icon?: string | null; parentId?: string | null; isTemplate?: boolean },
): Promise<AuroraObjectRecord> {
  const existing = await getObject(input.id, workspaceId)
  if (existing) {
    if (
      existing.type !== input.type || existing.title !== input.title || existing.is_deleted
      || existing.is_template !== (input.isTemplate ?? false)
      || (input.icon !== undefined && existing.icon !== input.icon)
      || (input.parentId !== undefined && existing.parent_id !== input.parentId)
    ) throw new ToolInputError('Planned object ID already belongs to a different object')
    return existing
  }
  return createObject(workspaceId, input.type, input.title, {
    id: input.id, icon: input.icon, parentId: input.parentId, isTemplate: input.isTemplate,
  })
}

// ── Custom object types and templates ───────────────────────────────────────

function mapObjectType(record: Record<string, unknown>): ObjectTypeDef {
  const rawSchema = record['schema']
  let schema: ObjectTypeSchema[] = []
  if (Array.isArray(rawSchema)) schema = rawSchema as ObjectTypeSchema[]
  else if (typeof rawSchema === 'string' && rawSchema.trim()) {
    const parsed = JSON.parse(rawSchema) as unknown
    if (!Array.isArray(parsed)) throw new Error('Invalid object type schema response')
    schema = parsed as ObjectTypeSchema[]
  }
  return {
    id: String(record['id'] ?? ''),
    workspace_id: String(record['workspace_id'] ?? ''),
    name: String(record['name'] ?? ''),
    icon: typeof record['icon'] === 'string' && record['icon'] ? record['icon'] : null,
    color: typeof record['color'] === 'string' && record['color'] ? record['color'] : null,
    schema,
    created_at: String(record['created_at'] ?? record['created'] ?? ''),
    updated_at: String(record['updated_at'] ?? record['updated'] ?? ''),
  }
}

export async function listAuroraObjectTypes(workspaceId: string): Promise<ObjectTypeDef[]> {
  const client = getAuroraClient()
  const filter = client.filter('workspace_id = {:wid}', { wid: workspaceId })
  const output: ObjectTypeDef[] = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await client.collection('object_types').listPage({ filter, sort: 'created_at', page, perPage: 50 })
    const mapped = response.items.map(mapObjectType)
    if (mapped.some((entry) => entry.workspace_id !== workspaceId)) throw new Error('Object type lookup returned a foreign workspace record')
    output.push(...mapped)
    if (!response.totalPages || page >= response.totalPages) break
    if (page === 100) throw new Error('Object type lookup exceeded its safety page limit')
  }
  return output
}

export async function createAuroraObjectType(
  workspaceId: string,
  input: { id: string; name: string; icon: string | null; color: string | null; schema: ObjectTypeSchema[] },
): Promise<ObjectTypeDef> {
  const record = await getAuroraClient().collection('object_types').create({
    id: input.id,
    workspace_id: workspaceId,
    name: input.name,
    icon: input.icon ?? '',
    color: input.color ?? '',
    schema: input.schema,
  })
  const created = mapObjectType(record)
  if (created.workspace_id !== workspaceId || created.id !== input.id) throw new Error('Object type writer returned an invalid record')
  return created
}

export async function updateAuroraObjectType(
  workspaceId: string,
  id: string,
  changes: { name?: string; icon?: string | null; color?: string | null; schema?: ObjectTypeSchema[] },
): Promise<ObjectTypeDef> {
  const client = getAuroraClient()
  const existing = mapObjectType(await client.collection('object_types').get(id))
  if (existing.workspace_id !== workspaceId) throw new ToolNotFoundError(`Object type ${id} not found in this workspace`)
  const body: Record<string, unknown> = {}
  if (changes.name !== undefined) body['name'] = changes.name
  if (changes.icon !== undefined) body['icon'] = changes.icon ?? ''
  if (changes.color !== undefined) body['color'] = changes.color ?? ''
  if (changes.schema !== undefined) body['schema'] = changes.schema
  const updated = mapObjectType(await client.collection('object_types').update(id, body))
  if (updated.workspace_id !== workspaceId || updated.id !== id) throw new Error('Object type writer returned an invalid record')
  return updated
}

export async function listAuroraTemplates(workspaceId: string, type?: string): Promise<AuroraObjectRecord[]> {
  return (await listAuroraTemplatesPage(workspaceId, type)).items
}

export async function listAuroraTemplatesPage(
  workspaceId: string,
  type?: string,
): Promise<CollectionPage<AuroraObjectRecord>> {
  const client = getAuroraClient()
  const filter = type
    ? client.filter('workspace_id = {:wid} && is_deleted = false && is_template = true && type = {:type}', { wid: workspaceId, type })
    : client.filter('workspace_id = {:wid} && is_deleted = false && is_template = true', { wid: workspaceId })
  const page = await client.collection('objects').listPage({ filter, sort: '-updated_at', page: 1, perPage: 50 })
  return { ...page, items: page.items.map(mapObject) }
}

function propertyValueField(valueType: PropertyValueType): keyof Pick<AuroraPropertyRecord, 'value_text' | 'value_num' | 'value_date' | 'value_bool' | 'value_ref'> {
  if (valueType === 'number' || valueType === 'progress') return 'value_num'
  if (valueType === 'date') return 'value_date'
  if (valueType === 'boolean') return 'value_bool'
  if (valueType === 'relation' || valueType === 'person' || valueType === 'file') return 'value_ref'
  return 'value_text'
}

export async function upsertAuroraPropertyStable(
  objectId: string,
  workspaceId: string,
  key: string,
  valueType: PropertyValueType,
  value: string | number | boolean | null,
): Promise<void> {
  const object = await getObject(objectId, workspaceId)
  if (!object) throw new ToolNotFoundError(`Object ${objectId} not found in this workspace`)
  if ((valueType === 'relation' || valueType === 'person') && value !== null) {
    const target = await getObject(String(value), workspaceId)
    if (!target) throw new ToolInputError(`Template property "${key}" references an object outside this workspace`)
  }
  const client = getAuroraClient()
  const existing = await client.collection('object_properties').listPage({
    filter: client.filter('object_id = {:oid} && key = {:key}', { oid: objectId, key }),
    page: 1,
    perPage: 1,
  })
  const fieldName = propertyValueField(valueType)
  const storedValue = (valueType === 'multi_select' && typeof value === 'string' && !value.startsWith('['))
    ? JSON.stringify(value.split(',').map((entry) => entry.trim()).filter(Boolean))
    : value
  const body = {
    value_type: valueType,
    value_text: null,
    value_num: null,
    value_date: null,
    value_bool: null,
    value_ref: null,
    [fieldName]: storedValue,
  }
  if (existing.items[0]?.['id']) await client.collection('object_properties').update(String(existing.items[0]['id']), body)
  else await client.collection('object_properties').create({ object_id: objectId, key, ...body })
}

function plainTextDocument(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  }
}

export async function createAuroraTemplate(input: AuroraTemplateInput): Promise<AuroraObjectRecord> {
  const title = input.title.trim()
  if (!title || title.length > 200) throw new ToolInputError('Template title must be 1-200 characters')
  if ((input.body?.length ?? 0) > 100_000) throw new ToolInputError('Template body is too large')
  let schema: ObjectTypeSchema[] = []
  if (input.type.startsWith('custom:')) {
    const typeId = input.type.slice('custom:'.length)
    const target = (await listAuroraObjectTypes(input.workspaceId)).find((entry) => entry.id === typeId)
    if (!target) throw new ToolInputError('Template custom object type does not exist in this workspace')
    schema = target.schema
  }
  const fields = new Map(schema.map((fieldValue) => [fieldValue.key, fieldValue]))
  for (const value of input.defaults ?? []) {
    const field = fields.get(value.key)
    if (input.type.startsWith('custom:') && (!field || field.value_type !== value.valueType)) {
      throw new ToolInputError(`Template default "${value.key}" is not declared with the matching value type`)
    }
  }
  let object = input.objectId ? await getObject(input.objectId, input.workspaceId) : null
  if (object && (
    object.type !== input.type || object.title !== title || object.is_deleted || !object.is_template
    || (input.icon !== undefined && object.icon !== input.icon)
  )) {
    throw new ToolInputError('Planned template ID already belongs to a different object')
  }
  object ??= await createObject(input.workspaceId, input.type, title, {
    id: input.objectId,
    icon: input.icon,
    isTemplate: true,
  })
  if (!object.is_template) throw new Error('Template writer did not create a template object')
  if (input.body !== undefined) await setContent(object.id, input.workspaceId, plainTextDocument(input.body))
  for (const value of input.defaults ?? []) {
    await upsertAuroraPropertyStable(object.id, input.workspaceId, value.key, value.valueType, value.value)
  }
  return object
}

function propertyRecordValue(record: AuroraPropertyRecord): string | number | boolean | null {
  return record.value_text ?? record.value_num ?? record.value_date ?? record.value_bool ?? record.value_ref
}

export async function createAuroraObjectFromTemplate(
  workspaceId: string,
  templateId: string,
  objectId?: string,
): Promise<string> {
  const template = await getObject(templateId, workspaceId)
  if (!template || template.is_deleted || !template.is_template) throw new ToolNotFoundError('Template is not available in this workspace')
  let schema: ObjectTypeSchema[] = []
  if (template.type.startsWith('custom:')) {
    const objectType = (await listAuroraObjectTypes(workspaceId)).find((entry) => entry.id === template.type.slice('custom:'.length))
    if (!objectType) throw new ToolInputError('Template custom object type no longer exists')
    schema = objectType.schema
  }
  const allowedFields = new Map(schema.map((fieldValue) => [fieldValue.key, fieldValue]))
  const [content, properties] = await Promise.all([
    getContentJson(templateId, workspaceId),
    listProperties([templateId], workspaceId),
  ])
  let created = objectId ? await getObject(objectId, workspaceId) : null
  if (created && (
    created.type !== template.type || created.title !== template.title || created.is_deleted || created.is_template
  )) throw new ToolInputError('Planned object ID already belongs to a different object')
  created ??= await createObject(workspaceId, template.type, template.title ?? 'Untitled', {
    id: objectId,
    icon: template.icon,
  })
  if (content) await setContent(created.id, workspaceId, content)
  for (const property of properties) {
    const declared = allowedFields.get(property.key)
    if (template.type.startsWith('custom:') && (!declared || declared.value_type !== property.value_type)) continue
    const valueType = property.value_type as PropertyValueType
    const value = propertyRecordValue(property)
    if (value !== null) await upsertAuroraPropertyStable(created.id, workspaceId, property.key, valueType, value)
  }
  return created.id
}

export async function setAuroraContentStable(
  workspaceId: string,
  objectId: string,
  content: Record<string, unknown>,
): Promise<void> {
  await setContent(objectId, workspaceId, content)
}

export type AuroraImportCapabilities = {
  workspaceId: string
  role: string
  scopes: string[]
  e2ee: { enabled: boolean; importBlocked: boolean; reason: string | null }
  upload: { maxBytes: number; mimePolicy: unknown; limitBytes: number; usedBytes: number; remainingBytes: number }
  storage: { available: boolean; backend: string }
}

export async function getAuroraImportCapabilities(workspaceId: string): Promise<AuroraImportCapabilities> {
  const response = await getAuroraClient().request<Partial<AuroraImportCapabilities>>(
    `/api/mcp/workspaces/${encodeURIComponent(workspaceId)}/import-capabilities`,
    { method: 'GET' },
  )
  if (
    response.workspaceId !== workspaceId || typeof response.role !== 'string' || !Array.isArray(response.scopes)
    || !response.scopes.every((scope) => typeof scope === 'string')
    || !response.e2ee || typeof response.e2ee.importBlocked !== 'boolean'
    || !response.upload || typeof response.upload.maxBytes !== 'number' || typeof response.upload.remainingBytes !== 'number'
    || !response.storage || typeof response.storage.available !== 'boolean'
  ) throw new Error('Invalid AuroraCloud import capability response')
  return response as AuroraImportCapabilities
}

export type AuroraAttachmentUpload = {
  id: string
  workspaceId: string
  objectId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
}

export async function uploadAuroraMcpAttachment(input: {
  workspaceId: string
  objectId: string
  fileName: string
  mimeType: string
  bytes: Buffer
  idempotencyKey: string
}): Promise<AuroraAttachmentUpload> {
  const fileName = input.fileName.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 240) || 'attachment.bin'
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType || 'application/octet-stream' }), fileName)
  const response = await getAuroraClient().request<Partial<AuroraAttachmentUpload>>(
    `/api/mcp/workspaces/${encodeURIComponent(input.workspaceId)}/objects/${encodeURIComponent(input.objectId)}/attachments`,
    { method: 'POST', rawBody: form, headers: { 'idempotency-key': input.idempotencyKey } },
  )
  if (
    response.workspaceId !== input.workspaceId || response.objectId !== input.objectId
    || typeof response.id !== 'string' || typeof response.fileName !== 'string'
    || typeof response.mimeType !== 'string' || response.sizeBytes !== input.bytes.length || typeof response.url !== 'string'
  ) throw new Error('Invalid AuroraCloud attachment upload response')
  return response as AuroraAttachmentUpload
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

export async function restoreObject(id: string, workspaceId: string): Promise<boolean> {
  const obj = await getObject(id, workspaceId)
  if (!obj) throw new ToolNotFoundError(`Object ${id} not found in this workspace`)
  if (!obj.is_deleted) return false
  await getAuroraClient().collection('objects').update(id, { is_deleted: false })
  return true
}

// ── Content ──────────────────────────────────────────────────────────────────

/** Sentinel returned by getContent when content is E2EE-encrypted. */
export const E2EE_LOCKED_SENTINEL = '<<E2EE_LOCKED>>'

function isE2eeEncryptedPayload(json: unknown): boolean {
  return typeof json === 'string' && (json.startsWith('v1:') || json.startsWith('v2:'))
}

/**
 * Read an object's content as plain text.
 *
 * Returns distinct availability states:
 *   - `not_found` — the object does not exist in this workspace
 *   - `empty` — the object exists but has no content record or empty content
 *   - `encrypted_locked` — content is end-to-end encrypted (cannot be read)
 *   - `permission_denied` — the token lacks `read:content` scope
 *   - `available` — content was read successfully
 */
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
  if (existing.items.length > 0 && isE2eeEncryptedPayload(existing.items[0]['content_json'])) {
    throw new ToolInputError('Object content is end-to-end encrypted and cannot be modified by the MCP server')
  }
  if (existing.items.length > 0) {
    await client.collection('content').update(String(existing.items[0].id), { content_json: contentJson })
  } else {
    await client.collection('content').create({ object_id: objectId, content_json: contentJson })
  }
}

/**
 * Check whether an object's content is E2EE-encrypted, without fetching the
 * full content payload. Returns `null` if the object or its content record
 * is missing. Used to pre-check before mixed write operations (e.g. updating
 * both title and content) so the operation fails atomically instead of
 * leaving a half-applied update.
 */
export async function getObjectE2eeStatus(objectId: string, workspaceId: string): Promise<boolean | null> {
  const obj = await getObject(objectId, workspaceId)
  if (!obj) return null
  const client = getAuroraClient()
  try {
    const records = await client.collection('content').listPage({
      filter: client.filter('object_id = {:id}', { id: objectId }),
      page: 1,
      perPage: 1,
    })
    const r = records.items[0]
    if (!r) return null
    return isE2eeEncryptedPayload(r['content_json'])
  } catch (error) {
    if (error instanceof AuroraApiError && error.status === 404) return null
    throw error
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

export async function listProperties(
  objectIds: string[],
  workspaceId: string,
  options: { maxPages?: number } = {},
): Promise<AuroraPropertyRecord[]> {
  if (!objectIds.length) return []
  const maxPages = options.maxPages ?? 10
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new ToolInputError('maxPages must be a positive integer')
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

    for (let page = 1; page <= maxPages; page += 1) {
      const records = await client.collection('object_properties').listPage({ filter, page, perPage: 50 })
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
      if (!records.totalPages || page >= records.totalPages) break
      if (page === maxPages) {
        throw new ToolInputError(`Property collection exceeded the ${maxPages}-page safety limit`)
      }
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
    valueType === 'boolean' ? parseBooleanValue(value) :
    value

  if (existing.items.length > 0) {
    await client.collection('object_properties').update(String(existing.items[0].id), {
      value_type: valueType,
      value_text: null,
      value_num: null,
      value_date: null,
      value_bool: null,
      value_ref: null,
      [valueField]: parsedValue,
    })
  } else {
    await client.collection('object_properties').create({ object_id: objectId, key, value_type: valueType, [valueField]: parsedValue })
  }
}

function parseBooleanValue(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  return false
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

export async function listTaskStatuses(): Promise<string[]> {
  // Task statuses are defined in the schema, not per-workspace.
  // Returns the standard set; custom workspace statuses may not appear.
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
  return propsToTaskProps(props, objectId)
}

function propsToTaskProps(props: AuroraPropertyRecord[], objectId: string): AuroraTaskProps {
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
  options: { existingObject?: AuroraObjectRecord } = {},
): Promise<void> {
  const obj = options.existingObject ?? await getObject(objectId, workspaceId)
  if (!obj) throw new ToolNotFoundError(`Object ${objectId} not found in this workspace`)
  if (obj.type !== 'task') throw new ToolInputError(`${objectId} is not a task`)

  const client = getAuroraClient()

  // Collect the (key, valueType, value) triples to write.
  // undefined => skip, null/'' => clear (set value field to null), otherwise => set
  type Triple = { key: string; valueType: string; value: string | number | boolean | null }
  const triples: Triple[] = []
  if (patch.status !== undefined) triples.push({ key: 'status', valueType: 'text', value: patch.status })
  if (patch.priority !== undefined) triples.push({ key: 'priority', valueType: 'text', value: patch.priority })
  if (patch.due_date !== undefined) triples.push({ key: 'due_date', valueType: 'date', value: patch.due_date })
  if (patch.description !== undefined) triples.push({ key: 'description', valueType: 'text', value: patch.description })
  if (patch.task_list_id !== undefined) triples.push({ key: 'task_list_id', valueType: 'ref', value: patch.task_list_id })
  if (patch.assignees !== undefined) triples.push({ key: 'assignees', valueType: 'text', value: JSON.stringify(patch.assignees) })
  if (patch.labels !== undefined) triples.push({ key: 'labels', valueType: 'text', value: JSON.stringify(patch.labels) })

  if (!triples.length) return

  // Batch: fetch all existing properties for this object in one request, then
  // partition by key. This avoids one list request per field (N+1 within a
  // single update_task call).
  const existing = await listProperties([objectId], workspaceId, { maxPages: 100 })
  const existingByKey = new Map<string, string>()
  for (const record of existing) {
    const key = record.key
    if (key && !existingByKey.has(key)) {
      existingByKey.set(key, record.id)
    }
  }

  for (const { key, valueType, value } of triples) {
    const isClearing = value === null || value === ''
    const valueField =
      valueType === 'number' ? 'value_num' :
      valueType === 'date' ? 'value_date' :
      valueType === 'boolean' ? 'value_bool' :
      valueType === 'ref' ? 'value_ref' :
      'value_text'
    const existingId = existingByKey.get(key)
    if (existingId) {
      if (isClearing) {
        await client.collection('object_properties').update(existingId, {
          value_type: valueType,
          value_text: null,
          value_num: null,
          value_date: null,
          value_bool: null,
          value_ref: null,
        })
      } else {
        await client.collection('object_properties').update(existingId, { value_type: valueType, [valueField]: value })
      }
    } else if (!isClearing) {
      await client.collection('object_properties').create({ object_id: objectId, key, value_type: valueType, [valueField]: value })
    }
    // If clearing and no existing record, there is nothing to clear.
  }
}

// ── Planning helpers ─────────────────────────────────────────────────────────

export type AuroraPlanningTask = AuroraTaskProps & {
  id: string
  title: string | null
  updated_at: string | null
}

/** Maximum number of tasks listPlanningTasks will fetch + hydrate. */
export const PLANNING_TASKS_MAX = 500

export async function listPlanningTasks(workspaceId: string): Promise<AuroraPlanningTask[]> {
  // Cap at PLANNING_TASKS_MAX to avoid pulling an unbounded task list + the
  // associated property hydration cost. list_week_plan's description documents
  // this ceiling.
  const tasks: AuroraObjectRecord[] = []
  for (let page = 1; tasks.length < PLANNING_TASKS_MAX; page += 1) {
    const result = await listObjectsPage(workspaceId, 'task', page, 50, { excludeTemplates: true })
    tasks.push(...result.items)
    if (!result.totalPages || page >= result.totalPages || result.items.length === 0) break
  }
  const capped = tasks.slice(0, PLANNING_TASKS_MAX)
  if (!capped.length) return []
  // Batch: fetch all task properties in one batched request instead of N+1.
  const taskIds = capped.map((task) => task.id)
  const allProps = await listProperties(taskIds, workspaceId, { maxPages: 100 })
  const propsByObject = new Map<string, AuroraPropertyRecord[]>()
  for (const prop of allProps) {
    const list = propsByObject.get(prop.object_id) ?? []
    list.push(prop)
    propsByObject.set(prop.object_id, list)
  }
  return capped.map((task) => {
    const props = propsByObject.get(task.id) ?? []
    return {
      id: task.id,
      title: task.title,
      updated_at: task.updated_at,
      ...propsToTaskProps(props, task.id),
    }
  })
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
    icon: typeof r['icon'] === 'string' && r['icon'] ? r['icon'] : null,
    parent_id: typeof r['parent_id'] === 'string' && r['parent_id'] ? r['parent_id'] : null,
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
  const full = parts.join(' ')
  if (full.length <= 3000) return full
  // Append a visible truncation marker so callers can tell the content was cut.
  return `${full.slice(0, 3000)}… (truncated)`
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
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : null
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

/** Read the request timeout from env. Default 30s. 0 disables. */
function readRequestTimeoutMs(): number {
  const raw = process.env['AURORA_REQUEST_TIMEOUT_MS']?.trim()
  if (!raw) return 30000
  const ms = Number(raw)
  if (!Number.isFinite(ms) || ms < 0) return 30000
  return Math.ceil(ms)
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
      // Escape backslashes first, then double quotes, to prevent filter injection.
      return `"${String(value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
    })

  const request = async <T = unknown>(path: string, options: { method?: string; body?: unknown; rawBody?: BodyInit; headers?: HeadersInit } = {}): Promise<T> => {
    const headers = new Headers(options.headers)
    if (authStore.token) headers.set('authorization', `Bearer ${authStore.token}`)
    if (options.body !== undefined && options.rawBody !== undefined) throw new Error('Request cannot contain JSON and raw bodies together')
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    const timeoutMs = readRequestTimeoutMs()
    let response: Response
    try {
      response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
        signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new AuroraApiError(0, 'timeout', `Request timed out after ${timeoutMs}ms`)
      }
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
