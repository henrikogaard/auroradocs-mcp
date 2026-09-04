import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function resolveMcpStateDir(env: Record<string, string | undefined> = process.env): string {
  const raw = env['AURORA_MCP_STATE_DIR']?.trim()
  return path.resolve(raw || path.join(os.homedir(), '.auroradocs-mcp'))
}

export function mcpStatePersistenceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env['AURORA_MCP_STATE_DIR']?.trim()) return true
  return env['NODE_ENV'] !== 'test'
}

export async function ensureMcpStateDirectory(stateDir: string): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const info = await lstat(stateDir)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('MCP state path must be a real directory')
  await chmod(stateDir, 0o700)
}

export async function writeMcpStateFile(
  stateDir: string,
  fileName: string,
  serialized: string,
  maxBytes: number,
): Promise<string> {
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(fileName)) throw new Error('Invalid MCP state file name')
  await ensureMcpStateDirectory(stateDir)
  const destination = path.join(stateDir, fileName)
  const temporary = path.join(stateDir, `.${fileName}.${randomBytes(8).toString('hex')}.tmp`)
  if (Buffer.byteLength(serialized) > maxBytes) throw new Error('MCP state file exceeds its safety limit')
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
