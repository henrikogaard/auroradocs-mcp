import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('check runs docs contracts and normal NodeNext typechecking', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const tsconfig = JSON.parse(await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'))

  assert.equal(pkg.scripts['test:docs'], 'node --test scripts/docsContract.test.mjs')
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit')
  assert.match(pkg.scripts.check, /pnpm test:docs/)
  assert.match(pkg.scripts.check, /pnpm typecheck/)
  assert.ok(tsconfig.include.includes('test/**/*'), 'normal typecheck must include stdio integration tests')
})
