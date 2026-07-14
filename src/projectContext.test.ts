import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resetAuroraClientForTests } from './auroraClient.js'
import type { AuroraConnectionContext } from './contracts.js'
import { executeToolCall, formatToolResult } from './tools.js'

const context: AuroraConnectionContext = {
  kind: 'client',
  workspaces: [{
    workspaceId: 'workspace-1',
    alias: 'henrik-pkm',
    name: 'Henrik PKM',
    role: 'owner',
    scopes: ['read:objects', 'read:content', 'read:tasks'],
    grantId: 'grant-1',
    expiresAt: '2026-10-01T00:00:00.000Z',
  }],
}

const workspace = { id: 'workspace-1', name: 'Henrik PKM' }
const project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  title: 'Launch AuroraDocs',
  goal: 'Ship the public agent workflow',
  status: 'In Progress',
  priority: 'High',
  owner: 'Henrik',
  progress: 60,
  startDate: '2026-07-01',
  dueDate: '2026-07-31',
  brief: { availability: 'available', text: 'Launch context.' },
  tasks: {
    availability: 'available',
    groups: {
      todo: [],
      in_progress: [{ id: 'task-1', title: 'Publish MCP', status: 'In Progress', updatedAt: '2026-07-14T11:00:00.000Z' }],
      blocked: [{ id: 'task-2', title: 'Waiting for legal review', status: 'Blocked', updatedAt: '2026-07-14T10:00:00.000Z' }],
      done: [],
    },
  },
  blockers: ['Waiting for legal review'],
  risks: ['Store approval timing'],
  unresolvedDecisions: ['Default token lifetime'],
  recentActivity: [{ id: 'event-1', title: 'Roadmap approved', updatedAt: '2026-07-14T09:00:00.000Z' }],
  nextActions: ['Complete legal review', 'Publish package'],
  sources: [{
    sourceId: 'object:decision-1',
    title: 'Launch decision',
    deepLink: 'https://app.auroradocs.eu/workspaces/workspace-1/objects/decision-1',
    updatedAt: '2026-07-14T08:00:00.000Z',
    availability: 'available',
  }],
}

