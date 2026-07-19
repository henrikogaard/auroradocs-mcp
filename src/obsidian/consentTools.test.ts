import assert from 'node:assert/strict'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { getToolDefinitions } from '../toolCatalog.js'
import { executeToolCall } from '../tools.js'
import { analyzeObsidianVault } from './analyzer.js'
import { resolveObsidianConfig } from './config.js'
import { buildObsidianImportPlan, storeObsidianImportPlan } from './importPlan.js'
import type { ObsidianImportBatchResult } from './importer.js'
import { openAuthorizedVault } from './vaultAccess.js'

const fixtureRoot = fileURLToPath(new URL('../../test/fixtures/obsidian-vault/', import.meta.url))

async function storedPlan(expiresAt = '2099-07-19T11:00:00Z') {
  const root = await mkdtemp(path.join(tmpdir(), 'aurora-consent-vault-'))
  const vaultRoot = path.join(root, 'Vault')
  await cp(fixtureRoot, vaultRoot, { recursive: true })
  const vault = await openAuthorizedVault(resolveObsidianConfig({
    AURORA_OBSIDIAN_VAULT_ROOT: vaultRoot,
    AURORA_MCP_STATE_DIR: path.join(root, 'state'),
  }))
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    now: '2026-07-19T10:00:00Z',
    expiresAt,
  })
  storeObsidianImportPlan(plan, analysis)
  return plan
}

function completed(planId: string, planHash: string): ObsidianImportBatchResult {
  return { status: 'complete', planId, planHash, completed: 7, failed: 0, remaining: 0, nextCursor: null, warnings: [] }
}

test('import tool never invokes the importer on unsupported, declined, cancelled, or malformed consent', async () => {
  const plan = await storedPlan()
  let runs = 0
  const run = async () => { runs += 1; return completed(plan.planId, plan.planHash) }
  const base = { plan_id: plan.planId, plan_hash: plan.planHash }

  const unsupported = await executeToolCall('import_obsidian_vault', base, 'workspace-1', { runObsidianImport: run })
  assert.equal(unsupported.type, 'obsidian_import_confirmation_required')

  for (const response of [
    { action: 'decline' as const },
    { action: 'cancel' as const },
    { action: 'accept' as const, content: { confirmed: false } },
  ]) {
    const result = await executeToolCall('import_obsidian_vault', base, 'workspace-1', {
      requestObsidianImportConsent: async () => response,
      runObsidianImport: run,
    })
    assert.equal(result.type, 'no_op')
  }
  assert.equal(runs, 0)
})

test('accepted elicitation and exact compatibility confirmation invoke one bounded batch', async () => {
  const plan = await storedPlan()
  const calls: number[] = []
  const run = async (_stored: unknown, batchSize: number) => {
    calls.push(batchSize)
    return completed(plan.planId, plan.planHash)
  }
  const base = { plan_id: plan.planId, plan_hash: plan.planHash, batch_size: 25 }
  const content = {
    confirmed: true,
    hierarchy_policy: plan.hierarchyPolicy,
    collision_policy: plan.collisionPolicy,
    attachment_policy: plan.attachmentPolicy,
    unsupported_policy: plan.unsupportedPolicy,
    include_inferred_groups: plan.groups.some((group) => group.decision === 'accept'),
  }

  const elicited = await executeToolCall('import_obsidian_vault', base, 'workspace-1', {
    requestObsidianImportConsent: async () => ({ action: 'accept', content }),
    runObsidianImport: run,
  })
  assert.equal(elicited.type, 'obsidian_import_batch')

  const compatibility = await executeToolCall('import_obsidian_vault', { ...base, confirmed: true }, 'workspace-1', {
    runObsidianImport: run,
  })
  assert.equal(compatibility.type, 'obsidian_import_batch')
  assert.deepEqual(calls, [25, 25])
})

test('expired plans, wrong hashes, and invalid batch sizes stop before consent or writes', async () => {
  const plan = await storedPlan('2026-07-19T10:05:00Z')
  let consentCalls = 0
  let runs = 0
  for (const input of [
    { plan_id: plan.planId, plan_hash: 'wrong', confirmed: true },
    { plan_id: plan.planId, plan_hash: plan.planHash, confirmed: true },
    { plan_id: plan.planId, plan_hash: plan.planHash, confirmed: true, batch_size: 101 },
  ]) {
    const result = await executeToolCall('import_obsidian_vault', input, 'workspace-1', {
      requestObsidianImportConsent: async () => { consentCalls += 1; return { action: 'accept', content: {} } },
      runObsidianImport: async () => { runs += 1; return completed(plan.planId, plan.planHash) },
      now: () => new Date('2026-07-19T10:10:00Z'),
    })
    assert.equal(result.type, 'error')
  }
  assert.equal(consentCalls, 0)
  assert.equal(runs, 0)
})

test('final Obsidian tools advertise exact closed-world additive annotations', () => {
  const byName = new Map(getToolDefinitions().map((tool) => [tool.name, tool]))
  const importer = byName.get('import_obsidian_vault')
  const status = byName.get('get_obsidian_import_status')
  assert(importer && status)
  assert.deepEqual(importer.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  })
  assert.deepEqual(status.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  })
})
