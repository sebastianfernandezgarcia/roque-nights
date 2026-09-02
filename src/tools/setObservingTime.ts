/**
 * Tool 5: set_observing_time.
 *
 * The time slider is the spine of the app: the dome, the altitude curves and
 * every "where is it now" number follow it. The agent gets the same handle the
 * human drags, plus the keywords a person actually uses ("darkness_start",
 * "midnight"), resolved against the real ephemeris of the selected night.
 *
 * Nothing is applied until everything validates: a refused call leaves the app
 * exactly where it was, which matters when the agent is guessing at a keyword
 * that a polar night does not have.
 */

import { getNight } from '../astro/cache'
import type { NightEphemeris, TimeKeyword } from '../astro/night'
import { formatLatitude, makeObserver, moonAltitudeDeg, resolveTimeKeyword, sunAltitudeDeg } from '../astro/night'
import { formatInZone, localDate, roundTo } from '../astro/time'
import { observingNightIn, store } from '../state/store'
import type { Stamp, ToolError, ToolResult } from './envelope'
import { defineTool, fail, ok, stamp } from './envelope'
import { resolveNightOf } from './resolveSite'
import { DATE_SCHEMA } from './schemas'

/** Sun altitude at or below this is astronomical darkness. */
export const ASTRONOMICAL_DARKNESS_DEG = -18

const KEYWORDS: TimeKeyword[] = [
  'now',
  'sunset',
  'darkness_start',
  'midnight',
  'darkness_end',
  'sunrise',
]

/** True for an ISO 8601 string that already carries a zone ('Z' or an offset). */
const HAS_ZONE_RE = /([Zz]|[+-]\d{2}:?\d{2})$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

const HOUR_MS = 3_600_000
/** The same 1900-2100 window `parseIsoDate` enforces for dates. */
const EARLIEST_INSTANT_MS = Date.UTC(1900, 0, 1)
const LATEST_INSTANT_MS = Date.UTC(2100, 11, 31, 23, 59, 59, 999)

/** The keyword list, spelled out once for the agent-facing strings. */
const KEYWORD_GLOSS =
  '"now" (the REAL clock right now; when the selected night does not contain it the app moves to the observing night that does, and says so in caveats), ' +
  '"sunset" (the Sun at the horizon, still far too bright to observe), ' +
  '"darkness_start" (the start of ASTRONOMICAL darkness, Sun 18 degrees below the horizon: this is what "when it gets dark" means for observing, about 1 h 40 min after sunset at the Roque), ' +
  '"midnight" (the middle of astronomical darkness, NOT 00:00 clock time), ' +
  '"darkness_end" (the end of astronomical darkness, Sun back up to 18 degrees below the horizon), ' +
  '"sunrise" (the Sun back at the horizon)'

export interface SetObservingTimeData {
  time: Stamp
  night_of: string
  sun_altitude_deg: number
  moon_altitude_deg: number
  is_astronomical_darkness: boolean
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    time: {
      type: 'string',
      minLength: 3,
      maxLength: 40,
      description: `ISO 8601 UTC instant between 1900 and 2100 ("2026-09-12T22:30:00Z"), or one of the keywords for the selected night: ${KEYWORD_GLOSS}.`,
    },
    date: DATE_SCHEMA,
  },
  // No top-level anyOf: strict function-calling validators reject it. The run
  // body returns invalid_input when neither time nor date is given, and the
  // description says at least one of the two is required.
  additionalProperties: false,
} as const

/** 'HH:mm' in UTC, read from the instant rather than sliced off the string. */
function hhmm(isoUtc: string): string {
  return formatInZone(isoUtc, 'UTC')
}

/** The observing night that contains an instant: a night runs local noon to local noon. */
function observingNightOf(isoUtc: string, timeZone: string | null): string {
  return localDate(timeZone, new Date(Date.parse(isoUtc) - 12 * HOUR_MS))
}

function whenPhrase(at: Stamp): string {
  if (at.utc === null) return 'an unknown time'
  if (at.local === null) return `${formatInZone(at.utc, 'UTC', { withDate: true })} UTC`
  return `${at.local} local (${hhmm(at.utc)} UTC)`
}

