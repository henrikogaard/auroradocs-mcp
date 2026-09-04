import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  hashCustomDatabasePlan,
  type CustomDatabasePlan,
} from './customDatabases.js'
import {
  mcpStatePersistenceEnabled,
  resolveMcpStateDir,
  writeMcpStateFile,
} from './mcpState.js'

const PLAN_STORE = new Map<string, CustomDatabasePlan>()
const PLAN_MAX_BYTES = 1 * 1024 * 1024
const PLAN_STORE_LIMIT = 100

function planKey(workspaceId: string, planId: string): string {
  return `${workspaceId}:${planId}`
}

function planFileName(planId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(planId)) throw new Error('Invalid custom database plan ID')
  return `custom-database-plan-${planId}.json`
}

function pruneExpired(now = Date.now()): void {
  for (const [key, plan] of PLAN_STORE) {
    if (Date.parse(plan.expiresAt) <= now) PLAN_STORE.delete(key)
  }
  while (PLAN_STORE.size >= PLAN_STORE_LIMIT) {
    const oldest = PLAN_STORE.keys().next().value as string | undefined
    if (!oldest) break
    PLAN_STORE.delete(oldest)
  }
}

function assertPersistedPlan(value: unknown): asserts value is CustomDatabasePlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid persisted custom database plan')
  const plan = value as CustomDatabasePlan
  if (
    typeof plan.planId !== 'string'
    || typeof plan.planHash !== 'string'
    || typeof plan.workspaceId !== 'string'
    || typeof plan.createdAt !== 'string'
    || typeof plan.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(plan.createdAt))
    || !Number.isFinite(Date.parse(plan.expiresAt))
    || hashCustomDatabasePlan(plan) !== plan.planHash
  ) {
    throw new Error('Invalid persisted custom database plan')
  }
}

export function storeCustomDatabasePlan(plan: CustomDatabasePlan): void {
  pruneExpired()
  PLAN_STORE.set(planKey(plan.workspaceId, plan.planId), plan)
}

export function getStoredCustomDatabasePlan(workspaceId: string, planId: string): CustomDatabasePlan | null {
  pruneExpired()
  return PLAN_STORE.get(planKey(workspaceId, planId)) ?? null
}

export function clearCustomDatabasePlansForTests(): void {
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error('clearCustomDatabasePlansForTests is only available in test environments')
  }
  PLAN_STORE.clear()
}

export async function writeCustomDatabasePlan(
  plan: CustomDatabasePlan,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  storeCustomDatabasePlan(plan)
  if (!mcpStatePersistenceEnabled(env)) return null
  const serialized = `${JSON.stringify(plan, null, 2)}\n`
  return writeMcpStateFile(resolveMcpStateDir(env), planFileName(plan.planId), serialized, PLAN_MAX_BYTES)
}

export async function readCustomDatabasePlan(
  workspaceId: string,
  planId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<CustomDatabasePlan | null> {
  const memory = getStoredCustomDatabasePlan(workspaceId, planId)
  if (memory) return memory
  if (!mcpStatePersistenceEnabled(env) && !env['AURORA_MCP_STATE_DIR']?.trim()) return null
  const file = path.join(resolveMcpStateDir(env), planFileName(planId))
  let serialized: string
  try {
    const info = await lstat(file)
    if (info.isSymbolicLink() || !info.isFile() || info.size > PLAN_MAX_BYTES) {
      throw new Error('Invalid persisted custom database plan file')
    }
    serialized = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const value = JSON.parse(serialized) as unknown
  assertPersistedPlan(value)
  if (value.planId !== planId || value.workspaceId !== workspaceId) return null
  storeCustomDatabasePlan(value)
  return value
}
