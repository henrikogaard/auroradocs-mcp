import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js'

const workspaceId = 'workspace-test'
const token = 'aur_mcp_test_example'
const userId = 'user-test'
const recordTitle = 'Private launch roadmap'

function projectContextPayload() {
  return {
    status: 'ok',
    workspace: { id: workspaceId, name: 'Test Space' },
    project: {
      id: 'project-test',
      workspaceId,
      title: 'Launch AuroraDocs',
      goal: null,
      status: 'In Progress',
      priority: null,
      owner: null,
      progress: null,
      startDate: null,
      dueDate: null,
      brief: { availability: 'empty', text: null },
      tasks: { availability: 'empty', groups: { todo: [], in_progress: [], blocked: [], done: [] } },
      blockers: [],
      risks: [],
      unresolvedDecisions: [],
      recentActivity: [],
      nextActions: [],
      sources: [],
    },
    asOf: '2026-07-14T12:00:00.000Z',
    cursor: null,
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      assert(address && typeof address !== 'string')
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function runMcpProcess(env: Record<string, string>): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('close', (exitCode) => resolve({ exitCode, stderr }))
  })
}

test('authentication failure diagnostics do not expose private startup context', async () => {
  const privateWorkspaceId = 'workspace-private-auth'
  const privateUserId = 'user-private-auth'
  const privateToken = 'aur_mcp_private_auth_token'
  const privateUpstreamText = 'Confidential upstream membership details'
  for (const failure of ['membership_rejected', 'upstream_error'] as const) {
    const api = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      response.setHeader('content-type', 'application/json')

      if (request.method === 'GET' && url.pathname === '/auth/me') {
        response.end(JSON.stringify({ user: { id: privateUserId, private_note: privateUpstreamText } }))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/collections/workspace_members/records') {
        if (failure === 'membership_rejected') {
          response.end(JSON.stringify({ items: [], totalPages: 1, private_error: privateUpstreamText }))
        } else {
          response.statusCode = 500
          response.end(JSON.stringify({ error: privateUpstreamText }))
        }
        return
      }

      response.statusCode = 500
      response.end(JSON.stringify({ error: privateUpstreamText }))
    })

    try {
      const port = await listen(api)
      const result = await runMcpProcess({
        ...getDefaultEnvironment(),
        AURORA_API_URL: `http://127.0.0.1:${port}`,
        AURORA_API_TOKEN: privateToken,
        AURORA_WORKSPACE_ID: privateWorkspaceId,
      })

      assert.equal(result.exitCode, 1)
      assert.equal(result.stderr, 'AuroraDocs MCP authentication failed.\n')
      for (const secret of [privateUserId, privateWorkspaceId, privateToken, privateUpstreamText]) {
        assert.doesNotMatch(result.stderr, new RegExp(secret))
      }
    } finally {
      if (api.listening) await closeServer(api)
    }
  }
})

