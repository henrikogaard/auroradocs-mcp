// Vendored verbatim from Ogard-Labs/auroradocs packages/core/src/lib/recurrence.ts (main @ 47f0280).
// Keep in step with that file: the MCP must step a series exactly like the app.

/**
 * recurrence.ts — minimal RFC 5545 RRULE handling for Aurora tasks.
 *
 * Stored format: a plain RRULE string (without the leading `RRULE:` prefix), e.g.
 *   FREQ=DAILY
 *   FREQ=WEEKLY;BYDAY=MO,WE,FR
 *   FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=20270101T000000Z
 *
 * Subset supported in v1 (the patterns the editor exposes plus the most common
 * inputs the user can paste in via the Custom… field):
 *   FREQ        DAILY | WEEKLY | MONTHLY | YEARLY
 *   INTERVAL    positive integer (default 1)
 *   BYDAY       MO,TU,WE,TH,FR,SA,SU (any subset; only meaningful with WEEKLY)
 *   BYMONTHDAY  1..31 (only meaningful with MONTHLY/YEARLY)
 *   BYMONTH     1..12 (only meaningful with YEARLY)
 *   WKST        MO..SU — the day weeks begin on, which decides where a weekly
 *               INTERVAL's boundaries fall (default MO, as in the RFC)
 *   UNTIL       YYYYMMDD or YYYYMMDDTHHMMSSZ
 *   COUNT       not yet supported in v1 (concrete-chain model can't easily
 *               track how many occurrences a chain has produced); parsed and
 *               preserved in round-trips, but the chain ignores it. The editor
 *               doesn't surface it.
 *
 * Anything outside this subset (BYHOUR, BYMINUTE, BYSETPOS, BYWEEKNO, etc.) is
 * preserved as-is in the string but ignored by `nextOccurrence` / `matches`.
 *
 * The library is date-only — every input is treated as midnight in the local
 * time zone, and every output date is normalised to the same. Tasks store
 * `due_date` as `YYYY-MM-DD[THH:MM]`; recurrence operates on the date part.
 */

export type RRuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export type RRuleWeekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

export type ParsedRRule = {
  freq: RRuleFreq
  interval: number
  byDay?: RRuleWeekday[]
  byMonthDay?: number[]
  byMonth?: number[]
  until?: Date
  /**
   * The calendar day the limit names, as `YYYY-MM-DD`, read from the value's own
   * digits. `until` is a moment, and a `...T000000Z` limit read in a zone behind
   * UTC falls on the day before the one written — so a caller whose dates must
   * mean the same thing on every device reads the day from here instead.
   */
  untilDay?: string
  count?: number
  /**
   * The day weeks begin on, for a weekly INTERVAL. Absent means the RFC's own
   * default, Monday. Parsed rather than kept in `unknown` because this module
   * implements its meaning: left unknown, a caller that refuses what it cannot
   * act on would refuse a rule it does in fact honour.
   */
  weekStart?: RRuleWeekday
  /** Anything not understood is kept verbatim so round-trips don't lose data. */
  unknown: Record<string, string>
}

const VALID_FREQS: RRuleFreq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
const VALID_WEEKDAYS: RRuleWeekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
// Sunday = 0 in JS Date.getDay(). Map to/from RRULE weekday names.
const JS_WEEKDAY_TO_RRULE: Record<number, RRuleWeekday> = {
  0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA',
}
const RRULE_WEEKDAY_TO_JS: Record<RRuleWeekday, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
}

/**
 * Whether the date came back as the calendar date that was written.
 *
 * `new Date(2026, 1, 31)` is March 3rd, not an error, so an impossible date such
 * as `UNTIL=20260231` would be accepted and then saved back as the normalised
 * one — silently running a schedule past the end date its owner typed. The parse
 * is only accepted when the fields round-trip.
 */
