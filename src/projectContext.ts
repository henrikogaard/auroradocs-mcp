import { getAuroraClient } from './auroraClient.js'
import type {
  ProjectCandidate,
  ProjectActivity,
  ProjectChange,
  ProjectChangesResult,
  ProjectCitation,
  ProjectContextResult,
  ProjectIdentity,
  ProjectResumePacket,
  ProjectSectionAvailability,
  ProjectTask,
  ProjectWorkspaceIdentity,
} from './contracts.js'

const AVAILABILITY = new Set<ProjectSectionAvailability>([
  'available',
  'empty',
  'encrypted_locked',
  'permission_denied',
  'not_found',
  'unavailable',
  'not_indexed',
  'unsupported_type',
])

function invalidResponse(): never {
  throw new Error('Invalid project workflow response')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidResponse()
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return invalidResponse()
  return value.trim()
}

function nullableString(value: unknown): string | null {
  if (value === null) return null
  return string(value)
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= (daysInMonth[month - 1] ?? 0)
}

function timestamp(value: unknown): string {
  const normalized = string(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(normalized)
  if (!match) return invalidResponse()
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (
    !isCalendarDate(year, month, day)
    || hour > 23
    || minute > 59
    || second > 59
  ) return invalidResponse()
  return normalized
}

function nullableDate(value: unknown): string | null {
  if (value === null) return null
  const normalized = string(value)
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!dateOnly) return timestamp(normalized)
  const year = Number(dateOnly[1])
  const month = Number(dateOnly[2])
  const day = Number(dateOnly[3])
  if (!isCalendarDate(year, month, day)) return invalidResponse()
  return normalized
}

function nullableCursor(value: unknown): string | null {
  return value === null ? null : string(value)
}

function availability(value: unknown): ProjectSectionAvailability {
  const normalized = string(value) as ProjectSectionAvailability
  if (!AVAILABILITY.has(normalized)) return invalidResponse()
  return normalized
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return invalidResponse()
  return value.map(string)
}

function workspaceIdentity(value: unknown, expectedWorkspaceId: string): ProjectWorkspaceIdentity {
  const input = record(value)
  const id = string(input['id'])
  if (id !== expectedWorkspaceId) return invalidResponse()
  return { id, name: string(input['name']) }
}

function projectIdentity(value: unknown, expectedWorkspaceId: string, expectedProjectId?: string): ProjectIdentity {
  const input = record(value)
  const id = string(input['id'])
  const workspaceId = string(input['workspaceId'])
  if (workspaceId !== expectedWorkspaceId || (expectedProjectId !== undefined && id !== expectedProjectId)) {
    return invalidResponse()
  }
  return { id, workspaceId, title: string(input['title']) }
}

function projectTask(value: unknown): ProjectTask {
  const input = record(value)
  return {
    id: string(input['id']),
    title: string(input['title']),
    status: nullableString(input['status']),
    updatedAt: timestamp(input['updatedAt']),
  }
}

function projectChange(value: unknown): ProjectChange {
  const input = record(value)
  return {
    id: string(input['id']),
    type: string(input['type']),
    title: nullableString(input['title']),
    updatedAt: timestamp(input['updatedAt']),
  }
}

function projectActivity(value: unknown): ProjectActivity {
  const input = record(value)
  return {
    id: string(input['id']),
    title: nullableString(input['title']),
    updatedAt: timestamp(input['updatedAt']),
  }
}

function deepLink(value: unknown): string {
  const normalized = string(value)
  if (normalized.includes('\\') || /%5c/i.test(normalized)) return invalidResponse()
  if (normalized.startsWith('/') && !normalized.startsWith('//')) return normalized
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    return invalidResponse()
  }
  if (url.protocol !== 'https:' || url.username || url.password) return invalidResponse()
  return normalized
}

function citation(value: unknown): ProjectCitation {
  const input = record(value)
  const sourceId = string(input['sourceId'])
  if (!/^[a-z][a-z0-9_]*:[^\s:][^\s]*$/i.test(sourceId)) return invalidResponse()
  return {
    sourceId,
    title: nullableString(input['title']),
    deepLink: deepLink(input['deepLink']),
    updatedAt: timestamp(input['updatedAt']),
    availability: availability(input['availability']),
  }
}

function array<T>(value: unknown, normalize: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalidResponse()
  return value.map(normalize)
}

