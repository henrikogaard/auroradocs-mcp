import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveObsidianConfig } from './config.js'
import { openAuthorizedVault } from './vaultAccess.js'

async function fixtureVault() {
  const parent = await mkdtemp(path.join(tmpdir(), 'aurora-obsidian-vault-'))
  const root = path.join(parent, 'Vault')
  await mkdir(path.join(root, 'People'), { recursive: true })
  await mkdir(path.join(root, '.obsidian', 'plugins', 'unsafe'), { recursive: true })
  await mkdir(path.join(root, '.git'), { recursive: true })
  await writeFile(path.join(root, 'Home.md'), '# Home\n')
  await writeFile(path.join(root, 'People', 'Ada.md'), '# Ada\n')
  await writeFile(path.join(root, 'Map.canvas'), '{"nodes":[],"edges":[]}')
  await writeFile(path.join(root, '.obsidian', 'templates.json'), '{"folder":"Templates"}')
  await writeFile(path.join(root, '.obsidian', 'plugins', 'unsafe', 'main.js'), 'throw new Error()')
  await writeFile(path.join(root, '.git', 'config'), 'private')
  return { parent, root }
}

async function treeHash(root: string): Promise<string> {
  const files = ['Home.md', 'People/Ada.md', 'Map.canvas', '.obsidian/templates.json']
  const hash = createHash('sha256')
  for (const file of files) hash.update(file).update(await readFile(path.join(root, file)))
  return hash.digest('hex')
}

test('vault configuration requires one explicit absolute root and keeps state outside it', async () => {
  assert.throws(() => resolveObsidianConfig({}), /AURORA_OBSIDIAN_VAULT_ROOT/)
  assert.throws(() => resolveObsidianConfig({ AURORA_OBSIDIAN_VAULT_ROOT: 'relative/vault' }), /absolute/)
  const { root } = await fixtureVault()
  const config = resolveObsidianConfig({
    AURORA_OBSIDIAN_VAULT_ROOT: root,
    AURORA_MCP_STATE_DIR: path.join(path.dirname(root), 'state'),
  })
  assert.equal(config.vaultRoot, root)
  assert.equal(config.stateDir.startsWith(root + path.sep), false)
  assert.throws(() => resolveObsidianConfig({
    AURORA_OBSIDIAN_VAULT_ROOT: root,
    AURORA_MCP_STATE_DIR: path.join(root, '.state'),
  }), /outside/i)
})

test('authorized vault lists deterministic safe files and ignores hidden/plugin/git/trash content', async () => {
  const { root } = await fixtureVault()
  const before = await treeHash(root)
  const vault = await openAuthorizedVault(resolveObsidianConfig({ AURORA_OBSIDIAN_VAULT_ROOT: root }))
  assert.deepEqual((await vault.listSourceFiles()).map((entry) => entry.relativePath), [
    '.obsidian/templates.json',
    'Home.md',
    'Map.canvas',
    'People/Ada.md',
  ])
  assert.equal((await vault.readText('People/Ada.md')).text, '# Ada\n')
  assert.equal(await treeHash(root), before)
})

test('vault reads reject traversal, absolute paths, symlinks, oversized sources, and root replacement', async () => {
  const { parent, root } = await fixtureVault()
  await writeFile(path.join(parent, 'outside.md'), 'outside')
  await symlink(path.join(parent, 'outside.md'), path.join(root, 'escape.md'))
  const vault = await openAuthorizedVault(resolveObsidianConfig({ AURORA_OBSIDIAN_VAULT_ROOT: root }))
  for (const candidate of ['../outside.md', path.join(parent, 'outside.md'), 'escape.md']) {
    await assert.rejects(() => vault.readText(candidate), /path|symlink/i)
  }

  await writeFile(path.join(root, 'Huge.md'), Buffer.alloc(8 * 1024 * 1024 + 1, 65))
  await assert.rejects(() => vault.readText('Huge.md'), /8 MiB/)

  const oldRoot = `${root}-old`
  await rename(root, oldRoot)
  await mkdir(root)
  await writeFile(path.join(root, 'Home.md'), 'replacement')
  await assert.rejects(() => vault.listSourceFiles(), /replaced|identity/i)
})

test('vault entry ceiling fails closed', async () => {
  const { root } = await fixtureVault()
  const vault = await openAuthorizedVault(
    resolveObsidianConfig({ AURORA_OBSIDIAN_VAULT_ROOT: root }),
    { maxEntries: 2 },
  )
  await assert.rejects(() => vault.listSourceFiles(), /entry limit/i)
})
