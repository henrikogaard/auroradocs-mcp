import assert from 'node:assert/strict'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
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

async function connectModernClient(client: Client) {
  const handler = createMcpHandler(() => createAuroraMcpServer(context), { legacy: 'reject' })
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  })
  await client.connect(transport)
  return { handler, transport }
}

test('2026-07-28 clients discover the server and receive private list cache hints', async () => {
  const client = new Client(
    { name: 'modern-cache-test', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  try {
    await connectModernClient(client)
    const discover = await client.request({ method: 'server/discover' })
    assert.ok((discover.supportedVersions as string[]).includes('2026-07-28'))
    assert.equal((discover as { cacheScope?: string }).cacheScope, 'private')

    const listed = await client.listTools()
    assert(listed.tools.some((tool) => tool.name === 'import_obsidian_vault'))
    assert.equal((listed as { cacheScope?: string }).cacheScope, 'private')
    assert.equal((listed as { ttlMs?: number }).ttlMs, 300_000)
  } finally {
    await client.close().catch(() => undefined)
  }
})

test('2026-07-28 form elicitation declines import without writes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aurora-modern-consent-'))
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

  const client = new Client(
    { name: 'modern-consent-test', version: '1.0.0' },
    {
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    },
  )
  let elicitationCount = 0
  client.setRequestHandler('elicitation/create', async (request) => {
    elicitationCount += 1
    assert.equal(request.params.mode, 'form')
    assert.match(request.params.message, new RegExp(plan.planId))
    return { action: 'decline' }
  })
  try {
    await connectModernClient(client)
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
  }
})
