import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeToolCall } from './tools.js'
import { getObject, listObjectsPage, resetAuroraClientForTests } from './auroraClient.js'
import { isHiddenSystemObjectType, isRetiredObjectType, uncreatableObjectTypeReason } from './objectTypes.js'

function record(id: string, type: string, title: string | null = id) {
  return {
    id,
    workspace_id: 'workspace-1',
    type,
    title,
    icon: null,
    parent_id: null,
    is_deleted: false,
    is_template: false,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
  }
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse<IncomingMessage>, url: URL) => void,
  run: () => Promise<void>,
): Promise<void> {
  const previous = process.env['AURORA_API_URL']
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    handler(req, res, url)
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

// Page 1 holds two hidden rows and one page; page 2 holds two more pages.
const PAGES: Record<number, ReturnType<typeof record>[]> = {
  1: [record('cfg', 'workspace_config', null), record('page-1', 'page'), record('list', 'task_list', 'Groceries')],
  2: [record('page-2', 'page'), record('page-3', 'note')],
}

function listHandler(requests: URL[]) {
  return (_req: IncomingMessage, res: ServerResponse<IncomingMessage>, url: URL) => {
    if (url.pathname === '/api/collections/objects/records') {
      requests.push(url)
      const page = Number(url.searchParams.get('page') ?? '1')
      res.end(JSON.stringify({ items: PAGES[page] ?? [], page, perPage: 3, totalPages: 2, totalItems: 5 }))
      return
    }
    if (url.pathname.startsWith('/api/collections/objects/records/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop() ?? '')
      const found = [...PAGES[1]!, ...PAGES[2]!].find((item) => item.id === id)
      res.statusCode = found ? 200 : 404
      res.end(JSON.stringify(found ?? { error: 'not found' }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }
}

test('type helpers know the hidden and retired types', () => {
  assert.equal(isHiddenSystemObjectType('workspace_config'), true)
  assert.equal(isHiddenSystemObjectType('task_list'), true)
  assert.equal(isHiddenSystemObjectType('task'), false)
  assert.equal(isRetiredObjectType('research_artifact'), true)
  assert.equal(isRetiredObjectType('page'), false)
  assert.equal(uncreatableObjectTypeReason('page'), null)
  assert.match(uncreatableObjectTypeReason('task_list') ?? '', /Aurora app/)
  assert.match(uncreatableObjectTypeReason('workspace_config') ?? '', /internal/)
  assert.match(uncreatableObjectTypeReason('research_project') ?? '', /retired/)
})

test('list_objects and list_recent leave out hidden system objects without losing the limit', async () => {
  const requests: URL[] = []
  await withServer(listHandler(requests), async () => {
    for (const tool of ['list_objects', 'list_recent']) {
      const result = await executeToolCall(tool, { limit: 3 }, 'workspace-1') as { objects: Array<{ id: string }> }
      assert.deepEqual(result.objects.map((item) => item.id), ['page-1', 'page-2', 'page-3'], tool)
    }
  })
  assert.ok(requests.every((url) => url.searchParams.get('perPage') === '50'))
})

test('listObjectsPage drops hidden rows unless the type asks for them', async () => {
  await withServer(listHandler([]), async () => {
    const page = await listObjectsPage('workspace-1', undefined, 1, 3)
    assert.deepEqual(page.items.map((item) => item.id), ['page-1'])
    const explicit = await listObjectsPage('workspace-1', 'task_list', 1, 3)
    assert.ok(explicit.items.some((item) => item.type === 'task_list'))
  })
})

test('listing a hidden type explicitly is refused', async () => {
  await withServer(listHandler([]), async () => {
    for (const type of ['workspace_config', 'task_list']) {
      const result = await executeToolCall('list_objects', { type }, 'workspace-1') as { type: string; code?: string }
      assert.equal(result.type, 'error')
      assert.equal(result.code, 'invalid_input')
    }
  })
})

test('get_object and write tools treat hidden objects as not found', async () => {
  const writes: string[] = []
  await withServer((req, res, url) => {
    if (req.method !== 'GET') writes.push(`${req.method} ${url.pathname}`)
    listHandler([])(req, res, url)
  }, async () => {
    for (const id of ['cfg', 'list']) {
      const got = await executeToolCall('get_object', { id }, 'workspace-1') as { type: string; code?: string }
      assert.equal(got.code, 'not_found')
      const renamed = await executeToolCall('update_object_title', { id, title: 'x' }, 'workspace-1') as { code?: string }
      assert.equal(renamed.code, 'not_found')
      const deleted = await executeToolCall('delete_object', { id }, 'workspace-1') as { code?: string }
      assert.equal(deleted.code, 'not_found')
      const property = await executeToolCall('set_property', { object_id: id, key: 'k', value: 'v' }, 'workspace-1') as { code?: string }
      assert.equal(property.code, 'not_found')
    }
    assert.equal((await getObject('list', 'workspace-1', { includeHidden: true }))?.type, 'task_list')
  })
  assert.deepEqual(writes, [])
})

test('a long run of hidden rows does not starve a small limit', async () => {
  const pages = 15
  await withServer((_req, res, url) => {
    const page = Number(url.searchParams.get('page') ?? '1')
    const items = page < pages
      ? Array.from({ length: 50 }, (_, index) => record(`list-${page}-${index}`, 'task_list'))
      : [record('page-late', 'page')]
    res.end(JSON.stringify({ items, page, perPage: 50, totalPages: pages, totalItems: (pages - 1) * 50 + 1 }))
  }, async () => {
    const result = await executeToolCall('list_recent', { limit: 1 }, 'workspace-1') as { objects: Array<{ id: string }> }
    assert.deepEqual(result.objects.map((item) => item.id), ['page-late'])
  })
})

test('every wiki tool drops hidden system objects', async () => {
  const items = [
    { workspaceId: 'workspace-1', objectId: 'cfg', objectType: 'workspace_config', title: null, deepLink: '/object/cfg' },
    { workspaceId: 'workspace-1', objectId: 'page-1', objectType: 'page', title: 'Page', deepLink: '/object/page-1' },
  ]
  await withServer((_req, res, url) => {
    if (url.pathname.endsWith('/objects/cfg')) {
      res.end(JSON.stringify({ workspaceId: 'workspace-1', items: [items[0]] }))
      return
    }
    res.end(JSON.stringify({ workspaceId: 'workspace-1', query: 'x', limit: 10, items }))
  }, async () => {
    for (const [tool, input] of [
      ['wiki_search', { query: 'x' }],
      ['wiki_recent', {}],
      ['wiki_related', { id: 'page-1' }],
    ] as const) {
      const result = await executeToolCall(tool, input, 'workspace-1') as { sources: Array<{ objectId: string }> }
      assert.deepEqual(result.sources.map((source) => source.objectId), ['page-1'], tool)
    }
    const page = await executeToolCall('wiki_get_page', { id: 'cfg', includeFullText: true }, 'workspace-1') as { code?: string }
    assert.equal(page.code, 'not_found')
  })
})

test('search results drop hidden system objects', async () => {
  await withServer((_req, res, url) => {
    if (url.pathname.startsWith('/api/knowledge/workspaces/workspace-1/search')) {
      res.end(JSON.stringify({
        workspaceId: 'workspace-1',
        query: 'x',
        limit: 10,
        items: [
          { workspaceId: 'workspace-1', objectId: 'list', objectType: 'task_list', title: 'Groceries', deepLink: '/object/list' },
          { workspaceId: 'workspace-1', objectId: 'page-1', objectType: 'page', title: 'Page', deepLink: '/object/page-1' },
        ],
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    const result = await executeToolCall('search_objects', { query: 'x' }, 'workspace-1') as { objects: Array<{ id: string }> }
    assert.deepEqual(result.objects.map((item) => item.id), ['page-1'])
  })
})

test('create_object refuses hidden and retired types before writing', async () => {
  const writes: string[] = []
  await withServer((req, res, url) => {
    if (req.method !== 'GET') writes.push(`${req.method} ${url.pathname}`)
    res.end(JSON.stringify(record('new', 'page')))
  }, async () => {
    for (const type of ['task_list', 'workspace_config', 'research_project', 'research_image']) {
      const result = await executeToolCall('create_object', { type, title: 'x' }, 'workspace-1') as { type: string; code?: string; message?: string }
      assert.equal(result.type, 'error', type)
      assert.equal(result.code, 'invalid_input', type)
    }
    const ok = await executeToolCall('create_object', { type: 'page', title: 'x' }, 'workspace-1') as { type: string }
    assert.equal(ok.type, 'created')
  })
  assert.deepEqual(writes, ['POST /api/collections/objects/records'])
})
