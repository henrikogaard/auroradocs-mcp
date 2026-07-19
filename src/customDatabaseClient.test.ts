import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createAuroraObjectType,
  createAuroraTemplate,
  createAuroraObjectFromTemplate,
  listAuroraObjectTypes,
  resetAuroraClientForTests,
  updateAuroraObjectType,
} from './auroraClient.js'

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

test('object-type helpers use bounded workspace collection CRUD and preserve schema metadata', async () => {
  const previous = process.env['AURORA_API_URL']
  const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
  const typeRecord = {
    id: 'type-fixed-0001', workspace_id: 'workspace-1', name: 'Equipment', icon: '🧰', color: '#64748b',
    schema: [{ key: 'serial_number', label: 'Serial number', value_type: 'text' as const, required: false, sensitive: true }],
    created_at: '2026-07-19T10:00:00Z', updated_at: '2026-07-19T10:00:00Z',
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const entry: { method: string; path: string; body?: Record<string, unknown> } = { method: req.method ?? 'GET', path: url.pathname }
    if (req.method !== 'GET') entry.body = await bodyOf(req)
    requests.push(entry)
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && url.pathname === '/api/collections/object_types/records') {
      res.end(JSON.stringify({ items: [typeRecord], page: 1, totalPages: 1 }))
    } else {
      res.end(JSON.stringify({ ...typeRecord, ...(entry.body ?? {}) }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${address.port}`
    resetAuroraClientForTests()
    assert.equal((await listAuroraObjectTypes('workspace-1'))[0]?.schema[0]?.sensitive, true)
    await createAuroraObjectType('workspace-1', {
      id: 'type-fixed-0001', name: 'Equipment', icon: '🧰', color: '#64748b', schema: typeRecord.schema,
    })
    await updateAuroraObjectType('workspace-1', 'type-fixed-0001', { name: 'Gear', schema: typeRecord.schema })
    assert.deepEqual(requests.map((request) => [request.method, request.path]), [
      ['GET', '/api/collections/object_types/records'],
      ['POST', '/api/collections/object_types/records'],
      ['GET', '/api/collections/object_types/records/type-fixed-0001'],
      ['PATCH', '/api/collections/object_types/records/type-fixed-0001'],
    ])
    assert.equal(requests[1]?.body?.['id'], 'type-fixed-0001')
    assert.deepEqual(requests[2]?.body, undefined)
  } finally {
    if (previous === undefined) delete process.env['AURORA_API_URL']; else process.env['AURORA_API_URL'] = previous
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('template helpers create reusable objects and copy content plus declared defaults', async () => {
  const previous = process.env['AURORA_API_URL']
  const writes: Array<{ path: string; body: Record<string, unknown> }> = []
  const objects = new Map<string, Record<string, unknown>>()
  const properties = [{
    id: 'property-1', object_id: 'template-fixed1', key: 'status', value_type: 'select',
    value_text: 'Active', value_num: null, value_date: null, value_bool: null, value_ref: null,
  }]
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('content-type', 'application/json')
    if (req.method === 'POST' && url.pathname === '/api/collections/objects/records') {
      const body = await bodyOf(req); writes.push({ path: url.pathname, body })
      const record = {
        id: body['id'] ?? 'created-object01', workspace_id: body['workspace_id'], type: body['type'],
        title: body['title'] ?? null, icon: body['icon'] ?? null, parent_id: null,
        is_deleted: false, is_template: Boolean(body['is_template']), created_at: 'now', updated_at: 'now',
      }
      objects.set(String(record.id), record); res.end(JSON.stringify(record)); return
    }
    const objectMatch = url.pathname.match(/^\/api\/collections\/objects\/records\/(.+)$/)
    if (req.method === 'GET' && objectMatch) { res.end(JSON.stringify(objects.get(objectMatch[1] ?? '') ?? {})); return }
    if (req.method === 'GET' && url.pathname === '/api/collections/content/records') {
      res.end(JSON.stringify({ items: [{ id: 'content-1', object_id: 'template-fixed1', content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Template body' }] }] } }] })); return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      res.end(JSON.stringify({ items: properties })); return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/object_types/records') {
      res.end(JSON.stringify({ items: [{
        id: 'type-fixed-0001', workspace_id: 'workspace-1', name: 'Subscriptions', icon: null, color: null,
        schema: [{ key: 'status', label: 'Status', value_type: 'select', required: false, options: ['Active'] }], created_at: 'now', updated_at: 'now',
      }] })); return
    }
    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = await bodyOf(req); writes.push({ path: url.pathname, body }); res.end(JSON.stringify({ id: 'ok', ...body })); return
    }
    res.statusCode = 404; res.end(JSON.stringify({ code: 'not_found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${address.port}`
    resetAuroraClientForTests()
    const template = await createAuroraTemplate({
      workspaceId: 'workspace-1', objectId: 'template-fixed1', type: 'custom:type-fixed-0001',
      title: 'New subscription', body: 'Template body', defaults: [{ key: 'status', valueType: 'select', value: 'Active' }],
    })
    assert.equal(template.is_template, true)
    const objectId = await createAuroraObjectFromTemplate('workspace-1', 'template-fixed1', 'created-object01')
    assert.equal(objectId, 'created-object01')
    assert.ok(writes.some((write) => write.path.startsWith('/api/collections/content/records')))
    assert.ok(writes.some((write) => write.path.startsWith('/api/collections/object_properties/records')))
  } finally {
    if (previous === undefined) delete process.env['AURORA_API_URL']; else process.env['AURORA_API_URL'] = previous
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
