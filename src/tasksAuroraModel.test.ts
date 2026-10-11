import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeToolCall, formatToolResult } from './tools.js'
import { getTaskProps, readTaskLists, resetAuroraClientForTests, updateTaskProps } from './auroraClient.js'
import {
  BUILTIN_TASK_STATUSES,
  isCompletedTaskStatus,
  matchTaskStatus,
  openTaskStatusId,
  resolveWorkspaceTaskStatuses,
  workspaceConfigObjectId,
} from './taskStatuses.js'
import { nextRecurrenceDue, recurrenceSuccessorId } from './taskRecurrence.js'
import { buildWeekPlan } from './planningTools.js'

const WS = 'workspace-1'

type Row = Record<string, unknown>

/** A small in-memory AuroraCloud: objects, object_properties and the legacy task_lists table. */
class FakeCloud {
  objects = new Map<string, Row>()
  props: Row[] = []
  legacyLists: Row[] = []
  legacyStatus = 200
  writes: string[] = []
  private nextId = 1

  object(id: string, type: string, title: string | null, extra: Row = {}): void {
    this.objects.set(id, {
      id, workspace_id: WS, type, title, icon: null, parent_id: null, is_deleted: false, is_template: false,
      created_at: `2026-10-01T10:00:0${this.objects.size}Z`, updated_at: '2026-10-01T12:00:00Z', ...extra,
    })
  }

  prop(objectId: string, key: string, value: Row): void {
    this.props.push({
      id: `p${this.nextId++}`, object_id: objectId, workspace_id: WS, key, value_type: 'text',
      value_text: null, value_num: null, value_date: null, value_bool: null, value_ref: null, ...value,
    })
  }

  propsOf(objectId: string): Record<string, Row> {
    return Object.fromEntries(this.props.filter((prop) => prop.object_id === objectId).map((prop) => [prop.key, prop]))
  }

  handle = (req: IncomingMessage, res: ServerResponse<IncomingMessage>, url: URL, body: Row | null): void => {
    const send = (status: number, payload: unknown) => { res.statusCode = status; res.end(JSON.stringify(payload)) }
    const page = (items: Row[]) => send(200, { items, page: 1, perPage: 50, totalPages: 1, totalItems: items.length })
    const filter = url.searchParams.get('filter') ?? ''
    const path = url.pathname
    if (req.method !== 'GET') this.writes.push(`${req.method} ${path}`)

    if (path === '/api/collections/task_lists/records') {
      if (this.legacyStatus !== 200) return send(this.legacyStatus, { error: 'gone' })
      return page(this.legacyLists)
    }
    if (path === '/api/collections/objects/records' && req.method === 'GET') {
      const type = filter.match(/type = "([^"]+)"/)?.[1]
      return page([...this.objects.values()].filter((object) => !type || object.type === type))
    }
    if (path === '/api/collections/objects/records' && req.method === 'POST') {
      const id = String(body?.['id'] ?? `obj${this.nextId++}`)
      this.object(id, String(body?.['type']), (body?.['title'] as string) ?? null, {
        icon: body?.['icon'] || null, parent_id: body?.['parent_id'] || null,
      })
      return send(200, this.objects.get(id))
    }
    if (path.startsWith('/api/collections/objects/records/')) {
      const id = decodeURIComponent(path.split('/').pop() ?? '')
      const object = this.objects.get(id)
      if (!object) return send(404, { error: 'not found' })
      if (req.method === 'PATCH') Object.assign(object, body)
      return send(200, object)
    }
    if (path === '/api/collections/object_properties/records' && req.method === 'GET') {
      const ids = [...filter.matchAll(/object_id = "([^"]+)"/g)].map((match) => match[1])
      const key = filter.match(/key = "([^"]+)"/)?.[1]
      return page(this.props.filter((prop) => ids.includes(String(prop.object_id)) && (!key || prop.key === key)))
    }
    if (path === '/api/collections/object_properties/records' && req.method === 'POST') {
      this.prop(String(body?.['object_id']), String(body?.['key']), body ?? {})
      return send(200, this.props.at(-1))
    }
    if (path.startsWith('/api/collections/object_properties/records/') && req.method === 'PATCH') {
      const prop = this.props.find((candidate) => candidate.id === path.split('/').pop())
      if (!prop) return send(404, { error: 'not found' })
      Object.assign(prop, body)
      return send(200, prop)
    }
    return send(404, { error: 'not found' })
  }
}