function isCalendarDate(date: Date, year: number, month: number, day: number): boolean {
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function parseUntil(value: string): { at: Date; day: string } | undefined {
  // Accept YYYYMMDD or YYYYMMDDTHHMMSSZ.
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    const parsed = new Date(Number(y), Number(m) - 1, Number(d))
    if (!isCalendarDate(parsed, Number(y), Number(m), Number(d))) return undefined
    return { at: parsed, day: `${y}-${m}-${d}` }
  }
  const dateTime = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/)
  if (dateTime) {
    const [, y, m, d, hh, mm, ss] = dateTime
    // The time fields need their own check, not just the calendar ones. An
    // impossible minute or second — `T126000Z`, `T120060Z` — rolls forward into
    // the next hour or minute and leaves the date alone, so the round-trip below
    // would accept it and the picker would save back a different time than was
    // typed. Ranges rather than a round-trip, because 24:00:00 normalises to the
    // next day and would be caught either way, while 12:60:00 would not.
    if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return undefined
    // The day the value names, at local midnight, like every other date this module
    // handles. Read as the moment it literally is, a `...T000000Z` limit falls on the
    // day before in any zone behind UTC, so the last day of a schedule depended on
    // the device — and an occurrence a schedule has already built cannot be taken
    // back. The time of day is dropped because nothing here acts on it: every
    // comparison is between days.
    const parsed = new Date(Number(y), Number(m) - 1, Number(d))
    if (!isCalendarDate(parsed, Number(y), Number(m), Number(d))) return undefined
    return { at: parsed, day: `${y}-${m}-${d}` }
  }
  return undefined
}

/**
 * The day a limit names, in the date-only form, for a rule built in code rather
 * than parsed.
 *
 * Written from the value's own day rather than from its UTC fields. A limit read
 * as a moment and written back with `getUTC*` comes out as the day before in any
 * zone ahead of UTC, so saving a rule the picker had merely carried through moved
 * the end of the schedule — and reading it back moved it again on the next device.
 * The date-only form says the one thing this module means by a limit. A parsed rule
 * carries the digits it was written with, and those are used in preference to this,
 * since reading a day off an instant answers for the zone doing the reading.
 */
function formatUntil(date: Date): string {
  const y = date.getFullYear().toString().padStart(4, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return `${y}${m}${d}`
}

export function parseRRule(input: string | null | undefined): ParsedRRule | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  // Tolerate a leading `RRULE:` prefix even though we don't store it.
  const body = trimmed.replace(/^RRULE:/i, '').trim()
  if (!body) return null

  const out: ParsedRRule = { freq: 'DAILY', interval: 1, unknown: {} }
  let sawFreq = false

  for (const part of body.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).toUpperCase().trim()
    const raw = part.slice(eq + 1).trim()
    if (!key || !raw) continue

    switch (key) {
      case 'FREQ': {
        const freq = raw.toUpperCase() as RRuleFreq
        if (!VALID_FREQS.includes(freq)) return null
        out.freq = freq
        sawFreq = true
        break
      }
      case 'INTERVAL': {
        const n = Number.parseInt(raw, 10)
        if (Number.isFinite(n) && n > 0) out.interval = n
        break
      }
      case 'BYDAY': {
        const days = raw.split(',').map((d) => d.toUpperCase().trim()).filter((d) => VALID_WEEKDAYS.includes(d as RRuleWeekday)) as RRuleWeekday[]
        if (days.length) out.byDay = days
        break
      }
      case 'BYMONTHDAY': {
        const days = raw.split(',').map((d) => Number.parseInt(d, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 31)
        if (days.length) out.byMonthDay = days
        break
      }
      case 'BYMONTH': {
        const months = raw.split(',').map((m) => Number.parseInt(m, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 12)
        if (months.length) out.byMonth = months
        break
      }
      case 'UNTIL': {
        const until = parseUntil(raw.toUpperCase())
        if (until) {
          out.until = until.at
          out.untilDay = until.day
        }
        break
      }
      case 'COUNT': {
        const n = Number.parseInt(raw, 10)
        if (Number.isFinite(n) && n > 0) out.count = n
        break
      }
      case 'WKST': {
        const day = raw.toUpperCase() as RRuleWeekday
        if (VALID_WEEKDAYS.includes(day)) out.weekStart = day
        break
      }
      default: {
        out.unknown[key] = raw
        break
      }
    }
  }

  if (!sawFreq) return null
  return out
}

/**
 * Recognised keys in `input` whose value the parser threw away.
 *
 * `parseRRule` is deliberately forgiving: it keeps what it understands and
 * drops the rest, so `FREQ=DAILY;UNTIL=bogus` parses to a plain daily rule. For
 * a task the user advances by hand that is harmless, but a caller that acts on
 * the rule on its own needs to know the user asked for something that is no
 * longer in the rule — an ignored `UNTIL` means a schedule that never ends.
 *
 * A key is reported when any of its comma-separated values was dropped, an
 * empty value included. Keys the parser does not recognise at all are not
 * reported here: those survive in `unknown`, and it is up to the caller whether
 * it can honour them.
 */
export function rejectedRuleValues(input: string | null | undefined): string[] {
  if (!input) return []
  const body = input.trim().replace(/^RRULE:/i, '').trim()
  const rejected: string[] = []
  for (const part of body.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) {
      // A segment with no `=` at all. `parseRRule` skips it, so `FREQ=DAILY;UNTIL`
      // parses as a schedule that never ends — the same outcome as `UNTIL=bogus`,
      // reached one character earlier. An empty segment is not one of these: a
      // trailing or doubled `;` is punctuation, not a dropped value.
      const bare = part.trim().toUpperCase()
      if (bare) rejected.push(bare)
      continue
    }
    const key = part.slice(0, eq).toUpperCase().trim()
    const raw = part.slice(eq + 1).trim()
    // A segment that is all value and no key, such as `;=DAILY`, is dropped by
    // the parser too and is reported under the whole segment.
    if (!key) {
      rejected.push(part.trim().toUpperCase())
      continue
    }
    // An empty value is reported like any other the parser cannot use: `UNTIL=`
    // would otherwise vanish in silence and leave a schedule that never ends.
    if (!keptWholly(key, raw)) rejected.push(key)
  }
  return [...new Set(rejected)].sort()
}

