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

test('scoped npm package is configured for public trusted publishing', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const releaseWorkflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')

  assert.equal(pkg.name, '@henrikogard/auroradocs-mcp')
  assert.equal(pkg.version, '0.1.1')
  assert.equal(pkg.publishConfig?.access, 'public')
  assert.match(releaseWorkflow, /npm publish --provenance --access public/)
})