/** Why a keyword has no instant on this night, in one clause. */
function keywordExcuse(keyword: TimeKeyword, night: NightEphemeris): string {
  if (keyword === 'sunset' || keyword === 'sunrise') {
    if (night.sun.status === 'never_sets') return 'the Sun never sets on this night.'
    if (night.sun.status === 'never_rises') return 'the Sun never rises on this night.'
    return 'the event does not happen inside this night.'
  }
  if (night.darkness.status === 'no_astronomical_darkness') {
    return 'there is no astronomical darkness on this night.'
  }
  return 'the event does not happen inside this night.'
}

/** A resolved instant, plus the night the app has to move to for it to make sense. */
interface ResolvedTime {
  iso: string
  caveats: string[]
  /** Set only by "now": the observing night that really contains the real clock. */
  nightOf?: string
}

function resolveTime(
  raw: unknown,
  night: NightEphemeris,
  nightOf: string,
  latitude: number,
  timeZone: string | null,
): ResolvedTime | ToolError {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fail(
      'invalid_input',
      'time must be an ISO 8601 UTC instant or one of the keywords now, sunset, darkness_start, midnight, darkness_end, sunrise.',
    )
  }
  const value = raw.trim()
  const keyword = value.toLowerCase().replace(/[\s-]+/g, '_') as TimeKeyword
  if (KEYWORDS.includes(keyword)) {
    const iso = resolveTimeKeyword(keyword, night)
    if (!iso) {
      return fail(
        'invalid_input',
        `${keyword} does not occur on ${nightOf} at this latitude (${formatLatitude(latitude)}): ${keywordExcuse(keyword, night)}`,
        'Use "midnight", which always exists, or pass an explicit ISO 8601 UTC instant such as "2026-09-12T22:30:00Z".',
      )
    }
    if (keyword === 'now') {
      // "now" means the real clock, full stop. Answering with the middle of the
      // selected night instead was the one place where this app told an agent a
      // time that nobody was living in; the app moves to the night that really
      // contains the clock rather than moving the clock into the night.
      const now = new Date()
      const realIso = now.toISOString()
      const realNight = observingNightIn(timeZone, now)
      if (realNight === nightOf) return { iso: realIso, caveats: [] }
      return {
        iso: realIso,
        nightOf: realNight,
        caveats: [
          `The real clock is ${hhmm(realIso)} UTC on ${realIso.slice(0, 10)}, so the app moved to the night of ${realNight}.`,
        ],
      }
    }
    return { iso: new Date(iso).toISOString(), caveats: [] }
  }

  const caveats: string[] = []
  let text = value
  if (DATE_ONLY_RE.test(value)) {
    text = `${value}T00:00:00Z`
    caveats.push(
      `"${value}" has no clock time: it was read as 00:00 UTC. Use the date argument to change the selected night.`,
    )
  } else if (!HAS_ZONE_RE.test(value)) {
    text = `${value}Z`
    caveats.push(`"${value}" has no time zone: it was read as UTC.`)
  }
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) {
    return fail(
      'invalid_input',
      `"${value}" is not an ISO 8601 UTC instant or one of the keywords now, sunset, darkness_start, midnight, darkness_end, sunrise.`,
      'Example: { "time": "2026-09-12T22:30:00Z" } or { "time": "midnight" }.',
    )
  }
  if (ms < EARLIEST_INSTANT_MS || ms > LATEST_INSTANT_MS) {
    return fail(
      'invalid_input',
      `"${value}" is outside the range this app computes, 1900-01-01 to 2100-12-31.`,
      'Pass an instant inside that range, or use the date argument to select the night.',
    )
  }
  return { iso: new Date(ms).toISOString(), caveats }
}