/**
 * Whether a whole number stands alone in `raw`.
 *
 * `Number.parseInt` takes the numeric prefix and ignores the rest, so it reads
 * `2oops` as 2 and `10x` as 10. The parser does the same and would store a rule
 * the user did not type, so anything with more than a number in it counts as a
 * value that was not kept.
 */
function wholeNumber(raw: string, min: number, max: number): boolean {
  const value = raw.trim()
  if (!/^\d+$/.test(value)) return false
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= min && n <= max
}

/** Mirrors the per-key acceptance rules in `parseRRule`. */
function keptWholly(key: string, raw: string): boolean {
  // `parseRRule` skips any segment with an empty value, recognised or not, so an
  // empty value is never kept whatever the key. The default branch below would
  // otherwise report an unknown modifier such as `BYHOUR=` as preserved, when in
  // fact it never reaches `unknown` and the rule serialises without it.
  if (!raw.trim()) return false
  const items = () => raw.split(',').map((value) => value.trim())
  switch (key) {
    case 'INTERVAL':
      return wholeNumber(raw, 1, Number.MAX_SAFE_INTEGER)
    case 'COUNT':
      return wholeNumber(raw, 1, Number.MAX_SAFE_INTEGER)
    case 'BYDAY':
      return items().every((day) => VALID_WEEKDAYS.includes(day.toUpperCase() as RRuleWeekday))
    case 'BYMONTHDAY':
      return items().every((day) => wholeNumber(day, 1, 31))
    case 'BYMONTH':
      return items().every((month) => wholeNumber(month, 1, 12))
    case 'UNTIL':
      return parseUntil(raw.toUpperCase()) !== undefined
    case 'WKST':
      return VALID_WEEKDAYS.includes(raw.trim().toUpperCase() as RRuleWeekday)
    default:
      // FREQ makes `parseRRule` fail outright, and an unrecognised key is kept
      // verbatim rather than dropped.
      return true
  }
}

