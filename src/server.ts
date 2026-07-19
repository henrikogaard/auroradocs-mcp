import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { ToolInputError, toSafeToolError } from './errors.js'
import {
  getAuroraPromptDefinitions,
  getAuroraPrompt,
  getAuroraResourceTemplates,
  readAuroraResource,
} from './mcpSurfaces.js'
import { executeToolCall, toMcpToolCallResult } from './tools.js'
import { getToolDefinitions } from './toolCatalog.js'
import { SERVER_VERSION } from './version.js'
import type { AuroraConnectionContext } from './contracts.js'
import { buildObsidianConsentElicitation } from './obsidian/consent.js'

export function createAuroraMcpServer(context: AuroraConnectionContext): Server {
  const server = new Server(
    { name: 'auroradocs-mcp', version: SERVER_VERSION },
    { capabilities: { tools: {}, prompts: {}, resources: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const formElicitation = server.getClientCapabilities()?.elicitation?.form
    const result = await executeToolCall(name, (args ?? {}) as Record<string, unknown>, context, {
      requestObsidianImportConsent: formElicitation
        ? async (preview) => {
            const response = await server.elicitInput(buildObsidianConsentElicitation(preview))
            return { action: response.action, content: response.content }
          }
        : undefined,
    })
    return toMcpToolCallResult(result)
  })

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: getAuroraPromptDefinitions(),
  }))

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    try {
      return getAuroraPrompt(request.params.name, request.params.arguments ?? {})
    } catch (error) {
      if (error instanceof ToolInputError) throw new McpError(ErrorCode.InvalidParams, error.message)
      throw error
    }
  })

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: getAuroraResourceTemplates(),
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      return await readAuroraResource(request.params.uri, context)
    } catch (error) {
      if (error instanceof ToolInputError) throw new McpError(ErrorCode.InvalidParams, error.message)
      const safeError = toSafeToolError(error)
      const code = safeError.code === 'not_found'
        ? ErrorCode.InvalidParams
        : ErrorCode.InternalError
      throw new McpError(code, safeError.message)
    }
  })

  return server
}
