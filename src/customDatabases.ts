import { createHash, randomBytes } from 'node:crypto'

export const CUSTOM_DATABASE_CONTRACT_VERSION = 1 as const
export const CUSTOM_DATABASE_PLAN_TTL_MS = 30 * 60 * 1000

export type PropertyValueType =
  | 'text' | 'number' | 'progress' | 'date' | 'boolean' | 'relation'
  | 'select' | 'multi_select' | 'url' | 'email' | 'phone' | 'file'
  | 'person' | 'location' | 'formula'

export type ObjectTypeSchema = {
  key: string
  label: string
  value_type: PropertyValueType
  required: boolean
  storageType?: string
  sensitive?: boolean
  options?: string[]
  targetType?: string
  formula?: string
}

export type ObjectTypeDef = {
  id: string
  workspace_id: string
  name: string
  icon: string | null
  color: string | null
  schema: ObjectTypeSchema[]
  created_at: string
  updated_at?: string
}

export type CustomDatabaseRecipeId = 'contacts' | 'interests' | 'equipment' | 'subscriptions' | 'expenses'
export type CustomDatabaseTemplateDefault = {
  key: string
  valueType: PropertyValueType
  value: string | number | boolean | null
}
export type CustomDatabaseTemplateDefinition = {
  title: string
  icon?: string | null
  body?: string
  defaults?: CustomDatabaseTemplateDefault[]
}
export type CustomDatabaseTemplatePlan = CustomDatabaseTemplateDefinition & { objectId: string }
export type CustomDatabaseRecipe = {
  id: CustomDatabaseRecipeId
  name: string
  description: string
  icon: string
  color: string
  schema: ObjectTypeSchema[]
  template?: CustomDatabaseTemplateDefinition
}
export type CustomDatabasePlanSource = { kind: 'recipe' | 'free_form' | 'obsidian'; value: string }
export type CustomDatabasePlanOperation =
  | { kind: 'create'; objectTypeId: string }
  | { kind: 'update'; objectTypeId: string }
  | { kind: 'reuse'; objectTypeId: string }
export type CustomDatabasePlanMatch = {
  objectTypeId: string
  name: string
  compatibility: 'exact' | 'additive' | 'conflict'
  explanation: string
}
export type CustomDatabasePlan = {
  contractVersion: typeof CUSTOM_DATABASE_CONTRACT_VERSION
  planId: string
  planHash: string
  workspaceId: string
  source: CustomDatabasePlanSource
  name: string
  icon: string | null
  color: string | null
  schema: ObjectTypeSchema[]
  template: CustomDatabaseTemplatePlan | null
  matches: CustomDatabasePlanMatch[]
  assumptions: string[]
  warnings: string[]
  operation: CustomDatabasePlanOperation
  requiresConfirmation: true
  createdAt: string
  expiresAt: string
}

type BuildPlanInput = {
  workspaceId: string
  name: string
  icon?: string | null
  color?: string | null
  schema: ObjectTypeSchema[]
  template?: CustomDatabaseTemplateDefinition | null
  source: CustomDatabasePlanSource
  existingTypes: ObjectTypeDef[]
  assumptions?: string[]
  warnings?: string[]
  ids?: { planId?: string; objectTypeId?: string; templateObjectId?: string }
  now?: string
  expiresAt?: string
}

const VALUE_TYPES = new Set<PropertyValueType>([
  'text', 'number', 'progress', 'date', 'boolean', 'relation', 'select', 'multi_select',
  'url', 'email', 'phone', 'file', 'person', 'location', 'formula',
])
const BUILTIN_RELATION_TARGETS = new Set([
  'page', 'note', 'daily', 'task', 'database', 'collection', 'canvas', 'bookmark', 'file',
  'space', 'people', 'meetings', 'trips', 'projects', 'images', 'quotes', 'links', 'backlog',
  'research_project', 'research_source', 'research_session', 'research_artifact', 'research_image',
  'habit', 'transaction', 'site',
])

