import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resetAuroraClientForTests } from './auroraClient.js'
import { executeToolCall } from './tools.js'

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

test('plan and apply custom database uses the exact approved hash and is idempotent', async () => {
  const previous = process.env['AURORA_API_URL']
  const objectTypes: Record<string, unknown>[] = []
  let writes = 0
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && url.pathname === '/api/collections/object_types/records') {
      response.end(JSON.stringify({ items: objectTypes, page: 1, totalPages: 1 })); return
    }
    if (request.method === 'POST' && url.pathname === '/api/collections/object_types/records') {
      writes += 1
      const body = await readBody(request)
      const record = { ...body, created_at: '2026-07-19T10:00:00Z', updated_at: '2026-07-19T10:00:00Z' }
      objectTypes.push(record); response.end(JSON.stringify(record)); return
    }
    response.statusCode = 404; response.end(JSON.stringify({ code: 'not_found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    resetAuroraClientForTests()
    const planResult = await executeToolCall('plan_custom_database', {
      name: 'Reading list',
      schema: [{ key: 'status', label: 'Status', value_type: 'select', required: false, options: ['Unread', 'Read'] }],
    }, 'workspace-1')
    assert.equal(planResult.type, 'custom_database_plan')
    if (planResult.type !== 'custom_database_plan') return

    const rejected = await executeToolCall('apply_custom_database_plan', {
      plan_id: planResult.plan.planId,
      plan_hash: 'wrong',
    }, 'workspace-1')
    assert.equal(rejected.type, 'error')
    assert.equal(writes, 0)

    const input = { plan_id: planResult.plan.planId, plan_hash: planResult.plan.planHash }
    const first = await executeToolCall('apply_custom_database_plan', input, 'workspace-1')
    const second = await executeToolCall('apply_custom_database_plan', input, 'workspace-1')
    assert.equal(first.type === 'custom_database_applied' ? first.outcome : null, 'created')
    assert.equal(second.type === 'custom_database_applied' ? second.outcome : null, 'reused')
    assert.equal(writes, 1)
  } finally {
    if (previous === undefined) delete process.env['AURORA_API_URL']; else process.env['AURORA_API_URL'] = previous
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
