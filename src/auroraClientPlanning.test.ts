import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createPlanningTimeBlock,
  listObjectsPage,
  listPlanningTasks,
  readCanvasContent,
  resetAuroraClientForTests,
  searchObjectsPage,
} from './auroraClient.js'

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
