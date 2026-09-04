import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resetAuroraClientForTests } from './auroraClient.js'
import { clearCustomDatabasePlansForTests } from './customDatabasePlans.js'
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

test('apply_custom_database_plan reloads an approved plan from the MCP state directory', async () => {
  const previousUrl = process.env['AURORA_API_URL']
  const previousState = process.env['AURORA_MCP_STATE_DIR']
  const objectTypes: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && url.pathname === '/api/collections/object_types/records') {
      response.end(JSON.stringify({ items: objectTypes, page: 1, totalPages: 1 })); return
    }
    if (request.method === 'POST' && url.pathname === '/api/collections/object_types/records') {
      const body = await readBody(request)
      const record = { ...body, created_at: '2026-07-19T10:00:00Z', updated_at: '2026-07-19T10:00:00Z' }
      objectTypes.push(record); response.end(JSON.stringify(record)); return
    }
    response.statusCode = 404; response.end(JSON.stringify({ code: 'not_found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const stateDir = await mkdtemp(path.join(tmpdir(), 'aurora-apply-plan-'))
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    process.env['AURORA_MCP_STATE_DIR'] = stateDir
    resetAuroraClientForTests()
    const planResult = await executeToolCall('plan_custom_database', {
      name: 'Persisted reading list',
      schema: [{ key: 'status', label: 'Status', value_type: 'select', required: false, options: ['Unread', 'Read'] }],
    }, 'workspace-1')
    assert.equal(planResult.type, 'custom_database_plan')
    if (planResult.type !== 'custom_database_plan') return
    clearCustomDatabasePlansForTests()
    const applied = await executeToolCall('apply_custom_database_plan', {
      plan_id: planResult.plan.planId,
      plan_hash: planResult.plan.planHash,
    }, 'workspace-1')
    assert.equal(applied.type, 'custom_database_applied')
  } finally {
    if (previousUrl === undefined) delete process.env['AURORA_API_URL']; else process.env['AURORA_API_URL'] = previousUrl
    if (previousState === undefined) delete process.env['AURORA_MCP_STATE_DIR']; else process.env['AURORA_MCP_STATE_DIR'] = previousState
    resetAuroraClientForTests()
    clearCustomDatabasePlansForTests()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('apply_custom_database_plan treats a malformed plan ID as non-retryable invalid input', async () => {
  const previousState = process.env['AURORA_MCP_STATE_DIR']
  const stateDir = await mkdtemp(path.join(tmpdir(), 'aurora-malformed-plan-'))
  try {
    process.env['AURORA_MCP_STATE_DIR'] = stateDir
    for (const planId of ['../escape', `plan-${'x'.repeat(128)}`]) {
      const result = await executeToolCall('apply_custom_database_plan', {
        plan_id: planId,
        plan_hash: 'not-a-real-hash',
      }, 'workspace-1')
      assert.deepEqual(result, {
        type: 'error',
        code: 'invalid_input',
        message: 'The custom database plan is missing, expired, or does not match the approved hash',
        retryable: false,
      })
    }
  } finally {
    if (previousState === undefined) delete process.env['AURORA_MCP_STATE_DIR']
    else process.env['AURORA_MCP_STATE_DIR'] = previousState
  }
})

test('direct template creation rejects unsupported default value types before network access', async () => {
  const result = await executeToolCall('create_template', {
    type: 'page',
    title: 'Invalid default',
    defaults: [{ key: 'score', value_type: 'formula', value: '1 + 1' }],
  }, 'workspace-1')
  assert.equal(result.type, 'error')
  if (result.type === 'error') assert.match(result.message, /unsupported value_type/i)
})