async function withCloud(cloud: FakeCloud, run: () => Promise<void>): Promise<void> {
  const previous = process.env['AURORA_API_URL']
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    let raw = ''
    req.on('data', (chunk) => { raw += String(chunk) })
    req.on('end', () => cloud.handle(req, res, url, raw ? JSON.parse(raw) as Row : null))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    resetAuroraClientForTests()
    await run()
  } finally {
    if (previous === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previous
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

const CUSTOM_CONFIG = JSON.stringify({
  version: 1,
  statuses: {
    Idea: { color: '#999', order: 0, group: 'todo', updatedAt: '2026-10-01T00:00:00.000Z' },
    Doing: { color: '#00f', order: 1, group: 'inProgress', updatedAt: '2026-10-01T00:00:00.000Z' },
    Shipped: { color: '#0f0', order: 2, group: 'done', updatedAt: '2026-10-01T00:00:00.000Z' },
    "Won't do": { color: '#f00', order: 3, group: 'done', updatedAt: '2026-10-01T00:00:00.000Z' },
    Todo: { color: '#ccc', order: 4, updatedAt: '2026-10-02T00:00:00.000Z', deleted: true },
  },
  aliases: { Done: { to: 'Shipped', updatedAt: '2026-10-01T00:00:00.000Z' } },
})

// ── Statuses (#36) ───────────────────────────────────────────────────────────

test('built-in statuses match Aurora: Backlog, Todo, In Progress, Done with groups', () => {
  assert.deepEqual(BUILTIN_TASK_STATUSES.map((status) => [status.id, status.group]), [
    ['Backlog', 'todo'], ['Todo', 'todo'], ['In Progress', 'inProgress'], ['Done', 'done'],
  ])
  const resolved = resolveWorkspaceTaskStatuses(null)
  assert.equal(resolved.source, 'builtin')
  assert.equal(isCompletedTaskStatus('Done', resolved.judged), true)
  assert.equal(isCompletedTaskStatus('Cancelled', resolved.judged), false)
})

test('a synced config gives custom statuses, drops tombstones, keeps order and judges aliases by their target', () => {
  const resolved = resolveWorkspaceTaskStatuses(CUSTOM_CONFIG)
  assert.equal(resolved.source, 'workspace')
  assert.deepEqual(resolved.statuses.map((status) => status.id), ['Idea', 'Doing', 'Shipped', "Won't do"])
  assert.equal(isCompletedTaskStatus("Won't do", resolved.judged), true)
  assert.equal(isCompletedTaskStatus('Done', resolved.judged), true)
  assert.equal(isCompletedTaskStatus('Doing', resolved.judged), false)
  // Todo was deleted, so a new occurrence starts in the first open status.
  assert.equal(openTaskStatusId(resolved.judged), 'Idea')
})

test('encrypted, newer and broken configs fall back to the built-ins and say why', () => {
  assert.equal(resolveWorkspaceTaskStatuses('__e2ee__{"v":2}').source, 'encrypted')
  assert.equal(resolveWorkspaceTaskStatuses(JSON.stringify({ version: 2, statuses: {} })).source, 'unsupported')
  assert.equal(resolveWorkspaceTaskStatuses('not json').source, 'builtin')
  assert.deepEqual(resolveWorkspaceTaskStatuses('__e2ee__x').statuses.map((status) => status.id), ['Backlog', 'Todo', 'In Progress', 'Done'])
})

test('status matching is case- and spacing-insensitive and keeps the old MCP spelling working', () => {
  assert.equal(matchTaskStatus('To Do', BUILTIN_TASK_STATUSES), 'Todo')
  assert.equal(matchTaskStatus('in progress', BUILTIN_TASK_STATUSES), 'In Progress')
  assert.equal(matchTaskStatus('In Review', BUILTIN_TASK_STATUSES), null)
})

test('the workspace config object id matches the formula Aurora uses', () => {
  assert.equal(workspaceConfigObjectId(WS), 'urggf6h7bs1ddil')
})

test('list_task_statuses reads the workspace config object', async () => {
  const cloud = new FakeCloud()
  cloud.prop(workspaceConfigObjectId(WS), 'task_statuses', { value_text: CUSTOM_CONFIG })
  await withCloud(cloud, async () => {
    const result = await executeToolCall('list_task_statuses', {}, WS)
    assert.deepEqual(result, {
      type: 'task_statuses',
      statuses: ['Idea', 'Doing', 'Shipped', "Won't do"],
      status_definitions: [
        { id: 'Idea', group: 'todo' }, { id: 'Doing', group: 'inProgress' },
        { id: 'Shipped', group: 'done' }, { id: "Won't do", group: 'done' },
      ],
      source: 'workspace',
    })
  })
})

test('list_task_statuses explains an encrypted config', async () => {
  const cloud = new FakeCloud()
  cloud.prop(workspaceConfigObjectId(WS), 'task_statuses', { value_text: '__e2ee__ciphertext' })
  await withCloud(cloud, async () => {
    const result = await executeToolCall('list_task_statuses', {}, WS) as { source: string; note?: string; statuses: string[] }
    assert.equal(result.source, 'encrypted')
    assert.match(result.note ?? '', /end-to-end encrypted/)
    assert.deepEqual(result.statuses, ['Backlog', 'Todo', 'In Progress', 'Done'])
  })
})

test('update_task rejects an unknown status before writing anything', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', 'Write report')
  await withCloud(cloud, async () => {
    const result = await executeToolCall('update_task', { id: 'task-1', status: 'Cancelled', title: 'New' }, WS) as { type: string; message?: string }
    assert.equal(result.type, 'error')
    assert.match(result.message ?? '', /Unknown task status: Cancelled\. Use one of: Backlog, Todo, In Progress, Done/)
  })
  assert.deepEqual(cloud.writes, [])
})

test('week plan and scheduling treat every done-group status as complete', async () => {
  const statuses = resolveWorkspaceTaskStatuses(CUSTOM_CONFIG)
  const plan = buildWeekPlan([
    { id: 'a', title: 'Shipped', status: 'Shipped', due_date: null, updated_at: null, labels: [] },
    { id: 'b', title: 'Wont', status: "Won't do", due_date: null, updated_at: null, labels: [] },
    { id: 'c', title: 'Open', status: 'Doing', due_date: null, updated_at: null, labels: [] },
  ], { anchorDate: '2026-10-12', includeUnscheduled: true, unscheduledLimit: 10, isDone: (status) => isCompletedTaskStatus(status, statuses.judged) })
  assert.deepEqual(plan.unscheduled.map((task) => task.id), ['c'])

  const cloud = new FakeCloud()
  cloud.prop(workspaceConfigObjectId(WS), 'task_statuses', { value_text: CUSTOM_CONFIG })
  cloud.object('task-1', 'task', 'Done already')
  cloud.prop('task-1', 'status', { value_text: "Won't do" })
  await withCloud(cloud, async () => {
    const result = await executeToolCall('schedule_task_block', { mode: 'schedule_existing_task', task_id: 'task-1', date: '2026-10-13' }, WS) as { message?: string }
    assert.match(result.message ?? '', /Completed tasks cannot be scheduled/)
  })
})

// ── Task lists (#35) ─────────────────────────────────────────────────────────

function seedLists(cloud: FakeCloud): void {
  cloud.object('obj-groceries', 'task_list', 'Groceries')
  cloud.prop('obj-groceries', 'list_id', { value_text: 'list-groceries' })
  cloud.prop('obj-groceries', 'position', { value_type: 'number', value_num: 2 })
  cloud.object('obj-work', 'task_list', 'Work')
  cloud.prop('obj-work', 'list_id', { value_text: 'list-work' })
  cloud.prop('obj-work', 'position', { value_type: 'number', value_num: 1 })
  cloud.prop('obj-work', 'default_status', { value_text: 'In Progress' })
  cloud.object('obj-gone', 'task_list', 'Old list', { is_deleted: true })
  cloud.prop('obj-gone', 'list_id', { value_text: 'list-gone' })
  cloud.object('obj-pending', 'task_list', 'No id yet')
  // Legacy rows: one converted (object wins), one deleted as an object, one only in the table.
  cloud.legacyLists = [
    { id: 'list-work', workspace_id: WS, name: 'Work (stale)', default_status: null },
    { id: 'list-gone', workspace_id: WS, name: 'Old list', default_status: null },
    { id: 'list-legacy', workspace_id: WS, name: 'Legacy only', default_status: null },
  ]
}

test('task lists come from task_list objects, ordered by position, with legacy-only lists merged in', async () => {
  const cloud = new FakeCloud()
  seedLists(cloud)
  cloud.object('page-1', 'page', 'A page')
  await withCloud(cloud, async () => {
    const result = await executeToolCall('list_task_lists', {}, WS)
    assert.deepEqual(result, {
      type: 'task_lists',
      task_lists: [
        { id: 'list-work', name: 'Work' },
        { id: 'list-groceries', name: 'Groceries' },
        { id: 'list-legacy', name: 'Legacy only' },
      ],
    })
  })
})

test('a retired legacy table (410 or 404) leaves the object lists', async () => {
  for (const status of [404, 410]) {
    const cloud = new FakeCloud()
    seedLists(cloud)
    cloud.legacyStatus = status
    await withCloud(cloud, async () => {
      const snapshot = await readTaskLists(WS)
      assert.deepEqual(snapshot.lists.map((list) => list.id), ['list-work', 'list-groceries'])
    })
  }
})

test('encrypted list names are counted and explained instead of shown', async () => {
  const cloud = new FakeCloud()
  seedLists(cloud)
  cloud.object('obj-secret', 'task_list', '__e2ee__title')
  cloud.prop('obj-secret', 'list_id', { value_text: '__e2ee__id' })
  await withCloud(cloud, async () => {
    const result = await executeToolCall('list_task_lists', {}, WS) as { encrypted_lists?: number; note?: string; task_lists: Array<{ name: string }> }
    assert.equal(result.encrypted_lists, 1)
    assert.match(result.note ?? '', /end-to-end encrypted/)
    assert.ok(result.task_lists.every((list) => !list.name.startsWith('__e2ee__')))

    const missing = await executeToolCall('create_task', { title: 'x', task_list: 'Secret' }, WS) as { message?: string }
    assert.match(missing.message ?? '', /end-to-end encrypted/)
  })
})

test('create_task resolves a new list by name, writes task_list_id as text and applies its default status', async () => {
  const cloud = new FakeCloud()
  seedLists(cloud)
  await withCloud(cloud, async () => {
    const result = await executeToolCall('create_task', { title: 'Plan sprint', task_list: 'work' }, WS) as { id: string; status: string | null; task_list_name: string | null }
    assert.equal(result.task_list_name, 'Work')
    assert.equal(result.status, 'In Progress')
    const props = cloud.propsOf(result.id)
    assert.equal(props['task_list_id']?.value_type, 'text')
    assert.equal(props['task_list_id']?.value_text, 'list-work')
    assert.equal(props['task_list_id']?.value_ref ?? null, null)
    assert.equal(props['status']?.value_text, 'In Progress')
  })
})

// ── Assignees and labels in Aurora's format ─────────────────────────────────

test('assignees and labels are read from the app format and from older MCP JSON', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-app', 'task', 'Set by the app')
  cloud.prop('task-app', 'assignee', { value_text: 'user-a, user-b' })
  cloud.prop('task-app', 'tags', { value_text: 'urgent,client' })
  cloud.prop('task-app', 'labels', { value_text: 'old-label' })
  cloud.object('task-mcp', 'task', 'Set by an older MCP')
  cloud.prop('task-mcp', 'assignees', { value_text: '["user-c"]' })
  cloud.prop('task-mcp', 'labels', { value_text: '["legacy","urgent"]' })
  await withCloud(cloud, async () => {
    const app = await getTaskProps('task-app', WS)
    assert.deepEqual(app.assignees, ['user-a', 'user-b'])
    assert.deepEqual(app.labels, ['urgent', 'client', 'old-label'])
    const mcp = await getTaskProps('task-mcp', WS)
    assert.deepEqual(mcp.assignees, ['user-c'])
    assert.deepEqual(mcp.labels, ['legacy', 'urgent'])
  })
})

