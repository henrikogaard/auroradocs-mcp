type JsonSchema = {
  type?: string | string[]
  const?: string
  enum?: string[]
  description?: string
  minimum?: number
  maximum?: number
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  oneOf?: JsonSchema[]
  additionalProperties?: boolean | JsonSchema
}

export type JsonObjectSchema = JsonSchema & {
  type: 'object'
  properties: Record<string, JsonSchema>
  required?: string[]
  oneOf?: JsonObjectSchema[]
}

export type McpToolDefinition = {
  name: string
  title: string
  description: string
  inputSchema: JsonObjectSchema
  outputSchema: JsonObjectSchema
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

export type McpCoveragePriority = 'high' | 'medium' | 'low'
export type McpCoverageStatus = 'covered' | 'partial' | 'gap'
export type McpToolEffect = 'read' | 'write'
export type McpWorkflowApprovalMode = 'none' | 'confirm_each_write' | 'approve_exact_plan' | 'later_explicit_consent'

export type McpToolCoverageAudit = {
  generatedAt: string
  areas: Array<{
    id: string
    label: string
    status: McpCoverageStatus
    implementedTools: string[]
    missingTools: Array<{
      name: string
      priority: McpCoveragePriority
      reason: string
    }>
  }>
}

export type McpWorkflowRecipe = {
  id: string
  title: string
  goal: string
  requiredScopes: string[]
  toolSteps: string[]
  approvalMode: McpWorkflowApprovalMode
  writeBoundary: { allowedTools: string[]; rule: string }
  stopConditions: string[]
  expectedResultTypes: string[]
  prompt: string
}

const TOOL_EFFECTS: Readonly<Record<string, McpToolEffect>> = {
  list_workspaces: 'read',
  search_objects: 'read',
  search: 'read',
  list_objects: 'read',
  list_recent: 'read',
  wiki_search: 'read',
  wiki_get_page: 'read',
  wiki_related: 'read',
  wiki_recent: 'read',
  get_object: 'read',
  list_workspace_members: 'read',
  list_task_lists: 'read',
  list_task_statuses: 'read',
  list_week_plan: 'read',
  schedule_task_block: 'write',
  read_canvas: 'read',
  get_project_context: 'read',
  list_project_changes: 'read',
  get_mcp_tool_coverage: 'read',
  get_mcp_workflow_recipes: 'read',
  list_object_types: 'read',
  get_custom_database_recipes: 'read',
  plan_custom_database: 'read',
  apply_custom_database_plan: 'write',
  update_object_type: 'write',
  list_templates: 'read',
  create_template: 'write',
  create_from_template: 'write',
  analyze_obsidian_vault: 'read',
  get_obsidian_import_plan: 'read',
  import_obsidian_vault: 'write',
  get_obsidian_import_status: 'read',
  create_object: 'write',
  create_task: 'write',
  update_task: 'write',
  update_object_title: 'write',
  update_object: 'write',
  set_content: 'write',
  append_block: 'write',
  set_property: 'write',
  delete_object: 'write',
  restore_object: 'write',
}

const stringSchema: JsonSchema = { type: 'string' }
const nullableStringSchema: JsonSchema = { type: ['string', 'null'] }

function resultSchema(
  type: string,
  properties: Record<string, JsonSchema> = {},
  required: string[] = [],
): JsonObjectSchema {
  return {
    type: 'object',
    properties: { type: { const: type }, ...properties },
    required: ['type', ...required],
    additionalProperties: false,
  }
}

const SAFE_ERROR_SCHEMA = resultSchema('error', {
  code: {
    type: 'string',
    enum: ['invalid_input', 'authentication_failed', 'permission_denied', 'not_found', 'rate_limited', 'network_error', 'server_error'],
  },
  message: stringSchema,
  retryable: { type: 'boolean' },
}, ['code', 'message', 'retryable'])

const OBJECT_SUMMARY_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    id: stringSchema,
    title: nullableStringSchema,
    type: stringSchema,
    icon: nullableStringSchema,
  },
  required: ['id', 'title', 'type', 'icon'],
  additionalProperties: false,
}

const KNOWLEDGE_SOURCE_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    sourceId: stringSchema,
    workspaceId: stringSchema,
    objectId: stringSchema,
    kind: { type: 'string', enum: ['object', 'content_chunk', 'property', 'comment', 'attachment_metadata', 'relationship'] },
    title: nullableStringSchema,
    objectType: stringSchema,
    icon: nullableStringSchema,
    breadcrumb: { type: 'array', items: stringSchema },
    deepLink: stringSchema,
    snippet: nullableStringSchema,
    plainText: nullableStringSchema,
    blockId: nullableStringSchema,
    updatedAt: nullableStringSchema,
    score: { type: ['number', 'null'] },
    matchedFields: { type: 'array', items: { type: 'string', enum: ['title', 'content', 'properties', 'relationships'] } },
    availability: { type: 'string', enum: ['available', 'encrypted_locked', 'not_indexed', 'unsupported_type', 'permission_denied'] },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['parent', 'child', 'link', 'backlink', 'tag', 'task_project'] },
          objectId: stringSchema,
          title: nullableStringSchema,
        },
        required: ['type', 'objectId', 'title'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'sourceId', 'workspaceId', 'objectId', 'kind', 'title', 'objectType', 'icon', 'breadcrumb',
    'deepLink', 'snippet', 'plainText', 'blockId', 'updatedAt', 'score', 'matchedFields',
    'availability', 'relationships',
  ],
  additionalProperties: false,
}

const WEEK_PLAN_TASK_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    id: stringSchema,
    title: nullableStringSchema,
    status: nullableStringSchema,
    due_date: nullableStringSchema,
    updated_at: nullableStringSchema,
    labels: { type: 'array', items: stringSchema },
    timeBlock: {
      type: 'object',
      properties: { isTimeBlock: { type: 'boolean' }, durationMinutes: { type: ['number', 'null'] } },
      required: ['isTimeBlock', 'durationMinutes'],
      additionalProperties: false,
    },
  },
  required: ['id', 'title', 'status', 'due_date', 'updated_at', 'labels', 'timeBlock'],
  additionalProperties: false,
}

