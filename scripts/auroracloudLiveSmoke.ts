async function main() {
  requireEnv('AURORA_API_URL')
  const workspaceId = requireEnv('AURORA_WORKSPACE_ID')

  const [{ authenticate, resetAuroraClientForTests }, { executeToolCall }] = await Promise.all([
    import('../src/auroraClient.ts'),
    import('../src/tools.ts'),
  ])

  resetAuroraClientForTests()
  await authenticate()

  const members = await executeToolCall('list_workspace_members', {}, workspaceId)
  if (members.type !== 'members' || members.members.length < 1) {
    throw new Error('AuroraCloud MCP live smoke could not list workspace members.')
  }

  const taskLists = await executeToolCall('list_task_lists', {}, workspaceId)
  if (taskLists.type !== 'task_lists') {
    throw new Error(`AuroraCloud MCP live smoke could not list task lists: ${JSON.stringify(taskLists)}`)
  }

  const created = await executeToolCall(
    'create_object',
    { type: 'page', title: `Aurora MCP Live Smoke ${new Date().toISOString()}` },
    workspaceId,
  )
  if (created.type !== 'created') {
    throw new Error(`AuroraCloud MCP live smoke failed to create object: ${JSON.stringify(created)}`)
  }

  try {
    const setContent = await executeToolCall(
      'set_content',
      { id: created.id, text: 'Hello from the AuroraCloud MCP live smoke.' },
      workspaceId,
    )
    if (setContent.type !== 'content_set') {
      throw new Error(`AuroraCloud MCP live smoke failed to set content: ${JSON.stringify(setContent)}`)
    }

    const loaded = await executeToolCall('get_object', { id: created.id }, workspaceId)
    if (loaded.type !== 'object') {
      throw new Error(`AuroraCloud MCP live smoke failed to reload object: ${JSON.stringify(loaded)}`)
    }
    if (!loaded.content?.includes('AuroraCloud MCP live smoke')) {
      throw new Error('AuroraCloud MCP live smoke did not get the saved content back.')
    }

    const wikiSearch = await executeToolCall('wiki_search', { query: 'Aurora MCP Live Smoke', limit: 5 }, workspaceId)
    if (wikiSearch.type !== 'knowledge_sources' || !wikiSearch.sources.some((source) => source.objectId === created.id)) {
      throw new Error('AuroraCloud MCP live smoke did not find the created object through wiki_search.')
    }

    const wikiPage = await executeToolCall('wiki_get_page', { id: created.id, includeFullText: true }, workspaceId)
    if (wikiPage.type !== 'knowledge_sources' || wikiPage.sources.length !== 1) {
      throw new Error(`AuroraCloud MCP live smoke failed to read the wiki source: ${JSON.stringify(wikiPage)}`)
    }
    if (!wikiPage.sources[0]?.plainText?.includes('AuroraCloud MCP live smoke')) {
      throw new Error('AuroraCloud MCP live smoke did not get the wiki page text back.')
    }

    const listed = await executeToolCall('list_objects', { type: 'page', limit: 10 }, workspaceId)
    if (listed.type !== 'objects' || !listed.objects.some((object) => object.id === created.id)) {
      throw new Error('AuroraCloud MCP live smoke did not list the created object.')
    }
  } finally {
    const deleted = await executeToolCall('delete_object', { id: created.id }, workspaceId)
    if (deleted.type !== 'deleted') {
      throw new Error(`AuroraCloud MCP live smoke failed to delete the temporary object: ${JSON.stringify(deleted)}`)
    }
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

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
