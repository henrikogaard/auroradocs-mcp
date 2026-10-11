/**
 * Completing a recurring task creates its next occurrence, the way Aurora does
 * it in `setTaskStatus` → `advanceRecurrenceChain` (auroradocs
 * `packages/core/src/lib/tasks.ts`, #1177):
 *
 * - the next date is the rule's first occurrence after the task's due date
 *   (today when it has none), keeping a due time;
 * - the occurrence's id is derived from the source task and that date, so the
 *   app, other devices and this server all name the same object, and a retry
 *   or a completion the app already handled creates nothing new;
 * - the occurrence gets the source's title, parent and icon, an open status,
 *   the new due date, the rule, and the source's priority, assignees, tags,
 *   description and task list;
 * - the completed task records which occurrence it created (`recurrence_next`)
 *   and loses its rule, so completing it again does not spawn another.
 *
 * An existing occurrence (created elsewhere, edited or deleted since) keeps
 * every value it has; only an unfinished completion has its missing defaults
 * filled in. The marker written here carries no fingerprint, so the app's
 * "undo completion" keeps an occurrence created here instead of removing it.
 */
import { createHash } from 'node:crypto'
import {
  createObject,
  getAuroraClient,
  getObject,
  listProperties,
  type AuroraPropertyRecord,
} from './auroraClient.js'
import { nextOccurrence, parseRRule } from './recurrence.js'
import { isEncryptedMetadataValue, openTaskStatusId, type TaskStatusDefinition } from './taskStatuses.js'

export type RecurrenceAdvance =
  | { kind: 'created'; occurrenceId: string; dueDate: string }
  | { kind: 'existing'; occurrenceId: string; dueDate: string }
  | { kind: 'none' }
  | { kind: 'encrypted' }

/** The id Aurora gives the occurrence that follows `sourceTaskId` on `occurrenceDate` (YYYY-MM-DD). */
export function recurrenceSuccessorId(sourceTaskId: string, occurrenceDate: string): string {
  return createHash('sha256').update(`task-recurrence:v1\n${sourceTaskId}\n${occurrenceDate}`).digest('hex').slice(0, 15)
}

function datePart(value: string | null): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

function timePart(value: string | null): string | null {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/)
  return match ? match[1]! : null
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The next occurrence's date and due value, or null when the rule is unusable or has ended. */
export function nextRecurrenceDue(
  rule: string,
  dueDate: string | null,
  now: Date = new Date(),
): { date: string; dueDate: string } | null {
  const parsed = parseRRule(rule)
  if (!parsed) return null
  const sourceDate = datePart(dueDate)
  const anchor = sourceDate ? new Date(`${sourceDate}T00:00:00`) : now
  const from = sourceDate ? anchor : now
  const next = nextOccurrence(parsed, anchor, from)
  if (!next) return null
  const date = formatDateKey(next)
  const time = timePart(dueDate)
  return { date, dueDate: time ? `${date}T${time}` : date }
}

function parseList(...values: Array<string | null | undefined>): string[] {
  const items: string[] = []
  for (const raw of values) {
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        items.push(...parsed.map((entry) => String(entry).trim()).filter(Boolean))
        continue
      }
    } catch {
      // Comma-separated, as Aurora stores it.
    }
    items.push(...raw.split(',').map((entry) => entry.trim()).filter(Boolean))
  }
  return [...new Set(items)]
}

type PropertyWrite = { key: string; valueType: string; field: 'value_text' | 'value_date'; value: string }

function successorDefaults(props: AuroraPropertyRecord[], status: string, dueDate: string, rule: string): PropertyWrite[] {
  const get = (key: string) => props.find((prop) => prop.key === key)
  const text = (key: string) => {
    const value = get(key)?.value_text
    return typeof value === 'string' && value.trim() ? value : null
  }
  const writes: PropertyWrite[] = [
    { key: 'status', valueType: 'select', field: 'value_text', value: status },
    { key: 'due_date', valueType: 'date', field: 'value_date', value: dueDate },
    { key: 'recurrence', valueType: 'text', field: 'value_text', value: rule },
  ]
  const priority = text('priority')
  if (priority) writes.push({ key: 'priority', valueType: 'select', field: 'value_text', value: priority })
  // Like the app, only the current `assignee` is carried over; see `taskAssignees`.
  const assignees = parseList(get('assignee')?.value_text)
  if (assignees.length) writes.push({ key: 'assignee', valueType: 'text', field: 'value_text', value: assignees.join(',') })
  const tags = parseList(get('tags')?.value_text, get('labels')?.value_text)
  if (tags.length) writes.push({ key: 'tags', valueType: 'text', field: 'value_text', value: tags.join(',') })
  const description = text('description')
  if (description) writes.push({ key: 'description', valueType: 'text', field: 'value_text', value: description })
  const taskListId = get('task_list_id')?.value_text ?? get('task_list_id')?.value_ref ?? null
  if (taskListId) writes.push({ key: 'task_list_id', valueType: 'text', field: 'value_text', value: taskListId })
  return writes
}

