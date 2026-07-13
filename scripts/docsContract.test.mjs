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