async function withApi(
  handler: RequestListener,
  run: (requests: string[]) => Promise<void>,
): Promise<void> {
  const previousApiUrl = process.env['AURORA_API_URL']
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${address.port}`
    resetAuroraClientForTests()
    await run(requests)
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test('get_project_context returns a citation-ready resume packet', async () => {
  await withApi((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'ok', workspace, project, asOf: '2026-07-14T12:00:00.000Z', cursor: 'cursor-1' }))
  }, async (requests) => {
    const result = await executeToolCall('get_project_context', {
      workspace_id: 'workspace-1',
      project_id: 'project-1',
      activity_days: 14,
      task_limit: 20,
      source_limit: 10,
    }, context)

    assert.equal(result.type, 'project_context')
    if (result.type !== 'project_context') return
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.project.tasks.groups.blocked[0]?.title, 'Waiting for legal review')
    assert.equal(result.project.sources[0]?.sourceId, 'object:decision-1')
    assert.equal(result.asOf, '2026-07-14T12:00:00.000Z')
    assert.match(formatToolResult(result), /^Workspace: Henrik PKM \(workspace-1\)\nProject: Launch AuroraDocs \(project-1\)\nAs of:/)
    assert.match(formatToolResult(result), /Blockers:\n- Waiting for legal review/)
    assert.match(formatToolResult(result), /Next actions:\n- Complete legal review/)
    assert.match(formatToolResult(result), /Citations:\n- Launch decision \[object:decision-1\]/)
    assert.deepEqual(requests, ['/api/mcp/workspaces/workspace-1/projects/context?project_id=project-1&activity_days=14&task_limit=20&source_limit=10'])
  })
})

test('ambiguous name query returns candidates and never picks one', async () => {
  await withApi((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      status: 'ambiguous',
      workspace,
      candidates: [
        { id: 'project-1', workspaceId: 'workspace-1', title: 'Launch AuroraDocs' },
        { id: 'project-2', workspaceId: 'workspace-1', title: 'Launch Website' },
      ],
      asOf: '2026-07-14T12:00:00.000Z',
    }))
  }, async () => {
    const result = await executeToolCall('get_project_context', { workspace_id: 'workspace-1', query: 'launch' }, context)
    assert.equal(result.type, 'project_context')
    if (result.type !== 'project_context') return
    assert.equal(result.status, 'ambiguous')
    if (result.status !== 'ambiguous') return
    assert.equal(result.candidates.length, 2)
    assert.equal('project' in result, false)
  })
})

test('project context validates exactly one selector and numeric bounds before a request', async () => {
  await withApi((_req, res) => res.end('{}'), async (requests) => {
    for (const input of [
      { workspace_id: 'workspace-1' },
      { workspace_id: 'workspace-1', project_id: 'project-1', query: 'launch' },
      { workspace_id: 'workspace-1', project_id: 'project-1', activity_days: 0 },
      { workspace_id: 'workspace-1', project_id: 'project-1', task_limit: 51 },
      { workspace_id: 'workspace-1', project_id: 'project-1', source_limit: 26 },
    ]) {
      const result = await executeToolCall('get_project_context', input, context)
      assert.equal(result.type, 'error')
      if (result.type === 'error') assert.equal(result.code, 'invalid_input')
    }
    assert.equal(requests.length, 0)
  })
})

test('list_project_changes requires project, cursor, and bounded limit and returns normalized changes', async () => {
  await withApi((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      status: 'ok',
      workspace,
      project: { id: 'project-1', workspaceId: 'workspace-1', title: 'Launch AuroraDocs' },
      asOf: '2026-07-14T12:00:00.000Z',
      items: [{ id: 'event-2', type: 'task_updated', title: 'Publish MCP', updatedAt: '2026-07-14T11:30:00.000Z' }],
      nextCursor: 'cursor-2',
      hasMore: false,
    }))
  }, async (requests) => {
    const result = await executeToolCall('list_project_changes', {
      workspace_alias: 'henrik-pkm', project_id: 'project-1', cursor: 'cursor-1', limit: 100,
    }, context)
    assert.equal(result.type, 'project_changes')
    if (result.type !== 'project_changes') return
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.items[0]?.type, 'task_updated')
    assert.equal(result.nextCursor, 'cursor-2')
    assert.deepEqual(requests, ['/api/mcp/workspaces/workspace-1/projects/project-1/changes?cursor=cursor-1&limit=100'])
  })
})

test('list_project_changes rejects missing or invalid pagination before a request', async () => {
  await withApi((_req, res) => res.end('{}'), async (requests) => {
    for (const input of [
      { workspace_id: 'workspace-1', cursor: 'cursor-1' },
      { workspace_id: 'workspace-1', project_id: 'project-1' },
      { workspace_id: 'workspace-1', project_id: 'project-1', cursor: '', limit: 50 },
      { workspace_id: 'workspace-1', project_id: 'project-1', cursor: 'cursor-1', limit: 101 },
    ]) {
      const result = await executeToolCall('list_project_changes', input, context)
      assert.equal(result.type, 'error')
      if (result.type === 'error') assert.equal(result.code, 'invalid_input')
    }
    assert.equal(requests.length, 0)
  })
})

test('project workflow rejects mismatched identities and malformed citations without leaking payloads', async () => {
  for (const body of [
    { status: 'ok', workspace: { id: 'workspace-other', name: 'Private workspace' }, project, asOf: '2026-07-14T12:00:00.000Z', cursor: null },
    { status: 'ok', workspace, project: { ...project, id: 'project-other' }, asOf: '2026-07-14T12:00:00.000Z', cursor: null },
    { status: 'ok', workspace, project: { ...project, sources: [{ ...project.sources[0], deepLink: 'javascript:alert(1)' }] }, asOf: '2026-07-14T12:00:00.000Z', cursor: null },
    { status: 'ok', workspace, project: { ...project, sources: Array(11).fill(project.sources[0]) }, asOf: '2026-07-14T12:00:00.000Z', cursor: null },
  ]) {
    await withApi((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }, async () => {
      const result = await executeToolCall('get_project_context', { workspace_id: 'workspace-1', project_id: 'project-1' }, context)
      assert.deepEqual(result, {
        type: 'error', code: 'server_error', message: 'AuroraCloud is temporarily unavailable.', retryable: false,
      })
      assert.doesNotMatch(formatToolResult(result), /Private workspace|javascript|project-other/)
    })
  }
})

test('project workflows reject upstream pages that violate requested bounds or pagination invariants', async () => {
  for (const body of [
    {
      status: 'ok', workspace,
      project: { id: 'project-1', workspaceId: 'workspace-1', title: 'Launch AuroraDocs' },
      asOf: '2026-07-14T12:00:00.000Z',
      items: [
        { id: 'event-1', type: 'task_updated', title: null, updatedAt: '2026-07-14T11:00:00.000Z' },
        { id: 'event-2', type: 'task_updated', title: null, updatedAt: '2026-07-14T11:01:00.000Z' },
      ],
      nextCursor: null,
      hasMore: false,
    },
    {
      status: 'ok', workspace,
      project: { id: 'project-1', workspaceId: 'workspace-1', title: 'Launch AuroraDocs' },
      asOf: '2026-07-14T12:00:00.000Z',
      items: [],
      nextCursor: null,
      hasMore: true,
    },
    {
      status: 'ok', workspace,
      project: { id: 'project-1', workspaceId: 'workspace-1', title: 'Launch AuroraDocs' },
      asOf: '2026-07-14T12:00:00.000Z',
      items: [{ id: 'event-1', type: 'task_updated', title: null, updatedAt: '2026-02-30T11:00:00.000Z' }],
      nextCursor: null,
      hasMore: false,
    },
  ]) {
    await withApi((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }, async () => {
      const result = await executeToolCall('list_project_changes', {
        workspace_id: 'workspace-1', project_id: 'project-1', cursor: 'cursor-1', limit: 1,
      }, context)
      assert.equal(result.type, 'error')
      if (result.type === 'error') assert.equal(result.code, 'server_error')
    })
  }
})

test('project context rejects rollover-invalid calendar dates across every timestamp surface', async () => {
  const invalidBodies = [
    { status: 'ok', workspace, project, asOf: '2026-02-30T12:00:00.000Z', cursor: null },
    { status: 'ok', workspace, project: { ...project, startDate: '2026-02-30' }, asOf: '2026-07-14T12:00:00.000Z', cursor: null },
    { status: 'ok', workspace, project: { ...project, dueDate: '2026-02-30' }, asOf: '2026-07-14T12:00:00.000Z', cursor: null },
    {
      status: 'ok', workspace,
      project: {
        ...project,
        tasks: {
          ...project.tasks,
          groups: {
            ...project.tasks.groups,
            blocked: [{ ...project.tasks.groups.blocked[0], updatedAt: '2026-02-30T10:00:00.000Z' }],
          },
        },
      },
      asOf: '2026-07-14T12:00:00.000Z', cursor: null,
    },
    {
      status: 'ok', workspace,
      project: { ...project, recentActivity: [{ ...project.recentActivity[0], updatedAt: '2026-02-30T09:00:00.000Z' }] },
      asOf: '2026-07-14T12:00:00.000Z', cursor: null,
    },
    {
      status: 'ok', workspace,
      project: { ...project, sources: [{ ...project.sources[0], updatedAt: '2026-02-30T08:00:00.000Z' }] },
      asOf: '2026-07-14T12:00:00.000Z', cursor: null,
    },
  ]

  for (const body of invalidBodies) {
    await withApi((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }, async () => {
      const result = await executeToolCall('get_project_context', {
        workspace_id: 'workspace-1', project_id: 'project-1',
      }, context)
      assert.deepEqual(result, {
        type: 'error', code: 'server_error', message: 'AuroraCloud is temporarily unavailable.', retryable: false,
      })
      assert.doesNotMatch(formatToolResult(result), /2026-02-30/)
    })
  }
})

test('project context accepts only single-slash local or HTTPS citation links', async () => {
  for (const maliciousLink of [
    '//evil.example/steal',
    '/\\evil.example/steal',
    '/object/decision-1\\evil',
    '/object/decision-1%5Cevil',
    'http://app.auroradocs.eu/object/decision-1',
  ]) {
    await withApi((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        status: 'ok', workspace,
        project: { ...project, sources: [{ ...project.sources[0], deepLink: maliciousLink }] },
        asOf: '2026-07-14T12:00:00.000Z', cursor: null,
      }))
    }, async () => {
      const result = await executeToolCall('get_project_context', {
        workspace_id: 'workspace-1', project_id: 'project-1',
      }, context)
      assert.deepEqual(result, {
        type: 'error', code: 'server_error', message: 'AuroraCloud is temporarily unavailable.', retryable: false,
      })
      assert.doesNotMatch(formatToolResult(result), /evil\.example|http:\/\//)
    })
  }

  await withApi((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      status: 'ok', workspace,
      project: { ...project, sources: [{ ...project.sources[0], deepLink: '/object/decision-1' }] },
      asOf: '2026-07-14T12:00:00.000Z', cursor: null,
    }))
  }, async () => {
    const result = await executeToolCall('get_project_context', {
      workspace_id: 'workspace-1', project_id: 'project-1',
    }, context)
    assert.equal(result.type, 'project_context')
    if (result.type === 'project_context' && result.status === 'ok') {
      assert.equal(result.project.sources[0]?.deepLink, '/object/decision-1')
    }
  })
})
