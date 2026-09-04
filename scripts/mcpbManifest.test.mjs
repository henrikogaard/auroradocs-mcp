import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Claude Desktop extension manifest is a local stdio bundle with a keychain token', async () => {
  const manifest = JSON.parse(await readFile(new URL('../mcpb/manifest.json', import.meta.url), 'utf8'))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

  assert.equal(manifest.manifest_version, '0.3')
  assert.equal(manifest.name, 'auroradocs')
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.server.type, 'node')
  assert.equal(manifest.server.entry_point, 'dist/index.js')
  assert.deepEqual(manifest.server.mcp_config.command, 'node')
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/dist/index.js'])
  assert.equal(manifest.server.mcp_config.env.AURORA_API_TOKEN, '${user_config.api_token}')
  assert.equal(manifest.user_config.api_token.sensitive, true)
  assert.equal(manifest.user_config.api_token.required, true)
  assert.equal(manifest.user_config.api_url.default, 'https://api.auroradocs.eu')
  assert.equal(manifest.tools_generated, true)
  assert.match(manifest.compatibility.runtimes.node, />=20/)
  assert.doesNotMatch(JSON.stringify(manifest), /createMcpHandler|Streamable HTTP/)
})
