import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { SERVER_VERSION } from '../version.js'

export const IMPORT_JOURNAL_VERSION = 1 as const
const JOURNAL_MAX_BYTES = 5 * 1024 * 1024

export type ImportJournalItem = {
  sourceHash: string
  objectId: string
  phase: 'pending' | 'object' | 'content'
  status: 'pending' | 'complete' | 'failed'
  warningCodes: string[]
  errorCode?: string
}
export type ImportJournal = {
  version: typeof IMPORT_JOURNAL_VERSION
  packageVersion: string
  planId: string
  planHash: string
  workspaceId: string
  rootIdentityHash: string
  inventoryHash: string
  status: 'pending' | 'in_progress' | 'partial' | 'complete' | 'blocked'
  cursor: number
  groups: Record<string, { objectTypeId: string; status: 'pending' | 'complete' | 'failed'; errorCode?: string }>
  containers: Record<string, { objectId: string; status: 'pending' | 'complete' | 'failed'; errorCode?: string }>
  entries: Record<string, ImportJournalItem>
  attachments: Record<string, { attachmentId: string; parentObjectId: string; url?: string; status: 'pending' | 'complete' | 'failed'; errorCode?: string }>
  startedAt: string
  updatedAt: string
}

export type ObsidianImportStatus = {
  status: ImportJournal['status']
  planId: string
  planHash: string
  completed: number
  failed: number
  remaining: number
  nextCursor: number | null
  warningCodes: string[]
  updatedAt: string | null
  nextAction: string
}

export function createImportJournal(
  input: Pick<ImportJournal, 'planId' | 'planHash' | 'workspaceId' | 'rootIdentityHash' | 'inventoryHash'>,
  now = new Date(),
): ImportJournal {
  return {
    version: IMPORT_JOURNAL_VERSION, packageVersion: SERVER_VERSION,
    ...input, status: 'pending', cursor: 0, groups: {}, containers: {}, entries: {}, attachments: {},
    startedAt: now.toISOString(), updatedAt: now.toISOString(),
  }
}

function planFileName(planId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(planId)) throw new Error('Invalid import plan ID for journal')
  return `obsidian-import-${planId}.json`
}

async function ensureStateDirectory(stateDir: string): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const info = await lstat(stateDir)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('MCP state path must be a real directory')
  await chmod(stateDir, 0o700)
}

function assertJournalShape(value: unknown): asserts value is ImportJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid import journal')
  const record = value as Record<string, unknown>
  if (
    record['version'] !== IMPORT_JOURNAL_VERSION || typeof record['planId'] !== 'string'
    || typeof record['planHash'] !== 'string' || typeof record['workspaceId'] !== 'string'
    || typeof record['rootIdentityHash'] !== 'string' || typeof record['inventoryHash'] !== 'string'
    || typeof record['cursor'] !== 'number' || !record['entries'] || !record['groups'] || !record['containers'] || !record['attachments']
  ) throw new Error('Invalid import journal')
}

function assertContentFree(value: unknown): void {
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) { entry.forEach(visit); return }
    if (!entry || typeof entry !== 'object') return
    for (const [key, child] of Object.entries(entry as Record<string, unknown>)) {
      if (/^(?:body|content|frontmatter|token|credential|absolutePath|relativePath|propertyValue)$/i.test(key)) {
        throw new Error(`Sensitive field ${key} is not allowed in the import journal`)
      }
      visit(child)
    }
  }
  visit(value)
}

export async function writeImportJournal(stateDir: string, journal: ImportJournal): Promise<string> {
  assertJournalShape(journal)
  assertContentFree(journal)
  await ensureStateDirectory(stateDir)
  const destination = path.join(stateDir, planFileName(journal.planId))
  const temporary = path.join(stateDir, `.${planFileName(journal.planId)}.${randomBytes(8).toString('hex')}.tmp`)
  const serialized = `${JSON.stringify(journal, null, 2)}\n`
  if (Buffer.byteLength(serialized) > JOURNAL_MAX_BYTES) throw new Error('Import journal exceeds its safety limit')
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, destination)
    await chmod(destination, 0o600)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return destination
}

export async function readImportJournal(stateDir: string, planId: string): Promise<ImportJournal | null> {
  const file = path.join(stateDir, planFileName(planId))
  let serialized: string
  try {
    const info = await lstat(file)
    if (info.isSymbolicLink() || !info.isFile() || info.size > JOURNAL_MAX_BYTES) throw new Error('Invalid import journal file')
    serialized = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const value = JSON.parse(serialized) as unknown
  assertJournalShape(value)
  assertContentFree(value)
  if (value.planId !== planId) throw new Error('Import journal plan mismatch')
  return value
}

export function summarizeImportJournal(
  plan: {
    planId: string
    planHash: string
    entries: unknown[]
    attachmentPolicy?: 'referenced' | 'skip'
    counts?: { attachments: number }
  },
  journal: ImportJournal | null,
): ObsidianImportStatus {
  if (!journal) {
    return {
      status: 'pending', planId: plan.planId, planHash: plan.planHash,
      completed: 0, failed: 0, remaining: plan.entries.length, nextCursor: 0,
      warningCodes: [], updatedAt: null,
      nextAction: 'Confirm the exact plan ID and hash to import the first bounded batch.',
    }
  }
  const entries = Object.values(journal.entries)
  const attachments = Object.values(journal.attachments)
  const completed = entries.filter((entry) => entry.status === 'complete').length
  const failed = entries.filter((entry) => entry.status === 'failed').length
    + attachments.filter((entry) => entry.status === 'failed').length
  const warningCodes = new Set<string>()
  for (const entry of entries) {
    entry.warningCodes.forEach((code) => warningCodes.add(code))
    if (entry.errorCode) warningCodes.add(entry.errorCode)
  }
  for (const collection of [journal.groups, journal.containers, journal.attachments]) {
    for (const item of Object.values(collection)) if (item.errorCode) warningCodes.add(item.errorCode)
  }
  const expectedAttachments = plan.attachmentPolicy === 'referenced' ? plan.counts?.attachments ?? 0 : 0
  const completedAttachments = attachments.filter((entry) => entry.status === 'complete').length
  const remaining = Math.max(0, plan.entries.length - completed)
    + Math.max(0, expectedAttachments - completedAttachments)
  return {
    status: journal.status, planId: plan.planId, planHash: plan.planHash,
    completed, failed, remaining,
    nextCursor: journal.status === 'complete' ? null : journal.cursor,
    warningCodes: [...warningCodes].slice(0, 100), updatedAt: journal.updatedAt,
    nextAction: journal.status === 'complete'
      ? 'Import complete.'
      : journal.status === 'blocked'
        ? 'Resolve the reported safety block, re-analyze if needed, and confirm a current plan.'
        : 'Call import_obsidian_vault again with the same plan ID and hash to resume.',
  }
}
