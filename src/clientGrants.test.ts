import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { resetAuroraClientForTests } from './auroraClient.js'
import type { AuroraConnectionContext, GrantedWorkspace } from './contracts.js'
import { executeToolCall } from './tools.js'

const grantA: GrantedWorkspace = {
  workspaceId: 'workspace-a1b2',
  alias: 'henrik-pkm-a1b2',
  name: 'Henrik PKM',
  role: 'owner',
  scopes: ['read:objects'],
  grantId: 'grant-1',
  expiresAt: '2026-10-01T00:00:00.000Z',
}
const grantB: GrantedWorkspace = {
  workspaceId: 'workspace-c3d4',
  alias: 'aurora-work-c3d4',
  name: 'Aurora Work',
  role: 'editor',
  scopes: ['read:objects'],
  grantId: 'grant-2',
  expiresAt: null,
}

test('list_workspaces re-fetches client grants so a later grant is visible without restart', async () => {
  const context: AuroraConnectionContext = { kind: 'client', workspaces: [grantA] }
  let grants = [grantA]
  const first = await executeToolCall('list_workspaces', {}, context, {
    refreshClientGrants: async () => grants,
  })
  assert.deepEqual(first, { type: 'workspaces', workspaces: [grantA] })

  grants = [grantA, grantB]
  const second = await executeToolCall('list_workspaces', {}, context, {
    refreshClientGrants: async () => grants,
  })
  assert.equal(second.type, 'workspaces')
  if (second.type === 'workspaces') {
    assert.deepEqual(second.workspaces.map((workspace) => workspace.workspaceId), ['workspace-a1b2', 'workspace-c3d4'])
  }
  assert.equal(context.workspaces.length, 2)
})

test('a newly granted workspace can be selected after list_workspaces would have missed it', async () => {
  const previous = process.env['AURORA_API_URL']
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && url.pathname === '/api/collections/objects/records') {
      response.end(JSON.stringify({ items: [], page: 1, perPage: 20, totalPages: 1, totalItems: 0 }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    resetAuroraClientForTests()
    const context: AuroraConnectionContext = { kind: 'client', workspaces: [grantA] }
    const result = await executeToolCall('list_objects', { workspace_id: grantB.workspaceId }, context, {
      refreshClientGrants: async () => [grantA, grantB],
    })
    assert.equal(result.type, 'objects')
    assert.equal(context.workspaces.some((workspace) => workspace.workspaceId === grantB.workspaceId), true)
  } finally {
    if (previous === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previous
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
