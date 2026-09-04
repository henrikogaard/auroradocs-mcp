import {
  inputRequired,
  inputResponse,
  ProtocolError,
  ProtocolErrorCode,
  Server,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { listGrantedWorkspaces } from './auroraClient.js'
import { ToolInputError, toSafeToolError } from './errors.js'
import {
  getAuroraPromptDefinitions,
  getAuroraPrompt,
  getAuroraResourceTemplates,
  getAuroraServerInstructions,
  completeAuroraArgument,
  readAuroraResource,
} from './mcpSurfaces.js'
import { executeToolCall, toMcpToolCallResult } from './tools.js'
import { getToolDefinitions } from './toolCatalog.js'
import { SERVER_VERSION } from './version.js'
import type { AuroraConnectionContext } from './contracts.js'
import { buildObsidianConsentElicitation, ObsidianElicitationRequired } from './obsidian/consent.js'

const LIST_CACHE = { ttlMs: 300_000, cacheScope: 'private' as const }
const READ_CACHE = { ttlMs: 0, cacheScope: 'private' as const }

function clientSupportsFormElicitation(ctx: ServerContext, server: Server): boolean {
  const envelope = ctx.mcpReq.envelope as { clientCapabilities?: { elicitation?: { form?: unknown } } } | undefined
  const elicitation = envelope?.clientCapabilities?.elicitation ?? server.getClientCapabilities()?.elicitation
  if (!elicitation) return false
  if (Object.hasOwn(elicitation, 'form')) return Boolean(elicitation.form)
  return Object.keys(elicitation).length === 0
}

function withCacheHint<T extends object>(
  result: T,
  ctx: ServerContext,
  hint: { ttlMs: number; cacheScope: 'private' | 'public' },
): T {
  if (!ctx.mcpReq.envelope) return result
  return { ...result, ...hint }
}

export function createAuroraMcpServer(context: AuroraConnectionContext): Server {
  const server = new Server(
    { name: 'auroradocs-mcp', version: SERVER_VERSION },
    {
      capabilities: { tools: {}, prompts: {}, resources: {}, completions: {} },
      instructions: getAuroraServerInstructions(),
      cacheHints: {
        'tools/list': LIST_CACHE,
        'prompts/list': LIST_CACHE,
        'resources/templates/list': LIST_CACHE,
        'resources/read': READ_CACHE,
        'server/discover': LIST_CACHE,
      },
    },
  )

  const refreshClientGrants = context.kind === 'client'
    ? () => listGrantedWorkspaces()
    : undefined

  server.setRequestHandler('tools/list', async (_request, ctx) => withCacheHint({
    tools: getToolDefinitions(),
  }, ctx, LIST_CACHE))

  server.setRequestHandler('completion/complete', async (request, _ctx) => {
    try {
      return await completeAuroraArgument(request.params, context)
    } catch (error) {
      if (error instanceof ToolInputError) throw new ProtocolError(ProtocolErrorCode.InvalidParams, error.message)
      throw new ProtocolError(ProtocolErrorCode.InternalError, toSafeToolError(error).message)
    }
  })

  server.setRequestHandler('tools/call', async (request, ctx) => {
    const { name, arguments: args } = request.params
    const formElicitation = clientSupportsFormElicitation(ctx, server)
    const progressToken = ctx.mcpReq._meta?.progressToken
    try {
      const result = await executeToolCall(name, (args ?? {}) as Record<string, unknown>, context, {
        refreshClientGrants,
        reportProgress: progressToken === undefined
          ? undefined
          : async (progress) => {
              await ctx.mcpReq.notify({
                method: 'notifications/progress',
                params: {
                  progressToken,
                  progress: progress.completed,
                  total: progress.total,
                },
              })
            },
        requestObsidianImportConsent: formElicitation
          ? async (preview) => {
              const view = inputResponse(ctx.mcpReq.inputResponses, 'consent')
              if (view.kind === 'missing') throw new ObsidianElicitationRequired(preview)
              if (view.kind === 'elicit') {
                return {
                  action: view.action === 'accept' ? 'accept' : view.action === 'decline' ? 'decline' : 'cancel',
                  content: view.content,
                }
              }
              throw new ObsidianElicitationRequired(preview)
            }
          : undefined,
      })
      const definition = getToolDefinitions().find((tool) => tool.name === name)
      return server.projectCallToolResult(toMcpToolCallResult(result), definition?.outputSchema)
    } catch (error) {
      if (error instanceof ObsidianElicitationRequired) {
        return inputRequired({
          inputRequests: {
            consent: inputRequired.elicit(buildObsidianConsentElicitation(error.preview)),
          },
        })
      }
      throw error
    }
  })

  server.setRequestHandler('prompts/list', async (_request, ctx) => withCacheHint({
    prompts: getAuroraPromptDefinitions(),
  }, ctx, LIST_CACHE))

  server.setRequestHandler('prompts/get', async (request) => {
    try {
      return getAuroraPrompt(request.params.name, request.params.arguments ?? {})
    } catch (error) {
      if (error instanceof ToolInputError) throw new ProtocolError(ProtocolErrorCode.InvalidParams, error.message)
      throw error
    }
  })

  server.setRequestHandler('resources/templates/list', async (_request, ctx) => withCacheHint({
    resourceTemplates: getAuroraResourceTemplates(),
  }, ctx, LIST_CACHE))

  server.setRequestHandler('resources/read', async (request, ctx) => {
    try {
      return withCacheHint(await readAuroraResource(request.params.uri, context), ctx, READ_CACHE)
    } catch (error) {
      if (error instanceof ToolInputError) throw new ProtocolError(ProtocolErrorCode.InvalidParams, error.message)
      const safeError = toSafeToolError(error)
      const code = safeError.code === 'not_found'
        ? ProtocolErrorCode.InvalidParams
        : ProtocolErrorCode.InternalError
      throw new ProtocolError(code, safeError.message)
    }
  })

  return server
}
