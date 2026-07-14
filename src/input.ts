export type BoundedIntegerResult = { ok: true; value: number } | { ok: false; message: string }

export function readBoundedInteger(
  input: Record<string, unknown>,
  key: string,
  bounds: { defaultValue: number; min: number; max: number },
): BoundedIntegerResult {
  const raw = input[key]
  if (raw === undefined) return { ok: true, value: bounds.defaultValue }
  if (!Number.isInteger(raw) || (raw as number) < bounds.min || (raw as number) > bounds.max) {
    return { ok: false, message: `${key} must be an integer between ${bounds.min} and ${bounds.max}` }
  }
  return { ok: true, value: raw as number }
}

export type WorkspaceSelectorResult =
  | { ok: true; value: { workspaceId: string } | { workspaceAlias: string } }
  | { ok: false; message: string }

export function readWorkspaceSelector(input: Record<string, unknown>): WorkspaceSelectorResult {
  const hasId = Object.hasOwn(input, 'workspace_id')
  const hasAlias = Object.hasOwn(input, 'workspace_alias')
  const rawId = input['workspace_id']
  const rawAlias = input['workspace_alias']
  if (hasId && hasAlias) {
    return { ok: false, message: 'workspace_id and workspace_alias cannot be used together' }
  }
  if (hasId) {
    if (typeof rawId !== 'string' || !rawId.trim()) {
      return { ok: false, message: 'workspace_id must be a non-empty string' }
    }
    return { ok: true, value: { workspaceId: rawId.trim() } }
  }
  if (typeof rawAlias !== 'string' || !rawAlias.trim()) {
    return { ok: false, message: 'workspace_alias must be a non-empty string' }
  }
  return { ok: true, value: { workspaceAlias: rawAlias.trim() } }
}
