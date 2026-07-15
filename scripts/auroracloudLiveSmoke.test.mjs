import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LIVE_SMOKE_TOOL_NAMES,
  executeReadOnlyTool,
  runLiveSmoke,
} from './auroracloudLiveSmokeCore.js'

const clientEnv = {
  AURORA_API_URL: 'https://api.example.test',
  AURORA_API_TOKEN: 'aur_mcp_client_contract_test',
}

const clientContext = {
  kind: 'client',
  workspaces: [{
    workspaceId: 'workspace-1', alias: 'primary', name: 'Primary', role: 'owner',
    scopes: ['read:objects'], grantId: 'grant-1', expiresAt: '2026-08-01T00:00:00.000Z',
  }],
}

const legacyContext = {
  kind: 'legacy_workspace',
  defaultWorkspaceId: 'workspace-legacy',
  workspaces: [],
}

function successfulDependencies(overrides = {}) {
  const calls = []
  const dependencies = {
    resetAuroraClientForTests() {},
    async authenticate() { return clientContext },
    getToolDefinitions: () => [
      { name: 'list_workspaces' },
      { name: 'get_project_context' },
    ],
    getToolEffect: () => 'read',
    async executeToolCall(name, input, context) {
      calls.push({ name, input, context })
      if (name === 'list_workspaces') {
        return { type: 'workspaces', workspaces: context.workspaces }
      }
      if (name === 'get_project_context') {
        return { type: 'project_context', status: 'ok', cursor: null }
      }
      throw new Error(`Unexpected tool: ${name}`)
    },
    ...overrides,
  }
  return { calls, dependencies }
}

test('live smoke invokes the exact bounded read-only runtime call set', async () => {
  const { calls, dependencies } = successfulDependencies()
  let output = ''

  await runLiveSmoke({
    env: { ...clientEnv, AURORA_SMOKE_PROJECT_ID: 'project-1' },
    loadDependencies: async () => dependencies,
    writeOutput: (value) => { output += value },
  })

  assert.deepEqual(calls, [
    { name: 'list_workspaces', input: {}, context: clientContext },
    {
      name: 'get_project_context',
      input: {
        workspace_id: 'workspace-1',
        project_id: 'project-1',
        activity_days: 14,
        task_limit: 20,
        source_limit: 10,
      },
      context: clientContext,
    },
  ])
  assert.equal(output, 'AuroraCloud MCP live smoke passed.\n')
})

test('live smoke tool selection is statically limited to the read-only discovery and project-context tools', () => {
  assert.deepEqual(LIVE_SMOKE_TOOL_NAMES, ['list_workspaces', 'get_project_context'])
  assert.equal(LIVE_SMOKE_TOOL_NAMES.includes('create_object'), false)
  assert.equal(LIVE_SMOKE_TOOL_NAMES.includes('update_task'), false)
})

test('client smoke proves discovery and exits without guessing a project', async () => {
  const { calls, dependencies } = successfulDependencies()

  await runLiveSmoke({ env: clientEnv, loadDependencies: async () => dependencies, writeOutput() {} })

  assert.deepEqual(calls, [{ name: 'list_workspaces', input: {}, context: clientContext }])
})

test('legacy smoke uses its configured workspace and supports one explicit project check', async () => {
  const base = successfulDependencies({ async authenticate() { return legacyContext } })
  const env = {
    AURORA_API_URL: 'https://api.example.test',
    AURORA_WORKSPACE_ID: 'workspace-legacy',
    AURORA_API_TOKEN: 'aur_mcp_legacy_contract_test',
    AURORA_SMOKE_PROJECT_ID: 'project-legacy',
  }

  await runLiveSmoke({ env, loadDependencies: async () => base.dependencies, writeOutput() {} })

  assert.deepEqual(base.calls, [
    { name: 'list_workspaces', input: {}, context: legacyContext },
    {
      name: 'get_project_context',
      input: {
        workspace_id: 'workspace-legacy',
        project_id: 'project-legacy',
        activity_days: 14,
        task_limit: 20,
        source_limit: 10,
      },
      context: legacyContext,
    },
  ])
})