const WEEK_PLAN_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    type: { const: 'week_plan' },
    range: {
      type: 'object',
      properties: { start: stringSchema, end: stringSchema },
      required: ['start', 'end'],
      additionalProperties: false,
    },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: { date: stringSchema, tasks: { type: 'array', items: WEEK_PLAN_TASK_SCHEMA } },
        required: ['date', 'tasks'],
        additionalProperties: false,
      },
    },
    unscheduled: { type: 'array', items: WEEK_PLAN_TASK_SCHEMA },
  },
  required: ['type', 'range', 'days', 'unscheduled'],
  additionalProperties: false,
}

const CANVAS_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    type: { const: 'canvas' },
    canvas: {
      type: 'object',
      properties: { id: stringSchema, title: nullableStringSchema },
      required: ['id', 'title'],
      additionalProperties: false,
    },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: stringSchema,
          type: stringSchema,
          x: { type: ['number', 'null'] },
          y: { type: ['number', 'null'] },
          width: { type: ['number', 'null'] },
          height: { type: ['number', 'null'] },
          text: nullableStringSchema,
          color: nullableStringSchema,
          objectId: nullableStringSchema,
          objectTitle: nullableStringSchema,
        },
        required: ['id', 'type', 'x', 'y', 'width', 'height', 'text', 'color', 'objectId', 'objectTitle'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: stringSchema,
          fromCard: nullableStringSchema,
          toCard: nullableStringSchema,
          fromSide: nullableStringSchema,
          toSide: nullableStringSchema,
          label: nullableStringSchema,
          color: nullableStringSchema,
          style: nullableStringSchema,
          arrow: nullableStringSchema,
          arrowMode: nullableStringSchema,
          strokeWidth: { type: ['number', 'null'] },
        },
        required: ['id', 'fromCard', 'toCard', 'fromSide', 'toSide', 'label', 'color', 'style', 'arrow', 'arrowMode', 'strokeWidth'],
        additionalProperties: false,
      },
    },
    frames: { type: 'array', items: { type: 'object' } },
    warnings: { type: 'array', items: stringSchema },
  },
  required: ['type', 'canvas', 'cards', 'edges', 'frames', 'warnings'],
  additionalProperties: false,
}

const COVERAGE_AUDIT_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    generatedAt: stringSchema,
    areas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: stringSchema,
          label: stringSchema,
          status: { type: 'string', enum: ['covered', 'partial', 'gap'] },
          implementedTools: { type: 'array', items: stringSchema },
          missingTools: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: stringSchema,
                priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                reason: stringSchema,
              },
              required: ['name', 'priority', 'reason'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'label', 'status', 'implementedTools', 'missingTools'],
        additionalProperties: false,
      },
    },
  },
  required: ['generatedAt', 'areas'],
  additionalProperties: false,
}

const WORKFLOW_RECIPE_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    id: stringSchema,
    title: stringSchema,
    goal: stringSchema,
    requiredScopes: { type: 'array', items: stringSchema },
    toolSteps: { type: 'array', items: stringSchema },
    approvalMode: { type: 'string', enum: ['none', 'confirm_each_write', 'approve_exact_plan', 'later_explicit_consent'] },
    writeBoundary: {
      type: 'object',
      properties: {
        allowedTools: { type: 'array', items: stringSchema },
        rule: stringSchema,
      },
      required: ['allowedTools', 'rule'],
      additionalProperties: false,
    },
    stopConditions: { type: 'array', items: stringSchema },
    expectedResultTypes: { type: 'array', items: stringSchema },
    prompt: stringSchema,
  },
  required: [
    'id', 'title', 'goal', 'requiredScopes', 'toolSteps', 'approvalMode',
    'writeBoundary', 'stopConditions', 'expectedResultTypes', 'prompt',
  ],
  additionalProperties: false,
}

const OBJECT_TYPE_FIELD_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    key: stringSchema,
    label: stringSchema,
    value_type: { type: 'string', enum: ['text', 'number', 'progress', 'date', 'boolean', 'relation', 'select', 'multi_select', 'url', 'email', 'phone', 'file', 'person', 'location', 'formula'] },
    required: { type: 'boolean' },
    storageType: stringSchema,
    sensitive: { type: 'boolean' },
    options: { type: 'array', items: stringSchema },
    targetType: stringSchema,
    formula: stringSchema,
  },
  required: ['key', 'label', 'value_type', 'required'],
  additionalProperties: false,
}

const OBJECT_TYPE_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    id: stringSchema,
    workspace_id: stringSchema,
    name: stringSchema,
    icon: nullableStringSchema,
    color: nullableStringSchema,
    schema: { type: 'array', items: OBJECT_TYPE_FIELD_SCHEMA },
    created_at: stringSchema,
    updated_at: stringSchema,
  },
  required: ['id', 'workspace_id', 'name', 'icon', 'color', 'schema', 'created_at'],
  additionalProperties: false,
}

const TEMPLATE_SUMMARY_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: { id: stringSchema, title: nullableStringSchema, type: stringSchema, icon: nullableStringSchema },
  required: ['id', 'title', 'type', 'icon'],
  additionalProperties: false,
}

const OBSIDIAN_CONSENT_PREVIEW_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    planId: stringSchema,
    planHash: stringSchema,
    vaultDisplayName: stringSchema,
    workspaceId: stringSchema,
    counts: {
      type: 'object',
      properties: {
        notes: { type: 'integer' }, templates: { type: 'integer' }, canvases: { type: 'integer' },
        attachments: { type: 'integer' }, customGroups: { type: 'integer' },
      },
      required: ['notes', 'templates', 'canvases', 'attachments', 'customGroups'],
      additionalProperties: false,
    },
    policies: {
      type: 'object',
      properties: {
        hierarchy: { type: 'string', enum: ['spaces', 'parents', 'flatten'] },
        collisions: { type: 'string', enum: ['rename', 'skip', 'fail'] },
        attachments: { type: 'string', enum: ['referenced', 'skip'] },
        unsupported: { type: 'string', enum: ['preserve', 'skip'] },
      },
      required: ['hierarchy', 'collisions', 'attachments', 'unsupported'],
      additionalProperties: false,
    },
    acceptedGroupCount: { type: 'integer' },
  },
  required: ['planId', 'planHash', 'vaultDisplayName', 'workspaceId', 'counts', 'policies', 'acceptedGroupCount'],
  additionalProperties: false,
}

