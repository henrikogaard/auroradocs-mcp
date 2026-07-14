import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  authenticate,
  createPlanningTimeBlock,
  getContent,
  listTaskLists,
  listObjectsPage,
  listPlanningTasks,
  readCanvasContent,
  resetAuroraClientForTests,
  searchObjectsPage,
} from './auroraClient.js'
import { AuroraApiError } from './errors.js'

test('client credential starts without AURORA_WORKSPACE_ID and discovers only granted workspaces', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      items: [
        {
          workspaceId: 'workspace-a1b2',
          alias: 'henrik-pkm-a1b2',
          name: 'Henrik PKM',
          role: 'owner',
          scopes: ['read:objects', 'write:objects'],
          grantId: 'grant-1',
          expiresAt: '2026-10-01T00:00:00.000Z',
          privateField: 'must not escape',
        },
        {
          workspaceId: 'workspace-c3d4',
          alias: 'aurora-work-c3d4',
          name: 'Aurora Work',
          role: 'editor',
          scopes: ['read:objects'],
          grantId: 'grant-2',
          expiresAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(address as AddressInfo).port}`
    resetAuroraClientForTests()

    const context = await authenticate({ token: 'aur_mcp_client_fixture', workspaceId: undefined })

    assert.equal(context.kind, 'client')
    assert.deepEqual(context.workspaces.map((item) => item.alias), ['henrik-pkm-a1b2', 'aurora-work-c3d4'])
    assert.equal('privateField' in context.workspaces[0], false)
    assert.deepEqual(requests, ['/api/mcp/workspaces'])
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})

test('planning helper exports are callable functions', () => {
  assert.equal(typeof listPlanningTasks, 'function')
  assert.equal(typeof readCanvasContent, 'function')
  assert.equal(typeof createPlanningTimeBlock, 'function')
})

test('listObjectsPage requests exactly one bounded collection page', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      items: [],
      page: 1,
      perPage: 20,
      totalPages: 4,
      totalItems: 75,
    }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(address as AddressInfo).port}`
    resetAuroraClientForTests()

    const page = await listObjectsPage('workspace-1', undefined, 1, 20)

    assert.equal(page.totalPages, 4)
    assert.equal(requests.length, 1)
    const requestUrl = new URL(requests[0], 'http://127.0.0.1')
    assert.equal(requestUrl.pathname, '/api/collections/objects/records')
    assert.equal(requestUrl.searchParams.get('page'), '1')
    assert.equal(requestUrl.searchParams.get('perPage'), '20')
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})

test('searchObjectsPage uses knowledge search exactly once without collection pagination', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ workspaceId: 'workspace-1', query: 'road map', limit: 7, items: [] }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(address as AddressInfo).port}`
    resetAuroraClientForTests()

    await searchObjectsPage('workspace-1', 'road map', 7)

    assert.deepEqual(requests, ['/api/knowledge/workspaces/workspace-1/search?q=road%20map&limit=7'])
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})

test('403 content read becomes permission_denied, not empty content', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')

    if (url.pathname === '/api/collections/objects/records/object-1') {
      res.end(JSON.stringify({
        id: 'object-1',
        workspace_id: 'workspace-1',
        type: 'page',
        title: 'Private page',
        icon: null,
        parent_id: null,
        is_deleted: false,
        is_template: false,
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T12:00:00Z',
      }))
      return
    }

    res.statusCode = 403
    res.end(JSON.stringify({ code: 'permission_denied', message: 'private upstream body' }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(address as AddressInfo).port}`
    resetAuroraClientForTests()

    const result = await getContent('object-1', 'workspace-1')

    assert.deepEqual(result, { availability: 'permission_denied', text: null })
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})

test('content reads distinguish available, empty, encrypted, and missing content', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    const objectMatch = url.pathname.match(/^\/api\/collections\/objects\/records\/(.+)$/)

    if (objectMatch) {
      const id = objectMatch[1]
      if (id === 'missing') {
        res.statusCode = 404
        res.end(JSON.stringify({ code: 'not_found', message: 'private missing-object detail' }))
        return
      }
      res.end(JSON.stringify({
        id,
        workspace_id: 'workspace-1',
        type: 'page',
        title: id,
        icon: null,
        parent_id: null,
        is_deleted: false,
        is_template: false,
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T12:00:00Z',
      }))
      return
    }

    if (url.pathname === '/api/collections/content/records') {
      const filter = url.searchParams.get('filter') ?? ''
      const contentJson = filter.includes('encrypted')
        ? 'v1:ciphertext'
        : filter.includes('available')
          ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Readable text' }] }] }
          : filter.includes('empty-document')
            ? { type: 'doc', content: [] }
            : undefined
      res.end(JSON.stringify({
        items: contentJson === undefined ? [] : [{ id: 'content-1', content_json: contentJson }],
        page: 1,
        perPage: 1,
        totalPages: 1,
        totalItems: contentJson === undefined ? 0 : 1,
      }))
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ code: 'not_found' }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(address as AddressInfo).port}`
    resetAuroraClientForTests()

    assert.deepEqual(await getContent('available', 'workspace-1'), { availability: 'available', text: 'Readable text' })
    assert.deepEqual(await getContent('empty-record', 'workspace-1'), { availability: 'empty', text: null })
    assert.deepEqual(await getContent('empty-document', 'workspace-1'), { availability: 'empty', text: null })
    assert.deepEqual(await getContent('encrypted', 'workspace-1'), { availability: 'encrypted_locked', text: null })
    assert.deepEqual(await getContent('missing', 'workspace-1'), { availability: 'not_found', text: null })
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})

test('listTaskLists preserves server failures instead of returning successful emptiness', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const server = createServer((_req, res) => {
    res.statusCode = 503
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 'server_error', message: 'private database detail' }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(address as AddressInfo).port}`
    resetAuroraClientForTests()

    await assert.rejects(
      () => listTaskLists('workspace-1'),
      (error: unknown) => error instanceof AuroraApiError && error.status === 503,
    )
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})

test('listPlanningTasks reads current tags and legacy labels as task labels', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')

    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records') {
      res.end(JSON.stringify({
        items: [
          {
            id: 'task-1',
            workspace_id: 'workspace-1',
            type: 'task',
            title: 'Focus block',
            icon: null,
            parent_id: null,
            is_deleted: false,
            is_template: false,
            created_at: '2026-07-01T10:00:00Z',
            updated_at: '2026-07-01T12:00:00Z',
          },
        ],
      }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      res.end(JSON.stringify({
        items: [
          { id: 'prop-1', object_id: 'task-1', key: 'tags', value_type: 'text', value_text: 'time-block,duration:60m' },
          { id: 'prop-2', object_id: 'task-1', key: 'labels', value_type: 'text', value_text: '["legacy"]' },
          { id: 'prop-3', object_id: 'task-1', key: 'due_date', value_type: 'date', value_date: '2026-07-07T09:00' },
        ],
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

    const tasks = await listPlanningTasks('workspace-1')

    assert.deepEqual(tasks.map((task) => task.labels), [['time-block', 'duration:60m', 'legacy']])
    assert.equal(tasks[0].due_date, '2026-07-07T09:00')
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve())
    })
  }
})
