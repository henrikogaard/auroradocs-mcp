import assert from 'node:assert/strict'
import test from 'node:test'
import { decideObsidianImportConsent, type ObsidianConsentPreview } from './consent.js'

const preview: ObsidianConsentPreview = {
  planId: 'plan-1',
  planHash: 'hash-1',
  vaultDisplayName: 'Example Vault',
  workspaceId: 'workspace-1',
  counts: { notes: 4, templates: 1, canvases: 1, attachments: 2, customGroups: 1 },
  policies: { hierarchy: 'spaces', collisions: 'rename', attachments: 'referenced', unsupported: 'preserve' },
  acceptedGroupCount: 1,
}

function acceptedContent(overrides: Record<string, unknown> = {}) {
  return {
    confirmed: true,
    hierarchy_policy: 'spaces',
    collision_policy: 'rename',
    attachment_policy: 'referenced',
    unsupported_policy: 'preserve',
    include_inferred_groups: true,
    ...overrides,
  }
}

test('native exact confirmation is accepted only when elicitation is unavailable', async () => {
  const result = await decideObsidianImportConsent({ confirmed: true, preview })
  assert.deepEqual(result, { outcome: 'accepted', source: 'tool_input' })

  let calls = 0
  const supported = await decideObsidianImportConsent({
    confirmed: true, preview,
    requestConsent: async () => { calls += 1; return { action: 'cancel' } },
  })
  assert.deepEqual(supported, { outcome: 'cancelled', source: 'elicitation' })
  assert.equal(calls, 1)
})

test('unsupported clients require a later exact confirmation call', async () => {
  assert.deepEqual(await decideObsidianImportConsent({ preview }), {
    outcome: 'confirmation_required',
    source: 'compatibility_fallback',
  })
})

test('elicitation continues only on accept with true confirmation and unchanged choices', async () => {
  assert.deepEqual(await decideObsidianImportConsent({
    preview,
    requestConsent: async () => ({ action: 'accept', content: acceptedContent() }),
  }), { outcome: 'accepted', source: 'elicitation' })

  for (const response of [
    { action: 'decline' as const },
    { action: 'cancel' as const },
    { action: 'accept' as const, content: acceptedContent({ confirmed: false }) },
    { action: 'accept' as const, content: acceptedContent({ hierarchy_policy: 'flatten' }) },
    { action: 'accept' as const, content: { confirmed: true } },
  ]) {
    const result = await decideObsidianImportConsent({ preview, requestConsent: async () => response })
    assert.notEqual(result.outcome, 'accepted')
  }
})

test('explicit false and elicitation failures remain non-accept paths', async () => {
  assert.deepEqual(await decideObsidianImportConsent({ confirmed: false, preview }), {
    outcome: 'declined',
    source: 'tool_input',
  })
  assert.deepEqual(await decideObsidianImportConsent({
    preview,
    requestConsent: async () => { throw new Error('client disconnected with private detail') },
  }), { outcome: 'cancelled', source: 'elicitation' })
})