const OBSIDIAN_IMPORT_BATCH_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['blocked', 'in_progress', 'partial', 'complete'] },
    planId: stringSchema,
    planHash: stringSchema,
    completed: { type: 'integer', minimum: 0 },
    failed: { type: 'integer', minimum: 0 },
    remaining: { type: 'integer', minimum: 0 },
    nextCursor: { type: ['integer', 'null'] },
    warnings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { code: stringSchema, entryId: stringSchema },
        required: ['code'],
        additionalProperties: false,
      },
    },
  },
  required: ['status', 'planId', 'planHash', 'completed', 'failed', 'remaining', 'nextCursor', 'warnings'],
  additionalProperties: false,
}

const OBSIDIAN_IMPORT_STATUS_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pending', 'in_progress', 'partial', 'complete', 'blocked'] },
    planId: stringSchema,
    planHash: stringSchema,
    completed: { type: 'integer', minimum: 0 },
    failed: { type: 'integer', minimum: 0 },
    remaining: { type: 'integer', minimum: 0 },
    nextCursor: { type: ['integer', 'null'] },
    warningCodes: { type: 'array', items: stringSchema },
    updatedAt: nullableStringSchema,
    nextAction: stringSchema,
  },
  required: ['status', 'planId', 'planHash', 'completed', 'failed', 'remaining', 'nextCursor', 'warningCodes', 'updatedAt', 'nextAction'],
  additionalProperties: false,
}

const CUSTOM_DATABASE_PLAN_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    contractVersion: { type: 'integer' }, planId: stringSchema, planHash: stringSchema,
    workspaceId: stringSchema,
    source: { type: 'object', additionalProperties: true },
    name: stringSchema, icon: nullableStringSchema, color: nullableStringSchema,
    schema: { type: 'array', items: OBJECT_TYPE_FIELD_SCHEMA },
    template: { type: ['object', 'null'], additionalProperties: true },
    matches: { type: 'array', items: { type: 'object', additionalProperties: true } },
    assumptions: { type: 'array', items: stringSchema }, warnings: { type: 'array', items: stringSchema },
    operation: { type: 'object', additionalProperties: true }, requiresConfirmation: { type: 'boolean' },
    createdAt: stringSchema, expiresAt: stringSchema,
  },
  required: ['contractVersion', 'planId', 'planHash', 'workspaceId', 'source', 'name', 'icon', 'color', 'schema', 'template', 'matches', 'assumptions', 'warnings', 'operation', 'requiresConfirmation', 'createdAt', 'expiresAt'],
  additionalProperties: false,
}

const PROJECT_WORKSPACE_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: { id: stringSchema, name: stringSchema },
  required: ['id', 'name'],
  additionalProperties: false,
}

const PROJECT_IDENTITY_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: { id: stringSchema, workspaceId: stringSchema, title: stringSchema },
  required: ['id', 'workspaceId', 'title'],
  additionalProperties: false,
}

const PROJECT_AVAILABILITY_SCHEMA: JsonSchema = {
  type: 'string',
  enum: ['available', 'empty', 'encrypted_locked', 'permission_denied', 'not_found', 'unavailable', 'not_indexed', 'unsupported_type'],
}

const PROJECT_CHANGE_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: { id: stringSchema, type: stringSchema, title: nullableStringSchema, updatedAt: stringSchema },
  required: ['id', 'type', 'title', 'updatedAt'],
  additionalProperties: false,
}

const PROJECT_ACTIVITY_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: { id: stringSchema, title: nullableStringSchema, updatedAt: stringSchema },
  required: ['id', 'title', 'updatedAt'],
  additionalProperties: false,
}

const PROJECT_TASK_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: { id: stringSchema, title: stringSchema, status: nullableStringSchema, updatedAt: stringSchema },
  required: ['id', 'title', 'status', 'updatedAt'],
  additionalProperties: false,
}

const PROJECT_CITATION_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    sourceId: stringSchema,
    title: nullableStringSchema,
    deepLink: stringSchema,
    updatedAt: stringSchema,
    availability: PROJECT_AVAILABILITY_SCHEMA,
  },
  required: ['sourceId', 'title', 'deepLink', 'updatedAt', 'availability'],
  additionalProperties: false,
}

const PROJECT_RESUME_SCHEMA: JsonObjectSchema = {
  type: 'object',
  properties: {
    ...PROJECT_IDENTITY_SCHEMA.properties,
    goal: nullableStringSchema,
    status: nullableStringSchema,
    priority: nullableStringSchema,
    owner: nullableStringSchema,
    progress: { type: ['number', 'null'], minimum: 0, maximum: 100 },
    startDate: nullableStringSchema,
    dueDate: nullableStringSchema,
    brief: {
      type: 'object',
      properties: { availability: PROJECT_AVAILABILITY_SCHEMA, text: nullableStringSchema },
      required: ['availability', 'text'],
      additionalProperties: false,
    },
    tasks: {
      type: 'object',
      properties: {
        availability: PROJECT_AVAILABILITY_SCHEMA,
        groups: {
          type: 'object',
          properties: {
            todo: { type: 'array', items: PROJECT_TASK_SCHEMA },
            in_progress: { type: 'array', items: PROJECT_TASK_SCHEMA },
            blocked: { type: 'array', items: PROJECT_TASK_SCHEMA },
            done: { type: 'array', items: PROJECT_TASK_SCHEMA },
          },
          required: ['todo', 'in_progress', 'blocked', 'done'],
          additionalProperties: false,
        },
      },
      required: ['availability', 'groups'],
      additionalProperties: false,
    },
    blockers: { type: 'array', items: stringSchema },
    risks: { type: 'array', items: stringSchema },
    unresolvedDecisions: { type: 'array', items: stringSchema },
    recentActivity: { type: 'array', items: PROJECT_ACTIVITY_SCHEMA },
    nextActions: { type: 'array', items: stringSchema },
    sources: { type: 'array', items: PROJECT_CITATION_SCHEMA },
  },
  required: [
    'id', 'workspaceId', 'title', 'goal', 'status', 'priority', 'owner', 'progress', 'startDate', 'dueDate',
    'brief', 'tasks', 'blockers', 'risks', 'unresolvedDecisions', 'recentActivity', 'nextActions', 'sources',
  ],
  additionalProperties: false,
}

