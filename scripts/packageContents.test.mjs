import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const output = execFileSync(
  'npm',
  ['pack', '--dry-run', '--ignore-scripts', '--json'],
  { encoding: 'utf8' },
)
const [pack] = JSON.parse(output)
const paths = pack.files.map(({ path }) => path)
const forbidden = paths.filter((path) =>
  /(^|\/)(?:\.turbo|src|test)(?:\/|$)|\.test\.(?:js|d\.ts)$|(^|\/)tsconfig|auroracloudSmoke\.ts$/.test(path),
)

assert.deepEqual(
  forbidden,
  [],
  `npm package contains forbidden files:\n${forbidden.join('\n')}`,
)