function field(key: string, label: string, valueType: PropertyValueType, options: Partial<ObjectTypeSchema> = {}): ObjectTypeSchema {
  return { key, label, value_type: valueType, required: false, ...options }
}

export const CUSTOM_DATABASE_RECIPES: CustomDatabaseRecipe[] = [
  {
    id: 'contacts', name: 'Contacts', icon: '👤', color: '#3b82f6',
    description: 'Track people, contact details, relationships, and follow-up history.',
    schema: [
      field('email', 'Email', 'email'), field('phone', 'Phone', 'phone'),
      field('company', 'Company', 'text'), field('role', 'Role', 'text'),
      field('last_contacted', 'Last contacted', 'date'),
      field('relationship', 'Relationship', 'select', { options: ['Personal', 'Professional', 'Other'] }),
      field('status', 'Status', 'select', { options: ['Active', 'Follow up', 'Archived'] }),
      field('tags', 'Tags', 'multi_select', { options: ['Important'] }),
    ],
    template: { title: 'New contact', body: '## Notes\n\n## Follow-up' },
  },
  {
    id: 'interests', name: 'Interests', icon: '💡', color: '#f59e0b',
    description: 'Track topics to explore, sources, priority, and a next action.',
    schema: [
      field('status', 'Status', 'select', { options: ['Inbox', 'Exploring', 'Active', 'Paused', 'Done'] }),
      field('rating', 'Rating', 'number'), field('source_url', 'Source URL', 'url'),
      field('next_action', 'Next action', 'text'),
      field('tags', 'Tags', 'multi_select', { options: ['Research'] }),
    ],
    template: { title: 'New interest', body: '## Why this matters\n\n## Next action' },
  },
  {
    id: 'equipment', name: 'Equipment', icon: '🧰', color: '#64748b',
    description: 'Track gear, ownership details, condition, location, and warranty dates.',
    schema: [
      field('category', 'Category', 'select', { options: ['Electronics', 'Tools', 'Outdoor', 'Other'] }),
      field('brand', 'Brand', 'text'), field('model', 'Model', 'text'),
      field('serial_number', 'Serial number', 'text', { sensitive: true }),
      field('purchase_date', 'Purchase date', 'date'), field('purchase_price', 'Purchase price', 'number'),
      field('condition', 'Condition', 'select', { options: ['New', 'Good', 'Fair', 'Needs repair', 'Retired'] }),
      field('location', 'Location', 'location'), field('warranty_expiry', 'Warranty expiry', 'date'),
    ],
    template: { title: 'New equipment', body: '## Notes\n\n## Maintenance history' },
  },
  {
    id: 'subscriptions', name: 'Subscriptions', icon: '🔁', color: '#8b5cf6',
    description: 'Track recurring costs, renewal dates, categories, and cancellation details.',
    schema: [
      field('price', 'Price', 'number'),
      field('currency', 'Currency', 'select', { options: ['NOK', 'EUR', 'USD', 'GBP', 'SEK', 'DKK'] }),
      field('billing_cycle', 'Billing cycle', 'select', { options: ['Monthly', 'Quarterly', 'Yearly', 'Other'] }),
      field('next_renewal', 'Next renewal', 'date'),
      field('category', 'Category', 'select', { options: ['Software', 'Media', 'Utilities', 'Membership', 'Other'] }),
      field('status', 'Status', 'select', { options: ['Active', 'Trial', 'Paused', 'Cancelled'] }),
      field('cancellation_url', 'Cancellation URL', 'url'),
    ],
    template: { title: 'New subscription', body: '## Notes\n\n## Cancellation details' },
  },
  {
    id: 'expenses', name: 'Expenses', icon: '🧾', color: '#10b981',
    description: 'Track spending, categories, receipts, and reimbursement state.',
    schema: [
      field('amount', 'Amount', 'number', { required: true }),
      field('currency', 'Currency', 'select', { options: ['NOK', 'EUR', 'USD', 'GBP', 'SEK', 'DKK'] }),
      field('date', 'Date', 'date', { required: true }),
      field('category', 'Category', 'select', { options: ['Travel', 'Meals', 'Equipment', 'Software', 'Other'] }),
      field('reimbursable', 'Reimbursable', 'boolean'),
      field('reimbursement_status', 'Reimbursement status', 'select', { options: ['Not applicable', 'To submit', 'Submitted', 'Paid'] }),
      field('receipt', 'Receipt', 'file'),
    ],
    template: { title: 'New expense', defaults: [{ key: 'reimbursable', valueType: 'boolean', value: false }] },
  },
]