/** Whether the source's `recurrence_next` marker already records this occurrence. */
function markerNames(props: AuroraPropertyRecord[], successorId: string): boolean {
  const raw = props.find((prop) => prop.key === 'recurrence_next')?.value_text
  if (!raw) return false
  try {
    return (JSON.parse(raw) as { id?: unknown }).id === successorId
  } catch {
    return false
  }
}

async function writeProperty(
  objectId: string,
  existing: AuroraPropertyRecord | undefined,
  write: { key: string; valueType: string; field: string; value: string | null },
): Promise<void> {
  const collection = getAuroraClient().collection('object_properties')
  const body = {
    value_type: write.valueType,
    value_text: null,
    value_num: null,
    value_date: null,
    value_bool: null,
    value_ref: null,
    ...(write.value === null ? {} : { [write.field]: write.value }),
  }
  if (existing) await collection.update(existing.id, body)
  else if (write.value !== null) await collection.create({ object_id: objectId, key: write.key, ...body })
}

/**
 * Create the next occurrence of a task that was just moved into a done status.
 * Returns `none` for a task without a usable rule and `encrypted` when its
 * values are end-to-end encrypted and cannot be read here.
 */
export async function advanceRecurrenceChain(
  workspaceId: string,
  sourceTaskId: string,
  statuses: readonly TaskStatusDefinition[],
  now: Date = new Date(),
): Promise<RecurrenceAdvance> {
  const source = await getObject(sourceTaskId, workspaceId)
  if (!source || source.type !== 'task') return { kind: 'none' }
  const props = (await listProperties([sourceTaskId], workspaceId, { maxPages: 100 }))
    .filter((prop) => prop.object_id === sourceTaskId)
  const ruleProp = props.find((prop) => prop.key === 'recurrence')
  const rawRule = ruleProp?.value_text?.trim() ?? ''
  if (!rawRule) return { kind: 'none' }
  if (isEncryptedMetadataValue(rawRule) || isEncryptedMetadataValue(source.title)) return { kind: 'encrypted' }
  const dueProp = props.find((prop) => prop.key === 'due_date')
  const next = nextRecurrenceDue(rawRule, dueProp?.value_date ?? dueProp?.value_text ?? null, now)
  if (!next) return { kind: 'none' }

  const successorId = recurrenceSuccessorId(sourceTaskId, next.date)
  // AuroraCloud turns a create of an existing id into an update, so the
  // occurrence is looked up first: whatever exists (created by the app or an
  // earlier call, edited or deleted since) is left as it is.
  const existing = await getObject(successorId, workspaceId)
  let kind: 'created' | 'existing' = 'existing'
  if (!existing) {
    await createObject(workspaceId, 'task', source.title ?? '', {
      id: successorId,
      icon: source.icon,
      parentId: source.parent_id,
    })
    kind = 'created'
  }
  // A brand-new occurrence gets every default. An existing one is only filled
  // in while this completion is unfinished: the source still has its rule and
  // no marker naming the occurrence, so an earlier attempt (here or in the app)
  // stopped part-way. Then only the defaults it lacks are written, and nothing
  // already set, by whoever set it, is overwritten. A deleted occurrence, or one
  // whose completion was recorded, is left alone.
  const defaults = successorDefaults(props, openTaskStatusId(statuses), next.dueDate, rawRule)
  if (!existing) {
    for (const write of defaults) await writeProperty(successorId, undefined, write)
  } else if (!existing.is_deleted && !markerNames(props, successorId)) {
    const present = new Set((await listProperties([successorId], workspaceId, { maxPages: 100 }))
      .filter((prop) => prop.object_id === successorId)
      .map((prop) => prop.key))
    for (const write of defaults) {
      if (!present.has(write.key)) await writeProperty(successorId, undefined, write)
    }
  }

  // A marker that already names this occurrence (the app's, with its
  // fingerprint for undo) is kept as it is.
  if (!markerNames(props, successorId)) {
    const marker = JSON.stringify({ id: successorId, date: next.date, rule: rawRule, fp: null, state: 'live' })
    await writeProperty(sourceTaskId, props.find((prop) => prop.key === 'recurrence_next'), {
      key: 'recurrence_next', valueType: 'text', field: 'value_text', value: marker,
    })
  }
  // Strip the rule from the completed task so completing it again can't re-fire.
  await writeProperty(sourceTaskId, ruleProp, { key: 'recurrence', valueType: 'text', field: 'value_text', value: null })
  return { kind, occurrenceId: successorId, dueDate: next.dueDate }
}
