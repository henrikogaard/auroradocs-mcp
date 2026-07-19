import { parseDocument } from 'yaml'

export const FRONTMATTER_MAX_BYTES = 256 * 1024
export const FRONTMATTER_MAX_DEPTH = 20
export const FRONTMATTER_MAX_ALIASES = 100

export type ParsedFrontmatter = {
  data: Record<string, unknown>
  body: string
  warnings: string[]
}

function assertSafeValue(value: unknown, depth = 0): void {
  if (depth > FRONTMATTER_MAX_DEPTH) throw new Error(`YAML depth exceeds ${FRONTMATTER_MAX_DEPTH}`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('YAML numeric values must be finite')
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeValue(entry, depth + 1)
    return
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!key || key.length > 256) throw new Error('YAML keys must be bounded text')
      assertSafeValue(entry, depth + 1)
    }
    return
  }
  throw new Error('YAML contains an unsupported value type')
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { data: {}, body: source, warnings: [] }
  }
  const match = /^(?:---\r?\n)([\s\S]*?)(?:\r?\n---[ \t]*\r?\n?)/.exec(source)
  if (!match) return { data: {}, body: source, warnings: ['Unclosed YAML frontmatter was preserved as readable text.'] }
  const raw = match[1] ?? ''
  if (Buffer.byteLength(raw, 'utf8') > FRONTMATTER_MAX_BYTES) {
    return { data: {}, body: source, warnings: ['YAML frontmatter exceeded the 256 KiB safety limit and was preserved as readable text.'] }
  }
  try {
    const document = parseDocument(raw, { schema: 'core', uniqueKeys: true, prettyErrors: false })
    if (document.errors.length) throw new Error(document.errors[0]?.message ?? 'Invalid YAML')
    if (document.warnings.length) throw new Error(document.warnings[0]?.message ?? 'Unsafe YAML tag')
    const value = document.toJS({ maxAliasCount: FRONTMATTER_MAX_ALIASES }) as unknown
    if (value === null) return { data: {}, body: source.slice(match[0].length), warnings: [] }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error('Frontmatter root must be a mapping')
    }
    assertSafeValue(value)
    return { data: value as Record<string, unknown>, body: source.slice(match[0].length), warnings: [] }
  } catch {
    return { data: {}, body: source, warnings: ['Invalid or unsafe YAML frontmatter was preserved as readable text.'] }
  }
}