export function newAuroraId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = randomBytes(15)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

export function normalizeSchemaKey(input: string): string {
  const value = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_')
  if (!value) throw new Error('Schema key must contain letters or numbers')
  return /^\d/.test(value) ? `field_${value}` : value
}

function cloneField(value: ObjectTypeSchema): ObjectTypeSchema {
  return {
    key: value.key, label: value.label, value_type: value.value_type, required: value.required,
    ...(value.storageType !== undefined ? { storageType: value.storageType } : {}),
    ...(value.sensitive !== undefined ? { sensitive: value.sensitive } : {}),
    ...(value.options ? { options: [...value.options] } : {}),
    ...(value.targetType !== undefined ? { targetType: value.targetType } : {}),
    ...(value.formula !== undefined ? { formula: value.formula } : {}),
  }
}

export function validateCustomDatabaseSchema(
  schema: ObjectTypeSchema[],
  options: { existingTypes?: ObjectTypeDef[]; selfTargetType?: string } = {},
): ObjectTypeSchema[] {
  if (!Array.isArray(schema)) throw new Error('Schema must be an array')
  if (schema.length > 64) throw new Error('Schema may contain at most 64 properties')
  const keys = new Set<string>()
  const customTargets = new Set((options.existingTypes ?? []).map((entry) => `custom:${entry.id}`))
  return schema.map((input, index) => {
    if (!input || typeof input !== 'object') throw new Error(`Schema property ${index + 1} is invalid`)
    const key = normalizeSchemaKey(String(input.key ?? ''))
    if (key.length > 64) throw new Error(`Schema key "${key}" is too long`)
    if (keys.has(key)) throw new Error(`Duplicate schema key after normalization: ${key}`)
    keys.add(key)
    const label = String(input.label ?? '').trim()
    if (!label || label.length > 120) throw new Error(`Schema label for "${key}" must be 1-120 characters`)
    if (!VALUE_TYPES.has(input.value_type)) throw new Error(`Unsupported value type for "${key}"`)
    if (typeof input.required !== 'boolean') throw new Error(`Schema property "${key}" must declare required`)
    const next = { ...cloneField(input), key, label }
    if (input.options !== undefined) {
      if (input.value_type !== 'select' && input.value_type !== 'multi_select') {
        throw new Error(`Options are only supported for select properties (${key})`)
      }
      if (!Array.isArray(input.options) || input.options.length < 1 || input.options.length > 100) {
        throw new Error(`Select property "${key}" must have 1-100 options`)
      }
      const seen = new Set<string>()
      next.options = input.options.map((raw) => {
        const option = String(raw).trim()
        if (!option || option.length > 100) throw new Error(`Select options for "${key}" must be bounded text`)
        const normalized = option.toLocaleLowerCase()
        if (seen.has(normalized)) throw new Error(`Select options for "${key}" must be unique`)
        seen.add(normalized)
        return option
      })
    } else if (input.value_type === 'select' || input.value_type === 'multi_select') {
      throw new Error(`Select property "${key}" requires options`)
    }
    if (input.value_type === 'formula') {
      const formula = input.formula?.trim()
      if (!formula || formula.length > 1_000) throw new Error(`Formula property "${key}" requires a bounded formula`)
      next.formula = formula
    } else if (input.formula !== undefined) {
      throw new Error(`Formula is only supported for formula properties (${key})`)
    }
    if (input.value_type === 'relation') {
      let target = input.targetType?.trim()
      if (target === 'self') target = options.selfTargetType
      if (!target) throw new Error(`Relation target for "${key}" is required`)
      if (options.existingTypes && !BUILTIN_RELATION_TARGETS.has(target) && target !== options.selfTargetType && !customTargets.has(target)) {
        throw new Error(`Relation target for "${key}" does not resolve: ${target}`)
      }
      next.targetType = target
    } else if (input.targetType !== undefined) {
      throw new Error(`Relation target is only supported for relation properties (${key})`)
    }
    return next
  })
}

