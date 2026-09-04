import path from 'node:path'
import { resolveMcpStateDir } from '../mcpState.js'

export type ObsidianImportConfig = {
  vaultRoot: string
  stateDir: string
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function resolveObsidianConfig(
  env: Record<string, string | undefined> = process.env,
): ObsidianImportConfig {
  const rawRoot = env['AURORA_OBSIDIAN_VAULT_ROOT']?.trim()
  if (!rawRoot) throw new Error('AURORA_OBSIDIAN_VAULT_ROOT is required to authorize vault analysis.')
  if (!path.isAbsolute(rawRoot)) throw new Error('AURORA_OBSIDIAN_VAULT_ROOT must be an absolute path.')
  const vaultRoot = path.resolve(rawRoot)
  const stateDir = resolveMcpStateDir(env)
  if (isInside(vaultRoot, stateDir)) {
    throw new Error('AURORA_MCP_STATE_DIR must be outside the authorized Obsidian vault.')
  }
  return { vaultRoot, stateDir }
}