const RESULT_SCHEMAS: Readonly<Record<string, JsonObjectSchema[]>> = {
  list_workspaces: [resultSchema('workspaces', {
    workspaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          workspaceId: stringSchema,
          alias: stringSchema,
          name: stringSchema,
          role: stringSchema,
          scopes: { type: 'array', items: stringSchema },
          grantId: stringSchema,
          expiresAt: nullableStringSchema,
        },
        required: ['workspaceId', 'alias', 'name', 'role', 'scopes', 'grantId', 'expiresAt'],
        additionalProperties: false,
      },
    },
  }, ['workspaces'])],
  search_objects: [resultSchema('objects', { objects: { type: 'array', items: OBJECT_SUMMARY_SCHEMA } }, ['objects'])],
  search: [resultSchema('objects', { objects: { type: 'array', items: OBJECT_SUMMARY_SCHEMA } }, ['objects'])],
  list_objects: [resultSchema('objects', { objects: { type: 'array', items: OBJECT_SUMMARY_SCHEMA } }, ['objects'])],
  list_recent: [resultSchema('objects', { objects: { type: 'array', items: OBJECT_SUMMARY_SCHEMA } }, ['objects'])],
  wiki_search: [resultSchema('knowledge_sources', { sources: { type: 'array', items: KNOWLEDGE_SOURCE_SCHEMA } }, ['sources'])],
  wiki_get_page: [resultSchema('knowledge_sources', { sources: { type: 'array', items: KNOWLEDGE_SOURCE_SCHEMA } }, ['sources'])],
  wiki_related: [resultSchema('knowledge_sources', { sources: { type: 'array', items: KNOWLEDGE_SOURCE_SCHEMA } }, ['sources'])],
  wiki_recent: [resultSchema('knowledge_sources', { sources: { type: 'array', items: KNOWLEDGE_SOURCE_SCHEMA } }, ['sources'])],
  get_object: [resultSchema('object', {
    object: OBJECT_SUMMARY_SCHEMA,
    availability: { type: 'string', enum: ['available', 'empty', 'encrypted_locked', 'permission_denied', 'not_found', 'unavailable'] },
    content: nullableStringSchema,
    properties: { type: 'object', additionalProperties: stringSchema },
  }, ['object', 'availability', 'content', 'properties'])],
  list_workspace_members: [resultSchema('members', {
    members: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: stringSchema, name: nullableStringSchema, email: stringSchema, role: stringSchema },
        required: ['id', 'name', 'email', 'role'],
        additionalProperties: false,
      },
    },
  }, ['members'])],
  list_task_lists: [resultSchema('task_lists', {
    task_lists: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: stringSchema, name: stringSchema },
        required: ['id', 'name'],
        additionalProperties: false,
      },
    },
  }, ['task_lists'])],
  list_task_statuses: [resultSchema('task_statuses', { statuses: { type: 'array', items: stringSchema } }, ['statuses'])],
  list_week_plan: [resultSchema('week_plan', { plan: WEEK_PLAN_SCHEMA }, ['plan'])],
  schedule_task_block: [resultSchema('scheduled_task_block', {
    id: stringSchema,
    title: nullableStringSchema,
    due_date: stringSchema,
    mode: stringSchema,
  }, ['id', 'title', 'due_date', 'mode'])],
  read_canvas: [resultSchema('canvas', { canvas: CANVAS_SCHEMA }, ['canvas'])],
  get_mcp_tool_coverage: [resultSchema('mcp_tool_coverage', { audit: COVERAGE_AUDIT_SCHEMA }, ['audit'])],
  get_mcp_workflow_recipes: [resultSchema('mcp_workflow_recipes', { recipes: { type: 'array', items: WORKFLOW_RECIPE_SCHEMA } }, ['recipes'])],
  list_object_types: [resultSchema('object_types', { object_types: { type: 'array', items: OBJECT_TYPE_SCHEMA } }, ['object_types'])],
  get_custom_database_recipes: [resultSchema('custom_database_recipes', { recipes: { type: 'array', items: { type: 'object', additionalProperties: true } } }, ['recipes'])],
  plan_custom_database: [resultSchema('custom_database_plan', { plan: CUSTOM_DATABASE_PLAN_SCHEMA, summary: stringSchema }, ['plan', 'summary'])],
  apply_custom_database_plan: [resultSchema('custom_database_applied', {
    outcome: { type: 'string', enum: ['created', 'updated', 'reused'] },
    object_type: OBJECT_TYPE_SCHEMA, template_id: nullableStringSchema, plan_id: stringSchema, plan_hash: stringSchema,
  }, ['outcome', 'object_type', 'template_id', 'plan_id', 'plan_hash'])],
  update_object_type: [resultSchema('object_type_updated', { object_type: OBJECT_TYPE_SCHEMA }, ['object_type'])],
  list_templates: [resultSchema('templates', { templates: { type: 'array', items: TEMPLATE_SUMMARY_SCHEMA } }, ['templates'])],
  create_template: [resultSchema('template_created', { template: TEMPLATE_SUMMARY_SCHEMA }, ['template'])],
  create_from_template: [resultSchema('template_instantiated', { template_id: stringSchema, object_id: stringSchema }, ['template_id', 'object_id'])],
  analyze_obsidian_vault: [resultSchema('obsidian_import_plan', { plan: { type: 'object', additionalProperties: true } }, ['plan'])],
  get_obsidian_import_plan: [resultSchema('obsidian_import_plan_page', { page: { type: 'object', additionalProperties: true } }, ['page'])],
  import_obsidian_vault: [
    resultSchema('obsidian_import_confirmation_required', {
      plan_id: stringSchema,
      plan_hash: stringSchema,
      preview: OBSIDIAN_CONSENT_PREVIEW_SCHEMA,
    }, ['plan_id', 'plan_hash', 'preview']),
    resultSchema('obsidian_import_batch', {
      result: OBSIDIAN_IMPORT_BATCH_SCHEMA,
    }, ['result']),
    resultSchema('no_op', { message: stringSchema }, ['message']),
  ],
  get_obsidian_import_status: [resultSchema('obsidian_import_status', {
    status: OBSIDIAN_IMPORT_STATUS_SCHEMA,
  }, ['status'])],
  get_project_context: [
    resultSchema('project_context', {
      status: { const: 'ok' },
      workspace: PROJECT_WORKSPACE_SCHEMA,
      project: PROJECT_RESUME_SCHEMA,
      asOf: stringSchema,
      cursor: nullableStringSchema,
    }, ['status', 'workspace', 'project', 'asOf', 'cursor']),
    resultSchema('project_context', {
      status: { const: 'ambiguous' },
      workspace: PROJECT_WORKSPACE_SCHEMA,
      candidates: { type: 'array', items: PROJECT_IDENTITY_SCHEMA },
      asOf: stringSchema,
    }, ['status', 'workspace', 'candidates', 'asOf']),
    resultSchema('project_context', {
      status: { const: 'not_found' },
      workspace: PROJECT_WORKSPACE_SCHEMA,
      asOf: stringSchema,
    }, ['status', 'workspace', 'asOf']),
  ],
  list_project_changes: [
    resultSchema('project_changes', {
      status: { const: 'ok' },
      workspace: PROJECT_WORKSPACE_SCHEMA,
      project: PROJECT_IDENTITY_SCHEMA,
      asOf: stringSchema,
      items: { type: 'array', items: PROJECT_CHANGE_SCHEMA },
      nextCursor: nullableStringSchema,
      hasMore: { type: 'boolean' },
    }, ['status', 'workspace', 'project', 'asOf', 'items', 'nextCursor', 'hasMore']),
    resultSchema('project_changes', {
      status: { const: 'not_found' },
      workspace: PROJECT_WORKSPACE_SCHEMA,
      asOf: stringSchema,
    }, ['status', 'workspace', 'asOf']),
  ],
  create_object: [resultSchema('created', { id: stringSchema, title: stringSchema }, ['id', 'title'])],
  create_task: [resultSchema('task_created', {
    id: stringSchema,
    title: stringSchema,
    status: nullableStringSchema,
    task_list_name: nullableStringSchema,
  }, ['id', 'title', 'status', 'task_list_name'])],
  update_task: [resultSchema('task_updated', {
    id: stringSchema,
    title: stringSchema,
    changed_fields: { type: 'array', items: stringSchema },
  }, ['id', 'title', 'changed_fields'])],
  update_object_title: [resultSchema('updated', { id: stringSchema, title: stringSchema }, ['id', 'title'])],
  update_object: [
    resultSchema('object_updated', { id: stringSchema, changed_fields: { type: 'array', items: stringSchema } }, ['id', 'changed_fields']),
    resultSchema('no_op', { message: stringSchema }, ['message']),
  ],
  set_content: [resultSchema('content_set', { id: stringSchema }, ['id'])],
  append_block: [resultSchema('content_appended', { id: stringSchema }, ['id'])],
  set_property: [resultSchema('property_set', {
    objectId: stringSchema,
    key: stringSchema,
    value: stringSchema,
  }, ['objectId', 'key', 'value'])],
  delete_object: [resultSchema('deleted', { id: stringSchema }, ['id'])],
  restore_object: [resultSchema('restored', { id: stringSchema, changed: { type: 'boolean' } }, ['id', 'changed'])],
}