test('assignees and labels are written as Aurora writes them: assignee and tags as comma-separated text', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', 'Write report')
  await withCloud(cloud, async () => {
    await updateTaskProps('task-1', WS, { assignees: ['user-a', ' user-b ', 'user-a'], labels: ['urgent', 'client', 'urgent', ''] })
  })
  const props = cloud.propsOf('task-1')
  assert.equal(props['assignee']?.value_type, 'text')
  assert.equal(props['assignee']?.value_text, 'user-a,user-b')
  assert.equal(props['tags']?.value_type, 'text')
  assert.equal(props['tags']?.value_text, 'urgent,client')
  assert.equal(props['assignees'], undefined)
  assert.equal(props['labels'], undefined)
})

test('writing replaces older MCP JSON values so the app sees them, and empty lists clear', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', 'Write report')
  cloud.prop('task-1', 'assignees', { value_text: '["user-c"]' })
  cloud.prop('task-1', 'labels', { value_text: '["legacy"]' })
  cloud.prop('task-1', 'tags', { value_text: 'kept' })
  await withCloud(cloud, async () => {
    await updateTaskProps('task-1', WS, { assignees: ['user-a'], labels: ['fresh'] })
    let props = cloud.propsOf('task-1')
    assert.equal(props['assignee']?.value_text, 'user-a')
    assert.equal(props['assignees']?.value_text, null)
    assert.equal(props['tags']?.value_text, 'fresh')
    assert.equal(props['labels']?.value_text, null)
    assert.deepEqual((await getTaskProps('task-1', WS)).labels, ['fresh'])

    await updateTaskProps('task-1', WS, { assignees: [], labels: [] })
    props = cloud.propsOf('task-1')
    assert.equal(props['assignee']?.value_text, null)
    assert.equal(props['tags']?.value_text, null)
    const read = await getTaskProps('task-1', WS)
    assert.deepEqual(read.assignees, [])
    assert.deepEqual(read.labels, [])
  })
})