export function serializeRRule(rule: ParsedRRule): string {
  const parts: string[] = [`FREQ=${rule.freq}`]
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(',')}`)
  if (rule.byMonthDay?.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`)
  if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(',')}`)
  // Written back only when the rule named one. Emitting the default would put a
  // modifier into every weekly rule the picker builds, which round-trips as a
  // change the user did not make.
  if (rule.weekStart) parts.push(`WKST=${rule.weekStart}`)
  // The day as the value itself recorded it, when it has one. `until` is an instant,
  // so reading its day back depends on the zone doing the reading — and a picker can
  // outlive a zone change, the device having travelled between parsing a rule and
  // saving an edit to it, which would move the end of the schedule by a day.
  const until = rule.untilDay?.replace(/-/g, '') ?? (rule.until ? formatUntil(rule.until) : null)
  if (until) parts.push(`UNTIL=${until}`)
  if (rule.count != null) parts.push(`COUNT=${rule.count}`)
  for (const [k, v] of Object.entries(rule.unknown)) parts.push(`${k}=${v}`)
  return parts.join(';')
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date)
  // Preserve the day-of-month if possible. JS Date naturally clamps Feb 31 →
  // March 3, which produces ugly drift for monthly recurrences. We clamp to
  // the last day of the target month instead so "monthly on the 31st" stays
  // anchored to the end-of-month rather than walking forward.
  const desiredDay = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const lastDayInTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(desiredDay, lastDayInTargetMonth))
  return d
}

function addYears(date: Date, n: number): Date {
  return addMonths(date, n * 12)
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isAfter(a: Date, b: Date): boolean {
  return a.getTime() > b.getTime()
}

function isBefore(a: Date, b: Date): boolean {
  return a.getTime() < b.getTime()
}

/**
 * Whole calendar days between two local midnights. Rounding matters: a day that
 * crosses a daylight-saving boundary is 23 or 25 hours long, so dividing
 * elapsed milliseconds without rounding puts the candidate in the wrong day —
 * and, once divided again by seven, the wrong week.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000))
}

/**
 * The rule's week-start day: `WKST` when it carries one, Monday otherwise, as
 * RFC 5545 specifies.
 */
function weekStartOf(rule: ParsedRRule): RRuleWeekday {
  return rule.weekStart ?? 'MO'
}

/**
 * The first day of the calendar week containing `date`.
 *
 * A weekly INTERVAL counts calendar weeks, not seven-day blocks measured from
 * the start date: RFC 5545 says an interval of 2 means every other week, and a
 * week is bounded by `WKST`. Counting from the anchor instead puts a rule whose
 * `BYDAY` falls before the anchor's own weekday a whole week out of phase —
 * fortnightly on Mondays, started on a Wednesday, would fire on the Monday five
 * days later rather than the one twelve days later, and stay wrong for good.
 */
function startOfRRuleWeek(date: Date, weekStart: RRuleWeekday): Date {
  const day = startOfDay(date)
  const back = ((day.getDay() - RRULE_WEEKDAY_TO_JS[weekStart]) + 7) % 7
  return addDays(day, -back)
}

/**
 * True if `candidate` is a valid occurrence date for the given anchor + rule.
 * Used by the calendar / daily-notes view to decide whether to render a
 * virtual occurrence on a given date.
 */
export function matches(rule: ParsedRRule, anchor: Date, candidate: Date): boolean {
  const a = startOfDay(anchor)
  const c = startOfDay(candidate)
  if (isBefore(c, a)) return false
  if (rule.until && isAfter(c, startOfDay(rule.until))) return false

  switch (rule.freq) {
    case 'DAILY': {
      return calendarDaysBetween(a, c) % rule.interval === 0
    }
    case 'WEEKLY': {
      // Anchor week is week 0; rule.interval=2 → every other week.
      // If BYDAY is set, only the listed weekdays in qualifying weeks count.
      // If BYDAY is unset, the only matching weekday is the anchor's own.
      // Whole calendar weeks between the week the anchor falls in and the week
      // the candidate falls in — not days since the anchor divided by seven. See
      // `startOfRRuleWeek`.
      const weekStart = weekStartOf(rule)
      const weekDelta = Math.round(
        calendarDaysBetween(startOfRRuleWeek(a, weekStart), startOfRRuleWeek(c, weekStart)) / 7,
      )
      if (weekDelta < 0) return false
      if (weekDelta % rule.interval !== 0) return false
      const candidateDow = JS_WEEKDAY_TO_RRULE[c.getDay()]
      const anchorDow = JS_WEEKDAY_TO_RRULE[a.getDay()]
      const validDays = rule.byDay?.length ? rule.byDay : [anchorDow]
      return validDays.includes(candidateDow)
    }
    case 'MONTHLY': {
      const monthsDiff = (c.getFullYear() - a.getFullYear()) * 12 + (c.getMonth() - a.getMonth())
      if (monthsDiff < 0 || monthsDiff % rule.interval !== 0) return false
      const validDays = rule.byMonthDay?.length ? rule.byMonthDay : [a.getDate()]
      return validDays.includes(c.getDate())
    }
    case 'YEARLY': {
      const yearsDiff = c.getFullYear() - a.getFullYear()
      if (yearsDiff < 0 || yearsDiff % rule.interval !== 0) return false
      const validMonths = rule.byMonth?.length ? rule.byMonth : [a.getMonth() + 1]
      if (!validMonths.includes(c.getMonth() + 1)) return false
      const validDays = rule.byMonthDay?.length ? rule.byMonthDay : [a.getDate()]
      return validDays.includes(c.getDate())
    }
    default:
      return false
  }
}

/**
 * Compute the first occurrence strictly after `from`, given the rule and an
 * anchor date (typically the current task's due date). Returns null if the
 * rule has terminated (UNTIL exhausted) or could not be parsed/extended.
 *
 * The algorithm walks forward day-by-day for DAILY/WEEKLY (cheap) and uses a
 * step-and-check loop for MONTHLY/YEARLY (cheap because the search space is
 * small — at most ~31 candidate days per step). A 5-year hard cap prevents
 * runaway loops on pathological rules (e.g. WEEKLY with BYDAY listing weekdays
 * that cannot satisfy INTERVAL=2 within a useful horizon).
 */
export function nextOccurrence(rule: ParsedRRule, anchor: Date, from: Date): Date | null {
  const start = startOfDay(from)
  const a = startOfDay(anchor)
  const HARD_CAP_DAYS = 365 * 5

  switch (rule.freq) {
    case 'DAILY': {
      // The matching dates are anchor + k * interval (k ≥ 0). Compute the
      // smallest such date strictly after `from` directly instead of walking
      // day-by-day — for INTERVAL=7 the walk previously did 6 wasted matches
      // per real one.
      const oneDayMs = 24 * 3600 * 1000
      const daysFromAnchor = Math.floor((start.getTime() - a.getTime()) / oneDayMs)
      const stepsBefore = Math.max(0, Math.floor(daysFromAnchor / rule.interval))
      const candidate = addDays(a, (stepsBefore + 1) * rule.interval)
      if (rule.until && isAfter(startOfDay(candidate), startOfDay(rule.until))) return null
      return candidate
    }
    case 'WEEKLY': {
      // BYDAY (or anchor's weekday if unset) lets multiple days match per
      // valid week, so we still walk day-by-day, but we fast-forward across
      // any days that fall in non-matching weeks (week-delta % interval ≠ 0)
      // by jumping to the start of the next matching week. INTERVAL=1 with
      // BYDAY=MO,WE,FR walks at most 6 days per match; INTERVAL=2 used to
      // walk 7 wasted days per matching week, now it skips them.
      const weekStart = weekStartOf(rule)
      const anchorWeek = startOfRRuleWeek(a, weekStart)
      let candidate = addDays(start, 1)
      for (let i = 0; i < HARD_CAP_DAYS; i++) {
        if (rule.until && isAfter(startOfDay(candidate), startOfDay(rule.until))) return null
        if (matches(rule, a, candidate)) return candidate
        if (rule.interval > 1) {
          // Measured and skipped in the same calendar weeks `matches` judges by,
          // or the fast-forward would land on a week it then rejects and walk the
          // whole horizon a day at a time.
          const weekDelta = Math.round(
            calendarDaysBetween(anchorWeek, startOfRRuleWeek(candidate, weekStart)) / 7,
          )
          if (weekDelta % rule.interval !== 0) {
            const weeksToSkip = rule.interval - (((weekDelta % rule.interval) + rule.interval) % rule.interval)
            // The first day of the next matching week, which is always forward of
            // `candidate`: the week's own start is at most six days behind it.
            candidate = addDays(startOfRRuleWeek(candidate, weekStart), weeksToSkip * 7)
            continue
          }
        }
        candidate = addDays(candidate, 1)
      }
      return null
    }
    case 'MONTHLY': {
      // Walk month-by-month from the anchor, generating candidate days from
      // BYMONTHDAY (or [anchor.getDate()] if unset). The first candidate
      // strictly after `from` and within the rule's UNTIL is the answer.
      const validDays = rule.byMonthDay?.length ? rule.byMonthDay : [a.getDate()]
      const startMonths = (start.getFullYear() - a.getFullYear()) * 12 + (start.getMonth() - a.getMonth())
      const firstAlignedMonth = startMonths - (((startMonths % rule.interval) + rule.interval) % rule.interval)
      for (let step = Math.max(0, firstAlignedMonth); step < HARD_CAP_DAYS / 28; step += rule.interval) {
        const monthDate = addMonths(a, step)
        const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
        for (const day of validDays.slice().sort((x, y) => x - y)) {
          const safeDay = Math.min(day, lastDay)
          const candidate = new Date(monthDate.getFullYear(), monthDate.getMonth(), safeDay)
          if (rule.until && isAfter(startOfDay(candidate), startOfDay(rule.until))) return null
          if (isAfter(candidate, start)) return candidate
        }
      }
      return null
    }
    case 'YEARLY': {
      const validMonths = rule.byMonth?.length ? rule.byMonth : [a.getMonth() + 1]
      const validDays = rule.byMonthDay?.length ? rule.byMonthDay : [a.getDate()]
      const startYears = start.getFullYear() - a.getFullYear()
      const firstAlignedYear = startYears - (((startYears % rule.interval) + rule.interval) % rule.interval)
      for (let step = Math.max(0, firstAlignedYear); step < 50; step += rule.interval) {
        const yearDate = addYears(a, step)
        for (const month of validMonths.slice().sort((x, y) => x - y)) {
          const lastDay = new Date(yearDate.getFullYear(), month, 0).getDate()
          for (const day of validDays.slice().sort((x, y) => x - y)) {
            const safeDay = Math.min(day, lastDay)
            const candidate = new Date(yearDate.getFullYear(), month - 1, safeDay)
            if (rule.until && isAfter(startOfDay(candidate), startOfDay(rule.until))) return null
            if (isAfter(candidate, start)) return candidate
          }
        }
      }
      return null
    }
    default:
      return null
  }
}

/**
 * Iterate every occurrence strictly within `[rangeStart, rangeEnd]` (both
 * inclusive). Used by the calendar view to render virtual occurrences for
 * the visible month or week.
 */
export function* expandOccurrences(
  rule: ParsedRRule,
  anchor: Date,
  rangeStart: Date,
  rangeEnd: Date,
): Generator<Date> {
  const limit = startOfDay(rangeEnd)
  let cursor = startOfDay(rangeStart)
  // Walk the range inclusively. We also check the anchor itself in case the
  // range starts on or before the anchor.
  if (sameDay(cursor, startOfDay(anchor)) || isAfter(cursor, startOfDay(anchor))) {
    if (matches(rule, anchor, cursor)) yield cursor
  }
  for (let i = 0; i < 366 * 5 && !isAfter(cursor, limit); i++) {
    const next = addDays(cursor, 1)
    if (isAfter(next, limit)) return
    if (matches(rule, anchor, next)) yield next
    cursor = next
  }
}

/** Convert a JS Date weekday (0..6, Sun=0) to RRULE BYDAY token. */
export function jsDayToRRuleWeekday(jsDay: number): RRuleWeekday {
  return JS_WEEKDAY_TO_RRULE[jsDay] ?? 'MO'
}

/** Convert an RRULE BYDAY token to a JS Date weekday (0..6, Sun=0). */
export function rruleWeekdayToJsDay(weekday: RRuleWeekday): number {
  return RRULE_WEEKDAY_TO_JS[weekday] ?? 1
}

/**
 * True if a task's recurrence rule produces an occurrence on the given
 * `YYYY-MM-DD` date (or if the task's actual `due_date` falls on that date).
 * The thin wrapper exists so calendar and daily-notes code can ask the
 * question once instead of repeating the parse + match dance at every
 * filter callsite.
 */
export function taskOccursOnDate(
  task: { due_date: string | null; recurrence: string | null },
  dateStr: string,
): boolean {
  if (!task.due_date) return false
  const taskDateStr = task.due_date.slice(0, 10)
  if (taskDateStr === dateStr) return true
  if (!task.recurrence) return false
  const rule = parseRRule(task.recurrence)
  if (!rule) return false
  const anchor = new Date(`${taskDateStr}T00:00:00`)
  const candidate = new Date(`${dateStr}T00:00:00`)
  return matches(rule, anchor, candidate)
}

/**
 * Editor-friendly summary of a rule, e.g. "Every day", "Every 2 weeks on Mon,
 * Wed", "Every month on the 1st". Falls back to the raw RRULE for anything
 * the summariser doesn't recognise. UI-side i18n can layer over this.
 */
export function describeRRule(rule: ParsedRRule): string {
  const interval = rule.interval
  switch (rule.freq) {
    case 'DAILY':
      return interval === 1 ? 'Every day' : `Every ${interval} days`
    case 'WEEKLY': {
      const days = rule.byDay?.length
        ? rule.byDay.map((d) => ({ MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' })[d]).join(', ')
        : ''
      const base = interval === 1 ? 'Every week' : `Every ${interval} weeks`
      return days ? `${base} on ${days}` : base
    }
    case 'MONTHLY': {
      const days = rule.byMonthDay?.length ? rule.byMonthDay.join(', ') : null
      const base = interval === 1 ? 'Every month' : `Every ${interval} months`
      return days ? `${base} on day ${days}` : base
    }
    case 'YEARLY':
      return interval === 1 ? 'Every year' : `Every ${interval} years`
    default:
      return serializeRRule(rule)
  }
}
