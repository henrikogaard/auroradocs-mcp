import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createPlanningTimeBlock,
  listPlanningTasks,
  readCanvasContent,
  resetAuroraClientForTests,
} from './auroraClient.js'

test('planning helper exports are callable functions', () => {
  assert.equal(typeof listPlanningTasks, 'function')
  assert.equal(typeof readCanvasContent, 'function')
  assert.equal(typeof createPlanningTimeBlock, 'function')
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
