import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  getMcpToolCoverageAudit,
  getMcpWorkflowRecipes,
  getToolEffect,
  getToolEffects,
  getToolDefinitions,
} from './toolCatalog.js'
import { executeToolCall, formatToolResult } from './tools.js'
import { resetAuroraClientForTests } from './auroraClient.js'

test('MCP tool catalog exposes planning and canvas coverage with priorities', () => {
  const audit = getMcpToolCoverageAudit()
  const areas = new Map(audit.areas.map((area) => [area.id, area]))

  assert.equal(areas.get('knowledge')?.status, 'covered')
  assert.equal(areas.get('tasks')?.status, 'covered')
  assert.equal(areas.get('calendar')?.status, 'covered')
  assert.deepEqual(areas.get('calendar')?.implementedTools, ['list_week_plan', 'schedule_task_block'])
  assert.deepEqual(areas.get('calendar')?.missingTools, [])
  assert.equal(areas.get('canvas')?.status, 'covered')
  assert.deepEqual(areas.get('canvas')?.implementedTools, ['read_canvas'])
  assert.deepEqual(areas.get('canvas')?.missingTools, [])
})

test('MCP workflow recipes provide usable agent task plans', () => {
  const recipes = getMcpWorkflowRecipes()
  const ids = recipes.map((recipe) => recipe.id)

  assert.deepEqual(ids, ['weekly_summary', 'task_triage', 'research_synthesis', 'source_lookup'])
  assert.ok(recipes.every((recipe) => recipe.toolSteps.length > 0))
  assert.ok(recipes.find((recipe) => recipe.id === 'task_triage')?.toolSteps.includes('update_task'))
})

test('MCP catalog tools are registered and formatted as read-only results', async () => {
  const toolNames = getToolDefinitions().map((tool) => tool.name)
  assert.ok(toolNames.includes('get_mcp_tool_coverage'))
  assert.ok(toolNames.includes('get_mcp_workflow_recipes'))
  assert.ok(toolNames.includes('list_week_plan'))
  assert.ok(toolNames.includes('read_canvas'))
  assert.ok(toolNames.includes('schedule_task_block'))

  const result = await executeToolCall('get_mcp_workflow_recipes', {}, 'workspace-1')
  assert.equal(result.type, 'mcp_workflow_recipes')
  assert.match(formatToolResult(result), /weekly_summary/)
  assert.match(formatToolResult(result), /wiki_search/)
})

test('MCP tool catalog authoritatively classifies every registered tool effect', () => {
  const expected = {
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
  } as const
  const toolNames = getToolDefinitions().map((tool) => tool.name).sort()

  assert.deepEqual(getToolEffects(), expected)
  assert.deepEqual(Object.keys(getToolEffects()).sort(), toolNames)
  assert.equal(getToolEffect('unknown_tool'), undefined)
})

test('read_canvas validates required id before reading workspace content', async () => {
  const result = await executeToolCall('read_canvas', {}, 'workspace-1')

  assert.deepEqual(result, { type: 'error', message: 'Canvas object ID is required' })
})