function run(input: Record<string, unknown>): ToolResult<SetObservingTimeData> {
  const state = store.getState()
  const site = state.site

  const hasDate = input.date !== undefined && input.date !== null
  const hasTime = input.time !== undefined && input.time !== null
  if (!hasDate && !hasTime) {
    return fail(
      'invalid_input',
      'set_observing_time needs time, date, or both.',
      'Example: { "time": "midnight" } or { "date": "2026-09-12", "time": "darkness_start" }.',
    )
  }

  const requestedNight = resolveNightOf(input.date, state.nightOf)
  if (typeof requestedNight !== 'string') return requestedNight
  let nightOf = requestedNight

  // The night is computed BEFORE anything is applied, so a keyword that does not
  // exist at this latitude fails without moving the app.
  let night = getNight(nightOf, site)
  const caveats: string[] = []
  let timeUtc = state.timeUtc

  if (hasTime) {
    const resolved = resolveTime(input.time, night, nightOf, site.latitude, site.timeZone)
    if ('ok' in resolved) return resolved
    timeUtc = resolved.iso
    caveats.push(...resolved.caveats)

    // "now" already knows which night contains the real clock, and has said so.
    let movedNight = false
    if (resolved.nightOf !== undefined && resolved.nightOf !== nightOf) {
      nightOf = resolved.nightOf
      night = getNight(nightOf, site)
      movedNight = true
    }

    // An instant from another night must not leave the app showing this one:
    // the dome, the timeline and every altitude would be computed for a night
    // the slider does not touch.
    const ms = Date.parse(timeUtc)
    const inside =
      ms >= Date.parse(night.windowStartUtc) && ms <= Date.parse(night.windowEndUtc)
    if (!inside && !movedNight) {
      const containing = observingNightOf(timeUtc, site.timeZone)
      if (containing !== nightOf) {
        caveats.push(
          `${hhmm(timeUtc)} UTC on ${timeUtc.slice(0, 10)} is not inside the night of ${nightOf}, so the app moved to the night of ${containing}, which contains it.`,
        )
        nightOf = containing
        night = getNight(nightOf, site)
      }
    }
  } else {
    // Only the night changed: keep the slider where it is unless it now points
    // at a different night entirely.
    const at = Date.parse(timeUtc)
    const inside =
      Number.isFinite(at) &&
      at >= Date.parse(night.windowStartUtc) &&
      at <= Date.parse(night.windowEndUtc)
    if (!inside) {
      const midnight = resolveTimeKeyword('midnight', night)
      if (midnight) {
        timeUtc = new Date(midnight).toISOString()
        caveats.push(
          `The slider was on another night, so it moved to the middle of the night of ${nightOf} (${hhmm(timeUtc)} UTC).`,
        )
      }
    }
  }

  if (nightOf !== state.nightOf) store.getState().setNightOf(nightOf, 'agent')
  if (timeUtc !== state.timeUtc) store.getState().setTime(timeUtc, 'agent')

  const observer = makeObserver(site)
  const at = new Date(timeUtc)
  const sunAlt = roundTo(sunAltitudeDeg(at, observer), 2)
  const moonAlt = roundTo(moonAltitudeDeg(at, observer), 2)
  const isDark = sunAlt <= ASTRONOMICAL_DARKNESS_DEG
  const when = stamp(timeUtc, site.timeZone)

  const sunClause =
    sunAlt > 0
      ? `the Sun is ${roundTo(sunAlt, 1)}° above the horizon (daylight)`
      : `the Sun is ${roundTo(Math.abs(sunAlt), 1)}° below the horizon (${isDark ? 'astronomical darkness' : 'twilight'})`
  const moonClause =
    moonAlt > 0
      ? `the Moon is ${roundTo(moonAlt, 1)}° up (${night.moon.illuminationPct}% lit)`
      : `the Moon is below the horizon`

  return ok(
    `Time set to ${whenPhrase(when)} on the night of ${nightOf} at ${site.name}: ${sunClause} and ${moonClause}.`,
    {
      time: when,
      night_of: nightOf,
      sun_altitude_deg: sunAlt,
      moon_altitude_deg: moonAlt,
      is_astronomical_darkness: isDark,
    },
    site,
    { caveats },
  )
}

export const setObservingTimeTool: ModelContextToolDefinition = defineTool<SetObservingTimeData>({
  name: 'set_observing_time',
  title: 'Move the observing time slider',
  description: `Use this to move the time slider that the sky map and all target positions follow. At least one of time and date is required. Pass time as an ISO 8601 UTC instant between 1900 and 2100 ("2026-09-12T22:30:00Z") or as a keyword for the selected night: ${KEYWORD_GLOSS}. Optionally change the selected night with date (YYYY-MM-DD, the evening the night starts), which recomputes everything in the app. An instant that belongs to another night moves the app to that night and says so in caveats. Idempotent.`,
  inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run,
})
