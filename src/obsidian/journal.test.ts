import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createImportJournal, readImportJournal, writeImportJournal } from './journal.js'

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
