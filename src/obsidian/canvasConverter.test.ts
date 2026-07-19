import test from 'node:test'
import assert from 'node:assert/strict'
import { convertObsidianCanvas } from './canvasConverter.js'

test('Canvas conversion maps text, file, web, group nodes and remaps colliding IDs', () => {
  const result = convertObsidianCanvas({
    relativePath: 'Map.canvas', title: 'Map', sourceHash: 'hash', warnings: [], referencedPaths: [],
    nodes: [
      { id: 'same', type: 'text', text: 'Research', x: 0, y: 0, width: 200, height: 100 },
      { id: 'same', type: 'file', file: 'People/Ada.md', x: 220, y: 0, width: 200, height: 100 },
      { id: 'web', type: 'link', url: 'https://example.test', x: 0, y: 120, width: 200, height: 100 },
      { id: 'group', type: 'group', label: 'Context', x: 0, y: 0, width: 500, height: 300 },
    ],
    edges: [{ id: 'edge', fromNode: 'same', toNode: 'web', label: 'supports' }],
  }, {
    objectIdsByPath: new Map([['People/Ada.md', 'object-ada']]), attachmentsByPath: new Map(),
  })
  assert.equal(new Set(result.content.cards.map((card) => card.id)).size, result.content.cards.length)
  assert.ok(result.content.cards.some((card) => card.objectId === 'object-ada'))
  assert.ok(result.content.cards.some((card) => card.url === 'https://example.test'))
  assert.equal(result.content.frames[0]?.label, 'Context')
  assert.ok(result.warnings.some((warning) => /duplicate|collid/i.test(warning)))
})

test('unsupported and unresolved Canvas nodes remain readable and produce warnings', () => {
  const result = convertObsidianCanvas({
    relativePath: 'Map.canvas', title: 'Map', sourceHash: 'hash', warnings: [], referencedPaths: [],
    nodes: [
      { id: 'missing', type: 'file', file: 'Assets/missing.pdf', x: 0, y: 0 },
      { id: 'plugin', type: 'custom-plugin', data: 'preserve me' },
    ], edges: [],
  }, { objectIdsByPath: new Map(), attachmentsByPath: new Map() })
  assert.match(JSON.stringify(result.content), /Assets\/missing\.pdf|custom-plugin/)
  assert.ok(result.warnings.length >= 2)
})

test('unsupported skip policy omits unsupported and unresolved Canvas nodes', () => {
  const context = { objectIdsByPath: new Map(), attachmentsByPath: new Map(), unsupportedPolicy: 'skip' as const }
  const result = convertObsidianCanvas({
    relativePath: 'Map.canvas', title: 'Map', sourceHash: 'hash', warnings: [], referencedPaths: [],
    nodes: [
      { id: 'missing', type: 'file', file: 'Assets/missing.pdf' },
      { id: 'plugin', type: 'custom-plugin', data: 'skip me' },
      { id: 'text', type: 'text', text: 'Keep me' },
    ], edges: [{ id: 'skipped-edge', fromNode: 'plugin', toNode: 'text' }],
  }, context)
  const serialized = JSON.stringify(result.content)
  assert.match(serialized, /Keep me/)
  assert.doesNotMatch(serialized, /missing\.pdf|custom-plugin/)
  assert.equal(result.content.edges.length, 0)
  assert.ok(result.warnings.some((warning) => /skipped/i.test(warning)))
})
