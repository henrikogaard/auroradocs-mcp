import { getConfig } from '../../../apps/api/src/config.js'
import { createAuroraApi } from '../../../apps/api/src/app.js'

async function main() {
  const config = getConfig({
    ...process.env,
    NODE_ENV: 'test',
    AURORA_API_PORT: process.env['AURORA_API_PORT'] ?? '3115',
  })

  const { app } = await createAuroraApi(config)

  try {
    await app.listen({ host: config.host, port: config.port })

    const baseUrl = `http://${config.host}:${config.port}`
    const email = `mcp-${Date.now()}@auroradocs.test`
    const password = 'aurora1234'

    const registerResponse = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        displayName: 'Aurora MCP Smoke',
      }),
    })
    if (!registerResponse.ok) {
      throw new Error(`Failed to register MCP smoke user: ${registerResponse.status}`)
    }

    const registerPayload = await registerResponse.json() as {
      accessToken: string
    }

    const workspaceResponse = await fetch(`${baseUrl}/workspaces`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${registerPayload.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Aurora MCP Smoke Workspace',
        slug: `aurora-mcp-smoke-${Date.now()}`,
      }),
    })
    if (!workspaceResponse.ok) {
      throw new Error(`Failed to create MCP smoke workspace: ${workspaceResponse.status}`)
    }

    const workspacePayload = await workspaceResponse.json() as {
      workspace?: { id?: string }
    }
    const workspaceId = workspacePayload.workspace?.id
    if (!workspaceId) {
      throw new Error('Workspace create response did not include an id.')
    }

    const taskListResponse = await fetch(`${baseUrl}/api/collections/task_lists/records`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${registerPayload.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: `mcp-task-list-${Date.now()}`,
        workspace_id: workspaceId,
        name: 'MCP Smoke List',
        default_status: 'Todo',
        position: 0,
      }),
    })
    if (!taskListResponse.ok) {
      throw new Error(`Failed to create MCP smoke task list: ${taskListResponse.status}`)
    }

    process.env['AURORA_API_URL'] = baseUrl
    process.env['AURORA_WORKSPACE_ID'] = workspaceId
    process.env['AURORA_API_EMAIL'] = email
    process.env['AURORA_API_PASSWORD'] = password

    const [{ authenticate, resetAuroraClientForTests }, { executeToolCall }] = await Promise.all([
      import('../src/auroraClient.ts'),
      import('../src/tools.ts'),
    ])

    resetAuroraClientForTests()
    await authenticate()

    const members = await executeToolCall('list_workspace_members', {}, workspaceId)
    if (members.type !== 'members' || members.members.length < 1) {
      throw new Error('MCP smoke could not list AuroraCloud workspace members.')
    }

    const created = await executeToolCall('create_object', { type: 'page', title: 'Aurora MCP Page' }, workspaceId)
    if (created.type !== 'created') {
      throw new Error(`MCP smoke failed to create object: ${JSON.stringify(created)}`)
    }

    const setContent = await executeToolCall('set_content', { id: created.id, text: 'Hello from AuroraCloud MCP smoke.' }, workspaceId)
    if (setContent.type !== 'content_set') {
      throw new Error(`MCP smoke failed to set content: ${JSON.stringify(setContent)}`)
    }

    const appendBlock = await executeToolCall('append_block', { id: created.id, text: 'Appended by append_block.' }, workspaceId)
    if (appendBlock.type !== 'content_appended') {
      throw new Error(`MCP smoke failed to append content: ${JSON.stringify(appendBlock)}`)
    }

    const setProperty = await executeToolCall(
      'set_property',
      { object_id: created.id, key: 'status', value_type: 'text', value: 'Draft' },
      workspaceId,
    )
    if (setProperty.type !== 'property_set') {
      throw new Error(`MCP smoke failed to set property: ${JSON.stringify(setProperty)}`)
    }

    const loaded = await executeToolCall('get_object', { id: created.id }, workspaceId)
    if (loaded.type !== 'object') {
      throw new Error(`MCP smoke failed to reload created object: ${JSON.stringify(loaded)}`)
    }
    if (!loaded.content?.includes('Hello from AuroraCloud MCP smoke.') || !loaded.content?.includes('Appended by append_block.')) {
      throw new Error('MCP smoke did not get the saved object content back from AuroraCloud.')
    }
    if (loaded.properties['status'] !== 'Draft') {
      throw new Error('MCP smoke did not get the saved object property back from AuroraCloud.')
    }

    const listed = await executeToolCall('list_objects', { type: 'page', limit: 10 }, workspaceId)
    if (listed.type !== 'objects' || !listed.objects.some((object) => object.id === created.id)) {
      throw new Error('MCP smoke did not list the created AuroraCloud object.')
    }

    const recent = await executeToolCall('list_recent', { type: 'page', limit: 10 }, workspaceId)
    if (recent.type !== 'objects' || !recent.objects.some((object) => object.id === created.id)) {
      throw new Error('MCP smoke did not list the created AuroraCloud object through list_recent.')
    }

    const search = await executeToolCall('search', { query: 'Aurora MCP Page' }, workspaceId)
    if (search.type !== 'objects' || !search.objects.some((object) => object.id === created.id)) {
      throw new Error('MCP smoke did not find the created AuroraCloud object through search alias.')
    }

    const wikiSearch = await executeToolCall('wiki_search', { query: 'Aurora MCP Page', limit: 5 }, workspaceId)
    if (wikiSearch.type !== 'knowledge_sources' || !wikiSearch.sources.some((source) => source.objectId === created.id)) {
      throw new Error('MCP smoke did not find the created AuroraCloud object through wiki_search.')
    }

    const wikiPage = await executeToolCall('wiki_get_page', { id: created.id, includeFullText: true }, workspaceId)
    if (wikiPage.type !== 'knowledge_sources' || wikiPage.sources.length !== 1) {
      throw new Error(`MCP smoke failed to read the wiki source: ${JSON.stringify(wikiPage)}`)
    }
    if (!wikiPage.sources[0]?.plainText?.includes('Hello from AuroraCloud MCP smoke.')) {
      throw new Error('MCP smoke did not get the wiki page text back from AuroraCloud.')
    }

    const taskLists = await executeToolCall('list_task_lists', {}, workspaceId)
    if (taskLists.type !== 'task_lists') {
      throw new Error(`MCP smoke failed to list AuroraCloud task lists: ${JSON.stringify(taskLists)}`)
    }
    if (!taskLists.task_lists.some((taskList) => taskList.name === 'MCP Smoke List')) {
      throw new Error('MCP smoke did not return the AuroraCloud task list.')
    }

    process.stdout.write('AuroraCloud MCP smoke passed.\n')
  } finally {
    await app.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
