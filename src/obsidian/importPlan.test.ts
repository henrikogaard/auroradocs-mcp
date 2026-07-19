import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { analyzeObsidianVault } from './analyzer.js'
import { resolveObsidianConfig } from './config.js'
import { openAuthorizedVault } from './vaultAccess.js'
import {
  assertCurrentObsidianImportPlan,
  buildObsidianImportPlan,
  getObsidianImportPlanPage,
} from './importPlan.js'
import { executeToolCall } from '../tools.js'

const fixtureRoot = fileURLToPath(new URL('../../test/fixtures/obsidian-vault/', import.meta.url))

async function fixtureAnalysis() {
  const vault = await openAuthorizedVault(resolveObsidianConfig({ AURORA_OBSIDIAN_VAULT_ROOT: fixtureRoot }))
  return analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
}

test('inference uses explicit types and recipe folders while low-confidence notes remain pages', async () => {
  const analysis = await fixtureAnalysis()
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    ids: { planId: 'obsidian-plan-1' }, now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const groups = new Map(plan.groups.map((group) => [group.name, group]))
  assert.ok(groups.has('Contacts'))
  assert.ok(groups.has('Equipment'))
  assert.ok(groups.has('Interests'))
  assert.equal(groups.get('Contacts')?.recipeId, 'contacts')
  assert.ok(groups.get('Contacts')?.evidence.some((entry) => /type|kind/i.test(entry)))
  assert.equal(plan.entries.find((entry) => entry.relativePath === 'Home.md')?.mapping, 'page')
  assert.equal(plan.entries.find((entry) => entry.relativePath === 'People/Ada.md')?.mapping, 'custom')
  assert.equal(groups.get('Equipment')?.schema.find((field) => field.key === 'price')?.value_type, 'number')
  assert.equal(groups.get('Equipment')?.schema.find((field) => field.key === 'purchase_date')?.value_type, 'date')
  assert.equal(plan.requiresConfirmation, true)
})

test('plans expose conservative bounded metadata without raw bodies or frontmatter values', async () => {
  const plan = buildObsidianImportPlan(await fixtureAnalysis(), 'workspace-1', {
    ids: { planId: 'obsidian-plan-1' }, now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const page = getObsidianImportPlanPage(plan, 'groups', 1, 2)
  assert.equal(page.items.length, 2)
  assert.equal(page.hasMore, true)
  assert.doesNotMatch(JSON.stringify(page), /ada@example\.test|Template body|Analytical Engines/)
  assert.ok(plan.counts.notes >= 6)
  assert.equal(plan.counts.attachments, 1)
})

test('group adjustments are enum-bound and rename, merge, split, or reject deterministically', async () => {
  const analysis = await fixtureAnalysis()
  const baseline = buildObsidianImportPlan(analysis, 'workspace-1', {
    ids: { planId: 'obsidian-plan-1' }, now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const contacts = baseline.groups.find((group) => group.name === 'Contacts')!
  const equipment = baseline.groups.find((group) => group.name === 'Equipment')!
  const interests = baseline.groups.find((group) => group.name === 'Interests')!
  const adjusted = buildObsidianImportPlan(analysis, 'workspace-1', {
    ids: { planId: 'obsidian-plan-2' }, now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
    adjustments: [
      { groupId: contacts.id, action: 'rename', name: 'People' },
      { groupId: equipment.id, action: 'reject' },
      { groupId: interests.id, action: 'split', splitBy: 'folder' },
    ],
  })
  assert.ok(adjusted.groups.some((group) => group.name === 'People'))
  assert.equal(adjusted.entries.find((entry) => entry.relativePath === 'Gear/Camera.md')?.mapping, 'page')
  assert.notEqual(adjusted.planHash, baseline.planHash)
  assert.throws(() => buildObsidianImportPlan(analysis, 'workspace-1', {
    adjustments: [{ groupId: 'unknown', action: 'reject' }],
  }), /unknown group/i)
})

test('plan validation rejects foreign, expired, tampered, root-changed, and inventory-changed plans', async () => {
  const analysis = await fixtureAnalysis()
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    ids: { planId: 'obsidian-plan-1' }, now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  assert.throws(() => assertCurrentObsidianImportPlan(plan, analysis, 'workspace-2', new Date('2026-07-19T10:10:00Z')), /workspace/i)
  assert.throws(() => assertCurrentObsidianImportPlan(plan, analysis, 'workspace-1', new Date('2026-07-19T10:31:00Z')), /expired/i)
  assert.throws(() => assertCurrentObsidianImportPlan({ ...plan, hierarchyPolicy: 'flatten' }, analysis, 'workspace-1', new Date('2026-07-19T10:10:00Z')), /hash/i)
  assert.throws(() => assertCurrentObsidianImportPlan(plan, { ...analysis, rootIdentityHash: 'changed' }, 'workspace-1', new Date('2026-07-19T10:10:00Z')), /root/i)
  assert.throws(() => assertCurrentObsidianImportPlan(plan, { ...analysis, inventoryHash: 'changed' }, 'workspace-1', new Date('2026-07-19T10:10:00Z')), /inventory|stale/i)
})

test('analysis and plan paging tools remain local, bounded, and content-free', async () => {
  const previousRoot = process.env['AURORA_OBSIDIAN_VAULT_ROOT']
  const previousFetch = globalThis.fetch
  let networkCalls = 0
  process.env['AURORA_OBSIDIAN_VAULT_ROOT'] = fixtureRoot
  globalThis.fetch = (() => { networkCalls += 1; throw new Error('unexpected network') }) as typeof fetch
  try {
    const result = await executeToolCall('analyze_obsidian_vault', {}, 'workspace-1')
    assert.equal(result.type, 'obsidian_import_plan')
    if (result.type !== 'obsidian_import_plan') return
    const page = await executeToolCall('get_obsidian_import_plan', {
      plan_id: result.plan.planId, section: 'entries', per_page: 2,
    }, 'workspace-1')
    assert.equal(page.type, 'obsidian_import_plan_page')
    assert.doesNotMatch(JSON.stringify(page), /ada@example\.test|Template body/)
    assert.equal(networkCalls, 0)
  } finally {
    if (previousRoot === undefined) delete process.env['AURORA_OBSIDIAN_VAULT_ROOT']; else process.env['AURORA_OBSIDIAN_VAULT_ROOT'] = previousRoot
    globalThis.fetch = previousFetch
  }
})
