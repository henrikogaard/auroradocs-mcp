import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const requiredReadmeText = [
  'Settings → Workspace → MCP Access',
  'read:objects',
  'read:content',
  'search',
  'tasks',
  'write:objects',
  'write:content',
  '90 days',
  'shown only once',
  'aur_mcp_',
  'https://api.auroradocs.eu',
  'AURORA_WORKSPACE_ID',
  'Claude Desktop',
  'Claude Code',
  'Codex',
  'Revoke all active tokens',
  'E2EE',
  'stdio',
]

test('README documents complete public MCP onboarding', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')

  for (const text of requiredReadmeText) {
    assert.ok(readme.includes(text), `README is missing required text: ${text}`)
  }
})

test('public docs distinguish search scopes and role-specific emergency revocation', async () => {
  const [readme, tools, security, troubleshooting] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/tools.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/security.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/troubleshooting.md', import.meta.url), 'utf8'),
  ])
  const docs = [readme, tools, security, troubleshooting].join('\n')

  for (const text of [
    '`search_objects` and its `search` alias search object titles with `read:objects` only.',
    '`wiki_search` searches workspace knowledge and requires `read:objects` plus `search`.',
    'Only workspace owners can use **Revoke all active tokens** in the UI.',
    'Admins should revoke each affected token individually and contact a workspace owner for emergency bulk revocation.',
  ]) {
    assert.ok(docs.includes(text), `Public docs are missing required security guidance: ${text}`)
  }

  const wikiSearchRow = tools
    .split('\n')
    .find((line) => /^\|\s*`wiki_search`\s*\|/.test(line))
  assert.ok(wikiSearchRow, 'docs/tools.md is missing the wiki_search table row')
  assert.match(
    wikiSearchRow,
    /^\|\s*`wiki_search`\s*\|[^|]+\|\s*`read:objects`\s*,\s*`search`\s*\|\s*$/,
    'wiki_search must require exactly read:objects and search',
  )
  assert.doesNotMatch(wikiSearchRow, /`read:content`/)

  for (const [name, document] of [
    ['README.md', readme],
    ['docs/security.md', security],
    ['docs/troubleshooting.md', troubleshooting],
  ]) {
    const normalized = document.replace(/\s+/g, ' ')
    assert.ok(
      normalized.includes('Only workspace owners can use **Revoke all active tokens** in the UI.'),
      `${name} must identify owner-only UI bulk revocation`,
    )
    assert.ok(
      normalized.includes('Admins should revoke each affected token individually and contact a workspace owner for emergency bulk revocation.'),
      `${name} must document the admin individual-revoke and owner-escalation path`,
    )
  }
})
