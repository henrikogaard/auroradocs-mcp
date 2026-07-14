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
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { authenticate } from './auroraClient.js'
import { createAuroraMcpServer } from './server.js'

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let context
  try {
    context = await authenticate({
      token: process.env['AURORA_API_TOKEN'],
      workspaceId: process.env['AURORA_WORKSPACE_ID'],
    })
  } catch {
    process.stderr.write('AuroraDocs MCP authentication failed.\n')
    process.exit(1)
  }

  const server = createAuroraMcpServer(context)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('AuroraDocs MCP server running.\n')
}

main().catch(() => {
  process.stderr.write('AuroraDocs MCP server failed to start.\n')
  process.exit(1)
})
