import test from 'node:test'
import assert from 'node:assert/strict'
import { readBoundedInteger, readWorkspaceSelector } from './input.js'

test('bounded integer rejects negative, fractional, NaN, infinite, and oversized values', () => {
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 51]) {
    assert.deepEqual(
      readBoundedInteger({ limit: value }, 'limit', { defaultValue: 20, min: 1, max: 50 }),
      { ok: false, message: 'limit must be an integer between 1 and 50' },
    )
  }
})

test('bounded integer returns its default or an in-range integer', () => {
  assert.deepEqual(
    readBoundedInteger({}, 'limit', { defaultValue: 20, min: 1, max: 50 }),
    { ok: true, value: 20 },
  )
  assert.deepEqual(
    readBoundedInteger({ limit: 50 }, 'limit', { defaultValue: 20, min: 1, max: 50 }),
    { ok: true, value: 50 },
  )
})

test('workspace selector accepts one non-empty id or alias and rejects ambiguous selectors', () => {
  assert.deepEqual(readWorkspaceSelector({ workspace_id: ' workspace-1 ' }), {
    ok: true,
    value: { workspaceId: 'workspace-1' },
  })
  assert.deepEqual(readWorkspaceSelector({ workspace_alias: ' personal ' }), {
    ok: true,
    value: { workspaceAlias: 'personal' },
  })
  assert.deepEqual(readWorkspaceSelector({ workspace_id: 'workspace-1', workspace_alias: 'personal' }), {
    ok: false,
    message: 'workspace_id and workspace_alias cannot be used together',
  })
  assert.deepEqual(readWorkspaceSelector({ workspace_id: '  ' }), {
    ok: false,
    message: 'workspace_id must be a non-empty string',
  })
  assert.deepEqual(readWorkspaceSelector({ workspace_id: undefined }), {
    ok: false,
    message: 'workspace_id must be a non-empty string',
  })
})
