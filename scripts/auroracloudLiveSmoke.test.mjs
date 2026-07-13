import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeReadOnlyTool,
  runLiveSmoke,
} from './auroracloudLiveSmokeCore.js'

const validEnv = {
  AURORA_API_URL: 'https://api.example.test',
  AURORA_WORKSPACE_ID: 'workspace-1',
  AURORA_API_TOKEN: 'aur_mcp_contract_test',
}

function successfulDependencies(overrides = {}) {
  const calls = []
  const dependencies = {
    resetAuroraClientForTests() {},
    async authenticate() {},
    getToolDefinitions: () => [
      { name: 'list_workspace_members' },
      { name: 'list_objects' },
      { name: 'wiki_recent' },
    ],
    getToolEffect: () => 'read',
    async executeToolCall(name, input, workspaceId) {
      calls.push({ name, input, workspaceId })
      if (name === 'list_workspace_members') {
        return { type: 'members', members: [{ id: 'member-1' }] }
      }
      if (name === 'list_objects') return { type: 'objects', objects: [] }
      if (name === 'wiki_recent') return { type: 'knowledge_sources', sources: [] }
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
    env: validEnv,
    loadDependencies: async () => dependencies,
    writeOutput: (value) => { output += value },
  })

  assert.deepEqual(calls, [
    { name: 'list_workspace_members', input: {}, workspaceId: 'workspace-1' },
    { name: 'list_objects', input: { limit: 1 }, workspaceId: 'workspace-1' },
    { name: 'wiki_recent', input: { limit: 1 }, workspaceId: 'workspace-1' },
  ])
  assert.equal(output, 'AuroraCloud MCP live smoke passed.\n')
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
        'workspace-1',
      ),
      new RegExp(`not authoritatively classified as read-only: ${name}`),
    )
    assert.equal(dispatches, 0)
  })
}

test('live smoke accepts a valid empty object list', async () => {
  const { dependencies } = successfulDependencies()

  await runLiveSmoke({ env: validEnv, loadDependencies: async () => dependencies, writeOutput() {} })
})

for (const failingTool of ['list_objects', 'wiki_recent']) {
  test(`live smoke propagates ${failingTool} failures`, async () => {
    const base = successfulDependencies()
    const originalExecute = base.dependencies.executeToolCall
    base.dependencies.executeToolCall = async (name, input, workspaceId) => {
      if (name === failingTool) return { type: 'error', message: `${failingTool} backend failure` }
      return originalExecute(name, input, workspaceId)
    }

    await assert.rejects(
      runLiveSmoke({ env: validEnv, loadDependencies: async () => base.dependencies, writeOutput() {} }),
      new RegExp(`${failingTool} backend failure`),
    )
  })
}

test('live smoke failure output does not serialize workspace records', async () => {
  const base = successfulDependencies()
  const originalExecute = base.dependencies.executeToolCall
  base.dependencies.executeToolCall = async (name, input, workspaceId) => {
    if (name === 'list_objects') {
      return { type: 'unexpected', objects: [{ title: 'Private workspace title' }] }
    }
    return originalExecute(name, input, workspaceId)
  }

  await assert.rejects(
    runLiveSmoke({ env: validEnv, loadDependencies: async () => base.dependencies, writeOutput() {} }),
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
  ['missing AURORA_WORKSPACE_ID', 'AURORA_WORKSPACE_ID', undefined, /AURORA_WORKSPACE_ID is required/],
  ['blank AURORA_WORKSPACE_ID', 'AURORA_WORKSPACE_ID', '\t', /AURORA_WORKSPACE_ID is required/],
  ['missing AURORA_API_TOKEN', 'AURORA_API_TOKEN', undefined, /AURORA_API_TOKEN is required/],
  ['blank AURORA_API_TOKEN', 'AURORA_API_TOKEN', ' ', /AURORA_API_TOKEN is required/],
  ['malformed token prefix', 'AURORA_API_TOKEN', 'not-an-mcp-token', /must start with aur_mcp_/],
]

for (const [label, key, value, expectedError] of invalidEnvironmentCases) {
  test(`${label} fails before imports, network, or dispatcher activity`, async () => {
    const env = { ...validEnv }
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
