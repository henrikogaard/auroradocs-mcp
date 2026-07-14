import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { executeToolCall, toMcpToolCallResult } from './tools.js'
import { getToolDefinitions } from './toolCatalog.js'
import { SERVER_VERSION } from './version.js'

export type AuroraMcpServerContext = {
  workspaceId: string
}

export function createAuroraMcpServer(context: AuroraMcpServerContext): Server {
  const server = new Server(
    { name: 'auroradocs-mcp', version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const result = await executeToolCall(name, (args ?? {}) as Record<string, unknown>, context.workspaceId)
    return toMcpToolCallResult(result)
  })

  return server
}
