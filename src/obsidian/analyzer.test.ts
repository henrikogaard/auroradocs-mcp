import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrontmatter } from './frontmatter.js'
import { analyzeObsidianVault, OBSIDIAN_VAULT_TOTAL_SOURCE_MAX_BYTES, summarizeVaultAnalysis } from './analyzer.js'
import type { AuthorizedVault } from './vaultAccess.js'
import { openAuthorizedVault } from './vaultAccess.js'
import { resolveObsidianConfig } from './config.js'

const fixtureRoot = fileURLToPath(new URL('../../test/fixtures/obsidian-vault/', import.meta.url))

async function immutableTreeHash(root: string): Promise<string> {
  const hash = createHash('sha256')
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      hash.update(relative)
      if (entry.isDirectory()) await visit(absolute)
      else hash.update(await readFile(absolute))
    }
  }
  await visit(root)
  return hash.digest('hex')
}

test('safe frontmatter parser accepts bounded core YAML and warns without executing custom tags', () => {
  const parsed = parseFrontmatter('---\ntitle: Test\ntags: [one, two]\ncount: 2\nactive: true\ndate: 2026-07-19\n---\n# Body')
  assert.deepEqual(parsed.data, { title: 'Test', tags: ['one', 'two'], count: 2, active: true, date: '2026-07-19' })
  assert.equal(parsed.body, '# Body')

  const unsafe = parseFrontmatter('---\nvalue: !js/function function () { return 1 }\n---\nText')
  assert.deepEqual(unsafe.data, {})
  assert.match(unsafe.warnings.join(' '), /YAML|tag|frontmatter/i)
  assert.match(unsafe.body, /!js\/function/)
})

test('analysis inventories notes, templates, tags, links, attachments, and Canvas without network or source writes', async () => {
  const before = await immutableTreeHash(fixtureRoot)
  const previousFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = (() => { networkCalls += 1; throw new Error('analysis must not call AuroraCloud') }) as typeof fetch
  try {
    const vault = await openAuthorizedVault(resolveObsidianConfig({ AURORA_OBSIDIAN_VAULT_ROOT: fixtureRoot }))
    const analysis = await analyzeObsidianVault(vault)
    const summary = summarizeVaultAnalysis(analysis)

    assert.equal(analysis.vaultDisplayName, 'obsidian-vault')
    assert.equal(analysis.templatesFolder, 'Templates')
    assert.ok(analysis.notes.length >= 6)
    assert.equal(analysis.canvases.length, 1)
    assert.equal(analysis.attachments.length, 1)
    assert.equal(analysis.attachments[0]?.relativePath, 'Assets/manual.pdf')
    assert.ok(analysis.notes.find((note) => note.relativePath === 'People/Ada.md')?.tags.includes('inventor'))
    assert.ok(analysis.notes.find((note) => note.relativePath === 'Templates/Contact.md')?.isTemplate)
    assert.ok(analysis.warnings.some((warning) => /dynamic|Templater/i.test(warning)))
    assert.ok(analysis.links.some((link) => link.target === 'Missing note' && link.status === 'broken'))
    assert.ok(analysis.links.some((link) => link.target === 'Ada' && link.status === 'ambiguous'))
    assert.ok(analysis.links.some((link) => link.target === 'People/Ada' && link.status === 'resolved'))
    assert.equal(summary.requiresConfirmation, true)
    assert.equal(JSON.stringify(summary).includes('Template body'), false)
    assert.equal(JSON.stringify(summary).includes('ada@example.test'), false)
    assert.equal(networkCalls, 0)
    assert.equal(await immutableTreeHash(fixtureRoot), before)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('analysis rejects an oversized aggregate source inventory before reading files', async () => {
  let reads = 0
  const vault = {
    listSourceFiles: async () => [
      { relativePath: 'one.md', kind: 'markdown' as const, sizeBytes: OBSIDIAN_VAULT_TOTAL_SOURCE_MAX_BYTES },
      { relativePath: 'two.md', kind: 'markdown' as const, sizeBytes: 1 },
    ],
    readText: async () => { reads += 1; throw new Error('must not read') },
  } as unknown as AuthorizedVault
  await assert.rejects(() => analyzeObsidianVault(vault), /256 MiB/i)
  assert.equal(reads, 0)
})
