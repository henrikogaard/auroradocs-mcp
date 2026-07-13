import assert from 'node:assert/strict'
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

    response.statusCode = 404
    response.end(JSON.stringify({ error: `Unexpected route: ${request.method} ${url.pathname}` }))
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
        AURORA_API_TOKEN: token,
        AURORA_WORKSPACE_ID: workspaceId,
      },
      stderr: 'pipe',
    })
    client = new Client({ name: 'auroradocs-mcp-stdio-test', version: '1.0.0' })
    await client.connect(transport)

    const listed = await client.listTools()
    assert(listed.tools.some((tool) => tool.name === 'get_mcp_tool_coverage'))

    const result = await client.callTool({ name: 'get_mcp_tool_coverage', arguments: {} })
    assert.notEqual(result.isError, true)
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

    assert.deepEqual(requests.map(({ path }) => path), [
      '/auth/me',
      '/api/collections/workspace_members/records',
    ])
    assert(requests.every(({ authorization }) => authorization === `Bearer ${token}`))
    const membershipRequest = requests[1]
    assert(membershipRequest)
    const membershipFilter = new URLSearchParams(membershipRequest.search).get('filter')
    assert.match(membershipFilter ?? '', /workspace_id = "workspace-test"/)
    assert.match(membershipFilter ?? '', /user_id = "user-test"/)
  } finally {
    await client?.close().catch(() => undefined)
    await transport?.close().catch(() => undefined)
    if (api.listening) await closeServer(api)
  }
})
