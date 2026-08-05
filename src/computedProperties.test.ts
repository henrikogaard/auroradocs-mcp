import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { resetAuroraClientForTests } from './auroraClient.js'
import { buildMcpObjectPropertyResult, executeToolCall } from './tools.js'

test('MCP object properties suppress stored computed shadows and expose explicit unavailable states', () => {
  const result = buildMcpObjectPropertyResult({
    rawProperties: [
      {
        id: 'property-title',
        object_id: 'row-1',
        key: 'status',
        value_type: 'text',
        value_text: 'Active',
        value_num: null,
        value_date: null,
        value_bool: null,
        value_ref: null,
      },
      {
        id: 'property-shadow',
        object_id: 'row-1',
        key: 'score',
        value_type: 'formula',
        value_text: '999',
        value_num: null,
        value_date: null,
        value_bool: null,
        value_ref: null,
      },
    ],
    schema: [
      { key: 'score', label: 'Score', value_type: 'formula' },
      { key: 'total', label: 'Total', value_type: 'rollup' },
    ],
    computedPropertiesStatus: 'complete',
  })

  assert.deepEqual(result, {
    properties: { status: 'Active' },
    computed_properties: {
      score: { label: 'Score', status: 'unavailable', code: 'local_evaluation_required' },
      total: { label: 'Total', status: 'unavailable', code: 'local_evaluation_required' },
    },
    computed_properties_status: 'complete',
  })
  assert.doesNotMatch(JSON.stringify(result), /999/)
})

test('MCP object properties report incomplete schema discovery explicitly', () => {
  const result = buildMcpObjectPropertyResult({
    rawProperties: [],
    schema: [],
    computedPropertiesStatus: 'unavailable',
  })

  assert.equal(result.computed_properties_status, 'unavailable')
  assert.deepEqual(result.computed_properties, {})
})

test('known computed schema keys suppress legacy shadows mislabeled as scalar rows', () => {
  const result = buildMcpObjectPropertyResult({
    rawProperties: [
      {
        id: 'property-shadow',
        object_id: 'row-1',
        key: 'score',
        value_type: 'text',
        value_text: '999',
        value_num: null,
        value_date: null,
        value_bool: null,
        value_ref: null,
      },
    ],
    schema: [{ key: 'score', label: 'Score', value_type: 'formula' }],
    computedPropertiesStatus: 'complete',
  })

  assert.deepEqual(result.properties, {})
  assert.deepEqual(result.computed_properties, {
    score: { label: 'Score', status: 'unavailable', code: 'local_evaluation_required' },
  })
  assert.doesNotMatch(JSON.stringify(result), /999/)
})

test('get_object discovers custom computed fields without returning a stored shadow', async () => {
  const previousApiUrl = process.env['AURORA_API_URL']
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    response.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/collections/objects/records/row-1') {
      response.end(JSON.stringify({
        id: 'row-1', workspace_id: 'workspace-1', type: 'custom:type-score',
        title: 'Scorecard', icon: null, parent_id: null, is_deleted: false,
        is_template: false, created_at: '2026-07-28T00:00:00.000Z',
        updated_at: '2026-07-28T00:00:00.000Z',
      }))
      return
    }
    if (url.pathname === '/api/collections/content/records') {
      response.end(JSON.stringify({ items: [], page: 1, totalPages: 1, totalItems: 0 }))
      return
    }
    if (url.pathname === '/api/collections/object_properties/records') {
      response.end(JSON.stringify({
        items: [{
          id: 'property-shadow', object_id: 'row-1', key: 'score', value_type: 'formula',
          value_text: '999', value_num: null, value_date: null, value_bool: null, value_ref: null,
        }],
        page: 1, totalPages: 1, totalItems: 1,
      }))
      return
    }
    if (url.pathname === '/api/collections/object_types/records') {
      response.end(JSON.stringify({
        items: [{
          id: 'type-score', workspace_id: 'workspace-1', name: 'Score', icon: null,
          color: null, created_at: '2026-07-28T00:00:00.000Z',
          schema: [{ key: 'score', label: 'Score', value_type: 'formula', required: false }],
        }],
        page: 1, totalPages: 1, totalItems: 1,
      }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ code: 'not_found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.ok(address)

  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(address as AddressInfo).port}`
    resetAuroraClientForTests()
    const result = await executeToolCall('get_object', { id: 'row-1' }, 'workspace-1')
    assert.equal(result.type, 'object')
    if (result.type !== 'object') return
    assert.deepEqual(result.properties, {})
    assert.deepEqual(result.computed_properties, {
      score: { label: 'Score', status: 'unavailable', code: 'local_evaluation_required' },
    })
    assert.equal(result.computed_properties_status, 'complete')
    assert.doesNotMatch(JSON.stringify(result), /999/)
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    )
  }
})