test('an external stdio client can list and invoke the MCP coverage tool', async () => {
  const requests: Array<{ authorization: string | undefined; path: string; search: string }> = []
  const api = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    requests.push({
      authorization: request.headers.authorization,
      path: url.pathname,
      search: url.search,
    })

    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && url.pathname === '/auth/me') {
      response.end(JSON.stringify({ user: { id: userId } }))
      return
    }
    if (
      request.method === 'GET'
      && url.pathname === '/api/collections/workspace_members/records'
    ) {
      response.end(JSON.stringify({
        items: [{ id: 'membership-test', workspace_id: workspaceId, user_id: userId, role: 'owner' }],
        totalPages: 1,
      }))
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/collections/objects/records') {
      response.end(JSON.stringify({
        items: [{
          id: 'record-test',
          workspace_id: workspaceId,
          type: 'page',
          title: recordTitle,
          icon: null,
          parent_id: null,
          is_deleted: false,
          is_template: false,
          created_at: '2026-07-14T08:00:00Z',
          updated_at: '2026-07-14T09:00:00Z',
        }],
        page: 1,
        perPage: 1,
        totalPages: 1,
        totalItems: 1,
      }))
      return
    }
    if (request.method === 'GET' && url.pathname === `/api/mcp/workspaces/${workspaceId}/projects/context`) {
      response.end(JSON.stringify(projectContextPayload()))
      return
    }

    response.statusCode = 404
    response.end(JSON.stringify({ error: `Unexpected route: ${request.method} ${url.pathname}` }))
  })

  let transport: StdioClientTransport | undefined
  let client: Client | undefined
  let stderr = ''
  try {
    const port = await listen(api)
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        AURORA_API_URL: `http://127.0.0.1:${port}`,
        AURORA_API_TOKEN: token,
        AURORA_WORKSPACE_ID: workspaceId,
      },
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    client = new Client({ name: 'auroradocs-mcp-stdio-test', version: '1.0.0' })
    await client.connect(transport)

    const listed = await client.listTools()
    assert(listed.tools.some((tool) => tool.name === 'get_mcp_tool_coverage'))

    const prompts = await client.listPrompts()
    assert(prompts.prompts.some((prompt) => prompt.name === 'resume_project'))
    const prompt = await client.getPrompt({
      name: 'resume_project',
      arguments: { workspace_id: workspaceId, project_id: 'project-test' },
    })
    assert.equal(prompt.messages[0]?.content.type, 'text')
    assert.match(prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : '', /get_project_context/)

    const templates = await client.listResourceTemplates()
    assert(templates.resourceTemplates.some((template) => (
      template.uriTemplate === 'aurora://workspaces/{workspaceId}/projects/{projectId}/context'
    )))
    const resource = await client.readResource({
      uri: `aurora://workspaces/${workspaceId}/projects/project-test/context`,
    })
    assert.equal(resource.contents[0]?.mimeType, 'application/json')
    const resourceContent = resource.contents[0]
    assert(resourceContent && 'text' in resourceContent)
    assert.equal(JSON.parse(resourceContent.text).project.id, 'project-test')

    const result = await client.callTool({ name: 'get_mcp_tool_coverage', arguments: {} })
    assert.equal(result.isError, false)
    const structuredContent = result.structuredContent as Record<string, unknown> | undefined
    assert.equal(typeof structuredContent, 'object')
    assert.equal(structuredContent?.['type'], 'mcp_tool_coverage')
    assert.equal(typeof structuredContent?.['audit'], 'object')
    const content = result.content
    assert(Array.isArray(content))
    const text = content.find((item: unknown): item is { type: 'text'; text: string } => (
      typeof item === 'object'
      && item !== null
      && 'type' in item
      && item.type === 'text'
      && 'text' in item
      && typeof item.text === 'string'
    ))
    assert(text)
    assert.doesNotThrow(() => JSON.parse(text.text))

    const errorResult = await client.callTool({ name: 'list_objects', arguments: { limit: 0 } })
    assert.equal(errorResult.isError, true)
    assert.deepEqual(errorResult.structuredContent, {
      type: 'error',
      code: 'invalid_input',
      message: 'limit must be an integer between 1 and 50',
      retryable: false,
    })

    const recordResult = await client.callTool({ name: 'list_objects', arguments: { limit: 1 } })
    assert.equal(recordResult.isError, false)
    assert.deepEqual(recordResult.structuredContent, {
      type: 'objects',
      objects: [{ id: 'record-test', title: recordTitle, type: 'page', icon: null }],
    })

    assert.deepEqual(requests.map(({ path }) => path), [
      '/auth/me',
      '/api/collections/workspace_members/records',
      `/api/mcp/workspaces/${workspaceId}/projects/context`,
      '/api/collections/objects/records',
    ])
    assert(requests.every(({ authorization }) => authorization === `Bearer ${token}`))
    const membershipRequest = requests[1]
    assert(membershipRequest)
    const membershipFilter = new URLSearchParams(membershipRequest.search).get('filter')
    assert.match(membershipFilter ?? '', /workspace_id = "workspace-test"/)
    assert.match(membershipFilter ?? '', /user_id = "user-test"/)

    assert.match(stderr, /AuroraDocs MCP authenticated\./)
    assert.match(stderr, /AuroraDocs MCP server running\./)
    for (const secret of [userId, workspaceId, token, recordTitle]) {
      assert.doesNotMatch(stderr, new RegExp(secret))
    }
  } finally {
    await client?.close().catch(() => undefined)
    await transport?.close().catch(() => undefined)
    if (api.listening) await closeServer(api)
  }
})

test('client credentials discover granted workspaces without a default workspace', async () => {
  const clientToken = 'aur_mcp_client_stdio_fixture'
  const requests: string[] = []
  const api = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    requests.push(url.pathname)
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && url.pathname === '/api/mcp/workspaces') {
      response.end(JSON.stringify({ items: [{
        workspaceId,
        alias: 'test-space-test',
        name: 'Test Space',
        role: 'owner',
        scopes: ['read:objects'],
        grantId: 'grant-test',
        expiresAt: '2026-10-01T00:00:00.000Z',
      }] }))
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/collections/objects/records') {
      response.end(JSON.stringify({ items: [], page: 1, perPage: 1, totalPages: 1, totalItems: 0 }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'unexpected route' }))
  })

  let transport: StdioClientTransport | undefined
  let client: Client | undefined
  try {
    const port = await listen(api)
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        AURORA_API_URL: `http://127.0.0.1:${port}`,
        AURORA_API_TOKEN: clientToken,
      },
      stderr: 'pipe',
    })
    client = new Client({ name: 'auroradocs-mcp-client-credential-test', version: '1.0.0' })
    await client.connect(transport)

    const listed = await client.callTool({ name: 'list_workspaces', arguments: {} })
    assert.deepEqual(listed.structuredContent, {
      type: 'workspaces',
      workspaces: [{
        workspaceId,
        alias: 'test-space-test',
        name: 'Test Space',
        role: 'owner',
        scopes: ['read:objects'],
        grantId: 'grant-test',
        expiresAt: '2026-10-01T00:00:00.000Z',
      }],
    })
    const objects = await client.callTool({ name: 'list_objects', arguments: { workspace_alias: 'test-space-test', limit: 1 } })
    assert.deepEqual(objects.structuredContent, { type: 'objects', objects: [] })
    assert.deepEqual(requests, ['/api/mcp/workspaces', '/api/collections/objects/records'])
  } finally {
    await client?.close().catch(() => undefined)
    await transport?.close().catch(() => undefined)
    if (api.listening) await closeServer(api)
  }
})