function projectResume(
  value: unknown,
  expectedWorkspaceId: string,
  limits: { taskLimit: number; sourceLimit: number },
  expectedProjectId?: string,
): ProjectResumePacket {
  const input = record(value)
  const identity = projectIdentity(input, expectedWorkspaceId, expectedProjectId)
  const brief = record(input['brief'])
  const tasks = record(input['tasks'])
  const groups = record(tasks['groups'])
  const progress = input['progress']
  if (progress !== null && (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 100)) {
    return invalidResponse()
  }
  const normalizedBrief = { availability: availability(brief['availability']), text: nullableString(brief['text']) }
  if ((normalizedBrief.availability === 'available') !== (normalizedBrief.text !== null)) return invalidResponse()
  const normalizedGroups = {
    todo: array(groups['todo'], projectTask),
    in_progress: array(groups['in_progress'], projectTask),
    blocked: array(groups['blocked'], projectTask),
    done: array(groups['done'], projectTask),
  }
  if (Object.values(normalizedGroups).reduce((count, group) => count + group.length, 0) > limits.taskLimit) {
    return invalidResponse()
  }
  const normalizedSources = array(input['sources'], citation)
  if (normalizedSources.length > limits.sourceLimit) return invalidResponse()
  return {
    ...identity,
    goal: nullableString(input['goal']),
    status: nullableString(input['status']),
    priority: nullableString(input['priority']),
    owner: nullableString(input['owner']),
    progress: progress as number | null,
    startDate: nullableDate(input['startDate']),
    dueDate: nullableDate(input['dueDate']),
    brief: normalizedBrief,
    tasks: {
      availability: availability(tasks['availability']),
      groups: normalizedGroups,
    },
    blockers: stringArray(input['blockers']),
    risks: stringArray(input['risks']),
    unresolvedDecisions: stringArray(input['unresolvedDecisions']),
    recentActivity: array(input['recentActivity'], projectActivity),
    nextActions: stringArray(input['nextActions']),
    sources: normalizedSources,
  }
}

function candidate(value: unknown, expectedWorkspaceId: string): ProjectCandidate {
  return projectIdentity(value, expectedWorkspaceId)
}

export function normalizeProjectContextResponse(
  value: unknown,
  expectedWorkspaceId: string,
  limits: { taskLimit: number; sourceLimit: number },
  expectedProjectId?: string,
): ProjectContextResult {
  const input = record(value)
  const status = string(input['status'])
  const workspace = workspaceIdentity(input['workspace'], expectedWorkspaceId)
  const asOf = timestamp(input['asOf'])
  if (status === 'not_found') return { status, workspace, asOf }
  if (status === 'ambiguous') {
    if (expectedProjectId !== undefined) return invalidResponse()
    const candidates = array(input['candidates'], (item) => candidate(item, expectedWorkspaceId))
    if (candidates.length < 2 || candidates.length > 5) return invalidResponse()
    return { status, workspace, candidates, asOf }
  }
  if (status !== 'ok') return invalidResponse()
  return {
    status,
    workspace,
    project: projectResume(input['project'], expectedWorkspaceId, limits, expectedProjectId),
    asOf,
    cursor: nullableCursor(input['cursor']),
  }
}

export function normalizeProjectChangesResponse(
  value: unknown,
  expectedWorkspaceId: string,
  expectedProjectId: string,
  limit: number,
): ProjectChangesResult {
  const input = record(value)
  const status = string(input['status'])
  const workspace = workspaceIdentity(input['workspace'], expectedWorkspaceId)
  const asOf = timestamp(input['asOf'])
  if (status === 'not_found') return { status, workspace, asOf }
  if (status !== 'ok') return invalidResponse()
  if (typeof input['hasMore'] !== 'boolean') return invalidResponse()
  const items = array(input['items'], projectChange)
  if (items.length > limit || items.length > 100) return invalidResponse()
  const nextCursor = nullableCursor(input['nextCursor'])
  if (input['hasMore'] && nextCursor === null) return invalidResponse()
  return {
    status,
    workspace,
    project: projectIdentity(input['project'], expectedWorkspaceId, expectedProjectId),
    asOf,
    items,
    nextCursor,
    hasMore: input['hasMore'],
  }
}

export async function getProjectContext(
  workspaceId: string,
  input: { projectId?: string; query?: string; activityDays: number; taskLimit: number; sourceLimit: number; cursor?: string },
): Promise<ProjectContextResult> {
  const query = new URLSearchParams()
  if (input.projectId !== undefined) query.set('project_id', input.projectId)
  if (input.query !== undefined) query.set('query', input.query)
  query.set('activity_days', String(input.activityDays))
  query.set('task_limit', String(input.taskLimit))
  query.set('source_limit', String(input.sourceLimit))
  if (input.cursor !== undefined) query.set('cursor', input.cursor)
  const response = await getAuroraClient().request<unknown>(
    `/api/mcp/workspaces/${encodeURIComponent(workspaceId)}/projects/context?${query.toString()}`,
    { method: 'GET' },
  )
  return normalizeProjectContextResponse(response, workspaceId, {
    taskLimit: input.taskLimit,
    sourceLimit: input.sourceLimit,
  }, input.projectId)
}

export async function listProjectChanges(
  workspaceId: string,
  input: { projectId: string; cursor: string; limit: number },
): Promise<ProjectChangesResult> {
  const query = new URLSearchParams({ cursor: input.cursor, limit: String(input.limit) })
  const response = await getAuroraClient().request<unknown>(
    `/api/mcp/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(input.projectId)}/changes?${query.toString()}`,
    { method: 'GET' },
  )
  return normalizeProjectChangesResponse(response, workspaceId, input.projectId, input.limit)
}
