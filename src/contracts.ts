export type Availability =
  | 'available'
  | 'empty'
  | 'encrypted_locked'
  | 'permission_denied'
  | 'not_found'
  | 'unavailable'

export type ContentReadResult = {
  availability: Availability
  text: string | null
}

export type ToolErrorCode =
  | 'invalid_input'
  | 'authentication_failed'
  | 'permission_denied'
  | 'not_found'
  | 'rate_limited'
  | 'network_error'
  | 'server_error'

export type ToolErrorResult = {
  type: 'error'
  code: ToolErrorCode
  message: string
  retryable: boolean
}

export type GrantedWorkspace = {
  workspaceId: string
  alias: string
  name: string
  role: string
  scopes: string[]
  grantId: string
  expiresAt: string
}

export type AuroraConnectionContext =
  | { kind: 'legacy_workspace'; defaultWorkspaceId: string; workspaces: GrantedWorkspace[] }
  | { kind: 'client'; workspaces: GrantedWorkspace[] }

export type ProjectSectionAvailability =
  | 'available'
  | 'empty'
  | 'encrypted_locked'
  | 'permission_denied'
  | 'not_found'
  | 'unavailable'
  | 'not_indexed'
  | 'unsupported_type'

export type ProjectWorkspaceIdentity = { id: string; name: string }
export type ProjectIdentity = { id: string; workspaceId: string; title: string }
export type ProjectCandidate = ProjectIdentity

export type ProjectTask = {
  id: string
  title: string
  status: string | null
  updatedAt: string
}

export type ProjectCitation = {
  sourceId: string
  title: string | null
  deepLink: string
  updatedAt: string
  availability: ProjectSectionAvailability
}

export type ProjectResumePacket = ProjectIdentity & {
  goal: string | null
  status: string | null
  priority: string | null
  owner: string | null
  progress: number | null
  startDate: string | null
  dueDate: string | null
  brief: { availability: ProjectSectionAvailability; text: string | null }
  tasks: {
    availability: ProjectSectionAvailability
    groups: {
      todo: ProjectTask[]
      in_progress: ProjectTask[]
      blocked: ProjectTask[]
      done: ProjectTask[]
    }
  }
  blockers: string[]
  risks: string[]
  unresolvedDecisions: string[]
  recentActivity: ProjectActivity[]
  nextActions: string[]
  sources: ProjectCitation[]
}

export type ProjectContextResult =
  | { status: 'ambiguous'; workspace: ProjectWorkspaceIdentity; candidates: ProjectCandidate[]; asOf: string }
  | { status: 'not_found'; workspace: ProjectWorkspaceIdentity; asOf: string }
  | { status: 'ok'; workspace: ProjectWorkspaceIdentity; project: ProjectResumePacket; asOf: string; cursor: string | null }

export type ProjectChange = {
  id: string
  type: string
  title: string | null
  updatedAt: string
}

export type ProjectActivity = {
  id: string
  title: string | null
  updatedAt: string
}

export type ProjectChangesResult =
  | { status: 'not_found'; workspace: ProjectWorkspaceIdentity; asOf: string }
  | {
      status: 'ok'
      workspace: ProjectWorkspaceIdentity
      project: ProjectIdentity
      asOf: string
      items: ProjectChange[]
      nextCursor: string | null
      hasMore: boolean
    }
