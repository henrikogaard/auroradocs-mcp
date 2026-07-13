import assert from 'node:assert/strict'
import test from 'node:test'

import { validatePackageManifest } from './packageContentsCore.mjs'

const validManifest = {
  name: 'auroradocs-mcp',
  version: '0.1.0',
  bin: { 'aurora-mcp': 'dist/index.js' },
  paths: [
    'package.json',
    'README.md',
    'LICENSE',
    'NOTICE',
    'dist/index.js',
    'dist/version.js',
  ],
}

test('package manifest accepts the required standalone runtime surface', () => {
  assert.doesNotThrow(() => validatePackageManifest(validManifest))
})

for (const [label, mutate] of [
  ['wrong name', (manifest) => { manifest.name = '@private/mcp' }],
  ['wrong version', (manifest) => { manifest.version = '0.1.1' }],
  ['wrong executable', (manifest) => { manifest.bin = { 'aurora-mcp': './src/index.ts' } }],
  ['missing required runtime path', (manifest) => { manifest.paths = manifest.paths.filter((path) => path !== 'dist/version.js') }],
  ['forbidden source path', (manifest) => { manifest.paths.push('src/index.ts') }],
]) {
  test(`package manifest rejects ${label}`, () => {
    const malformed = structuredClone(validManifest)
    mutate(malformed)
    assert.throws(() => validatePackageManifest(malformed))
  })
}