test('any later write to a task moves older MCP JSON labels into tags', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', 'Write report')
  cloud.prop('task-1', 'labels', { value_text: '["legacy"]' })
  cloud.prop('task-1', 'tags', { value_text: 'urgent' })
  await withCloud(cloud, async () => {
    await updateTaskProps('task-1', WS, { priority: 'high' })
  })
  const props = cloud.propsOf('task-1')
  assert.equal(props['priority']?.value_text, 'high')
  assert.equal(props['tags']?.value_text, 'urgent,legacy')
  assert.equal(props['labels']?.value_text, null)
})

test('older MCP assignees are shown while assignee is empty but never copied back on an unrelated write', async () => {
  // An empty `assignee` may be the app clearing everyone; restoring the old
  // value would undo that.
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', 'Write report')
  cloud.prop('task-1', 'assignees', { value_text: '["user-c","user-d"]' })
  await withCloud(cloud, async () => {
    assert.deepEqual((await getTaskProps('task-1', WS)).assignees, ['user-c', 'user-d'])
    await updateTaskProps('task-1', WS, { priority: 'high' })
  })
  const props = cloud.propsOf('task-1')
  assert.equal(props['assignee'], undefined)
  assert.equal(props['assignees']?.value_text, '["user-c","user-d"]')
})