for (const effect of ['write', undefined]) {
  test(`read-only dispatcher rejects ${effect ?? 'unknown'} dynamically selected tools before dispatch`, async () => {
    let dispatches = 0
    const name = effect === 'write' ? 'create_object' : 'unclassified_tool'

    await assert.rejects(
      executeReadOnlyTool(
        {
          getToolEffect: () => effect,
          executeToolCall: async () => {
            dispatches += 1
            return { type: 'created', id: 'should-not-exist' }
          },
        },
        name,
        {},
        clientContext,
      ),
      new RegExp(`not authoritatively classified as read-only: ${name}`),
    )
    assert.equal(dispatches, 0)
  })
}

for (const failingTool of ['list_workspaces', 'get_project_context']) {
  test(`live smoke propagates ${failingTool} failures`, async () => {
    const base = successfulDependencies()
    const originalExecute = base.dependencies.executeToolCall
    base.dependencies.executeToolCall = async (name, input, workspaceId) => {
      if (name === failingTool) return { type: 'error', message: `${failingTool} backend failure` }
      return originalExecute(name, input, workspaceId)
    }

    await assert.rejects(
      runLiveSmoke({
        env: { ...clientEnv, AURORA_SMOKE_PROJECT_ID: 'project-1' },
        loadDependencies: async () => base.dependencies,
        writeOutput() {},
      }),
      new RegExp(`${failingTool} backend failure`),
    )
  })
}

test('live smoke failure output does not serialize workspace records', async () => {
  const base = successfulDependencies()
  const originalExecute = base.dependencies.executeToolCall
  base.dependencies.executeToolCall = async (name, input, workspaceId) => {
    if (name === 'list_workspaces') {
      return { type: 'unexpected', workspaces: [{ name: 'Private workspace title' }] }
    }
    return originalExecute(name, input, workspaceId)
  }

  await assert.rejects(
    runLiveSmoke({ env: clientEnv, loadDependencies: async () => base.dependencies, writeOutput() {} }),
    (error) => {
      assert.match(error.message, /unexpected result type: unexpected/)
      assert.doesNotMatch(error.message, /Private workspace title/)
      return true
    },
  )
})

const invalidEnvironmentCases = [
  ['missing AURORA_API_URL', 'AURORA_API_URL', undefined, /AURORA_API_URL is required/],
  ['blank AURORA_API_URL', 'AURORA_API_URL', '   ', /AURORA_API_URL is required/],
  ['missing AURORA_API_TOKEN', 'AURORA_API_TOKEN', undefined, /AURORA_API_TOKEN is required/],
  ['blank AURORA_API_TOKEN', 'AURORA_API_TOKEN', ' ', /AURORA_API_TOKEN is required/],
  ['malformed token prefix', 'AURORA_API_TOKEN', 'not-an-mcp-token', /must start with aur_mcp_ or aur_mcp_client_/],
]

for (const [label, key, value, expectedError] of invalidEnvironmentCases) {
  test(`${label} fails before imports, network, or dispatcher activity`, async () => {
    const env = { ...clientEnv }
    if (value === undefined) delete env[key]
    else env[key] = value
    let dependencyLoads = 0

    await assert.rejects(
      runLiveSmoke({
        env,
        loadDependencies: async () => {
          dependencyLoads += 1
          throw new Error('imports or network should not start')
        },
        writeOutput() {},
      }),
      expectedError,
    )
    assert.equal(dependencyLoads, 0)
  })
}

test('legacy credentials require AURORA_WORKSPACE_ID before imports or network', async () => {
  let dependencyLoads = 0
  await assert.rejects(
    runLiveSmoke({
      env: { AURORA_API_URL: 'https://api.example.test', AURORA_API_TOKEN: 'aur_mcp_legacy_test' },
      loadDependencies: async () => {
        dependencyLoads += 1
        throw new Error('imports or network should not start')
      },
      writeOutput() {},
    }),
    /AURORA_WORKSPACE_ID is required for legacy credentials/,
  )
  assert.equal(dependencyLoads, 0)
})
