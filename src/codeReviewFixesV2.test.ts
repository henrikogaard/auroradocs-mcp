import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeToolCall } from './tools.js'
import {
  resetAuroraClientForTests,
  updateTaskProps,
  listPlanningTasks,
  PLANNING_TASKS_MAX,
  type AuroraObjectRecord,
} from './auroraClient.js'
import { getMcpToolCoverageAudit } from './toolCatalog.js'

const OBJECT_RECORD: AuroraObjectRecord = {
  id: 'obj-1',
  workspace_id: 'workspace-1',
  type: 'page',
  title: 'Original',
  icon: null,
  parent_id: null,
  is_deleted: false,
  is_template: false,
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-01T12:00:00Z',
}

const TASK_RECORD: AuroraObjectRecord = {
  ...OBJECT_RECORD,
  id: 'task-1',
  type: 'task',
  title: 'Plan launch',
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse<IncomingMessage>, url: URL) => void,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const previous = process.env['AURORA_API_URL']
  const previousTimeout = process.env['AURORA_REQUEST_TIMEOUT_MS']
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    handler(req, res, url)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${address.port}`
    resetAuroraClientForTests()
    await run(address.port)
  } finally {
    if (previous === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previous
    if (previousTimeout === undefined) delete process.env['AURORA_REQUEST_TIMEOUT_MS']
    else process.env['AURORA_REQUEST_TIMEOUT_MS'] = previousTimeout
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

// ── C1: update_object atomicity ──────────────────────────────────────────────

test('update_object does not write the title when content is E2EE-encrypted (atomic)', async () => {
  let titlePatches = 0
  let contentPatches = 0
  await withServer((req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/obj-1') {
      res.end(JSON.stringify(OBJECT_RECORD))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/content/records') {
      res.end(JSON.stringify({
        items: [{ id: 'content-1', object_id: 'obj-1', content_json: 'v1:ciphertext' }],
        totalPages: 1, page: 1, perPage: 50, totalItems: 1,
      }))
      return
    }
    if (req.method === 'PATCH' && url.pathname === '/api/collections/objects/records/obj-1') {
      titlePatches += 1
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => res.end(JSON.stringify({ id: 'obj-1' })))
      return
    }
    if (req.method === 'PATCH' && url.pathname === '/api/collections/content/records/content-1') {
      contentPatches += 1
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => res.end(JSON.stringify({ id: 'content-1' })))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    const result = await executeToolCall('update_object', {
      id: 'obj-1', title: 'New title', text: 'new content',
    }, 'workspace-1')
    assert.equal(result.type, 'error')
    assert.match((result as { message: string }).message, /end-to-end encrypted/i)
    assert.equal(titlePatches, 0, 'title PATCH must not fire when content is E2EE-encrypted')
    assert.equal(contentPatches, 0, 'content PATCH must not fire when content is E2EE-encrypted')
  })
})

// ── H1: set_property empty string for text ───────────────────────────────────

test('set_property stores empty string as text value_text ""', async () => {
  const writes: Array<Record<string, unknown>> = []
  await withServer((req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/obj-1') {
      res.end(JSON.stringify(OBJECT_RECORD))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      res.end(JSON.stringify({ items: [], totalPages: 1, page: 1, perPage: 50, totalItems: 0 }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/collections/object_properties/records') {
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => {
        writes.push(JSON.parse(body) as Record<string, unknown>)
        res.end(JSON.stringify({ id: 'prop-1' }))
      })
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    const result = await executeToolCall('set_property', {
      object_id: 'obj-1', key: 'note', value_type: 'text', value: '',
    }, 'workspace-1')
    assert.equal(result.type, 'property_set')
    assert.equal(writes.length, 1)
    assert.equal(writes[0]['value_text'], '')
  })
})

// ── H2: set_property number NaN guard ────────────────────────────────────────

test('set_property rejects non-numeric value for value_type number', async () => {
  await withServer((_req, res, url) => {
    if (url.pathname === '/api/collections/objects/records/obj-1') {
      res.end(JSON.stringify(OBJECT_RECORD))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    const result = await executeToolCall('set_property', {
      object_id: 'obj-1', key: 'count', value_type: 'number', value: 'later',
    }, 'workspace-1')
    assert.equal(result.type, 'error')
    assert.match((result as { message: string }).message, /must be a finite number/i)
  })
})

// ── H3: set_property boolean case-insensitive ────────────────────────────────

test('set_property accepts case-insensitive true/True/1/yes as boolean true', async () => {
  for (const raw of ['true', 'True', 'TRUE', '1', 'yes', 'Yes']) {
    const writes: Array<Record<string, unknown>> = []
    await withServer((req, res, url) => {
      if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/obj-1') {
        res.end(JSON.stringify(OBJECT_RECORD))
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
        res.end(JSON.stringify({ items: [], totalPages: 1, page: 1, perPage: 50, totalItems: 0 }))
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/collections/object_properties/records') {
        let body = ''
        req.on('data', (chunk) => { body += String(chunk) })
        req.on('end', () => {
          writes.push(JSON.parse(body) as Record<string, unknown>)
          res.end(JSON.stringify({ id: 'prop-1' }))
        })
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    }, async () => {
      const result = await executeToolCall('set_property', {
        object_id: 'obj-1', key: 'flag', value_type: 'boolean', value: raw,
      }, 'workspace-1')
      assert.equal(result.type, 'property_set', `expected property_set for value=${raw}`)
      assert.equal(writes.length, 1)
      assert.equal(writes[0]['value_bool'], true, `expected true for value=${raw}`)
    })
  }
})

test('set_property rejects ambiguous boolean values', async () => {
  for (const raw of ['maybe', 'yep', '2']) {
    await withServer((_req, res, url) => {
      if (url.pathname === '/api/collections/objects/records/obj-1') {
        res.end(JSON.stringify(OBJECT_RECORD))
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    }, async () => {
      const result = await executeToolCall('set_property', {
        object_id: 'obj-1', key: 'flag', value_type: 'boolean', value: raw,
      }, 'workspace-1')
      assert.equal(result.type, 'error', `expected error for value=${raw}`)
    })
  }
})

// ── M2: update_task clears status and description ────────────────────────────

test('update_task clears status when given an empty string', async () => {
  const patches: Array<{ id: string; body: Record<string, unknown> }> = []
  await withServer((req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/task-1') {
      res.end(JSON.stringify(TASK_RECORD))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      res.end(JSON.stringify({
        items: [{ id: 'prop-status', object_id: 'task-1', key: 'status', value_type: 'text', value_text: 'In Progress' }],
        totalPages: 1, page: 1, perPage: 50, totalItems: 1,
      }))
      return
    }
    if (req.method === 'PATCH' && url.pathname === '/api/collections/object_properties/records/prop-status') {
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => {
        patches.push({ id: 'prop-status', body: JSON.parse(body) as Record<string, unknown> })
        res.end(JSON.stringify({ id: 'prop-status' }))
      })
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    const result = await executeToolCall('update_task', { id: 'task-1', status: '' }, 'workspace-1')
    assert.equal(result.type, 'task_updated')
    assert.deepEqual(patches, [{
      id: 'prop-status',
      body: { value_type: 'text', value_text: null, value_num: null, value_date: null, value_bool: null, value_ref: null },
    }])
  })
})

// ── M5: updateTaskProps batch upsert ─────────────────────────────────────────

test('updateTaskProps batches all property reads into a single listProperties call', async () => {
  let propertyListRequests = 0
  let writes = 0
  await withServer((req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      propertyListRequests += 1
      res.end(JSON.stringify({
        items: [
          { id: 'prop-status', object_id: 'task-1', key: 'status', value_type: 'text', value_text: 'Todo' },
          { id: 'prop-priority', object_id: 'task-1', key: 'priority', value_type: 'text', value_text: 'Low' },
        ],
        totalPages: 1, page: 1, perPage: 50, totalItems: 2,
      }))
      return
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      writes += 1
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => res.end(JSON.stringify({ id: 'prop-x' })))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    await updateTaskProps('task-1', 'workspace-1', {
      status: 'In Progress',
      priority: 'High',
      due_date: '2026-07-15T09:00',
      description: 'Updated desc',
    }, { existingObject: TASK_RECORD })
    assert.equal(propertyListRequests, 1, `expected 1 batched property list request, got ${propertyListRequests}`)
    assert.ok(writes >= 4, `expected at least 4 writes, got ${writes}`)
  })
})

// ── M4: listPlanningTasks cap ────────────────────────────────────────────────

test('listPlanningTasks caps at PLANNING_TASKS_MAX', async () => {
  // Generate more tasks than the cap to verify truncation.
  const TOTAL = PLANNING_TASKS_MAX + 100
  await withServer((req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records') {
      const perPage = Number(url.searchParams.get('perPage') ?? '50')
      const page = Number(url.searchParams.get('page') ?? '1')
      const start = (page - 1) * perPage
      const count = Math.min(perPage, TOTAL - start)
      const items = count > 0 ? Array.from({ length: count }, (_, i) => ({
        id: `task-${start + i + 1}`,
        workspace_id: 'workspace-1',
        type: 'task',
        title: `Task ${start + i + 1}`,
        icon: null, parent_id: null, is_deleted: false, is_template: false,
        created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T12:00:00Z',
      })) : []
      res.end(JSON.stringify({ items, totalPages: Math.ceil(TOTAL / perPage), page, perPage, totalItems: TOTAL }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      res.end(JSON.stringify({ items: [], totalPages: 1, page: 1, perPage: 50, totalItems: 0 }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    const tasks = await listPlanningTasks('workspace-1')
    assert.equal(tasks.length, PLANNING_TASKS_MAX)
  })
})

// ── Follow-up: filter templates before applying object limits ────────────────

test('list_objects and list_recent exclude templates before applying the limit', async () => {
  const template = { ...OBJECT_RECORD, id: 'template-1', title: 'Template', is_template: true }
  const normalOne = { ...OBJECT_RECORD, id: 'page-1', title: 'Page one' }
  const normalTwo = { ...OBJECT_RECORD, id: 'page-2', title: 'Page two' }

  await withServer((_req, res, url) => {
    if (url.pathname === '/api/collections/objects/records') {
      const filter = url.searchParams.get('filter') ?? ''
      const items = filter.includes('is_template = false')
        ? [normalOne, normalTwo]
        : [template, normalOne]
      res.end(JSON.stringify({ items, totalPages: 1, page: 1, perPage: 2, totalItems: items.length }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    const listed = await executeToolCall('list_objects', { limit: 2 }, 'workspace-1')
    const recent = await executeToolCall('list_recent', { limit: 2 }, 'workspace-1')
    assert.deepEqual((listed as { objects: Array<{ id: string }> }).objects.map((item) => item.id), ['page-1', 'page-2'])
    assert.deepEqual((recent as { objects: Array<{ id: string }> }).objects.map((item) => item.id), ['page-1', 'page-2'])
  })
})

// ── Follow-up: page task properties before upserting ─────────────────────────

test('updateTaskProps pages through existing properties before creating a duplicate', async () => {
  const writes: Array<{ method: string; id: string | null; body: Record<string, unknown> }> = []
  await withServer((req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      const page = Number(url.searchParams.get('page') ?? '1')
      const items = page === 1
        ? Array.from({ length: 50 }, (_, index) => ({ id: `noise-${index}`, object_id: 'task-1', key: `noise-${index}`, value_type: 'text', value_text: 'x' }))
        : [{ id: 'prop-status', object_id: 'task-1', key: 'status', value_type: 'text', value_text: 'Todo' }]
      res.end(JSON.stringify({ items, totalPages: 2, page, perPage: 50, totalItems: 51 }))
      return
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => {
        writes.push({ method: req.method ?? '', id: url.pathname.split('/').pop() ?? null, body: JSON.parse(body) as Record<string, unknown> })
        res.end(JSON.stringify({ id: 'prop-status' }))
      })
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    await updateTaskProps('task-1', 'workspace-1', { status: 'Done' }, { existingObject: TASK_RECORD })
    assert.deepEqual(writes, [{
      method: 'PATCH', id: 'prop-status', body: { value_type: 'text', value_text: 'Done' },
    }])
  })
})

test('updateTaskProps clears legacy value_text fallbacks for typed task fields', async () => {
  const patches: Array<{ id: string; body: Record<string, unknown> }> = []
  await withServer((req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      res.end(JSON.stringify({
        items: [
          { id: 'prop-due', object_id: 'task-1', key: 'due_date', value_type: 'date', value_text: '2026-07-15' },
          { id: 'prop-list', object_id: 'task-1', key: 'task_list_id', value_type: 'ref', value_text: 'list-1' },
        ],
        totalPages: 1, page: 1, perPage: 50, totalItems: 2,
      }))
      return
    }
    if (req.method === 'PATCH') {
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => {
        patches.push({ id: url.pathname.split('/').pop() ?? '', body: JSON.parse(body) as Record<string, unknown> })
        res.end(JSON.stringify({ id: 'patched' }))
      })
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    await updateTaskProps('task-1', 'workspace-1', { due_date: null, task_list_id: null }, { existingObject: TASK_RECORD })
    const emptyFields = { value_text: null, value_num: null, value_date: null, value_bool: null, value_ref: null }
    assert.deepEqual(patches, [
      { id: 'prop-due', body: { value_type: 'date', ...emptyFields } },
      { id: 'prop-list', body: { value_type: 'ref', ...emptyFields } },
    ])
  })
})

test('listPlanningTasks hydrates properties beyond the shared first ten pages', async () => {
  await withServer((_req, res, url) => {
    if (url.pathname === '/api/collections/objects/records') {
      res.end(JSON.stringify({
        items: [{ ...TASK_RECORD }], totalPages: 1, page: 1, perPage: 50, totalItems: 1,
      }))
      return
    }
    if (url.pathname === '/api/collections/object_properties/records') {
      const page = Number(url.searchParams.get('page') ?? '1')
      const items = page <= 10
        ? Array.from({ length: 50 }, (_, index) => ({ id: `noise-${page}-${index}`, object_id: 'task-1', key: `noise-${page}-${index}`, value_type: 'text', value_text: 'x' }))
        : [{ id: 'prop-status', object_id: 'task-1', key: 'status', value_type: 'text', value_text: 'In Progress' }]
      res.end(JSON.stringify({ items, totalPages: 11, page, perPage: 50, totalItems: 501 }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }, async () => {
    const tasks = await listPlanningTasks('workspace-1')
    assert.equal(tasks[0]?.status, 'In Progress')
  })
})

// ── #5: Fetch timeout via AbortSignal ─────────────────────────────────────────

test('request aborts with a timeout error when AuroraCloud hangs', async () => {
  await withServer((_req, res, _url) => {
    // Never respond — simulates a hung server.
  }, async () => {
    process.env['AURORA_REQUEST_TIMEOUT_MS'] = '200'
    resetAuroraClientForTests()
    const { getObject } = await import('./auroraClient.js')
    await assert.rejects(
      () => getObject('obj-1', 'workspace-1'),
      (err: Error) => err instanceof Error && /timed out|timeout|network/i.test(err.message),
    )
  })
})

// ── #12: resetAuroraClientForTests gated behind NODE_ENV=test ────────────────

test('resetAuroraClientForTests throws outside NODE_ENV=test', () => {
  const previous = process.env['NODE_ENV']
  delete process.env['NODE_ENV']
  try {
    assert.throws(() => resetAuroraClientForTests(), /test environments/)
  } finally {
    if (previous !== undefined) process.env['NODE_ENV'] = previous
  }
})

// ── #9: Filter escaping escapes backslashes ──────────────────────────────────

test('filter escapes backslashes before double quotes', async () => {
  const previous = process.env['AURORA_API_URL']
  process.env['AURORA_API_URL'] = 'http://127.0.0.1:9999'
  resetAuroraClientForTests()
  try {
    const { getAuroraClient } = await import('./auroraClient.js')
    const filter = getAuroraClient().filter('key = {:value}', { value: 'ha\\"ha' })
    // Input: ha\"ha → escape backslash → ha\\"ha → escape quote → ha\\\"ha
    assert.equal(filter, 'key = "ha\\\\\\"ha"')
  } finally {
    if (previous === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previous
    resetAuroraClientForTests()
  }
})

// ── L6: getMcpToolCoverageAudit live timestamp ───────────────────────────────

test('getMcpToolCoverageAudit uses a live ISO timestamp', () => {
  const audit = getMcpToolCoverageAudit()
  const parsed = Date.parse(audit.generatedAt)
  assert.ok(Number.isFinite(parsed), `generatedAt should be a valid ISO date, got ${audit.generatedAt}`)
  // Should be within the last minute.
  assert.ok(Date.now() - parsed < 60_000, 'generatedAt should be recent')
})
