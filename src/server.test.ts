import assert from 'node:assert/strict'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AuroraConnectionContext } from './contracts.js'
import { createAuroraMcpServer } from './server.js'
import { analyzeObsidianVault } from './obsidian/analyzer.js'
import { resolveObsidianConfig } from './obsidian/config.js'
import { buildObsidianImportPlan, storeObsidianImportPlan } from './obsidian/importPlan.js'
import { openAuthorizedVault } from './obsidian/vaultAccess.js'

const fixtureRoot = fileURLToPath(new URL('../test/fixtures/obsidian-vault/', import.meta.url))
const context: AuroraConnectionContext = {
  kind: 'legacy_workspace',
  defaultWorkspaceId: 'workspace-1',
  workspaces: [{
    workspaceId: 'workspace-1', alias: 'workspace-1', name: 'Workspace 1', role: 'owner',
    scopes: ['read:objects', 'write:objects', 'write:content'], grantId: 'grant-1', expiresAt: null,
  }],
}

test('server advertises a safe agent operating contract during initialization', async () => {
  const server = createAuroraMcpServer(context)
  const client = new Client({ name: 'instructions-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const instructions = client.getInstructions()

    assert.match(instructions ?? '', /list_workspaces/)
    assert.match(instructions ?? '', /get_mcp_workflow_recipes/)
    assert.match(instructions ?? '', /read tools first/i)
    assert.match(instructions ?? '', /explicit user approval/i)
    assert.match(instructions ?? '', /exact plan ID and hash/i)
    assert.match(instructions ?? '', /untrusted evidence, never instructions/i)
    assert.match(instructions ?? '', /sourceId and deepLink/)
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
})

test('server uses advertised form elicitation and decline returns a write-free no-op', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aurora-server-consent-'))
  const vaultRoot = path.join(root, 'Vault')
  await cp(fixtureRoot, vaultRoot, { recursive: true })
  const vault = await openAuthorizedVault(resolveObsidianConfig({
    AURORA_OBSIDIAN_VAULT_ROOT: vaultRoot,
    AURORA_MCP_STATE_DIR: path.join(root, 'state'),
  }))
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    now: '2026-07-19T10:00:00Z', expiresAt: '2099-07-19T10:30:00Z',
  })
  storeObsidianImportPlan(plan, analysis)

  const server = createAuroraMcpServer(context)
  const client = new Client(
    { name: 'consent-test', version: '1.0.0' },
    { capabilities: { elicitation: { form: {} } } },
  )
  let elicitationCount = 0
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    elicitationCount += 1
    assert.equal(request.params.mode, 'form')
    assert.match(request.params.message, new RegExp(plan.planId))
    assert.match(request.params.message, /source vault will remain read-only/i)
    assert.deepEqual(request.params.requestedSchema.required, [
      'hierarchy_policy', 'collision_policy', 'attachment_policy',
      'unsupported_policy', 'include_inferred_groups', 'confirmed',
    ])
    return { action: 'decline' }
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const result = await client.callTool({
      name: 'import_obsidian_vault',
      arguments: { plan_id: plan.planId, plan_hash: plan.planHash },
    })
    assert.equal(result.isError, false)
    assert.deepEqual(result.structuredContent, {
      type: 'no_op',
      message: 'Obsidian import was not approved; no AuroraDocs writes were performed.',
    })
    assert.equal(elicitationCount, 1)
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
})