test('a current assignee set in the app wins over a stale older MCP value', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', 'Write report')
  cloud.prop('task-1', 'assignees', { value_text: '["user-a"]' })
  cloud.prop('task-1', 'assignee', { value_text: 'user-b' })
  await withCloud(cloud, async () => {
    assert.deepEqual((await getTaskProps('task-1', WS)).assignees, ['user-b'])
    await updateTaskProps('task-1', WS, { priority: 'high' })
    assert.equal(cloud.propsOf('task-1')['assignee']?.value_text, 'user-b')
    await updateTaskProps('task-1', WS, { assignees: ['user-b', 'user-e'] })
    assert.equal(cloud.propsOf('task-1')['assignee']?.value_text, 'user-b,user-e')
    assert.equal(cloud.propsOf('task-1')['assignees']?.value_text, null)
  })
})

test('encrypted tags are not mixed with older MCP labels on an unrelated write', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', 'Write report')
  cloud.prop('task-1', 'tags', { value_text: '__e2ee__ciphertext' })
  cloud.prop('task-1', 'labels', { value_text: '["legacy"]' })
  await withCloud(cloud, async () => {
    await updateTaskProps('task-1', WS, { priority: 'high' })
  })
  const props = cloud.propsOf('task-1')
  assert.equal(props['tags']?.value_text, '__e2ee__ciphertext')
  assert.equal(props['labels']?.value_text, '["legacy"]')
})

