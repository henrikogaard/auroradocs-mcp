import test from 'node:test'
import assert from 'node:assert/strict'
import { convertObsidianMarkdown } from './contentConverter.js'

test('Markdown conversion preserves common structure, marks, links, and readable fallbacks without fetching', () => {
  const previousFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = (() => { fetches += 1; throw new Error('must not fetch') }) as typeof fetch
  try {
    const markdown = [
      '# Heading',
      '',
      'A **bold** and *italic* paragraph with [site](https://example.test) and [[People/Ada|Ada]].',
      '',
      '- item one',
      '- [x] completed',
      '',
      '> quoted',
      '',
      '```ts',
      'const value = 1',
      '```',
      '',
      '| Name | State |',
      '| --- | --- |',
      '| Ada | Active |',
      '',
      'Broken [[Missing note]] and anchored [[People/Ada#Work]].',
    ].join('\n')
    const result = convertObsidianMarkdown(markdown, {
      sourcePath: 'Home.md',
      objectIdsByPath: new Map([['People/Ada.md', 'object-ada']]),
      resolvedLinks: [
        { raw: '[[People/Ada|Ada]]', target: 'People/Ada', alias: 'Ada', anchor: null, embed: false, sourcePath: 'Home.md', status: 'resolved', resolvedPath: 'People/Ada.md' },
        { raw: '[[Missing note]]', target: 'Missing note', alias: null, anchor: null, embed: false, sourcePath: 'Home.md', status: 'broken', resolvedPath: null },
        { raw: '[[People/Ada#Work]]', target: 'People/Ada', alias: null, anchor: '#Work', embed: false, sourcePath: 'Home.md', status: 'resolved', resolvedPath: 'People/Ada.md' },
      ],
      attachmentsByPath: new Map(),
    })
    const json = JSON.stringify(result.document)
    assert.match(json, /"type":"heading"/)
    assert.match(json, /"type":"bulletList"|"type":"taskList"/)
    assert.match(json, /"type":"blockquote"/)
    assert.match(json, /"type":"codeBlock"/)
    assert.match(json, /"type":"table"/)
    assert.match(json, /\/object\/object-ada/)
    assert.match(json, /Missing note/)
    assert.ok(result.warnings.some((warning) => /broken/i.test(warning)))
    assert.ok(result.warnings.some((warning) => /anchor/i.test(warning)))
    assert.equal(fetches, 0)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('resolved attachment embeds become attachment references and unresolved embeds stay readable', () => {
  const result = convertObsidianMarkdown('![[Assets/manual.pdf]]\n\n![[Assets/missing.png]]', {
    sourcePath: 'Home.md', objectIdsByPath: new Map(), resolvedLinks: [],
    attachmentsByPath: new Map([['Assets/manual.pdf', { attachmentId: 'attachment-1', url: '/api/attachments/attachment-1' }]]),
  })
  const json = JSON.stringify(result.document)
  assert.match(json, /attachment-1/)
  assert.match(json, /Assets\/missing\.png/)
  assert.ok(result.warnings.some((warning) => /unresolved attachment/i.test(warning)))
})

test('Markdown image titles are excluded from attachment path lookup', () => {
  const result = convertObsidianMarkdown('![Manual](Assets/manual.pdf "Equipment guide")', {
    sourcePath: 'Home.md', objectIdsByPath: new Map(), resolvedLinks: [],
    attachmentsByPath: new Map([['Assets/manual.pdf', { attachmentId: 'attachment-title', url: '/api/attachments/title' }]]),
  })
  assert.match(JSON.stringify(result.document), /attachment-title/)
  assert.deepEqual(result.referencedAttachmentIds, ['attachment-title'])
})

test('unsupported skip policy omits dynamic plugin blocks and unresolved fallbacks', () => {
  const context = {
    sourcePath: 'Home.md', objectIdsByPath: new Map<string, string>(), resolvedLinks: [],
    attachmentsByPath: new Map(), unsupportedPolicy: 'skip' as const,
  }
  const result = convertObsidianMarkdown('```dataview\nLIST FROM #travel\n```\n\n[[Missing note]]', context)
  const serialized = JSON.stringify(result.document)
  assert.doesNotMatch(serialized, /LIST FROM|Missing note/)
  assert.ok(result.warnings.some((warning) => /skipped/i.test(warning)))
})

test('standard local Markdown links resolve to Aurora objects and uploaded attachments', () => {
  const result = convertObsidianMarkdown('[Ada](People/Ada.md) and [manual](Assets/manual.pdf)', {
    sourcePath: 'Home.md', resolvedLinks: [],
    objectIdsByPath: new Map([['People/Ada.md', 'object-ada']]),
    attachmentsByPath: new Map([['Assets/manual.pdf', { attachmentId: 'attachment-manual', url: '/canonical/manual' }]]),
  })
  const serialized = JSON.stringify(result.document)
  assert.match(serialized, /\/object\/object-ada/)
  assert.match(serialized, /\/canonical\/manual/)
  assert.deepEqual(result.referencedAttachmentIds, ['attachment-manual'])
})
