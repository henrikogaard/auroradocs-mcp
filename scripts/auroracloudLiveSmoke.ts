async function main() {
  requireEnv('AURORA_API_URL')
  const workspaceId = requireEnv('AURORA_WORKSPACE_ID')
  requireMcpToken()

  const [{ authenticate, resetAuroraClientForTests }, { executeToolCall }, { getToolDefinitions }] = await Promise.all([
    import('../src/auroraClient.ts'),
    import('../src/tools.ts'),
    import('../src/toolCatalog.ts'),
  ])

  resetAuroraClientForTests()
  await authenticate()

  const tools = getToolDefinitions()
  if (tools.length < 1) {
    throw new Error('AuroraCloud MCP live smoke could not list tools.')
  }

  const members = await executeToolCall('list_workspace_members', {}, workspaceId)
  if (members.type !== 'members' || members.members.length < 1) {
    throw new Error('AuroraCloud MCP live smoke could not list workspace members.')
  }

  const taskLists = await executeToolCall('list_task_lists', {}, workspaceId)
  if (taskLists.type !== 'task_lists') {
    throw new Error(`AuroraCloud MCP live smoke could not list task lists: ${JSON.stringify(taskLists)}`)
  }

  const recentKnowledge = await executeToolCall('wiki_recent', { limit: 1 }, workspaceId)
  if (recentKnowledge.type !== 'knowledge_sources') {
    throw new Error(`AuroraCloud MCP live smoke could not list recent knowledge: ${JSON.stringify(recentKnowledge)}`)
  }

  process.stdout.write('AuroraCloud MCP live smoke passed.\n')
}

function requireEnv(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) {
    throw new Error(`${key} is required.`)
  }
  return value
}

function requireMcpToken(): string {
  const token = requireEnv('AURORA_API_TOKEN')
  if (!token.startsWith('aur_mcp_')) {
    throw new Error('AURORA_API_TOKEN must start with aur_mcp_.')
  }
  return token
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
