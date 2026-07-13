import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

test('live smoke only invokes the approved read-only tool calls', async () => {
  const source = await readFile(new URL('./auroracloudLiveSmoke.ts', import.meta.url), 'utf8')
  const invokedTools = [...source.matchAll(/executeToolCall\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])

  assert.deepEqual(invokedTools, [
    'list_workspace_members',
    'list_task_lists',
    'wiki_recent',
  ])

  assert.match(source, /getToolDefinitions\(\)/)
})

test('live smoke rejects non-MCP tokens before connecting', async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ['--import', 'tsx', 'scripts/auroracloudLiveSmoke.ts'],
      {
        cwd: new URL('..', import.meta.url),
        env: {
          PATH: process.env.PATH,
          AURORA_API_URL: 'http://127.0.0.1:9',
          AURORA_WORKSPACE_ID: 'contract-test-workspace',
          AURORA_API_TOKEN: 'not-an-mcp-token',
        },
      },
    ),
    (error) => {
      assert.match(error.stderr, /AURORA_API_TOKEN must start with aur_mcp_/)
      assert.doesNotMatch(error.stderr, /ECONNREFUSED|fetch failed/)
      return true
    },
  )
})
