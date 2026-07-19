import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AuroraImportCapabilities, AuroraObjectRecord } from '../auroraClient.js'
import type { ObjectTypeDef, ObjectTypeSchema, PropertyValueType } from '../customDatabases.js'
import { analyzeObsidianVault } from './analyzer.js'
import { resolveObsidianConfig } from './config.js'
import { buildObsidianImportPlan } from './importPlan.js'
import { runObsidianImportBatch, type ObsidianImportDependencies } from './importer.js'
import { openAuthorizedVault } from './vaultAccess.js'

const fixtureRoot = fileURLToPath(new URL('../../test/fixtures/obsidian-vault/', import.meta.url))

function capabilities(overrides: Partial<AuroraImportCapabilities> = {}): AuroraImportCapabilities {
  return {
    workspaceId: 'workspace-1', role: 'owner', scopes: ['read:objects', 'write:objects', 'write:content'],
    e2ee: { enabled: false, importBlocked: false, reason: null },
    upload: { maxBytes: 64 * 1024 * 1024, mimePolicy: null, limitBytes: 1024 ** 3, usedBytes: 0, remainingBytes: 1024 ** 3 },
    storage: { available: true, backend: 'test' }, ...overrides,
  }
}

function fakeDependencies(capability = capabilities()) {
  const objectTypes = new Map<string, ObjectTypeDef>()
  const objects = new Map<string, AuroraObjectRecord>()
  const content = new Map<string, Record<string, unknown>>()
  const properties: Array<{ objectId: string; key: string; valueType: PropertyValueType; value: unknown }> = []
  const attachments = new Map<string, { id: string; workspaceId: string; objectId: string; fileName: string; mimeType: string; sizeBytes: number; url: string }>()
  let writeCalls = 0
  const dependencies: ObsidianImportDependencies = {
    getCapabilities: async () => capability,
    listObjectTypes: async () => [...objectTypes.values()],
    createObjectType: async (workspaceId, input) => {
      writeCalls += 1
      const existing = objectTypes.get(input.id)
      if (existing) return existing
      const value: ObjectTypeDef = { ...input, workspace_id: workspaceId, created_at: 'now', updated_at: 'now' }
      objectTypes.set(input.id, value); return value
    },
    createObject: async (workspaceId, input) => {
      writeCalls += 1
      const existing = objects.get(input.id)
      if (existing) return existing
      const value: AuroraObjectRecord = {
        id: input.id, workspace_id: workspaceId, type: input.type, title: input.title, icon: input.icon ?? null,
        parent_id: input.parentId ?? null, is_deleted: false, is_template: input.isTemplate ?? false,
        created_at: 'now', updated_at: 'now',
      }
      objects.set(input.id, value); return value
    },
    setContent: async (_workspaceId, objectId, value) => { writeCalls += 1; content.set(objectId, value) },
    upsertProperty: async (_workspaceId, objectId, key, valueType, value) => { writeCalls += 1; properties.push({ objectId, key, valueType, value }) },
    uploadAttachment: async (input) => {
      writeCalls += 1
      const existing = attachments.get(input.idempotencyKey)
      if (existing) return existing
      const value = { id: `attachment-${attachments.size + 1}`, workspaceId: input.workspaceId, objectId: input.objectId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.bytes.length, url: `/attachments/${attachments.size + 1}` }
      attachments.set(input.idempotencyKey, value); return value
    },
    now: () => new Date('2026-07-19T10:10:00Z'),
  }
  return { dependencies, objectTypes, objects, content, properties, attachments, writes: () => writeCalls }
}

async function copiedVault() {
  const root = await mkdtemp(path.join(tmpdir(), 'aurora-import-vault-'))
  const vaultRoot = path.join(root, 'Vault')
  await cp(fixtureRoot, vaultRoot, { recursive: true })
  const stateDir = path.join(root, 'state')
  const vault = await openAuthorizedVault(resolveObsidianConfig({ AURORA_OBSIDIAN_VAULT_ROOT: vaultRoot, AURORA_MCP_STATE_DIR: stateDir }))
  return { root, vaultRoot, stateDir, vault }
}

test('bounded two-pass import resumes to completion without duplicate types, objects, content, or attachments', async () => {
  const { vault, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', { ids: { planId: 'plan-import-1' }, now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z' })
  const fake = fakeDependencies()

  let result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 2, dependencies: fake.dependencies })
  assert.equal(result.status, 'in_progress')
  for (let attempt = 0; attempt < 10 && result.status !== 'complete'; attempt += 1) {
    result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 2, dependencies: fake.dependencies })
  }
  assert.equal(result.status, 'complete')
  assert.equal(fake.objects.size, plan.entries.length + plan.containers.length)
  assert.equal(fake.content.size, plan.entries.length)
  assert.equal(fake.attachments.size, analysis.attachments.length)
  assert.match(JSON.stringify([...fake.content.values()]), /\/attachments\/1/)
  assert.ok(fake.properties.some((property) => property.key === 'tags'))

  const writesBefore = fake.writes()
  const repeated = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 50, dependencies: fake.dependencies })
  assert.equal(repeated.status, 'complete')
  assert.equal(fake.writes(), writesBefore)
})

