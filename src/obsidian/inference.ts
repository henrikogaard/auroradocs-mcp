import {
  CUSTOM_DATABASE_RECIPES,
  normalizeSchemaKey,
  validateCustomDatabaseSchema,
  type CustomDatabaseRecipeId,
  type ObjectTypeSchema,
  type PropertyValueType,
} from '../customDatabases.js'
import type { AnalyzedNote, ResolvedVaultLink, VaultAnalysis } from './analyzer.js'

export type InferredGroup = {
  key: string
  name: string
  recipeId: CustomDatabaseRecipeId | null
  confidence: number
  evidence: string[]
  notePaths: string[]
  schema: ObjectTypeSchema[]
}

const META_KEYS = new Set(['title', 'type', 'kind', 'aliases', 'alias', 'tags', 'tag', 'cssclasses', 'publish'])

function canonicalGroup(value: string): { key: string; recipeId: CustomDatabaseRecipeId | null; name: string } {
  const normalized = normalizeSchemaKey(value)
  const aliases: Record<string, CustomDatabaseRecipeId> = {
    contact: 'contacts', contacts: 'contacts', person: 'contacts', people: 'contacts',
    interest: 'interests', interests: 'interests',
    equipment: 'equipment', gear: 'equipment', asset: 'equipment', assets: 'equipment',
    subscription: 'subscriptions', subscriptions: 'subscriptions',
    expense: 'expenses', expenses: 'expenses',
  }
  const recipeId = aliases[normalized] ?? null
  const recipe = recipeId ? CUSTOM_DATABASE_RECIPES.find((entry) => entry.id === recipeId) : undefined
  const name = recipe?.name ?? value.trim().replace(/[_-]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
  return { key: recipeId ?? normalized, recipeId, name }
}

function explicitGroup(note: AnalyzedNote): string | null {
  for (const key of ['type', 'kind']) {
    const value = note.frontmatter[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function recipeFolder(note: AnalyzedNote): string | null {
  const first = note.folder.split('/')[0]
  if (!first) return null
  const canonical = canonicalGroup(first)
  return canonical.recipeId ? first : null
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return false
  return Number.isFinite(Date.parse(value))
}

function scalarType(value: unknown): PropertyValueType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  if (Array.isArray(value)) return 'text'
  if (typeof value !== 'string') return 'text'
  const trimmed = value.trim()
  if (isIsoDate(trimmed)) return 'date'
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'email'
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return 'url'
  if (/^\+?[\d() .-]{7,24}$/.test(trimmed)) return 'phone'
  return 'text'
}

function relationTarget(value: unknown, note: AnalyzedNote, links: ResolvedVaultLink[], noteGroups: Map<string, string>): string | null {
  if (typeof value !== 'string') return null
  const match = /^\[\[([^\]|#^]+)(?:[#^][^\]|]+)?(?:\|[^\]]+)?\]\]$/.exec(value.trim())
  if (!match) return null
  const resolved = links.find((link) => link.sourcePath === note.relativePath && link.target === match[1]?.trim() && link.status === 'resolved')
  if (!resolved?.resolvedPath) return null
  return noteGroups.get(resolved.resolvedPath) ?? null
}

function inferSchema(notes: AnalyzedNote[], recipeId: CustomDatabaseRecipeId | null, analysis: VaultAnalysis, noteGroups: Map<string, string>): ObjectTypeSchema[] {
  const recipe = recipeId ? CUSTOM_DATABASE_RECIPES.find((entry) => entry.id === recipeId) : undefined
  const fields = new Map<string, ObjectTypeSchema>()
  for (const field of recipe?.schema ?? []) fields.set(field.key, { ...field, ...(field.options ? { options: [...field.options] } : {}) })
  const values = new Map<string, unknown[]>()
  for (const note of notes) for (const [rawKey, value] of Object.entries(note.frontmatter)) {
    let key: string
    try { key = normalizeSchemaKey(rawKey) } catch { continue }
    if (META_KEYS.has(key) || key.length > 64) continue
    values.set(key, [...(values.get(key) ?? []), value])
  }
  for (const [key, observed] of values) {
    if (fields.has(key)) continue
    const types = new Set(observed.map(scalarType))
    let valueType: PropertyValueType = types.size === 1 ? [...types][0] ?? 'text' : 'text'
    let targetType: string | undefined
    if (valueType === 'text') {
      const targets = new Set(notes.flatMap((note) => {
        const target = relationTarget(note.frontmatter[key], note, analysis.links, noteGroups)
        return target ? [target] : []
      }))
      if (targets.size === 1 && observed.length === notes.length) {
        valueType = 'relation'
        targetType = `group:${[...targets][0]}`
      }
    }
    const label = key.split('_').map((part, index) => index === 0 ? part.charAt(0).toLocaleUpperCase() + part.slice(1) : part).join(' ')
    const field: ObjectTypeSchema = { key, label, value_type: valueType, required: false }
    if (targetType) field.targetType = targetType
    fields.set(key, field)
  }
  return validateCustomDatabaseSchema([...fields.values()].map((field) => (
    field.targetType?.startsWith('group:') ? { ...field, value_type: 'text', targetType: undefined } : field
  )))
}

export function inferObsidianGroups(analysis: VaultAnalysis): { groups: InferredGroup[]; noteGroupKeys: Map<string, string> } {
  const candidates = new Map<string, { canonical: ReturnType<typeof canonicalGroup>; notes: AnalyzedNote[]; evidence: Set<string>; confidence: number }>()
  const noteGroupKeys = new Map<string, string>()
  for (const note of analysis.notes) {
    const explicit = explicitGroup(note)
    const folder = recipeFolder(note)
    const source = explicit ?? folder
    if (!source) continue
    const canonical = canonicalGroup(source)
    const confidence = explicit ? 0.95 : 0.78
    const bucket = candidates.get(canonical.key) ?? { canonical, notes: [], evidence: new Set<string>(), confidence }
    bucket.notes.push(note)
    bucket.confidence = Math.max(bucket.confidence, confidence)
    bucket.evidence.add(explicit ? `Explicit type/kind metadata appears in ${note.relativePath}.` : `Folder ${note.folder} matches the ${canonical.name} recipe.`)
    candidates.set(canonical.key, bucket)
    noteGroupKeys.set(note.relativePath, canonical.key)
  }
  const groups = [...candidates.values()].sort((left, right) => left.canonical.name.localeCompare(right.canonical.name, 'en')).map((bucket) => ({
    key: bucket.canonical.key,
    name: bucket.canonical.name,
    recipeId: bucket.canonical.recipeId,
    confidence: bucket.confidence,
    evidence: [...bucket.evidence].slice(0, 20),
    notePaths: bucket.notes.map((note) => note.relativePath).sort(),
    schema: inferSchema(bucket.notes, bucket.canonical.recipeId, analysis, noteGroupKeys),
  }))
  return { groups, noteGroupKeys }
}
