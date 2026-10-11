/**
 * Object types the MCP must treat differently from content.
 *
 * Hidden system objects hold workspace infrastructure rather than content: one
 * `workspace_config` object per workspace (synced settings such as task
 * statuses) and one `task_list` object per task list. Aurora leaves them out of
 * every listing, search and export (auroradocs
 * `packages/core/src/lib/workspaceConfigObject.ts` and
 * `apps/api/src/lib/hiddenObjects.ts`), and so does the MCP. They are read only
 * through the features that own them.
 *
 * Research Studio's types were removed in auroradocs #1135. Objects of those
 * types are migrated to pages by the app, and nothing new may be created with
 * them.
 */

export const HIDDEN_SYSTEM_OBJECT_TYPES: ReadonlySet<string> = new Set(['workspace_config', 'task_list'])

export const RETIRED_OBJECT_TYPE_PREFIX = 'research_'

export function isHiddenSystemObjectType(type: string | null | undefined): boolean {
  return Boolean(type && HIDDEN_SYSTEM_OBJECT_TYPES.has(type))
}

export function isRetiredObjectType(type: string | null | undefined): boolean {
  return Boolean(type && type.startsWith(RETIRED_OBJECT_TYPE_PREFIX))
}

/** Why the MCP may not create an object of this type, or null when it may. */
export function uncreatableObjectTypeReason(type: string): string | null {
  if (type === 'task_list') {
    return 'Task lists cannot be created as objects through the MCP. Create or edit task lists in the Aurora app, then use list_task_lists.'
  }
  if (type === 'workspace_config') {
    return 'workspace_config is an internal Aurora object and cannot be created.'
  }
  if (isRetiredObjectType(type)) {
    return `${type} is a retired Research Studio type and cannot be created. Use a page instead.`
  }
  return null
}