test('preflight blocks E2EE and missing scopes before any Aurora write', async () => {
  const { vault, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', { now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z' })
  for (const capability of [
    capabilities({ e2ee: { enabled: true, importBlocked: true, reason: 'blocked' } }),
    capabilities({ scopes: ['read:objects'] }),
    capabilities({ role: 'viewer' }),
  ]) {
    const fake = fakeDependencies(capability)
    const result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { dependencies: fake.dependencies })
    assert.equal(result.status, 'blocked')
    assert.equal(fake.writes(), 0)
  }
})

test('source drift is detected by re-analysis before writes', async () => {
  const { vault, vaultRoot, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', { now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z' })
  await writeFile(path.join(vaultRoot, 'Home.md'), '# Changed after approval\n')
  const fake = fakeDependencies()
  const result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { dependencies: fake.dependencies })
  assert.equal(result.status, 'blocked')
  assert.ok(result.warnings.some((warning) => warning.code === 'stale_plan'))
  assert.equal(fake.writes(), 0)
})

test('lost object-create responses are retried with the same planned ID and do not duplicate data', async () => {
  const { vault, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', { hierarchyPolicy: 'flatten', now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z' })
  const fake = fakeDependencies()
  const originalCreate = fake.dependencies.createObject
  const firstEntryId = plan.entries[0]!.objectId
  let loseResponse = true
  fake.dependencies.createObject = async (workspaceId, input) => {
    const object = await originalCreate(workspaceId, input)
    if (input.id === firstEntryId && loseResponse) { loseResponse = false; throw new Error('simulated lost response') }
    return object
  }

  const first = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 1, dependencies: fake.dependencies })
  assert.equal(first.status, 'partial')
  for (let attempt = 0; attempt <= plan.entries.length && !fake.content.has(firstEntryId); attempt += 1) {
    await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 1, dependencies: fake.dependencies })
  }
  assert.equal(fake.content.has(firstEntryId), true)
  assert.equal([...fake.objects.values()].filter((object) => object.id === firstEntryId).length, 1)
})

test('entries stay blocked when their approved custom type prerequisite fails', async () => {
  const { vault, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    hierarchyPolicy: 'flatten', attachmentPolicy: 'skip',
    now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const customEntry = plan.entries.find((entry) => entry.mapping === 'custom')!
  const fake = fakeDependencies()
  fake.dependencies.createObjectType = async () => { throw new Error('type unavailable') }

  const result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 100, dependencies: fake.dependencies })
  assert.equal(result.status, 'partial')
  assert.equal(fake.objects.has(customEntry.objectId), false)
})

test('entries are not flattened when their planned parent container fails', async () => {
  const { vault, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    hierarchyPolicy: 'parents', attachmentPolicy: 'skip',
    now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const failedContainer = plan.containers.find((container) => container.folder === 'People')!
  const childEntry = plan.entries.find((entry) => entry.relativePath.startsWith('People/'))!
  const fake = fakeDependencies()
  const createObject = fake.dependencies.createObject
  fake.dependencies.createObject = async (workspaceId, input) => {
    if (input.id === failedContainer.objectId) throw new Error('container unavailable')
    return createObject(workspaceId, input)
  }

  const result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 100, dependencies: fake.dependencies })
  assert.equal(result.status, 'partial')
  assert.equal(fake.objects.has(childEntry.objectId), false)
})

test('batch cursor advances past an early failed entry to later vault entries', async () => {
  const { vault, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    hierarchyPolicy: 'flatten', attachmentPolicy: 'skip',
    now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const [firstEntry, secondEntry] = plan.entries
  const fake = fakeDependencies()
  const createObject = fake.dependencies.createObject
  fake.dependencies.createObject = async (workspaceId, input) => {
    if (input.id === firstEntry!.objectId) throw new Error('permanent first-entry failure')
    return createObject(workspaceId, input)
  }

  await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 1, dependencies: fake.dependencies })
  await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 1, dependencies: fake.dependencies })
  assert.equal(fake.objects.has(secondEntry!.objectId), true)
})