test('read_canvas reads canvas content and can omit card text', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')

    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/canvas-1') {
      res.end(JSON.stringify({
        id: 'canvas-1',
        workspace_id: 'workspace-1',
        type: 'canvas',
        title: 'Launch map',
        icon: null,
        parent_id: null,
        is_deleted: false,
        is_template: false,
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T12:00:00Z',
      }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/collections/content/records') {
      res.end(JSON.stringify({
        items: [
          {
            id: 'content-1',
            object_id: 'canvas-1',
            content_json: {
              cards: [
                { id: 'card-1', type: 'text', x: 10, y: 20, w: 200, h: 100, text: 'Hidden details' },
              ],
              edges: [
                { id: 'edge-1', fromCard: 'card-1', toCard: 'card-2', label: 'next' },
              ],
            },
          },
        ],
        totalPages: 1,
      }))
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)
  const port = (address as AddressInfo).port

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${port}`
    resetAuroraClientForTests()

    const result = await executeToolCall('read_canvas', { id: 'canvas-1', include_text: false }, 'workspace-1')

    assert.equal(result.type, 'canvas')
    assert.equal(result.canvas.cards[0].text, null)
    const text = formatToolResult(result)
    assert.match(text, /Canvas: Launch map \(canvas-1\)/)
    assert.match(text, /card-1 \[text\] x=10 y=20 w=200 h=100/)
    assert.match(text, /edge-1: card-1 -> card-2 \(next\)/)
    assert.doesNotMatch(text, /Hidden details/)
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve())
    })
  }
})

test('list_week_plan validates anchor_date before reading workspace tasks', async () => {
  const result = await executeToolCall('list_week_plan', { anchor_date: '2026/07/07' }, 'workspace-1')

  assert.deepEqual(result, { type: 'error', message: 'anchor_date must be a valid date formatted YYYY-MM-DD' })
})

test('list_week_plan rejects impossible calendar dates before reading workspace tasks', async () => {
  const result = await executeToolCall('list_week_plan', { anchor_date: '2026-02-31' }, 'workspace-1')

  assert.deepEqual(result, { type: 'error', message: 'anchor_date must be a valid date formatted YYYY-MM-DD' })
})

test('schedule_task_block validates mode, date, and start_time before writing', async () => {
  assert.deepEqual(
    await executeToolCall('schedule_task_block', { mode: 'later', date: '2026-07-07' }, 'workspace-1'),
    { type: 'error', message: 'mode must be schedule_existing_task or create_time_block' },
  )
  assert.deepEqual(
    await executeToolCall('schedule_task_block', { mode: 'create_time_block', title: 'Focus', date: '2026-02-31' }, 'workspace-1'),
    { type: 'error', message: 'date must be a valid date formatted YYYY-MM-DD' },
  )
  assert.deepEqual(
    await executeToolCall('schedule_task_block', { mode: 'create_time_block', title: 'Focus', date: '2026-07-07', start_time: '24:99' }, 'workspace-1'),
    { type: 'error', message: 'start_time must be a valid time formatted HH:mm' },
  )
})

test('schedule_task_block preserves existing task time when scheduling an existing task', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const patches: Array<{ id: string; body: Record<string, unknown> }> = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')

    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/task-1') {
      res.end(JSON.stringify({
        id: 'task-1',
        workspace_id: 'workspace-1',
        type: 'task',
        title: 'Plan launch',
        icon: null,
        parent_id: null,
        is_deleted: false,
        is_template: false,
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T12:00:00Z',
      }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      const filter = url.searchParams.get('filter') ?? ''
      if (filter.includes('"due_date"')) {
        res.end(JSON.stringify({
          items: [
            { id: 'prop-due', object_id: 'task-1', key: 'due_date', value_type: 'date', value_date: '2026-07-06T14:45' },
          ],
          totalPages: 1,
        }))
        return
      }
      res.end(JSON.stringify({
        items: [
          { id: 'prop-status', object_id: 'task-1', key: 'status', value_type: 'text', value_text: 'Todo' },
          { id: 'prop-due', object_id: 'task-1', key: 'due_date', value_type: 'date', value_date: '2026-07-06T14:45' },
        ],
        totalPages: 1,
      }))
      return
    }

    if (req.method === 'PATCH' && url.pathname === '/api/collections/object_properties/records/prop-due') {
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => {
        patches.push({ id: 'prop-due', body: JSON.parse(body) as Record<string, unknown> })
        res.end(JSON.stringify({ id: 'prop-due' }))
      })
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)
  const port = (address as AddressInfo).port

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${port}`
    resetAuroraClientForTests()

    const result = await executeToolCall('schedule_task_block', {
      mode: 'schedule_existing_task',
      task_id: 'task-1',
      date: '2026-07-09',
    }, 'workspace-1')

    assert.deepEqual(result, {
      type: 'scheduled_task_block',
      id: 'task-1',
      title: 'Plan launch',
      due_date: '2026-07-09T14:45',
      mode: 'schedule_existing_task',
    })
    assert.deepEqual(patches, [
      { id: 'prop-due', body: { value_type: 'date', value_date: '2026-07-09T14:45' } },
    ])
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve())
    })
  }
})

