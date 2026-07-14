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
  get_mcp_tool_coverage: 'read',
  get_mcp_workflow_recipes: 'read',
  create_object: 'write',
  create_task: 'write',
  update_task: 'write',
  update_object_title: 'write',
  update_object: 'write',
  set_content: 'write',
  append_block: 'write',
  set_property: 'write',
  delete_object: 'write',
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
    updatedAt: stringSchema,
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
    prompt: stringSchema,
  },
  required: ['id', 'title', 'goal', 'requiredScopes', 'toolSteps', 'prompt'],
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
          expiresAt: stringSchema,
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
}

const NON_IDEMPOTENT_TOOLS = new Set(['schedule_task_block', 'create_object', 'create_task', 'append_block'])
const LOCAL_TOOLS = new Set(['list_workspaces', 'list_task_statuses', 'get_mcp_tool_coverage', 'get_mcp_workflow_recipes'])
const WORKSPACE_SELECTOR_FREE_TOOLS = new Set(['list_workspaces', 'get_mcp_tool_coverage', 'get_mcp_workflow_recipes'])

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
    description: 'Return the AuroraDocs Week Planning view for a Monday-start week, including scheduled and optionally unscheduled tasks.',
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
    generatedAt: '2026-07-08',
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
        status: 'partial',
        implementedTools: ['search_objects', 'list_objects', 'list_recent', 'create_object', 'update_object', 'append_block', 'delete_object'],
        missingTools: [
          {
            name: 'restore_object',
            priority: 'low',
            reason: 'Deletes are reversible in the app, but MCP currently lacks an explicit trash restore command.',
          },
        ],
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
    ],
  }
}

export function getMcpWorkflowRecipes(): McpWorkflowRecipe[] {
  return [
    {
      id: 'weekly_summary',
      title: 'Weekly summary',
      goal: 'Summarize recent workspace changes and outstanding work for a weekly review.',
      requiredScopes: ['search', 'read:objects', 'read:content', 'tasks'],
      toolSteps: ['wiki_recent', 'wiki_search', 'list_task_statuses', 'list_objects'],
      prompt: 'Review recent sources, search for this week or active project terms, then summarize completed work, open decisions, and next actions with citations.',
    },
    {
      id: 'task_triage',
      title: 'Task triage',
      goal: 'Review unsorted or stale tasks and propose status, priority, list, or assignee updates.',
      requiredScopes: ['read:objects', 'tasks', 'write:objects'],
      toolSteps: ['list_task_lists', 'list_task_statuses', 'list_objects', 'get_object', 'update_task'],
      prompt: 'List task objects, inspect unclear items, then update only fields the user explicitly confirms or that match the agreed triage rule.',
    },
    {
      id: 'research_synthesis',
      title: 'Research synthesis',
      goal: 'Find relevant project sources and produce a citation-backed synthesis.',
      requiredScopes: ['search', 'read:objects', 'read:content'],
      toolSteps: ['wiki_search', 'wiki_get_page', 'wiki_related'],
      prompt: 'Search for the topic, read the top sources, follow related items, then answer with citations and a separate uncertainty list.',
    },
    {
      id: 'source_lookup',
      title: 'Source lookup',
      goal: 'Locate the source object behind a claim, task, or project reference.',
      requiredScopes: ['search', 'read:objects'],
      toolSteps: ['search_objects', 'wiki_search', 'wiki_get_page'],
      prompt: 'Search by title and content terms, return the best matching object IDs/deep links, and explain which matched fields support each result.',
    },
  ]
}
