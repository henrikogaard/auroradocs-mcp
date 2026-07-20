import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createAuroraObjectFromTemplate,
  createAuroraObjectStable,
  listAuroraObjectTypes,
  listAuroraTemplates,
  resetAuroraClientForTests,
  restoreObject,
  upsertAuroraPropertyStable,
} from './auroraClient.js'

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void | Promise<void>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const previous = process.env['AURORA_API_URL']
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${address.port}`
    resetAuroraClientForTests()
    await run(process.env['AURORA_API_URL'])
  } finally {
    if (previous === undefined) delete process.env['AURORA_API_URL']; else process.env['AURORA_API_URL'] = previous
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test('template listing filters templates before the first bounded page', async () => {
  let observedFilter = ''
  await withServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records') {
      observedFilter = url.searchParams.get('filter') ?? ''
      const isFiltered = observedFilter.includes('is_template')
      const items = isFiltered
        ? [{ id: 'template-older', workspace_id: 'workspace-1', type: 'page', title: 'Template', icon: null, parent_id: null, is_deleted: false, is_template: true, created_at: 'now', updated_at: 'now' }]
        : Array.from({ length: 50 }, (_, index) => ({ id: `normal-${index}`, workspace_id: 'workspace-1', type: 'page', title: 'Normal', icon: null, parent_id: null, is_deleted: false, is_template: false, created_at: 'now', updated_at: 'now' }))
      res.end(JSON.stringify({ page: 1, perPage: 50, totalItems: items.length, totalPages: 1, items }))
      return
    }
    res.statusCode = 404; res.end(JSON.stringify({ code: 'not_found' }))
  }, async () => {
    const templates = await listAuroraTemplates('workspace-1', 'page')
    assert.deepEqual(templates.map((template) => template.id), ['template-older'])
    assert.match(observedFilter, /is_template/)
  })
})

test('stable object retries normalize stored empty optional fields to null', async () => {
  let creates = 0
  await withServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/object-stable') {
      res.end(JSON.stringify({
        id: 'object-stable', workspace_id: 'workspace-1', type: 'page', title: 'Root',
        icon: '', parent_id: '', is_deleted: false, is_template: false, created_at: 'now', updated_at: 'now',
      }))
      return
    }
    if (req.method === 'POST') creates += 1
    res.statusCode = 404; res.end(JSON.stringify({ code: 'not_found' }))
  }, async () => {
    const object = await createAuroraObjectStable('workspace-1', {
      id: 'object-stable', type: 'page', title: 'Root', icon: null, parentId: null,
    })
    assert.equal(object.icon, null)
    assert.equal(object.parent_id, null)
    assert.equal(creates, 0)
  })
})

test('template instantiation copies all 64 declared defaults across property pages', async () => {
  const schema = Array.from({ length: 64 }, (_, index) => ({
    key: `field_${index}`, label: `Field ${index}`, value_type: 'text' as const, required: false,
  }))
  const properties = schema.map((field, index) => ({
    id: `property-${index}`, object_id: 'template-64', key: field.key, value_type: 'text',
    value_text: `value-${index}`, value_num: null, value_date: null, value_bool: null, value_ref: null,
  }))
  const propertyWrites: string[] = []
  const objectRecord = (id: string, isTemplate: boolean) => ({
    id, workspace_id: 'workspace-1', type: 'custom:type-64', title: 'Template 64', icon: null,
    parent_id: null, is_deleted: false, is_template: isTemplate, created_at: 'now', updated_at: 'now',
  })

  await withServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/template-64') {
      res.end(JSON.stringify(objectRecord('template-64', true))); return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/created-64') {
      res.end(JSON.stringify(objectRecord('created-64', false))); return
    }
    if (req.method === 'POST' && url.pathname === '/api/collections/objects/records') {
      res.end(JSON.stringify(objectRecord('created-64', false))); return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/object_types/records') {
      res.end(JSON.stringify({ page: 1, perPage: 50, totalItems: 1, totalPages: 1, items: [{
        id: 'type-64', workspace_id: 'workspace-1', name: 'Many defaults', icon: null, color: null,
        schema, created_at: 'now', updated_at: 'now',
      }] })); return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/content/records') {
      res.end(JSON.stringify({ page: 1, perPage: 1, totalItems: 0, totalPages: 0, items: [] })); return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      const filter = url.searchParams.get('filter') ?? ''
      if (filter.includes('template-64')) {
        const page = Number(url.searchParams.get('page') ?? '1')
        const items = properties.slice((page - 1) * 50, page * 50)
        res.end(JSON.stringify({ page, perPage: 50, totalItems: 64, totalPages: 2, items })); return
      }
      res.end(JSON.stringify({ page: 1, perPage: 1, totalItems: 0, totalPages: 0, items: [] })); return
    }
    if (req.method === 'POST' && url.pathname === '/api/collections/object_properties/records') {
      const body = await bodyOf(req)
      propertyWrites.push(String(body['key']))
      res.end(JSON.stringify({ id: `written-${propertyWrites.length}`, ...body })); return
    }
    res.statusCode = 404; res.end(JSON.stringify({ code: 'not_found' }))
  }, async () => {
    const objectId = await createAuroraObjectFromTemplate('workspace-1', 'template-64', 'created-64')
    assert.equal(objectId, 'created-64')
    assert.equal(propertyWrites.length, 64)
    assert.equal(propertyWrites.at(-1), 'field_63')
  })
})

test('object type discovery reads every reported page', async () => {
  const pages: number[] = []
  await withServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && url.pathname === '/api/collections/object_types/records') {
      const page = Number(url.searchParams.get('page') ?? '1'); pages.push(page)
      res.end(JSON.stringify({ page, perPage: 50, totalItems: 3, totalPages: 3, items: [{
        id: `type-${page}`, workspace_id: 'workspace-1', name: `Type ${page}`, icon: null, color: null,
        schema: [], created_at: 'now', updated_at: 'now',
      }] })); return
    }
    res.statusCode = 404; res.end(JSON.stringify({ code: 'not_found' }))
  }, async () => {
    assert.equal((await listAuroraObjectTypes('workspace-1')).length, 3)
    assert.deepEqual(pages, [1, 2, 3])
  })
})

test('property type changes clear obsolete value columns', async () => {
  let updateBody: Record<string, unknown> | null = null
  await withServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/object-property') {
      res.end(JSON.stringify({ id: 'object-property', workspace_id: 'workspace-1', type: 'page', title: 'Page', icon: null, parent_id: null, is_deleted: false, is_template: false, created_at: 'now', updated_at: 'now' })); return
    }
    if (req.method === 'GET' && url.pathname === '/api/collections/object_properties/records') {
      res.end(JSON.stringify({ page: 1, perPage: 1, totalItems: 1, totalPages: 1, items: [{ id: 'property-existing' }] })); return
    }
    if (req.method === 'PATCH' && url.pathname.endsWith('/property-existing')) {
      updateBody = await bodyOf(req); res.end(JSON.stringify({ id: 'property-existing', ...updateBody })); return
    }
    res.statusCode = 404; res.end(JSON.stringify({ code: 'not_found' }))
  }, async () => {
    await upsertAuroraPropertyStable('object-property', 'workspace-1', 'rating', 'number', 4)
    assert.deepEqual(updateBody, { value_type: 'number', value_text: null, value_num: 4, value_date: null, value_bool: null, value_ref: null })
  })
})

test('object restore is workspace-checked, idempotent, and avoids redundant writes', async () => {
  let deleted = true
  const patches: Record<string, unknown>[] = []
  await withServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && url.pathname === '/api/collections/objects/records/object-trashed') {
      res.end(JSON.stringify({
        id: 'object-trashed', workspace_id: 'workspace-1', type: 'page', title: 'Recover me',
        icon: null, parent_id: null, is_deleted: deleted, is_template: false,
        created_at: 'now', updated_at: 'now',
      })); return
    }
    if (req.method === 'PATCH' && url.pathname === '/api/collections/objects/records/object-trashed') {
      const body = await bodyOf(req)
      patches.push(body)
      deleted = Boolean(body['is_deleted'])
      res.end(JSON.stringify({ id: 'object-trashed', ...body })); return
    }
    res.statusCode = 404; res.end(JSON.stringify({ code: 'not_found' }))
  }, async () => {
    assert.equal(await restoreObject('object-trashed', 'workspace-1'), true)
    assert.equal(await restoreObject('object-trashed', 'workspace-1'), false)
    assert.deepEqual(patches, [{ is_deleted: false }])
  })
})