test('schedule_task_block creates a task-backed time block with default scheduling metadata', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const createdProperties: Array<Record<string, unknown>> = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')

    if (req.method === 'POST' && url.pathname === '/api/collections/objects/records') {
      res.end(JSON.stringify({
        id: 'block-1',
        workspace_id: 'workspace-1',
        type: 'task',
        title: 'Deep work',
        icon: null,
        parent_id: null,
        is_deleted: false,
        is_template: false,
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T12:00:00Z',
      }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/block-1') {
      res.end(JSON.stringify({
        id: 'block-1',
        workspace_id: 'workspace-1',
        type: 'task',
        title: 'Deep work',
        icon: null,
        parent_id: null,
        is_deleted: false,
        is_template: false,
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T12:00:00Z',
      }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      res.end(JSON.stringify({ items: [], totalPages: 1 }))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/collections/object_properties/records') {
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => {
        createdProperties.push(JSON.parse(body) as Record<string, unknown>)
        res.end(JSON.stringify({ id: `prop-${createdProperties.length}` }))
      })
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)
  const port = (address as AddressInfo).port

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${port}`
    resetAuroraClientForTests()

    const result = await executeToolCall('schedule_task_block', {
      mode: 'create_time_block',
      title: 'Deep work',
      date: '2026-07-10',
    }, 'workspace-1')

    assert.deepEqual(result, {
      type: 'scheduled_task_block',
      id: 'block-1',
      title: 'Deep work',
      due_date: '2026-07-10T09:00',
      mode: 'create_time_block',
    })
    assert.deepEqual(
      new Map(createdProperties.map((property) => [property['key'], property])),
      new Map([
        ['due_date', { object_id: 'block-1', key: 'due_date', value_type: 'date', value_date: '2026-07-10T09:00' }],
        ['labels', { object_id: 'block-1', key: 'labels', value_type: 'text', value_text: JSON.stringify(['time-block', 'duration:30m']) }],
        ['description', { object_id: 'block-1', key: 'description', value_type: 'text', value_text: 'Duration: 30 minutes' }],
      ]),
    )
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve())
    })
  }
})

test('formatToolResult renders scheduled task blocks', () => {
  assert.equal(
    formatToolResult({
      type: 'scheduled_task_block',
      id: 'task-1',
      title: 'Plan launch',
      due_date: '2026-07-09T14:45',
      mode: 'schedule_existing_task',
    }),
    'Scheduled: Plan launch (task-1) due 2026-07-09T14:45 via schedule_existing_task',
  )
})

test('formatToolResult renders week planning days, time blocks, and unscheduled tasks', () => {
  const text = formatToolResult({
    type: 'week_plan',
    plan: {
      type: 'week_plan',
      range: { start: '2026-07-06', end: '2026-07-12' },
      days: [
        { date: '2026-07-06', tasks: [] },
        {
          date: '2026-07-07',
          tasks: [
            {
              id: 'task-1',
              title: 'Plan launch',
              status: 'Todo',
              due_date: '2026-07-07T09:00',
              updated_at: '2026-07-01T12:00:00Z',
              labels: [],
              timeBlock: { isTimeBlock: false, durationMinutes: null },
            },
            {
              id: 'block-1',
              title: 'Deep work',
              status: 'Todo',
              due_date: '2026-07-07T13:30',
              updated_at: '2026-07-01T12:00:00Z',
              labels: ['time-block', 'duration:60m'],
              timeBlock: { isTimeBlock: true, durationMinutes: 60 },
            },
          ],
        },
      ],
      unscheduled: [
        {
          id: 'task-2',
          title: null,
          status: 'Todo',
          due_date: null,
          updated_at: '2026-07-01T12:00:00Z',
          labels: [],
          timeBlock: { isTimeBlock: false, durationMinutes: null },
        },
      ],
    },
  })

  assert.match(text, /Week 2026-07-06 to 2026-07-12/)
  assert.match(text, /2026-07-06\n  - No scheduled tasks/)
  assert.match(text, /Plan launch \(task-1\) due 2026-07-07T09:00/)
  assert.match(text, /Deep work \(block-1\) due 2026-07-07T13:30 \[time block, 60m\]/)
  assert.match(text, /Unscheduled\n  - \(Untitled\) \(task-2\)/)
})
