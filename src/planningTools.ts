export type McpPlanningTask = {
  id: string
  title: string | null
  status: string | null
  due_date: string | null
  updated_at: string | null
  labels: string[]
}

export type BuildWeekPlanInput = {
  anchorDate: string
  includeUnscheduled: boolean
  unscheduledLimit: number
}

export type McpWeekPlanTask = McpPlanningTask & {
  timeBlock: {
    isTimeBlock: boolean
    durationMinutes: number | null
  }
}

export type McpWeekPlan = {
  type: 'week_plan'
  range: { start: string; end: string }
  days: Array<{ date: string; tasks: McpWeekPlanTask[] }>
  unscheduled: McpWeekPlanTask[]
}

export type McpCanvasObject = {
  id: string
  title: string | null
  type: string
}

export type McpCanvasCard = {
  id: string
  type: string
  x: number | null
  y: number | null
  width: number | null
  height: number | null
  text: string | null
  color: string | null
  objectId: string | null
  objectTitle: string | null
}

export type McpCanvasEdge = {
  id: string
  fromCard: string | null
  toCard: string | null
  fromSide: string | null
  toSide: string | null
  label: string | null
  color: string | null
  style: string | null
  arrow: string | null
  arrowMode: string | null
  strokeWidth: number | null
}

export type McpCanvasReadResult = {
  type: 'canvas'
  canvas: { id: string; title: string | null }
  cards: McpCanvasCard[]
  edges: McpCanvasEdge[]
  frames: Array<Record<string, unknown>>
  warnings: string[]
}

export function buildWeekPlan(tasks: McpPlanningTask[], input: BuildWeekPlanInput): McpWeekPlan {
  const days = getWeekPlanningDays(input.anchorDate)
  const buckets = getWeekPlanningTaskBuckets(tasks, days)

  return {
    type: 'week_plan',
    range: getWeekPlanningRange(input.anchorDate),
    days: days.map((date) => ({
      date,
      tasks: (buckets[date] ?? []).map(toWeekPlanTask),
    })),
    unscheduled: input.includeUnscheduled
      ? getUnscheduledWeekPlanningTasks(tasks).slice(0, clampLimit(input.unscheduledLimit)).map(toWeekPlanTask)
      : [],
  }
}

export function normalizeCanvasContent(
  object: McpCanvasObject,
  contentJson: unknown,
  options: { includeText?: boolean } = {},
): McpCanvasReadResult {
  const includeText = options.includeText !== false
  const content = isRecord(contentJson) ? contentJson : {}
  const cardsRaw = Array.isArray(content['cards']) ? content['cards'] : []
  const edgesRaw = Array.isArray(content['edges']) ? content['edges'] : []
  const framesRaw = Array.isArray(content['frames']) ? content['frames'] : []
  const warnings: string[] = []

  if (!Array.isArray(content['cards'])) warnings.push('Canvas content did not include a cards array.')
  if (!Array.isArray(content['edges'])) warnings.push('Canvas content did not include an edges array.')

  return {
    type: 'canvas',
    canvas: { id: object.id, title: object.title },
    cards: cardsRaw.filter(isRecord).map((card) => ({
      id: readString(card['id']) ?? '(missing-id)',
      type: readString(card['type']) ?? 'unknown',
      x: readNumber(card['x']),
      y: readNumber(card['y']),
      width: readNumber(card['w']),
      height: readNumber(card['h']),
      text: includeText ? readString(card['text']) : null,
      color: readString(card['color']),
      objectId: readString(card['objectId']),
      objectTitle: readString(card['objectTitle']),
    })),
    edges: edgesRaw.filter(isRecord).map((edge) => ({
      id: readString(edge['id']) ?? '(missing-id)',
      fromCard: readString(edge['fromCard']),
      toCard: readString(edge['toCard']),
      fromSide: readString(edge['fromSide']),
      toSide: readString(edge['toSide']),
      label: readString(edge['label']),
      color: readString(edge['color']),
      style: readString(edge['style']),
      arrow: readString(edge['arrow']),
      arrowMode: readString(edge['arrowMode']),
      strokeWidth: readNumber(edge['strokeWidth']),
    })),
    frames: framesRaw.filter(isRecord),
    warnings,
  }
}

function toWeekPlanTask(task: McpPlanningTask): McpWeekPlanTask {
  return {
    ...task,
    timeBlock: parseWeekPlanningTimeBlock(task),
  }
}

function clampLimit(value: number): number {
  return Math.max(0, Math.min(50, Number.isFinite(value) ? Math.round(value) : 12))
}

function getWeekPlanningRange(anchorDateKey: string): { start: string; end: string } {
  const start = getWeekPlanningStart(anchorDateKey)
  return {
    start,
    end: addDaysToDateKey(start, 6),
  }
}

function getWeekPlanningDays(anchorDateKey: string): string[] {
  const start = getWeekPlanningStart(anchorDateKey)
  return Array.from({ length: 7 }, (_, index) => addDaysToDateKey(start, index))
}

function getWeekPlanningStart(anchorDateKey: string): string {
  const day = parseDateKey(anchorDateKey).getDay()
  const offsetToMonday = day === 0 ? -6 : 1 - day
  return addDaysToDateKey(anchorDateKey, offsetToMonday)
}

function getWeekPlanningTaskBuckets<T extends McpPlanningTask>(
  tasks: T[],
  days: string[],
): Record<string, T[]> {
  const daySet = new Set(days)
  const buckets = Object.fromEntries(days.map((day) => [day, [] as T[]])) as Record<string, T[]>

  for (const task of tasks) {
    if (isDoneTask(task)) continue
    const day = task.due_date?.slice(0, 10)
    if (!day || !daySet.has(day)) continue
    buckets[day].push(task)
  }

  for (const day of days) {
    buckets[day].sort(compareWeekPlanningTasks)
  }

  return buckets
}

function getUnscheduledWeekPlanningTasks<T extends McpPlanningTask>(tasks: T[]): T[] {
  return tasks
    .filter((task) => !isDoneTask(task) && !task.due_date)
    .sort(compareWeekPlanningTasks)
}

function parseWeekPlanningTimeBlock(task: McpPlanningTask): {
  isTimeBlock: boolean
  durationMinutes: number | null
} {
  const labels = task.labels ?? []
  if (!labels.includes('time-block')) return { isTimeBlock: false, durationMinutes: null }

  const durationLabel = labels.find((label) => /^duration:\d+m$/.test(label))
  const durationMinutes = durationLabel ? Number(durationLabel.match(/^duration:(\d+)m$/)?.[1] ?? '') : NaN

  return {
    isTimeBlock: true,
    durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map((part) => Number(part))
  return new Date(year, month - 1, day)
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isDoneTask(task: McpPlanningTask): boolean {
  return task.status === 'Done'
}

function compareWeekPlanningTasks(a: McpPlanningTask, b: McpPlanningTask): number {
  const aTime = taskTime(a.due_date)
  const bTime = taskTime(b.due_date)
  if (aTime && bTime && aTime !== bTime) return aTime.localeCompare(bTime)
  if (aTime && !bTime) return -1
  if (!aTime && bTime) return 1

  const aTitle = a.title?.trim() || a.id
  const bTitle = b.title?.trim() || b.id
  return aTitle.localeCompare(bTitle)
}

function taskTime(dueDate?: string | null): string | null {
  const match = dueDate?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/)
  return match?.[1] ?? null
}