const NON_IDEMPOTENT_TOOLS = new Set(['schedule_task_block', 'create_object', 'create_task', 'append_block', 'create_template', 'create_from_template', 'import_obsidian_vault'])
const LOCAL_TOOLS = new Set(['list_workspaces', 'list_task_statuses', 'get_mcp_tool_coverage', 'get_mcp_workflow_recipes', 'get_custom_database_recipes', 'analyze_obsidian_vault', 'get_obsidian_import_plan', 'import_obsidian_vault', 'get_obsidian_import_status'])
const WORKSPACE_SELECTOR_FREE_TOOLS = new Set(['list_workspaces', 'get_mcp_tool_coverage', 'get_mcp_workflow_recipes', 'get_custom_database_recipes'])

type McpToolDeclaration = Omit<McpToolDefinition, 'title' | 'outputSchema' | 'annotations'>

const TOOL_DEFINITIONS: McpToolDeclaration[] = [
  {
    name: 'list_workspaces',
    description: 'List only the AuroraDocs workspaces granted to this MCP credential.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_objects',
    description: 'Search for objects (pages, notes, tasks, etc.) in the workspace by title keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search for in object titles' },
        type: { type: 'string', description: 'Optional object type filter (page, note, task, etc.)' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results to return (default 10, max 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search',
    description: 'Alias for search_objects. Search workspace objects by title keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search for in object titles' },
        type: { type: 'string', description: 'Optional object type filter (page, note, task, etc.)' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results to return (default 10, max 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_objects',
    description: 'List objects in the workspace, optionally filtered by type.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Optional object type to filter by' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results to return (default 20)' },
      },
    },
  },
  {
    name: 'list_recent',
    description: 'List the most recently updated objects in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Optional object type to filter by' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results to return (default 20)' },
      },
    },
  },
  {
    name: 'wiki_search',
    description: 'Search workspace knowledge and return citation-ready sources.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to run against workspace knowledge' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results to return (default 20, max 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'wiki_get_page',
    description: 'Read one object as a wiki source and optionally include full text.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object ID' },
        includeFullText: { type: 'boolean', description: 'Include the full readable text payload when available' },
      },
      required: ['id'],
    },
  },
  {
    name: 'wiki_related',
    description: 'Find related workspace sources for an object.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object ID' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum results to return (default 6, max 10)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'wiki_recent',
    description: 'List recently updated readable workspace sources.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum results to return (default 6, max 10)' },
      },
    },
  },
  {
    name: 'get_object',
    description: 'Get the content, details, and properties of a specific object by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_workspace_members',
    description: 'List workspace members with their roles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_task_lists',
    description: 'List available task lists in the workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_task_statuses',
    description: 'List the task statuses available in the workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_week_plan',
    description: 'Return the AuroraDocs Week Planning view for a Monday-start week, including scheduled and optionally unscheduled tasks. Tasks are capped at the 500 most recently updated.',
    inputSchema: {
      type: 'object',
      properties: {
        anchor_date: { type: 'string', description: 'Date inside the requested week, formatted YYYY-MM-DD. Defaults to today.' },
        include_unscheduled: { type: 'boolean', description: 'Include incomplete tasks without a due date. Defaults to true.' },
        unscheduled_limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum unscheduled tasks to return. Defaults to 12, max 50.' },
      },
    },
  },
  {
    name: 'schedule_task_block',
    description: 'Schedule an existing task into Week Planning or create a task-backed time block.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'schedule_existing_task or create_time_block' },
        task_id: { type: 'string', description: 'Existing task object ID when mode is schedule_existing_task' },
        title: { type: 'string', description: 'Time-block title when mode is create_time_block' },
        date: { type: 'string', description: 'Target date formatted YYYY-MM-DD' },
        start_time: { type: 'string', description: 'Optional start time formatted HH:mm' },
        duration_minutes: { type: 'number', description: 'Time-block duration in minutes. Defaults to 30.' },
      },
      required: ['mode', 'date'],
    },
  },
  {
    name: 'read_canvas',
    description: 'Read a Canvas object structure, including cards/nodes and edges/links, without modifying the canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Canvas object ID' },
        include_text: { type: 'boolean', description: 'Include card text when available. Defaults to true.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_mcp_tool_coverage',
    description: 'Return AuroraDocs MCP tool coverage areas, implemented tools, and prioritized gaps.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_mcp_workflow_recipes',
    description: 'Return documented agent workflow recipes and the MCP tools/scopes they use.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_project_context',
    description: 'Resume planning work with a bounded project packet containing tasks, blockers, next actions, and citations.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Exact project object ID; cannot be combined with query' },
        query: { type: 'string', description: 'Project title query; cannot be combined with project_id' },
        activity_days: { type: 'integer', minimum: 1, maximum: 90, description: 'Recent activity window in days (default 14)' },
        task_limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum project tasks (default 20)' },
        source_limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Maximum citation sources (default 10)' },
      },
      oneOf: [
        { type: 'object', properties: { project_id: stringSchema }, required: ['project_id'] },
        { type: 'object', properties: { query: stringSchema }, required: ['query'] },
      ],
    },
  },
  {
    name: 'list_project_changes',
    description: 'List bounded project changes after an opaque cursor.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Exact project object ID' },
        cursor: { type: 'string', description: 'Opaque cursor returned by project context or a previous change page' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum changes to return (default 50)' },
      },
      required: ['project_id', 'cursor'],
    },
  },
  {
    name: 'list_object_types',
    description: 'List existing custom object types and bounded schemas in a granted workspace. Use before planning a custom database.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_custom_database_recipes',
    description: 'List editable starter recipes for contacts, interests, equipment, subscriptions, and expenses. This is local and read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'plan_custom_database',
    description: 'Create a read-only, expiring custom-database plan after checking existing types. Prefer a recipe when it fits; otherwise provide a name and schema.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'string', enum: ['contacts', 'interests', 'equipment', 'subscriptions', 'expenses'], description: 'Optional starter recipe' },
        name: { type: 'string', description: 'Object type name; defaults to the selected recipe name' },
        icon: { type: ['string', 'null'], description: 'Optional icon override or null' },
        color: { type: ['string', 'null'], description: 'Optional color override or null' },
        schema: { type: 'array', items: OBJECT_TYPE_FIELD_SCHEMA, description: 'Free-form or edited recipe schema, maximum 64 fields' },
        template: { type: ['object', 'null'], additionalProperties: true, description: 'Optional starter template with title, body, icon, and defaults' },
        assumptions: { type: 'array', items: stringSchema, description: 'Bounded assumptions to show for approval' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'apply_custom_database_plan',
    description: 'Apply the exact current custom-database plan after user approval. Requires the plan ID and hash returned by plan_custom_database.',
    inputSchema: {
      type: 'object',
      properties: { plan_id: stringSchema, plan_hash: stringSchema },
      required: ['plan_id', 'plan_hash'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_object_type',
    description: 'Apply an additive-only update to a custom object type. Existing fields, value types, requiredness, storage, sensitivity, relation targets, and select options cannot be removed or tightened.',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringSchema,
        name: stringSchema,
        icon: { type: ['string', 'null'] },
        color: { type: ['string', 'null'] },
        schema: { type: 'array', items: OBJECT_TYPE_FIELD_SCHEMA },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_templates',
    description: 'List reusable templates in a granted workspace, optionally filtered by object type.',
    inputSchema: {
      type: 'object', properties: { type: stringSchema }, additionalProperties: false,
    },
  },
  {
    name: 'create_template',
    description: 'Create a reusable template with optional body content and schema-declared property defaults.',
    inputSchema: {
      type: 'object',
      properties: {
        object_id: { type: 'string', description: 'Optional planned 15-character object ID for idempotent workflows' },
        type: stringSchema, title: stringSchema, icon: { type: ['string', 'null'] }, body: stringSchema,
        defaults: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: stringSchema, value_type: stringSchema, value: {} },
            required: ['key', 'value_type', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['type', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_from_template',
    description: 'Create a normal object from a workspace template, copying validated content and schema-declared default properties.',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: stringSchema,
        object_id: { type: 'string', description: 'Optional planned 15-character object ID for resume-safe workflows' },
      },
      required: ['template_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_obsidian_vault',
    description: 'Read the single locally authorized Obsidian vault, infer a reviewable destination plan, and perform zero AuroraCloud writes. Raw note bodies are not returned.',
    inputSchema: {
      type: 'object',
      properties: {
        hierarchy_policy: { type: 'string', enum: ['spaces', 'parents', 'flatten'] },
        collision_policy: { type: 'string', enum: ['rename', 'skip', 'fail'] },
        attachment_policy: { type: 'string', enum: ['referenced', 'skip'] },
        unsupported_policy: { type: 'string', enum: ['preserve', 'skip'] },
        adjustments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              group_id: stringSchema,
              action: { type: 'string', enum: ['accept', 'rename', 'reject', 'merge', 'split'] },
              name: stringSchema,
              merge_with_group_id: stringSchema,
              split_by: { type: 'string', enum: ['folder', 'explicit_type', 'property_signature'] },
            },
            required: ['group_id', 'action'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_obsidian_import_plan',
    description: 'Read a bounded page of an existing Obsidian import plan without rescanning or writing.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: stringSchema,
        section: { type: 'string', enum: ['groups', 'entries', 'warnings'] },
        page: { type: 'integer', minimum: 1, maximum: 10000 },
        per_page: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['plan_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'import_obsidian_vault',
    description: 'After the user reviews an exact Obsidian plan, request explicit consent and import one additive, resumable batch. The source vault is never modified.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: stringSchema,
        plan_hash: stringSchema,
        confirmed: { type: 'boolean', description: 'Compatibility confirmation for clients without MCP form elicitation; only set true after a later explicit user acceptance.' },
        batch_size: { type: 'integer', minimum: 1, maximum: 100, description: 'Entries to process in this call (default 50, maximum 100).' },
      },
      required: ['plan_id', 'plan_hash'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_obsidian_import_status',
    description: 'Read content-free progress and warning codes for an in-process Obsidian import plan.',
    inputSchema: {
      type: 'object',
      properties: { plan_id: stringSchema },
      required: ['plan_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_object',
    description: 'Create a new non-task object (page, note, bookmark, etc.) in the workspace. Use create_task for tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Object type: page, note, bookmark, etc.' },
        title: { type: 'string', description: 'Title for the new object' },
      },
      required: ['type', 'title'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task in the workspace with full task fields. Assignees can be names, emails, or user IDs. Task list can be a name or ID.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        status: { type: 'string', description: 'Task status (e.g. To Do, In Progress, Done)' },
        priority: { type: 'string', description: 'Priority: Low, Medium, High, or Urgent' },
        due_date: { type: 'string', description: 'Due date in ISO 8601 (e.g. 2026-04-15 or 2026-04-15T22:00)' },
        assignees: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: 'Assignee names, emails, or user IDs (array or comma-separated)' },
        task_list: { type: 'string', description: 'Task list name or ID' },
        labels: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: 'Labels/tags (array or comma-separated)' },
        description: { type: 'string', description: 'Task description' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task. Only provided fields are changed. Empty strings/arrays clear optional fields.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task object ID' },
        title: { type: 'string', description: 'New task title' },
        status: { type: 'string', description: 'Task status' },
        priority: { type: 'string', description: 'Priority: Low, Medium, High, Urgent, or empty to clear' },
        due_date: { type: 'string', description: 'Due date (ISO 8601) or empty to clear' },
        assignees: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: 'Assignees (names/emails/IDs) or empty to clear' },
        task_list: { type: 'string', description: 'Task list name/ID or empty to clear' },
        labels: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: 'Labels or empty to clear' },
        description: { type: 'string', description: 'Task description or empty to clear' },
      },
      required: ['id'],
    },
  },
  {
    name: 'update_object_title',
    description: 'Update the title of an existing object.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object ID' },
        title: { type: 'string', description: 'The new title' },
      },
      required: ['id', 'title'],
    },
  },
  {
    name: 'update_object',
    description: 'Update an existing object title and/or replace its plain-text content.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object ID' },
        title: { type: 'string', description: 'Optional new title' },
        text: { type: 'string', description: 'Optional plain text content to replace the existing content' },
        content: { type: 'string', description: 'Alias for text' },
      },
      required: ['id'],
    },
  },
  {
    name: 'set_content',
    description: 'Set the text content of an object. The text is converted to a structured document format.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object ID' },
        text: { type: 'string', description: 'Plain text content (newlines become paragraphs)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'append_block',
    description: 'Append plain text to the end of an object as one or more paragraph blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object ID' },
        text: { type: 'string', description: 'Plain text to append (newlines become paragraphs)' },
        content: { type: 'string', description: 'Alias for text' },
      },
      required: ['id', 'text'],
    },
  },
  {
    name: 'set_property',
    description: 'Set a generic property value on an object. For task-specific fields, use create_task or update_task instead.',
    inputSchema: {
      type: 'object',
      properties: {
        object_id: { type: 'string', description: 'The object ID' },
        key: { type: 'string', description: 'Property key/name' },
        value_type: { type: 'string', description: 'Value type: text, date, number, boolean' },
        value: { type: 'string', description: 'The value to set' },
      },
      required: ['object_id', 'key', 'value_type', 'value'],
    },
  },
  {
    name: 'delete_object',
    description: 'Soft-delete an object (moves to trash). This is reversible.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'restore_object',
    description: 'Restore one soft-deleted object from trash. Returns changed=false when the object is already active.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The soft-deleted object ID to restore' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
]

