#!/usr/bin/env node
/**
 * AuroraDocs MCP Server
 *
 * Exposes AuroraDocs workspace data to Claude Desktop and other MCP clients.
 * Uses the MCP stdio transport — add it to claude_desktop_config.json.
 *
 * SECURITY:
 *   - On startup the server verifies the authenticated user is a member
 *     of AURORA_WORKSPACE_ID. All queries are scoped to that workspace.
 *   - Object reads/writes verify workspace ownership before proceeding.
 *   - No cross-workspace or cross-user data leakage is possible.
 *
 * Environment variables:
 *   AURORA_WORKSPACE_ID  Workspace ID to expose
 *   AURORA_API_URL       AuroraCloud API URL, e.g. http://127.0.0.1:3000
 *   AURORA_API_TOKEN     AuroraCloud bearer token (recommended: workspace MCP token `aur_mcp_...`)
 *   AURORA_API_EMAIL     AuroraCloud user email (legacy/dev fallback)
 *   AURORA_API_PASSWORD  AuroraCloud user password (legacy/dev fallback)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { authenticate } from './auroraClient.js'
import { executeToolCall, formatToolResult } from './tools.js'
import { getToolDefinitions } from './toolCatalog.js'

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const workspaceId = process.env['AURORA_WORKSPACE_ID']
  if (!workspaceId) {
    process.stderr.write('Error: AURORA_WORKSPACE_ID environment variable is required\n')
    process.exit(1)
  }

  try {
    await authenticate()
  } catch (err) {
    process.stderr.write(`Authentication failed: ${err instanceof Error ? err.message : err}\n`)
    process.exit(1)
  }

  const server = new Server(
    { name: 'aurora-mcp', version: '0.1.1' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const result = await executeToolCall(name, (args ?? {}) as Record<string, unknown>, workspaceId)
    const text = formatToolResult(result)
    return {
      content: [{ type: 'text', text }],
      isError: result.type === 'error',
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write(`AuroraDocs MCP server running (workspace: ${workspaceId})\n`)
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`)
  process.exit(1)
})