test('update_task refuses to overwrite encrypted labels or assignees and changes nothing', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', 'Write report')
  cloud.prop('task-1', 'tags', { value_text: '__e2ee__ciphertext' })
  cloud.prop('task-1', 'assignee', { value_text: '__e2ee__other' })
  await withCloud(cloud, async () => {
    const labels = await executeToolCall('update_task', { id: 'task-1', title: 'Renamed', priority: 'high', labels: ['plain'] }, WS) as { type: string; message?: string }
    assert.equal(labels.type, 'error')
    assert.match(labels.message ?? '', /labels are end-to-end encrypted/)
    await assert.rejects(updateTaskProps('task-1', WS, { assignees: [] }), /assignees are end-to-end encrypted/)
  })
  assert.deepEqual(cloud.writes, [])
  assert.equal(cloud.objects.get('task-1')?.title, 'Write report')
  assert.equal(cloud.propsOf('task-1')['tags']?.value_text, '__e2ee__ciphertext')
})

test('the app\'s own comma-separated labels are left in place when they are not being changed', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', 'Write report')
  cloud.prop('task-1', 'labels', { value_text: 'from-app' })
  await withCloud(cloud, async () => {
    await updateTaskProps('task-1', WS, { priority: 'low' })
  })
  assert.equal(cloud.propsOf('task-1')['labels']?.value_text, 'from-app')
  assert.equal(cloud.propsOf('task-1')['tags'], undefined)
})

// ── Recurring tasks (#39) ────────────────────────────────────────────────────

test('next due date steps the rule like Aurora and keeps the time of day', () => {
  assert.deepEqual(nextRecurrenceDue('FREQ=DAILY', '2026-10-11'), { date: '2026-10-12', dueDate: '2026-10-12' })
  assert.deepEqual(nextRecurrenceDue('FREQ=DAILY;INTERVAL=3', '2026-10-11T09:30'), { date: '2026-10-14', dueDate: '2026-10-14T09:30' })
  // 2026-10-12 is a Monday.
  assert.deepEqual(nextRecurrenceDue('FREQ=WEEKLY;BYDAY=MO,TH', '2026-10-12'), { date: '2026-10-15', dueDate: '2026-10-15' })
  assert.deepEqual(nextRecurrenceDue('FREQ=WEEKLY;INTERVAL=2', '2026-10-12'), { date: '2026-10-26', dueDate: '2026-10-26' })
  assert.deepEqual(nextRecurrenceDue('FREQ=MONTHLY', '2026-01-31'), { date: '2026-02-28', dueDate: '2026-02-28' })
  assert.deepEqual(nextRecurrenceDue('FREQ=YEARLY', '2026-10-11'), { date: '2027-10-11', dueDate: '2027-10-11' })
  assert.equal(nextRecurrenceDue('FREQ=DAILY;UNTIL=20261011', '2026-10-11'), null)
  assert.equal(nextRecurrenceDue('nonsense', '2026-10-11'), null)
  assert.deepEqual(nextRecurrenceDue('FREQ=DAILY', null, new Date(2026, 9, 11, 15)), { date: '2026-10-12', dueDate: '2026-10-12' })
})

test('the next occurrence id matches the formula Aurora uses', () => {
  assert.equal(recurrenceSuccessorId('task-1', '2026-10-12'), 'b1f86d8d840c60d')
})