export function getToolDefinitions(): McpToolDefinition[] {
  return TOOL_DEFINITIONS.map((tool) => ({
    ...tool,
    title: tool.name.split('_').map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' '),
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties,
        ...(WORKSPACE_SELECTOR_FREE_TOOLS.has(tool.name) ? {} : {
          workspace_id: { type: 'string', description: 'Granted workspace ID to use for this operation' },
          workspace_alias: { type: 'string', description: 'Granted workspace alias to use for this operation' },
        }),
      },
      required: tool.inputSchema.required ? [...tool.inputSchema.required] : undefined,
    },
    outputSchema: structuredClone({
      type: 'object' as const,
      properties: {},
      oneOf: [...(RESULT_SCHEMAS[tool.name] ?? []), SAFE_ERROR_SCHEMA],
    }),
    annotations: {
      readOnlyHint: TOOL_EFFECTS[tool.name] === 'read',
      destructiveHint: tool.name === 'delete_object',
      idempotentHint: !NON_IDEMPOTENT_TOOLS.has(tool.name),
      openWorldHint: !LOCAL_TOOLS.has(tool.name),
    },
  }))
}

export function getToolEffect(name: string): McpToolEffect | undefined {
  return TOOL_EFFECTS[name]
}

export function getToolEffects(): Readonly<Record<string, McpToolEffect>> {
  return { ...TOOL_EFFECTS }
}

