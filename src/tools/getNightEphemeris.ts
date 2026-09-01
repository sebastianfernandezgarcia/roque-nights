/**
 * Tool 1: the night itself. Everything else in Roque Nights hangs off this answer.
 *
 * It is deliberately pure astronomy: darkness, Sun and Moon, computed in the
 * browser with astronomy-engine. No weather, no opinions. The description says so
 * out loud, because the first agent we tested with (GPT-5.6, 2026-09-01) assumed a
 * tool called `get_observing_conditions` would know about clouds; it did not, so
 * the tool was renamed and the boundary written into its own description.
 *
 * Two other lessons from that session are enforced here: a date is validated as a
 * real calendar day before it reaches the ephemeris, and a time zone is never
 * invented. Custom coordinates without an IANA zone get UTC only, with a caveat
 * that says how to ask for local times.
 */

import { getNight } from '../astro/cache'
import type { Interval, NightEphemeris } from '../astro/night'
import { formatInZone } from '../astro/time'
import { store } from '../state/store'
import type { Site } from '../state/types'
import {
  defineTool,
  isToolError,
  ok,
  stamp,
  type Stamp,
  type ToolResult,
} from './envelope'
import { resolveNightOf, resolveSite } from './resolveSite'
import { DATE_SCHEMA, SITE_SCHEMA } from './schemas'

export interface StampInterval {
  start: Stamp
  end: Stamp
}

export interface NightEphemerisData {
  night_of: string
  time_zone: string | null
  sun: {
    status: NightEphemeris['sun']['status']
    sunset: Stamp
    sunrise: Stamp
    civil_dusk: Stamp
    nautical_dusk: Stamp
    astronomical_dusk: Stamp
    astronomical_dawn: Stamp
    nautical_dawn: Stamp
    civil_dawn: Stamp
  }
  darkness: {
    status: NightEphemeris['darkness']['status']
    start: Stamp
    end: Stamp
    hours: number | null
    moon_free_hours: number | null
    usable_hours: number | null
    moon_free_intervals: StampInterval[]
  }
  moon: {
    illumination_pct: number
    phase: string
    rise: Stamp
    set: Stamp
    up_during_darkness_pct: number | null
  }
  /** The one-sentence account of this night the astronomy engine wrote. */
  explanation: string
}

export const GET_NIGHT_EPHEMERIS_DESCRIPTION =
  'Use this first when planning a night. Returns the astronomical ephemeris for the night that STARTS on the given evening: sunset and sunrise, civil, nautical and astronomical twilight, the true astronomical darkness window (Sun below -18 degrees), Moon rise and set, illumination and phase, total dark hours and how many of them are Moon-free. Pure astronomy computed in the browser with astronomy-engine; it does NOT include weather, seeing or transparency (use compare_dark_sky_sites for a cloud forecast). Defaults to the night and site currently shown in the app. Times are returned as UTC plus site-local time; for custom coordinates pass site.time_zone or you will only get UTC. Polar and high-latitude cases are explicit in data.darkness.status and data.sun.status.'

/** 'HH:mm' in the site zone, or in UTC when there is no zone. */
function clock(isoUtc: string | null, timeZone: string | null): string {
  if (!isoUtc) return 'never'
  return timeZone ? formatInZone(isoUtc, timeZone) : isoUtc.slice(11, 16)
}

function utcClock(isoUtc: string | null): string {
  return isoUtc ? isoUtc.slice(11, 16) : 'never'
}

function hours(value: number | null): string {
  return value === null ? 'no' : value.toFixed(1)
}

function intervalStamps(intervals: Interval[], timeZone: string | null): StampInterval[] {
  return intervals.map((i) => ({
    start: stamp(i.startUtc, timeZone),
    end: stamp(i.endUtc, timeZone),
  }))
}