export function validateAdditiveObjectTypePatch(currentSchema: ObjectTypeSchema[], nextSchema: ObjectTypeSchema[]): ObjectTypeSchema[] {
  const current = validateCustomDatabaseSchema(currentSchema)
  const next = validateCustomDatabaseSchema(nextSchema)
  const nextByKey = new Map(next.map((fieldValue) => [fieldValue.key, fieldValue]))
  const currentKeys = new Set(current.map((fieldValue) => fieldValue.key))
  for (const fieldValue of current) {
    const replacement = nextByKey.get(fieldValue.key)
    if (!replacement) throw new Error(`Additive schema updates cannot remove property "${fieldValue.key}"`)
    if (replacement.value_type !== fieldValue.value_type) throw new Error(`Additive schema updates cannot change the value type of "${fieldValue.key}"`)
    if (fieldValue.required !== replacement.required) throw new Error(`Additive schema updates cannot change requiredness for "${fieldValue.key}"`)
    if ((replacement.storageType ?? null) !== (fieldValue.storageType ?? null)) throw new Error(`Additive schema updates cannot change storage mapping for "${fieldValue.key}"`)
    if ((replacement.targetType ?? null) !== (fieldValue.targetType ?? null)) throw new Error(`Additive schema updates cannot retarget relation "${fieldValue.key}"`)
    if ((replacement.sensitive ?? false) !== (fieldValue.sensitive ?? false)) throw new Error(`Additive schema updates cannot change sensitive metadata for "${fieldValue.key}"`)
    const nextOptions = new Set((replacement.options ?? []).map((option) => option.toLocaleLowerCase()))
    for (const option of fieldValue.options ?? []) {
      if (!nextOptions.has(option.toLocaleLowerCase())) throw new Error(`Additive schema updates cannot remove select option "${option}"`)
    }
  }
  for (const fieldValue of next) {
    if (!currentKeys.has(fieldValue.key) && fieldValue.required) throw new Error(`Additive schema updates cannot add required property "${fieldValue.key}"`)
  }
  return next
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]))
  }
  return value
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function hashPayload(plan: Omit<CustomDatabasePlan, 'planHash'> | CustomDatabasePlan): Record<string, unknown> {
  return {
    contractVersion: plan.contractVersion, planId: plan.planId, workspaceId: plan.workspaceId,
    source: plan.source, name: plan.name, icon: plan.icon, color: plan.color, schema: plan.schema,
    template: plan.template, operation: plan.operation, requiresConfirmation: plan.requiresConfirmation,
    expiresAt: plan.expiresAt,
  }
}

export function hashCustomDatabasePlan(plan: Omit<CustomDatabasePlan, 'planHash'> | CustomDatabasePlan): string {
  return createHash('sha256').update(canonicalStringify(hashPayload(plan))).digest('hex')
}

function dateMillis(value: string, label: string): number {
  const result = Date.parse(value)
  if (!Number.isFinite(result)) throw new Error(`${label} must be an ISO timestamp`)
  return result
}