export function getMcpToolCoverageAudit(): McpToolCoverageAudit {
  return {
    generatedAt: new Date().toISOString(),
    areas: [
      {
        id: 'knowledge',
        label: 'Knowledge search and source lookup',
        status: 'covered',
        implementedTools: ['wiki_search', 'wiki_get_page', 'wiki_related', 'wiki_recent', 'get_object'],
        missingTools: [],
      },
      {
        id: 'tasks',
        label: 'Task triage and planning',
        status: 'covered',
        implementedTools: ['list_task_lists', 'list_task_statuses', 'create_task', 'update_task'],
        missingTools: [],
      },
      {
        id: 'objects',
        label: 'Object CRUD',
        status: 'covered',
        implementedTools: ['search_objects', 'list_objects', 'list_recent', 'create_object', 'update_object', 'append_block', 'delete_object', 'restore_object'],
        missingTools: [],
      },
      {
        id: 'calendar',
        label: 'Calendar and week planning',
        status: 'covered',
        implementedTools: ['list_week_plan', 'schedule_task_block'],
        missingTools: [],
      },
      {
        id: 'canvas',
        label: 'Canvas and visual planning',
        status: 'covered',
        implementedTools: ['read_canvas'],
        missingTools: [],
      },
      {
        id: 'custom_databases',
        label: 'Custom object types and reusable templates',
        status: 'covered',
        implementedTools: ['list_object_types', 'get_custom_database_recipes', 'plan_custom_database', 'apply_custom_database_plan', 'update_object_type', 'list_templates', 'create_template', 'create_from_template'],
        missingTools: [],
      },
      {
        id: 'obsidian_import',
        label: 'Consent-gated local Obsidian analysis and import',
        status: 'covered',
        implementedTools: ['analyze_obsidian_vault', 'get_obsidian_import_plan', 'import_obsidian_vault', 'get_obsidian_import_status'],
        missingTools: [],
      },
    ],
  }
}

