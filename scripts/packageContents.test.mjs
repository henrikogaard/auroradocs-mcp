import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { validatePackageManifest } from './packageContentsCore.mjs'

const output = execFileSync(
  'npm',
  ['pack', '--dry-run', '--ignore-scripts', '--json'],
  { encoding: 'utf8' },
)
const [pack] = JSON.parse(output)
const paths = pack.files.map(({ path }) => path)
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

assert.equal(pack.name, pkg.name)
assert.equal(pack.version, pkg.version)
validatePackageManifest({ name: pack.name, version: pack.version, bin: pkg.bin, paths })