function normalizeTemplate(value: CustomDatabaseTemplateDefinition | null | undefined, objectId: string, schema: ObjectTypeSchema[]): CustomDatabaseTemplatePlan | null {
  if (!value) return null
  const title = value.title.trim()
  if (!title || title.length > 200) throw new Error('Template title must be 1-200 characters')
  if ((value.body?.length ?? 0) > 100_000) throw new Error('Template body is too large')
  if ((value.defaults?.length ?? 0) > 64) throw new Error('Template may contain at most 64 defaults')
  const fields = new Map(schema.map((fieldValue) => [fieldValue.key, fieldValue]))
  const keys = new Set<string>()
  const defaults = value.defaults?.map((entry) => {
    const key = normalizeSchemaKey(entry.key)
    if (keys.has(key)) throw new Error(`Duplicate template default key: ${key}`)
    keys.add(key)
    const fieldValue = fields.get(key)
    if (!fieldValue || fieldValue.value_type !== entry.valueType) throw new Error(`Template default "${key}" has the wrong value type`)
    if (entry.valueType === 'formula') throw new Error(`Template default "${key}" cannot set a formula result`)
    return { key, valueType: entry.valueType, value: entry.value }
  })
  return {
    objectId, title,
    ...(value.icon !== undefined ? { icon: value.icon } : {}),
    ...(value.body !== undefined ? { body: value.body } : {}),
    ...(defaults ? { defaults } : {}),
  }
}

function schemasEqual(left: ObjectTypeSchema[], right: ObjectTypeSchema[]): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

