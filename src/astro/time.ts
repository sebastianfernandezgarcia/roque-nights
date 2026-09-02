/**
 * Dates, time zones and formatting for Roque Nights.
 *
 * House rules (see docs/PLAN.md):
 *  - every instant we keep internally is UTC (a `Date` or an ISO string ending in `Z`);
 *  - local wall clock time is produced only here, and only with an explicit IANA zone;
 *  - a site with an unknown zone gets `null` local times, never a guessed offset.
 */

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

/** Placeholder shown instead of a missing local time. */
const EMPTY = '—'

const MIN_YEAR = 1900
const MAX_YEAR = 2100
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface DateParts {
  year: number
  month: number
  day: number
}

/** Strict YYYY-MM-DD: real calendar day, year 1900..2100. Returns null otherwise (never throws). */
export function parseIsoDate(value: unknown): DateParts | null {
  if (typeof value !== 'string') return null
  const match = ISO_DATE_RE.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()
/** Memoized answers of `isValidTimeZone`: an IANA name never changes its mind. */
const zoneValid = new Map<string, boolean>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    zoneFormatters.set(timeZone, formatter)
  }
  return formatter
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Wall clock reading of an instant in a zone. Uses formatToParts so it does not depend on locale text. */
function wallClock(at: Date, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(at)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type)
    return part ? Number(part.value) : 0
  }
  // 'h23' can still report hour 24 for midnight in some ICU builds; normalize it.
  const hour = read('hour') % 24
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  }
}

/**
 * True when `tz` is a string accepted by Intl.DateTimeFormat as timeZone.
 *
 * Every formatting helper below asks this question, often thousands of times per
 * render, and building an Intl.DateTimeFormat costs about 20 us. The answer never
 * changes for a given string, so it is memoized on the same per zone formatter
 * cache the rest of the module uses.
 */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false
  const known = zoneValid.get(tz)
  if (known !== undefined) return known
  let valid: boolean
  try {
    partsFormatter(tz)
    valid = true
  } catch {
    valid = false
  }
  zoneValid.set(tz, valid)
  return valid
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 'HH:mm' (default) or 'YYYY-MM-DD HH:mm' in the zone; '—' for null. */
export function formatInZone(
  isoUtc: string | null,
  timeZone: string,
  opts?: { withDate?: boolean },
): string {
  if (!isoUtc) return EMPTY
  const at = new Date(isoUtc)
  if (Number.isNaN(at.getTime())) return EMPTY
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const w = wallClock(at, zone)
  const time = `${pad2(w.hour)}:${pad2(w.minute)}`
  if (!opts?.withDate) return time
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)} ${time}`
}

/** Offset of `timeZone` from UTC at instant `at`, in minutes (Canary in September = +60). */
export function timeZoneOffsetMinutes(timeZone: string, at: Date): number {
  if (!isValidTimeZone(timeZone)) return 0
  const w = wallClock(at, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  // Milliseconds are the same in both readings, so drop them before differencing.
  const instant = Math.floor(at.getTime() / 1000) * 1000
  return Math.round((asUtc - instant) / 60_000)
}

/** Today's calendar date in the zone (or UTC when timeZone is null). */
export function localDate(timeZone: string | null, from: Date = new Date()): string {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const w = wallClock(from, zone)
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`
}

/** 12:00 local on `nightOf`: exact via the zone when known, else solar noon from longitude (12:00Z - lon/15 h). */
export function localNoonUtc(
  nightOf: string,
  site: { longitude: number; timeZone: string | null },
): Date {
  const parts = parseIsoDate(nightOf)
  if (!parts) throw new RangeError(`localNoonUtc: "${nightOf}" is not a valid calendar date`)
  const nominalNoon = Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0)

  if (site.timeZone && isValidTimeZone(site.timeZone)) {
    // Two passes: the offset has to be read at the instant we are solving for (DST edges).
    let guess = nominalNoon - timeZoneOffsetMinutes(site.timeZone, new Date(nominalNoon)) * 60_000
    guess = nominalNoon - timeZoneOffsetMinutes(site.timeZone, new Date(guess)) * 60_000
    return new Date(guess)
  }

  const longitude = Number.isFinite(site.longitude) ? site.longitude : 0
  return new Date(nominalNoon - (longitude / 15) * HOUR_MS)
}

export function addDays(iso: string, days: number): string {
  const parts = parseIsoDate(iso)
  if (!parts) throw new RangeError(`addDays: "${iso}" is not a valid calendar date`)
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * DAY_MS)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/** Inclusive list of YYYY-MM-DD; throws RangeError if > maxDays (default 62) or to < from. */
export function isoDateRange(fromIso: string, toIso: string, maxDays = 62): string[] {
  const from = parseIsoDate(fromIso)
  const to = parseIsoDate(toIso)
  if (!from) throw new RangeError(`isoDateRange: "${fromIso}" is not a valid calendar date`)
  if (!to) throw new RangeError(`isoDateRange: "${toIso}" is not a valid calendar date`)
  const fromMs = Date.UTC(from.year, from.month - 1, from.day)
  const toMs = Date.UTC(to.year, to.month - 1, to.day)
  if (toMs < fromMs) throw new RangeError(`isoDateRange: ${toIso} is before ${fromIso}`)
  const count = Math.round((toMs - fromMs) / DAY_MS) + 1
  if (count > maxDays) {
    throw new RangeError(`isoDateRange: ${count} nights requested, the limit is ${maxDays}`)
  }
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(addDays(fromIso, i))
  return out
}

/** Compact 'YYYY-MM-DD HH:mm' or 'HH:mm' or null; used by tools' Stamp. */
export function localStamp(
  isoUtc: string | null,
  timeZone: string | null,
  opts?: { withDate?: boolean },
): string | null {
  if (!isoUtc || !timeZone || !isValidTimeZone(timeZone)) return null
  return formatInZone(isoUtc, timeZone, { withDate: opts?.withDate ?? true })
}

export function roundTo(n: number, decimals: number): number {
  if (!Number.isFinite(n)) return n
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}