function seedRecurring(cloud: FakeCloud): void {
  cloud.object('task-1', 'task', 'Water plants', { icon: '🌱', parent_id: 'project-1' })
  cloud.prop('task-1', 'status', { value_type: 'select', value_text: 'Todo' })
  cloud.prop('task-1', 'due_date', { value_type: 'date', value_date: '2026-10-11T08:00' })
  cloud.prop('task-1', 'recurrence', { value_text: 'FREQ=DAILY' })
  cloud.prop('task-1', 'priority', { value_type: 'select', value_text: 'high' })
  cloud.prop('task-1', 'assignee', { value_text: 'user-1,user-2' })
  cloud.prop('task-1', 'tags', { value_text: 'home' })
  cloud.prop('task-1', 'labels', { value_text: '["garden"]' })
  cloud.prop('task-1', 'description', { value_text: 'Both balconies' })
  cloud.prop('task-1', 'task_list_id', { value_text: 'list-home' })
}

test('completing a recurring task creates the next occurrence, records it and strips the rule', async () => {
  const cloud = new FakeCloud()
  seedRecurring(cloud)
  const successorId = recurrenceSuccessorId('task-1', '2026-10-12')
  await withCloud(cloud, async () => {
    const result = await executeToolCall('update_task', { id: 'task-1', status: 'done' }, WS)
    assert.deepEqual(result, {
      type: 'task_updated',
      id: 'task-1',
      title: 'Water plants',
      changed_fields: ['status'],
      next_occurrence: { id: successorId, due_date: '2026-10-12T08:00', created: true },
    })
  })
  const successor = cloud.objects.get(successorId)
  assert.equal(successor?.['title'], 'Water plants')
  assert.equal(successor?.['icon'], '🌱')
  assert.equal(successor?.['parent_id'], 'project-1')
  const props = cloud.propsOf(successorId)
  assert.deepEqual(Object.fromEntries(Object.entries(props).map(([key, prop]) => [key, [prop.value_type, prop.value_text ?? prop.value_date]])), {
    status: ['select', 'Todo'],
    due_date: ['date', '2026-10-12T08:00'],
    recurrence: ['text', 'FREQ=DAILY'],
    priority: ['select', 'high'],
    assignee: ['text', 'user-1,user-2'],
    tags: ['text', 'home,garden'],
    description: ['text', 'Both balconies'],
    task_list_id: ['text', 'list-home'],
  })
  const source = cloud.propsOf('task-1')
  assert.equal(source['status']?.value_text, 'Done')
  assert.equal(source['recurrence']?.value_text, null)
  assert.deepEqual(JSON.parse(String(source['recurrence_next']?.value_text)), {
    id: successorId, date: '2026-10-12', rule: 'FREQ=DAILY', fp: null, state: 'live',
  })
})

test('an occurrence the app already created and recorded is left alone and nothing is duplicated', async () => {
  const cloud = new FakeCloud()
  seedRecurring(cloud)
  const successorId = recurrenceSuccessorId('task-1', '2026-10-12')
  // The app completed the task: its marker arrived, the rule removal has not yet.
  cloud.prop('task-1', 'recurrence_next', { value_text: JSON.stringify({ id: successorId, date: '2026-10-12', rule: 'FREQ=DAILY', fp: 'abc', state: 'live' }) })
  cloud.object(successorId, 'task', 'Water plants (edited)')
  cloud.prop(successorId, 'status', { value_type: 'select', value_text: 'In Progress' })
  await withCloud(cloud, async () => {
    const result = await executeToolCall('update_task', { id: 'task-1', status: 'Done' }, WS) as { next_occurrence?: { created: boolean } }
    assert.equal(result.next_occurrence?.created, false)
    // Completing again finds no rule, so nothing else happens.
    const again = await executeToolCall('update_task', { id: 'task-1', status: 'Done' }, WS) as { next_occurrence?: unknown }
    assert.equal(again.next_occurrence, undefined)
  })
  assert.equal(cloud.writes.filter((write) => write === 'POST /api/collections/objects/records').length, 0)
  assert.equal(cloud.objects.get(successorId)?.['title'], 'Water plants (edited)')
  assert.equal(cloud.propsOf(successorId)['status']?.value_text, 'In Progress')
  assert.equal(Object.keys(cloud.propsOf(successorId)).length, 1)
  assert.equal(JSON.parse(String(cloud.propsOf('task-1')['recurrence_next']?.value_text)).fp, 'abc')
})

