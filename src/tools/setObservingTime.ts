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
import { roundTo } from '../astro/time'
import { store } from '../state/store'
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
      description:
        'ISO 8601 UTC instant ("2026-09-12T22:30:00Z") or one of the keywords now, sunset, darkness_start, midnight, darkness_end, sunrise.',
    },
    date: DATE_SCHEMA,
  },
  anyOf: [{ required: ['time'] }, { required: ['date'] }],
  additionalProperties: false,
} as const

function hhmm(isoUtc: string): string {
  return isoUtc.slice(11, 16)
}

function whenPhrase(at: Stamp): string {
  if (at.utc === null) return 'an unknown time'
  if (at.local === null) return `${at.utc.slice(0, 10)} ${hhmm(at.utc)} UTC`
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

function resolveTime(
  raw: unknown,
  night: NightEphemeris,
  nightOf: string,
  latitude: number,
): { iso: string; caveats: string[] } | ToolError {
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

  const nightOf = resolveNightOf(input.date, state.nightOf)
  if (typeof nightOf !== 'string') return nightOf

  // The night is computed BEFORE anything is applied, so a keyword that does not
  // exist at this latitude fails without moving the app.
  const night = getNight(nightOf, site)
  const caveats: string[] = []
  let timeUtc = state.timeUtc

  if (hasTime) {
    const resolved = resolveTime(input.time, night, nightOf, site.latitude)
    if ('ok' in resolved) return resolved
    timeUtc = resolved.iso
    caveats.push(...resolved.caveats)
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
  description: `Use this to move the time slider that the sky map and all target positions follow. Pass an ISO 8601 UTC instant ("2026-09-12T22:30:00Z") or a keyword for the selected night: "now", "sunset", "darkness_start", "midnight" (middle of astronomical darkness), "darkness_end", "sunrise". Optionally change the selected night with date (YYYY-MM-DD, the evening the night starts), which recomputes everything in the app. Idempotent.`,
  inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  run,
})
