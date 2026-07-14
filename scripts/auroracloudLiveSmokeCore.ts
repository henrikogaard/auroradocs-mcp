import type { AuroraConnectionContext, GrantedWorkspace } from '../src/contracts.js'

type ToolEffect = 'read' | 'write'

type ToolResult = {
  type: string
  [key: string]: unknown
}

type ReadOnlyDispatcher = {
  getToolEffect(name: string): ToolEffect | undefined
  executeToolCall(name: string, input: Record<string, unknown>, context: AuroraConnectionContext): Promise<ToolResult>
}

type LiveSmokeDependencies = ReadOnlyDispatcher & {
  authenticate(options: { token: string; workspaceId?: string }): Promise<AuroraConnectionContext>
  resetAuroraClientForTests(): void
  getToolDefinitions(): Array<{ name: string }>
}

export const LIVE_SMOKE_TOOL_NAMES = ['list_workspaces', 'get_project_context'] as const

type LiveSmokeOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  loadDependencies?: () => Promise<LiveSmokeDependencies>
  writeOutput?: (value: string) => void
}

export async function executeReadOnlyTool(
  dependencies: ReadOnlyDispatcher,
  name: string,
  input: Record<string, unknown>,
  context: AuroraConnectionContext,
): Promise<ToolResult> {
  if (dependencies.getToolEffect(name) !== 'read') {
    throw new Error(`Live smoke tool is not authoritatively classified as read-only: ${name}`)
  }
  return dependencies.executeToolCall(name, input, context)
}

export async function runLiveSmoke(options: LiveSmokeOptions = {}): Promise<void> {
  const env = options.env ?? process.env
  requireEnv(env, 'AURORA_API_URL')
  const token = requireMcpToken(env)
  const legacyWorkspaceId = token.startsWith('aur_mcp_client_')
    ? optionalEnv(env, 'AURORA_WORKSPACE_ID')
    : requireLegacyWorkspaceId(env)

  const dependencies = await (options.loadDependencies ?? loadRuntimeDependencies)()
  dependencies.resetAuroraClientForTests()
  const context = await dependencies.authenticate({ token, workspaceId: legacyWorkspaceId })

  const tools = dependencies.getToolDefinitions()
  if (tools.length < 1) {
    throw new Error('AuroraCloud MCP live smoke could not list tools.')
  }

  for (const requiredTool of LIVE_SMOKE_TOOL_NAMES) {
    if (!tools.some((tool) => tool.name === requiredTool)) {
      throw new Error(`AuroraCloud MCP live smoke could not find required tool: ${requiredTool}`)
    }
  }

  const discovered = await executeReadOnlyTool(dependencies, LIVE_SMOKE_TOOL_NAMES[0], {}, context)
  if (discovered.type !== 'workspaces' || !Array.isArray(discovered['workspaces'])) {
    throw new Error(`AuroraCloud MCP live smoke could not list granted workspaces: ${failureSummary(discovered)}`)
  }

  const projectId = optionalEnv(env, 'AURORA_SMOKE_PROJECT_ID')
  if (projectId) {
    const workspaceId = selectSmokeWorkspace(env, context, discovered['workspaces'])
    const project = await executeReadOnlyTool(dependencies, LIVE_SMOKE_TOOL_NAMES[1], {
      workspace_id: workspaceId,
      project_id: projectId,
      activity_days: 14,
      task_limit: 20,
      source_limit: 10,
    }, context)
    if (project.type !== 'project_context' || project['status'] !== 'ok') {
      throw new Error(`AuroraCloud MCP live smoke could not get project context: ${failureSummary(project)}`)
    }
  }

  const writeOutput = options.writeOutput ?? ((value: string) => process.stdout.write(value))
  writeOutput('AuroraCloud MCP live smoke passed.\n')
}

function failureSummary(result: ToolResult): string {
  if (result.type === 'error') {
    return `tool error: ${String(result['message'] ?? 'unknown error')}`
  }
  return `unexpected result type: ${result.type}`
}

function requireEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
): string {
  const value = env[key]?.trim()
  if (!value) {
    throw new Error(`${key} is required.`)
  }
  return value
}

function requireMcpToken(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const token = requireEnv(env, 'AURORA_API_TOKEN')
  if (!token.startsWith('aur_mcp_client_') && !token.startsWith('aur_mcp_')) {
    throw new Error('AURORA_API_TOKEN must start with aur_mcp_ or aur_mcp_client_.')
  }
  return token
}

function optionalEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
): string | undefined {
  return env[key]?.trim() || undefined
}

function requireLegacyWorkspaceId(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string {
  const workspaceId = optionalEnv(env, 'AURORA_WORKSPACE_ID')
  if (!workspaceId) throw new Error('AURORA_WORKSPACE_ID is required for legacy credentials.')
  return workspaceId
}

function selectSmokeWorkspace(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  context: AuroraConnectionContext,
  discovered: unknown[],
): string {
  if (context.kind === 'legacy_workspace') return context.defaultWorkspaceId

  const workspaces = discovered.filter(isGrantedWorkspace)
  if (workspaces.length < 1) throw new Error('AuroraCloud MCP live smoke found no granted workspaces.')
  const requestedId = optionalEnv(env, 'AURORA_SMOKE_WORKSPACE_ID')
  if (requestedId) {
    if (!workspaces.some((workspace) => workspace.workspaceId === requestedId)) {
      throw new Error('AURORA_SMOKE_WORKSPACE_ID does not match a discovered workspace grant.')
    }
    return requestedId
  }
  if (workspaces.length !== 1) {
    throw new Error('AURORA_SMOKE_WORKSPACE_ID is required when the client has multiple workspace grants.')
  }
  return workspaces[0]!.workspaceId
}

function isGrantedWorkspace(value: unknown): value is GrantedWorkspace {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>)['workspaceId'] === 'string'
}

async function loadRuntimeDependencies(): Promise<LiveSmokeDependencies> {
  const [{ authenticate, resetAuroraClientForTests }, { executeToolCall }, { getToolDefinitions, getToolEffect }] = await Promise.all([
    import('../src/auroraClient.js'),
    import('../src/tools.js'),
    import('../src/toolCatalog.js'),
  ])

  return {
    authenticate,
    resetAuroraClientForTests,
    executeToolCall,
    getToolDefinitions,
    getToolEffect,
  }
}
