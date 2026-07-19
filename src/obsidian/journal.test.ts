import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createImportJournal, readImportJournal, summarizeImportJournal, writeImportJournal } from './journal.js'

test('journal is atomic, private, resumable, and excludes content, values, tokens, and absolute paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aurora-journal-test-'))
  const stateDir = path.join(root, 'state')
  const journal = createImportJournal({
    planId: 'plan-fixed-1', planHash: 'plan-hash', workspaceId: 'workspace-1',
    rootIdentityHash: 'root-hash', inventoryHash: 'inventory-hash',
  }, new Date('2026-07-19T10:00:00Z'))
  journal.entries['entry-1'] = { sourceHash: 'source-hash', objectId: 'object-1', phase: 'content', status: 'complete', warningCodes: [] }
  const file = await writeImportJournal(stateDir, journal)
  const loaded = await readImportJournal(stateDir, 'plan-fixed-1')
  assert.deepEqual(loaded, journal)
  assert.equal((await stat(stateDir)).mode & 0o777, 0o700)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  const serialized = JSON.stringify(loaded)
  for (const forbidden of ['note body', 'ada@example.test', 'frontmatter', 'aur_mcp_', '/Users/', 'AURORA_API_TOKEN']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  }
})

test('status summary reports bounded content-free progress and next action', () => {
  const plan = { planId: 'plan-1', planHash: 'hash-1', entries: [{}, {}, {}] }
  const pending = summarizeImportJournal(plan, null)
  assert.deepEqual(pending, {
    status: 'pending', planId: 'plan-1', planHash: 'hash-1', completed: 0, failed: 0,
    remaining: 3, nextCursor: 0, warningCodes: [], updatedAt: null,
    nextAction: 'Confirm the exact plan ID and hash to import the first bounded batch.',
  })

  const journal = createImportJournal({
    planId: 'plan-1', planHash: 'hash-1', workspaceId: 'workspace-1',
    rootIdentityHash: 'root-hash', inventoryHash: 'inventory-hash',
  }, new Date('2026-07-19T10:00:00Z'))
  journal.status = 'partial'
  journal.cursor = 2
  journal.entries['entry-1'] = { sourceHash: 'a', objectId: 'object-1', phase: 'content', status: 'complete', warningCodes: ['fidelity'] }
  journal.entries['entry-2'] = { sourceHash: 'b', objectId: 'object-2', phase: 'object', status: 'failed', warningCodes: [], errorCode: 'rate_limited' }
  const partial = summarizeImportJournal(plan, journal)
  assert.equal(partial.status, 'partial')
  assert.equal(partial.completed, 1)
  assert.equal(partial.failed, 1)
  assert.equal(partial.remaining, 2)
  assert.deepEqual(partial.warningCodes, ['fidelity', 'rate_limited'])
  assert.match(partial.nextAction, /same plan ID and hash/)
})