export function getMcpWorkflowRecipes(): McpWorkflowRecipe[] {
  return [
    {
      id: 'weekly_summary',
      title: 'Weekly summary',
      goal: 'Summarize recent workspace changes and outstanding work for a weekly review.',
      requiredScopes: ['search', 'read:objects', 'read:content', 'read:tasks'],
      toolSteps: ['wiki_recent', 'wiki_search', 'list_task_statuses', 'list_objects'],
      approvalMode: 'none',
      writeBoundary: { allowedTools: [], rule: 'Read-only workflow; never call a write tool.' },
      stopConditions: ['Stop when required read data is unavailable or a read returns an error; report the unavailable section.'],
      expectedResultTypes: ['knowledge_sources', 'task_statuses', 'objects'],
      prompt: 'Review recent sources, search for this week or active project terms, then summarize completed work, open decisions, and next actions with citations.',
    },
    {
      id: 'task_triage',
      title: 'Task triage',
      goal: 'Review unsorted or stale tasks and propose status, priority, list, or assignee updates.',
      requiredScopes: ['read:objects', 'read:tasks', 'write:tasks', 'write:objects'],
      toolSteps: ['list_task_lists', 'list_task_statuses', 'list_objects', 'get_object', 'update_task'],
      approvalMode: 'confirm_each_write',
      writeBoundary: { allowedTools: ['update_task'], rule: 'Apply only the exact task fields the user confirms.' },
      stopConditions: ['Stop on an ambiguous task, user decline, permission denial, or any failed prerequisite read.'],
      expectedResultTypes: ['task_lists', 'task_statuses', 'objects', 'object', 'task_updated'],
      prompt: 'List task objects, inspect unclear items, then update only fields the user explicitly confirms or that match the agreed triage rule.',
    },
    {
      id: 'research_synthesis',
      title: 'Research synthesis',
      goal: 'Find relevant project sources and produce a citation-backed synthesis.',
      requiredScopes: ['search', 'read:objects', 'read:content'],
      toolSteps: ['wiki_search', 'wiki_get_page', 'wiki_related'],
      approvalMode: 'none',
      writeBoundary: { allowedTools: [], rule: 'Read-only workflow; never call a write tool.' },
      stopConditions: ['Stop when sources are unavailable or insufficient; report uncertainty instead of inventing an answer.'],
      expectedResultTypes: ['knowledge_sources'],
      prompt: 'Search for the topic, read the top sources, follow related items, then answer with citations and a separate uncertainty list.',
    },
    {
      id: 'source_lookup',
      title: 'Source lookup',
      goal: 'Locate the source object behind a claim, task, or project reference.',
      requiredScopes: ['search', 'read:objects'],
      toolSteps: ['search_objects', 'wiki_search', 'wiki_get_page'],
      approvalMode: 'none',
      writeBoundary: { allowedTools: [], rule: 'Read-only workflow; never call a write tool.' },
      stopConditions: ['Stop when no unambiguous source is found; return candidates and uncertainty.'],
      expectedResultTypes: ['objects', 'knowledge_sources'],
      prompt: 'Search by title and content terms, return the best matching object IDs/deep links, and explain which matched fields support each result.',
    },
    {
      id: 'custom_database_design',
      title: 'Custom database design',
      goal: 'Design or safely extend a special-use object type and reusable template after explicit approval.',
      requiredScopes: ['read:objects', 'write:objects', 'write:content'],
      toolSteps: ['get_custom_database_recipes', 'list_object_types', 'plan_custom_database', 'apply_custom_database_plan', 'list_templates'],
      approvalMode: 'approve_exact_plan',
      writeBoundary: { allowedTools: ['apply_custom_database_plan'], rule: 'Apply only the exact unexpired plan ID and hash the user approved.' },
      stopConditions: ['Stop before apply on missing approval, plan drift, expiry, destructive schema change, permission denial, or failed prerequisite.'],
      expectedResultTypes: ['custom_database_recipes', 'object_types', 'custom_database_plan', 'custom_database_applied', 'templates'],
      prompt: 'Start from the closest recipe, inspect existing object types, propose an additive plan, show its assumptions and exact hash, then apply it only after the user accepts that plan.',
    },
    {
      id: 'template_instantiation',
      title: 'Template instantiation',
      goal: 'Resolve one reusable template and create an object with its approved defaults and content.',
      requiredScopes: ['read:objects', 'write:objects', 'write:content'],
      toolSteps: ['list_templates', 'create_from_template'],
      approvalMode: 'confirm_each_write',
      writeBoundary: { allowedTools: ['create_from_template'], rule: 'Create one object only from the exact template and optional planned object ID the user approves.' },
      stopConditions: ['Stop on a missing or ambiguous template, changed planned identity, user decline, permission denial, or failed prerequisite read.'],
      expectedResultTypes: ['templates', 'template_instantiated'],
      prompt: 'List templates, resolve the requested selector unambiguously, show the exact template and optional planned object ID, then create one object only after explicit user approval.',
    },
    {
      id: 'obsidian_import',
      title: 'Obsidian vault import',
      goal: 'Analyze one locally authorized vault, review its mapping, obtain explicit later consent, and resume bounded additive import batches.',
      requiredScopes: ['read:objects', 'write:objects', 'write:content'],
      toolSteps: ['analyze_obsidian_vault', 'get_obsidian_import_plan', 'import_obsidian_vault', 'get_obsidian_import_status'],
      approvalMode: 'later_explicit_consent',
      writeBoundary: { allowedTools: ['import_obsidian_vault'], rule: 'Import only after a later explicit acceptance of the exact plan ID and hash; serialize bounded batches.' },
      stopConditions: ['Stop on decline, cancellation, stale or expired plan, source drift, missing scope, viewer role, E2EE, quota, storage failure, or blocked status.'],
      expectedResultTypes: ['obsidian_import_plan', 'obsidian_import_plan_page', 'obsidian_import_confirmation_required', 'obsidian_import_batch', 'obsidian_import_status', 'no_op'],
      prompt: 'Analyze first without writes, present the exact plan and wait for a later acceptance, then import bounded batches with the exact plan ID/hash until status is complete or blocked. Never modify the source vault.',
    },
  ]
}