test('a custom done status completes the task, and the new occurrence starts in the first open status', async () => {
  const cloud = new FakeCloud()
  seedRecurring(cloud)
  cloud.prop(workspaceConfigObjectId(WS), 'task_statuses', { value_text: CUSTOM_CONFIG })
  await withCloud(cloud, async () => {
    const result = await executeToolCall('update_task', { id: 'task-1', status: 'shipped' }, WS) as { next_occurrence?: { id: string } }
    assert.ok(result.next_occurrence)
    assert.equal(cloud.propsOf(result.next_occurrence.id)['status']?.value_text, 'Idea')
  })
})

test('moving a recurring task to an open status creates nothing', async () => {
  const cloud = new FakeCloud()
  seedRecurring(cloud)
  await withCloud(cloud, async () => {
    const result = await executeToolCall('update_task', { id: 'task-1', status: 'In Progress' }, WS) as { next_occurrence?: unknown }
    assert.equal(result.next_occurrence, undefined)
  })
  assert.equal(cloud.propsOf('task-1')['recurrence']?.value_text, 'FREQ=DAILY')
  assert.equal(cloud.writes.filter((write) => write.startsWith('POST /api/collections/objects')).length, 0)
})

test('an encrypted recurring task is completed but its series is left to the app', async () => {
  const cloud = new FakeCloud()
  cloud.object('task-1', 'task', '__e2ee__title')
  cloud.prop('task-1', 'recurrence', { value_text: '__e2ee__rule' })
  await withCloud(cloud, async () => {
    const result = await executeToolCall('update_task', { id: 'task-1', status: 'Done' }, WS) as { note?: string; next_occurrence?: unknown }
    assert.equal(result.next_occurrence, undefined)
    assert.match(result.note ?? '', /end-to-end encrypted/)
  })
  assert.equal(cloud.writes.filter((write) => write.startsWith('POST /api/collections/objects')).length, 0)
})

test('a successor left half-written by an interrupted completion is finished without overwriting what is set', async () => {
  const cloud = new FakeCloud()
  seedRecurring(cloud)
  const successorId = recurrenceSuccessorId('task-1', '2026-10-12')
  // An earlier attempt created the object and its status, then failed.
  cloud.object(successorId, 'task', 'Water plants')
  cloud.prop(successorId, 'status', { value_type: 'select', value_text: 'In Progress' })
  await withCloud(cloud, async () => {
    const result = await executeToolCall('update_task', { id: 'task-1', status: 'Done' }, WS) as { next_occurrence?: { created: boolean } }
    assert.equal(result.next_occurrence?.created, false)
  })
  const props = cloud.propsOf(successorId)
  assert.equal(props['status']?.value_text, 'In Progress')
  assert.equal(props['due_date']?.value_date, '2026-10-12T08:00')
  assert.equal(props['recurrence']?.value_text, 'FREQ=DAILY')
  assert.equal(props['task_list_id']?.value_text, 'list-home')
  assert.equal(cloud.props.filter((prop) => prop.object_id === successorId && prop.key === 'status').length, 1)
})

test('text results carry the next occurrence and encryption notes', () => {
  assert.equal(formatToolResult({
    type: 'task_updated', id: 't', title: 'T', changed_fields: ['status'],
    next_occurrence: { id: 'n', due_date: '2026-10-12', created: true },
  }), 'Task updated: "T" (t) — changed: status\nNext occurrence created: n due 2026-10-12')
  assert.match(formatToolResult({
    type: 'task_updated', id: 't', title: 'T', changed_fields: ['status'], note: 'encrypted series',
  }), /Note: encrypted series/)
  assert.match(formatToolResult({ type: 'task_lists', task_lists: [], encrypted_lists: 2, note: '2 encrypted' }), /No readable task lists found\.\nNote: 2 encrypted/)
  assert.equal(formatToolResult({
    type: 'task_statuses', statuses: ['Todo', 'Done'], source: 'builtin',
    status_definitions: [{ id: 'Todo', group: 'todo' }, { id: 'Done', group: 'done' }],
  }), 'Todo (todo), Done (done)')
})
