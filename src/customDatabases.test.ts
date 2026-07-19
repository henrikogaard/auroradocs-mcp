import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUSTOM_DATABASE_CONTRACT_VERSION,
  CUSTOM_DATABASE_RECIPES,
  assertApplicableCustomDatabasePlan,
  buildCustomDatabasePlan,
  normalizeSchemaKey,
  validateAdditiveObjectTypePatch,
  validateCustomDatabaseSchema,
  type ObjectTypeDef,
} from './customDatabases.js'

const workspaceId = 'workspace-1'

function existingType(overrides: Partial<ObjectTypeDef> = {}): ObjectTypeDef {
  return {
    id: 'type-existing-1',
    workspace_id: workspaceId,
    name: 'Equipment',
    icon: '🧰',
    color: '#64748b',
    schema: [{ key: 'brand', label: 'Brand', value_type: 'text', required: false }],
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-19T10:00:00.000Z',
    ...overrides,
  }
}

test('custom database recipes cover the five approved special-use cases', () => {
  assert.equal(CUSTOM_DATABASE_CONTRACT_VERSION, 1)
  assert.deepEqual(CUSTOM_DATABASE_RECIPES.map((recipe) => recipe.id), [
    'contacts', 'interests', 'equipment', 'subscriptions', 'expenses',
  ])
  assert.ok(CUSTOM_DATABASE_RECIPES.every((recipe) => recipe.schema.length > 0))
})

test('schema validation normalizes keys and rejects unsafe or destructive shapes', () => {
  assert.equal(normalizeSchemaKey(' Warranty Expiry '), 'warranty_expiry')
  assert.throws(() => validateCustomDatabaseSchema([
    { key: 'Status', label: 'Status', value_type: 'select', required: false, options: ['Active'] },
    { key: 'status', label: 'Other', value_type: 'text', required: false },
  ]), /duplicate/i)
  assert.throws(() => validateCustomDatabaseSchema([
    { key: 'owner', label: 'Owner', value_type: 'relation', required: false, targetType: 'custom:missing' },
  ], { existingTypes: [] }), /relation target/i)
})

test('additive updates preserve value types, requiredness, storage, relations, and options', () => {
  const current = [{
    key: 'status', label: 'Status', value_type: 'select' as const, required: false, options: ['Active'], sensitive: true,
  }]
  const accepted = validateAdditiveObjectTypePatch(current, [
    { key: 'status', label: 'State', value_type: 'select', required: false, options: ['Active', 'Archived'], sensitive: true },
    { key: 'renewal', label: 'Renewal', value_type: 'date', required: false },
  ])
  assert.deepEqual(accepted.map((field) => field.key), ['status', 'renewal'])
  assert.throws(() => validateAdditiveObjectTypePatch(current, []), /remove/i)
  assert.throws(() => validateAdditiveObjectTypePatch(current, [
    { key: 'status', label: 'Status', value_type: 'select', required: true, options: ['Active'], sensitive: true },
  ]), /required/i)
  assert.throws(() => validateAdditiveObjectTypePatch([
    { key: 'serial', label: 'Serial', value_type: 'text', required: true },
  ], [
    { key: 'serial', label: 'Serial', value_type: 'text', required: false },
  ]), /required/i)
  assert.throws(() => validateAdditiveObjectTypePatch(current, [
    { key: 'status', label: 'Status', value_type: 'select', required: false, options: ['Archived'], sensitive: true },
  ]), /remove select option/i)
})

test('plans are stable, workspace-bound, expiring, and select create, reuse, or update', () => {
  const base = {
    workspaceId,
    name: 'Equipment',
    source: { kind: 'recipe' as const, value: 'equipment' },
    schema: [
      { key: 'brand', label: 'Brand', value_type: 'text' as const, required: false },
      { key: 'model', label: 'Model', value_type: 'text' as const, required: false },
    ],
    ids: { planId: 'plan-fixed', objectTypeId: 'type-planned', templateObjectId: 'template-fixed' },
    now: '2026-07-19T10:00:00.000Z',
    expiresAt: '2026-07-19T10:30:00.000Z',
  }
  const created = buildCustomDatabasePlan({ ...base, existingTypes: [] })
  assert.equal(created.operation.kind, 'create')
  assert.equal(buildCustomDatabasePlan({ ...base, existingTypes: [] }).planHash, created.planHash)
  const reused = buildCustomDatabasePlan({ ...base, schema: base.schema.slice(0, 1), existingTypes: [existingType()] })
  assert.equal(reused.operation.kind, 'reuse')
  const updated = buildCustomDatabasePlan({ ...base, existingTypes: [existingType()] })
  assert.equal(updated.operation.kind, 'update')
})

test('approved plans reject a foreign workspace, expiry, tampering, and stale targets before writes', () => {
  const plan = buildCustomDatabasePlan({
    workspaceId,
    name: 'Equipment',
    source: { kind: 'free_form', value: 'gear tracker' },
    schema: existingType().schema,
    existingTypes: [],
    ids: { planId: 'plan-fixed', objectTypeId: 'type-planned' },
    now: '2026-07-19T10:00:00.000Z',
    expiresAt: '2026-07-19T10:30:00.000Z',
  })
  assert.throws(() => assertApplicableCustomDatabasePlan(plan, 'other', [], new Date('2026-07-19T10:10:00Z')), /workspace/i)
  assert.throws(() => assertApplicableCustomDatabasePlan(plan, workspaceId, [], new Date('2026-07-19T10:31:00Z')), /expired/i)
  assert.throws(() => assertApplicableCustomDatabasePlan({ ...plan, name: 'Changed' }, workspaceId, [], new Date('2026-07-19T10:10:00Z')), /hash/i)
  assert.throws(() => assertApplicableCustomDatabasePlan({ ...plan, planId: 'changed' }, workspaceId, [], new Date('2026-07-19T10:10:00Z')), /hash/i)
})
