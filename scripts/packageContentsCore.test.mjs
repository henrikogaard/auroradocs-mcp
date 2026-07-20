import assert from 'node:assert/strict'
import test from 'node:test'

import { validatePackageManifest } from './packageContentsCore.mjs'

const validManifest = {
  name: '@henrikogard/auroradocs-mcp',
  version: '0.2.1',
  bin: { 'aurora-mcp': 'dist/index.js' },
  paths: [
    'package.json',
    'README.md',
    'LICENSE',
    'NOTICE',
    'docs/setup.md',
    'docs/agent-profiles.md',
    'docs/agent-guide.md',
    'dist/index.js',
    'dist/version.js',
  ],
}

test('package manifest accepts the required standalone runtime surface', () => {
  assert.doesNotThrow(() => validatePackageManifest(validManifest))
})

for (const [label, mutate] of [
  ['wrong name', (manifest) => { manifest.name = 'auroradocs-mcp' }],
  ['wrong version', (manifest) => { manifest.version = '0.1.0' }],
  ['wrong executable', (manifest) => { manifest.bin = { 'aurora-mcp': './src/index.ts' } }],
  ['missing setup guide', (manifest) => { manifest.paths = manifest.paths.filter((path) => path !== 'docs/setup.md') }],
  ['missing agent profiles', (manifest) => { manifest.paths = manifest.paths.filter((path) => path !== 'docs/agent-profiles.md') }],
  ['missing agent guide', (manifest) => { manifest.paths = manifest.paths.filter((path) => path !== 'docs/agent-guide.md') }],
  ['missing required runtime path', (manifest) => { manifest.paths = manifest.paths.filter((path) => path !== 'dist/version.js') }],
  ['forbidden source path', (manifest) => { manifest.paths.push('src/index.ts') }],
]) {
  test(`package manifest rejects ${label}`, () => {
    const malformed = structuredClone(validManifest)
    mutate(malformed)
    assert.throws(() => validatePackageManifest(malformed))
  })
}
