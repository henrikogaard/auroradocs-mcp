import assert from 'node:assert/strict'

const REQUIRED_PATHS = [
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  'docs/setup.md',
  'docs/agent-profiles.md',
  'docs/agent-guide.md',
  'dist/index.js',
  'dist/version.js',
]

export function validatePackageManifest({ name, version, bin, paths }) {
  assert.equal(name, '@henrikogard/auroradocs-mcp', 'npm package name must be @henrikogard/auroradocs-mcp')
  assert.equal(version, '0.2.1', 'npm package version must be 0.2.1')
  assert.deepEqual(bin, { 'aurora-mcp': 'dist/index.js' }, 'npm executable mapping is incorrect')

  for (const requiredPath of REQUIRED_PATHS) {
    assert.ok(paths.includes(requiredPath), `npm package is missing required path: ${requiredPath}`)
  }

  const forbidden = paths.filter((path) =>
    /(^|\/)(?:\.turbo|src|test)(?:\/|$)|\.test\.(?:js|d\.ts)$|(^|\/)tsconfig|auroracloudSmoke\.ts$/.test(path),
  )
  assert.deepEqual(
    forbidden,
    [],
    `npm package contains forbidden files:\n${forbidden.join('\n')}`,
  )
}