export function buildCustomDatabasePlan(input: BuildPlanInput): CustomDatabasePlan {
  const workspaceId = input.workspaceId.trim()
  const name = input.name.trim()
  if (!workspaceId) throw new Error('Workspace ID is required')
  if (!name || name.length > 120) throw new Error('Object type name must be 1-120 characters')
  if (!input.source.value.trim()) throw new Error('Plan source is required')
  if (input.existingTypes.some((entry) => entry.workspace_id !== workspaceId)) throw new Error('Existing object types must belong to the plan workspace')
  const planId = input.ids?.planId ?? newAuroraId()
  const plannedId = input.ids?.objectTypeId ?? newAuroraId()
  const nameMatches = input.existingTypes.filter((entry) => entry.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
  if (nameMatches.length > 1) throw new Error(`Object type name "${name}" matches more than one existing type`)
  const match = nameMatches[0]
  const icon = input.icon === undefined && match ? match.icon : input.icon ?? null
  const color = input.color === undefined && match ? match.color : input.color ?? null
  const schema = validateCustomDatabaseSchema(input.schema, {
    existingTypes: input.existingTypes,
    selfTargetType: `custom:${match?.id ?? plannedId}`,
  })
  let operation: CustomDatabasePlanOperation = { kind: 'create', objectTypeId: plannedId }
  const matches: CustomDatabasePlanMatch[] = []
  if (match) {
    const current = validateCustomDatabaseSchema(match.schema)
    const exactSchema = schemasEqual(current, schema)
    const exactPresentation = match.name === name && match.icon === icon && match.color === color
    if (exactSchema && exactPresentation) {
      operation = { kind: 'reuse', objectTypeId: match.id }
      matches.push({ objectTypeId: match.id, name: match.name, compatibility: 'exact', explanation: 'Existing object type already has the approved schema.' })
    } else {
      try {
        if (!exactSchema) validateAdditiveObjectTypePatch(current, schema)
        operation = { kind: 'update', objectTypeId: match.id }
        matches.push({ objectTypeId: match.id, name: match.name, compatibility: exactSchema ? 'exact' : 'additive', explanation: exactSchema ? 'Only approved presentation changes are needed.' : 'Existing type can be extended additively.' })
      } catch (error) {
        matches.push({ objectTypeId: match.id, name: match.name, compatibility: 'conflict', explanation: error instanceof Error ? error.message : 'Incompatible schema.' })
        throw new Error(`"${name}" conflicts with an existing object type; rename it or choose an additive schema`)
      }
    }
  }
  const createdAt = input.now ?? new Date().toISOString()
  const createdMillis = dateMillis(createdAt, 'Plan creation time')
  const expiresAt = input.expiresAt ?? new Date(createdMillis + CUSTOM_DATABASE_PLAN_TTL_MS).toISOString()
  if (dateMillis(expiresAt, 'Plan expiry') <= createdMillis) throw new Error('Plan expiry must be after its creation time')
  const withoutHash: Omit<CustomDatabasePlan, 'planHash'> = {
    contractVersion: CUSTOM_DATABASE_CONTRACT_VERSION, planId, workspaceId,
    source: { kind: input.source.kind, value: input.source.value.trim() }, name, icon, color, schema,
    template: normalizeTemplate(input.template, input.ids?.templateObjectId ?? newAuroraId(), schema),
    matches, assumptions: [...(input.assumptions ?? [])].slice(0, 20), warnings: [...(input.warnings ?? [])].slice(0, 50),
    operation, requiresConfirmation: true, createdAt, expiresAt,
  }
  return { ...withoutHash, planHash: hashCustomDatabasePlan(withoutHash) }
}

function typeMatchesPlan(existing: ObjectTypeDef, plan: CustomDatabasePlan): boolean {
  return existing.workspace_id === plan.workspaceId && existing.name === plan.name
    && existing.icon === plan.icon && existing.color === plan.color
    && schemasEqual(validateCustomDatabaseSchema(existing.schema), plan.schema)
}

export function assertApplicableCustomDatabasePlan(
  plan: CustomDatabasePlan,
  workspaceId: string,
  existingTypes: ObjectTypeDef[],
  now = new Date(),
): { outcome: 'create' | 'update' | 'reuse'; existing: ObjectTypeDef | null } {
  if (plan.contractVersion !== CUSTOM_DATABASE_CONTRACT_VERSION) throw new Error('Unsupported custom database plan version')
  if (plan.workspaceId !== workspaceId) throw new Error('Custom database plan belongs to another workspace')
  if (now.getTime() >= dateMillis(plan.expiresAt, 'Plan expiry')) throw new Error('Custom database plan has expired')
  if (hashCustomDatabasePlan(plan) !== plan.planHash) throw new Error('Custom database plan hash does not match its contents')
  if (existingTypes.some((entry) => entry.workspace_id !== workspaceId)) throw new Error('Object type lookup returned a foreign workspace record')
  const existing = existingTypes.find((entry) => entry.id === plan.operation.objectTypeId) ?? null
  if (plan.operation.kind === 'reuse') {
    if (!existing || !typeMatchesPlan(existing, plan)) throw new Error('Reusable object type no longer matches the approved plan')
    return { outcome: 'reuse', existing }
  }
  if (plan.operation.kind === 'create') {
    if (existing) {
      if (!typeMatchesPlan(existing, plan)) throw new Error('Planned object type ID exists with different data')
      return { outcome: 'reuse', existing }
    }
    if (existingTypes.some((entry) => entry.name.trim().toLocaleLowerCase() === plan.name.toLocaleLowerCase())) {
      throw new Error('Object type name now conflicts with another type; create a new plan')
    }
    return { outcome: 'create', existing: null }
  }
  if (!existing) throw new Error('Object type selected for additive update no longer exists')
  validateAdditiveObjectTypePatch(existing.schema, plan.schema)
  return { outcome: 'update', existing }
}

export function summarizeCustomDatabasePlan(plan: CustomDatabasePlan): string {
  const action = plan.operation.kind === 'reuse' ? 'reuse the existing object type'
    : plan.operation.kind === 'update' ? 'additively update the existing object type'
      : 'create a new object type'
  return `${plan.name}: ${action} with ${plan.schema.length} properties${plan.template ? ' and one starter template' : ''}.`
}
