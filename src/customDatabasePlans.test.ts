import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildCustomDatabasePlan } from './customDatabases.js'
import {
  clearCustomDatabasePlansForTests,
  getStoredCustomDatabasePlan,
  readCustomDatabasePlan,
  writeCustomDatabasePlan,
} from './customDatabasePlans.js'

function plan(workspaceId = 'workspace-1') {
  return buildCustomDatabasePlan({
    workspaceId,
    name: 'Reading list',
    schema: [{ key: 'status', label: 'Status', value_type: 'select', required: false, options: ['Unread', 'Read'] }],
    source: { kind: 'free_form', value: 'Reading list' },
    existingTypes: [],
    ids: { planId: 'plan-persist-1' },
    now: '2026-07-19T10:00:00Z',
    expiresAt: '2099-07-19T10:30:00Z',
  })
}

test('custom database plans survive an in-memory store clear when written to the MCP state directory', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'aurora-custom-db-state-'))
  const env = { AURORA_MCP_STATE_DIR: stateDir, NODE_ENV: 'test' }
  const created = plan()
  await writeCustomDatabasePlan(created, env)
  clearCustomDatabasePlansForTests()
  assert.equal(getStoredCustomDatabasePlan(created.workspaceId, created.planId), null)

  const restored = await readCustomDatabasePlan(created.workspaceId, created.planId, env)
  assert.equal(restored?.planId, created.planId)
  assert.equal(restored?.planHash, created.planHash)
  assert.equal(restored?.name, 'Reading list')
})

test('custom database plans stay workspace-bound after reload', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'aurora-custom-db-bound-'))
  const env = { AURORA_MCP_STATE_DIR: stateDir, NODE_ENV: 'test' }
  const created = plan('workspace-1')
  await writeCustomDatabasePlan(created, env)
  clearCustomDatabasePlansForTests()
  assert.equal(await readCustomDatabasePlan('workspace-other', created.planId, env), null)
})
