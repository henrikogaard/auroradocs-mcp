type ToolEffect = 'read' | 'write'

type ToolResult = {
  type: string
  [key: string]: unknown
}

type ReadOnlyDispatcher = {
  getToolEffect(name: string): ToolEffect | undefined
  executeToolCall(name: string, input: Record<string, unknown>, workspaceId: string): Promise<ToolResult>
}

type LiveSmokeDependencies = ReadOnlyDispatcher & {
  authenticate(): Promise<void>
  resetAuroraClientForTests(): void
  getToolDefinitions(): Array<{ name: string }>
}

type LiveSmokeOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  loadDependencies?: () => Promise<LiveSmokeDependencies>
  writeOutput?: (value: string) => void
}

export async function executeReadOnlyTool(
  dependencies: ReadOnlyDispatcher,
  name: string,
  input: Record<string, unknown>,
  workspaceId: string,
): Promise<ToolResult> {
  if (dependencies.getToolEffect(name) !== 'read') {
    throw new Error(`Live smoke tool is not authoritatively classified as read-only: ${name}`)
  }
  return dependencies.executeToolCall(name, input, workspaceId)
}

export async function runLiveSmoke(options: LiveSmokeOptions = {}): Promise<void> {
  const env = options.env ?? process.env
  requireEnv(env, 'AURORA_API_URL')
  const workspaceId = requireEnv(env, 'AURORA_WORKSPACE_ID')
  requireMcpToken(env)

  const dependencies = await (options.loadDependencies ?? loadRuntimeDependencies)()
  dependencies.resetAuroraClientForTests()
  await dependencies.authenticate()

  const tools = dependencies.getToolDefinitions()
  if (tools.length < 1) {
    throw new Error('AuroraCloud MCP live smoke could not list tools.')
  }

  const members = await executeReadOnlyTool(dependencies, 'list_workspace_members', {}, workspaceId)
  if (members.type !== 'members' || !Array.isArray(members['members']) || members['members'].length < 1) {
    throw new Error(`AuroraCloud MCP live smoke could not list workspace members: ${failureSummary(members)}`)
  }

  const objects = await executeReadOnlyTool(dependencies, 'list_objects', { limit: 1 }, workspaceId)
  if (objects.type !== 'objects' || !Array.isArray(objects['objects'])) {
    throw new Error(`AuroraCloud MCP live smoke could not list objects: ${failureSummary(objects)}`)
  }

  const recentKnowledge = await executeReadOnlyTool(dependencies, 'wiki_recent', { limit: 1 }, workspaceId)
  if (recentKnowledge.type !== 'knowledge_sources' || !Array.isArray(recentKnowledge['sources'])) {
    throw new Error(`AuroraCloud MCP live smoke could not list recent knowledge: ${failureSummary(recentKnowledge)}`)
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
  if (!token.startsWith('aur_mcp_')) {
    throw new Error('AURORA_API_TOKEN must start with aur_mcp_.')
  }
  return token
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