/** Where the Moon sits relative to the darkness window, in one clause. */
function moonClause(night: NightEphemeris, timeZone: string | null): string {
  const { moon, darkness } = night
  const phase = `Moon ${moon.illuminationPct}% (${moon.phaseName})`
  const upPct = moon.upDuringDarknessPct

  if (upPct === 0) return `${phase} below the horizon all night`
  if (upPct === 100) return `${phase} above the horizon all night`

  const startMs = darkness.startUtc ? Date.parse(darkness.startUtc) : null
  const endMs = darkness.endUtc ? Date.parse(darkness.endUtc) : null
  const inDarkness = (iso: string | null): boolean => {
    if (!iso || startMs === null || endMs === null) return false
    const at = Date.parse(iso)
    return at >= startMs && at <= endMs
  }

  if (inDarkness(moon.riseUtc)) return `${phase} rises ${clock(moon.riseUtc, timeZone)}`
  if (inDarkness(moon.setUtc)) return `${phase} sets ${clock(moon.setUtc, timeZone)}`
  if (moon.riseUtc) return `${phase} rises ${clock(moon.riseUtc, timeZone)}`
  if (moon.setUtc) return `${phase} sets ${clock(moon.setUtc, timeZone)}`
  return phase
}

/**
 * One quotable sentence. With a known zone it leads with local time and puts UTC in
 * parentheses; without one it is UTC throughout and says so, so nobody can mistake
 * a UTC clock for a wall clock.
 */
export function buildSummary(night: NightEphemeris, site: Site): string {
  const tz = site.timeZone
  const head = `Night of ${night.nightOf} at ${site.name}`

  if (night.darkness.status !== 'ok') {
    return `${head}: ${night.explanation}`
  }

  const start = night.darkness.startUtc
  const end = night.darkness.endUtc
  const span = tz
    ? `${clock(start, tz)}-${clock(end, tz)} local (${utcClock(start)}-${utcClock(end)} UTC, ${hours(night.darkness.hours)} h)`
    : `${utcClock(start)}-${utcClock(end)} UTC (${hours(night.darkness.hours)} h)`

  const moonFree = night.darkness.moonFreeHours
  const dark = night.darkness.hours
  const moonFreeClause =
    moonFree === null || dark === null
      ? ''
      : `, ${hours(moonFree)} of the ${hours(dark)} dark hours are Moon-free`

  return `${head}: astronomical darkness ${span}, ${moonClause(night, tz)}${moonFreeClause}.`
}

function toData(night: NightEphemeris, timeZone: string | null): NightEphemerisData {
  const at = (iso: string | null): Stamp => stamp(iso, timeZone)
  return {
    night_of: night.nightOf,
    time_zone: timeZone,
    sun: {
      status: night.sun.status,
      sunset: at(night.sun.sunsetUtc),
      sunrise: at(night.sun.sunriseUtc),
      civil_dusk: at(night.sun.civilDuskUtc),
      nautical_dusk: at(night.sun.nauticalDuskUtc),
      astronomical_dusk: at(night.sun.astronomicalDuskUtc),
      astronomical_dawn: at(night.sun.astronomicalDawnUtc),
      nautical_dawn: at(night.sun.nauticalDawnUtc),
      civil_dawn: at(night.sun.civilDawnUtc),
    },
    darkness: {
      status: night.darkness.status,
      start: at(night.darkness.startUtc),
      end: at(night.darkness.endUtc),
      hours: night.darkness.hours,
      moon_free_hours: night.darkness.moonFreeHours,
      usable_hours: night.darkness.usableHours,
      moon_free_intervals: intervalStamps(night.darkness.moonFreeIntervals, timeZone),
    },
    moon: {
      illumination_pct: night.moon.illuminationPct,
      phase: night.moon.phaseName,
      rise: at(night.moon.riseUtc),
      set: at(night.moon.setUtc),
      up_during_darkness_pct: night.moon.upDuringDarknessPct,
    },
    explanation: night.explanation,
  }
}

export const getNightEphemerisTool = defineTool<NightEphemerisData>({
  name: 'get_night_ephemeris',
  title: 'Night ephemeris: darkness window, Sun and Moon',
  description: GET_NIGHT_EPHEMERIS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: { date: DATE_SCHEMA, site: SITE_SCHEMA },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  run: (input): ToolResult<NightEphemerisData> => {
    const state = store.getState()

    const resolved = resolveSite(input.site, state.site)
    if (isToolError(resolved)) return resolved

    const nightOf = resolveNightOf(input.date, state.nightOf)
    if (isToolError(nightOf)) return nightOf

    const night = getNight(nightOf, resolved.site)
    return ok(buildSummary(night, resolved.site), toData(night, resolved.site.timeZone), resolved.site, {
      caveats: resolved.caveats,
    })
  },
})
