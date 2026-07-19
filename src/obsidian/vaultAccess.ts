import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { ObsidianImportConfig } from './config.js'

export const OBSIDIAN_SOURCE_MAX_BYTES = 8 * 1024 * 1024
export const OBSIDIAN_VAULT_MAX_ENTRIES = 100_000

export type VaultSourceFile = {
  relativePath: string
  kind: 'markdown' | 'canvas' | 'templates_config'
  sizeBytes: number
}

export type VaultTextFile = VaultSourceFile & { text: string }

type RootIdentity = {
  canonicalPath: string
  dev: number | bigint
  ino: number | bigint
}

function normalizedRelativePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 4096 || path.isAbsolute(trimmed) || trimmed.includes('\\')) {
    throw new Error('Vault path must be a bounded vault-relative path.')
  }
  const normalized = path.posix.normalize(trimmed.replaceAll(path.sep, '/'))
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error('Vault path cannot escape the authorized root.')
  }
  return normalized
}

function sourceKind(relativePath: string): VaultSourceFile['kind'] | null {
  if (relativePath === '.obsidian/templates.json') return 'templates_config'
  if (relativePath.toLowerCase().endsWith('.md')) return 'markdown'
  if (relativePath.toLowerCase().endsWith('.canvas')) return 'canvas'
  return null
}

function shouldIgnore(relativePath: string): boolean {
  const parts = relativePath.split('/')
  if (relativePath === '.obsidian' || relativePath === '.obsidian/templates.json') return false
  if (parts[0] === '.obsidian') return true
  return parts.some((part) => (
    part.startsWith('.')
    || part.toLowerCase() === 'node_modules'
    || part.toLowerCase() === 'trash'
    || part.toLowerCase() === 'cache'
  ))
}

async function readRootIdentity(root: string): Promise<RootIdentity> {
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink()) throw new Error('The authorized vault root cannot be a symlink.')
  if (!rootInfo.isDirectory()) throw new Error('The authorized vault root must be a directory.')
  return { canonicalPath: await realpath(root), dev: rootInfo.dev, ino: rootInfo.ino }
}

export class AuthorizedVault {
  readonly #root: string
  readonly #identity: RootIdentity
  readonly #maxEntries: number

  constructor(root: string, identity: RootIdentity, maxEntries: number) {
    this.#root = root
    this.#identity = identity
    this.#maxEntries = maxEntries
  }

  get displayName(): string {
    return path.basename(this.#identity.canonicalPath)
  }

  get identityHash(): string {
    return createHash('sha256')
      .update(this.#identity.canonicalPath)
      .update(String(this.#identity.dev))
      .update(String(this.#identity.ino))
      .digest('hex')
  }

  async #assertRootIdentity(): Promise<void> {
    const current = await readRootIdentity(this.#root).catch(() => null)
    if (
      !current
      || current.canonicalPath !== this.#identity.canonicalPath
      || current.dev !== this.#identity.dev
      || current.ino !== this.#identity.ino
    ) {
      throw new Error('The authorized vault root identity was replaced; restart after reviewing the new root.')
    }
  }

  async #resolveSafeFile(relativePath: string): Promise<{ relativePath: string; absolutePath: string }> {
    await this.#assertRootIdentity()
    const normalized = normalizedRelativePath(relativePath)
    let current = this.#identity.canonicalPath
    for (const segment of normalized.split('/')) {
      current = path.join(current, segment)
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error('Vault symlinks are not allowed.')
    }
    const canonical = await realpath(current)
    const relative = path.relative(this.#identity.canonicalPath, canonical)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Vault path cannot escape the authorized root.')
    }
    return { relativePath: normalized, absolutePath: canonical }
  }

  async listSourceFiles(): Promise<VaultSourceFile[]> {
    await this.#assertRootIdentity()
    const files: VaultSourceFile[] = []
    let visitedEntries = 0

    const visit = async (relativeDirectory: string): Promise<void> => {
      const absoluteDirectory = relativeDirectory
        ? path.join(this.#identity.canonicalPath, ...relativeDirectory.split('/'))
        : this.#identity.canonicalPath
      const entries = await readdir(absoluteDirectory, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
      for (const entry of entries) {
        visitedEntries += 1
        if (visitedEntries > this.#maxEntries) throw new Error('Obsidian vault entry limit exceeded.')
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
        if (entry.isSymbolicLink() || shouldIgnore(relativePath)) continue
        if (entry.isDirectory()) {
          await visit(relativePath)
          continue
        }
        if (!entry.isFile()) continue
        const kind = sourceKind(relativePath)
        if (!kind) continue
        const info = await lstat(path.join(absoluteDirectory, entry.name))
        if (info.size > OBSIDIAN_SOURCE_MAX_BYTES) continue
        files.push({ relativePath, kind, sizeBytes: info.size })
      }
    }

    await visit('')
    return files
  }

  async readText(relativePath: string): Promise<VaultTextFile> {
    const resolved = await this.#resolveSafeFile(relativePath)
    const kind = sourceKind(resolved.relativePath)
    if (!kind) throw new Error('Vault path is not an allowed Markdown, Canvas, or Templates source.')
    const info = await lstat(resolved.absolutePath)
    if (!info.isFile()) throw new Error('Vault source path is not a file.')
    if (info.size > OBSIDIAN_SOURCE_MAX_BYTES) throw new Error('Vault source exceeds the 8 MiB analysis limit.')
    return {
      relativePath: resolved.relativePath,
      kind,
      sizeBytes: info.size,
      text: await readFile(resolved.absolutePath, 'utf8'),
    }
  }

  async readAsset(relativePath: string, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
    const resolved = await this.#resolveSafeFile(relativePath)
    if (shouldIgnore(resolved.relativePath) || resolved.relativePath === '.obsidian/templates.json') {
      throw new Error('Ignored vault paths cannot be read as attachments.')
    }
    const info = await lstat(resolved.absolutePath)
    if (!info.isFile()) throw new Error('Vault asset path is not a file.')
    if (info.size > maxBytes) throw new Error('Vault asset exceeds the allowed upload size.')
    return readFile(resolved.absolutePath)
  }
}

export async function openAuthorizedVault(
  config: ObsidianImportConfig,
  options: { maxEntries?: number } = {},
): Promise<AuthorizedVault> {
  const identity = await readRootIdentity(config.vaultRoot)
  return new AuthorizedVault(
    config.vaultRoot,
    identity,
    Math.max(1, Math.min(options.maxEntries ?? OBSIDIAN_VAULT_MAX_ENTRIES, OBSIDIAN_VAULT_MAX_ENTRIES)),
  )
}