test('failed attachment writes keep an otherwise completed batch partial', async () => {
  const { vault, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    hierarchyPolicy: 'flatten', attachmentPolicy: 'referenced',
    now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const fake = fakeDependencies()
  fake.dependencies.uploadAttachment = async () => { throw new Error('upload unavailable') }

  const result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 100, dependencies: fake.dependencies })
  assert.equal(result.status, 'partial')
  assert.ok(result.failed >= 1)
  assert.ok(result.remaining >= 1)
})

test('Canvas content waits until every referenced attachment upload completes', async () => {
  const { vault, vaultRoot, stateDir } = await copiedVault()
  await writeFile(path.join(vaultRoot, 'Map.canvas'), JSON.stringify({
    nodes: [{
      id: 'attachment-1', type: 'file', file: 'Assets/manual.pdf',
      x: 0, y: 0, width: 300, height: 180,
    }],
    edges: [],
  }))
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    hierarchyPolicy: 'flatten', attachmentPolicy: 'referenced',
    now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const canvas = plan.entries.find((entry) => entry.relativePath === 'Map.canvas')!
  const fake = fakeDependencies()
  fake.dependencies.uploadAttachment = async () => { throw new Error('upload unavailable') }

  const result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 100, dependencies: fake.dependencies })
  assert.equal(result.status, 'partial')
  assert.equal(fake.content.has(canvas.objectId), false)
})

test('quota preflight counts only attachments that have not already uploaded', async () => {
  const { vault, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    hierarchyPolicy: 'flatten', attachmentPolicy: 'referenced',
    now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const capability = capabilities()
  const fake = fakeDependencies(capability)
  const first = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 100, dependencies: fake.dependencies })
  assert.equal(first.status, 'complete')
  capability.upload.remainingBytes = 0

  const resumed = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 100, dependencies: fake.dependencies })
  assert.equal(resumed.status, 'complete')
  assert.equal(resumed.warnings.some((warning) => warning.code === 'attachment_quota_exceeded'), false)
})

test('unsupported skip policy reaches the importer and omits dynamic plugin content', async () => {
  const { vault, vaultRoot, stateDir } = await copiedVault()
  await writeFile(path.join(vaultRoot, 'Dynamic.md'), '```dataview\nLIST FROM #travel\n```\n')
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    hierarchyPolicy: 'flatten', attachmentPolicy: 'skip', unsupportedPolicy: 'skip',
    now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const fake = fakeDependencies()
  const result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 100, dependencies: fake.dependencies })
  assert.equal(result.status, 'complete')
  const entry = plan.entries.find((candidate) => candidate.relativePath === 'Dynamic.md')!
  assert.doesNotMatch(JSON.stringify(fake.content.get(entry.objectId)), /LIST FROM|#travel/)
})

test('identical attachment bytes at different paths retain distinct journal and upload identities', async () => {
  const { vault, vaultRoot, stateDir } = await copiedVault()
  const original = await readFile(path.join(vaultRoot, 'Assets/manual.pdf'))
  await writeFile(path.join(vaultRoot, 'Assets/manual-copy.pdf'), original)
  await writeFile(path.join(vaultRoot, 'Home.md'), `${await readFile(path.join(vaultRoot, 'Home.md'), 'utf8')}\n![[Assets/manual-copy.pdf]]\n`)
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    hierarchyPolicy: 'flatten', attachmentPolicy: 'referenced',
    now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const fake = fakeDependencies()
  const result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 100, dependencies: fake.dependencies })
  assert.equal(result.status, 'complete')
  assert.equal(analysis.attachments.length, 2)
  assert.equal(fake.attachments.size, 2)
})

test('attachment bytes changed after inventory validation are never uploaded', async () => {
  const { vault, stateDir } = await copiedVault()
  const analysis = await analyzeObsidianVault(vault, new Date('2026-07-19T10:00:00Z'))
  const plan = buildObsidianImportPlan(analysis, 'workspace-1', {
    hierarchyPolicy: 'flatten', attachmentPolicy: 'referenced',
    now: '2026-07-19T10:00:00Z', expiresAt: '2026-07-19T10:30:00Z',
  })
  const originalReadAsset = vault.readAsset.bind(vault)
  let reads = 0
  vault.readAsset = async (...args) => {
    reads += 1
    const bytes = await originalReadAsset(...args)
    return reads > analysis.attachments.length ? Buffer.concat([bytes, Buffer.from('changed')]) : bytes
  }
  const fake = fakeDependencies()
  const result = await runObsidianImportBatch({ plan, analysis }, vault, stateDir, { batchSize: 100, dependencies: fake.dependencies })
  assert.equal(result.status, 'partial')
  assert.equal(fake.attachments.size, 0)
})
