/**
 * Tool 2: what is actually worth pointing a telescope at tonight.
 *
 * The single most useful thing this tool does is return what it REJECTED and why.
 * "M7 peaks at 12 degrees, below your 30 degree floor" is an answer a person can
 * argue with; a silent omission is not. Every rejection carries the numbers that
 * produced it, so the agent can renegotiate the filters instead of guessing.
 *
 * Defaults come from the app: the night, the site and the filters the human is
 * looking at right now. That is the whole thesis of Roque Nights, in one tool: the
 * agent works the same instrument the human is holding.
 */

import { getNight } from '../astro/cache'
import { getTarget, type Target } from '../astro/catalog'
import type { DarknessStatus, NightEphemeris } from '../astro/night'
import { findObservableTargets, type TargetVisibility } from '../astro/targets'
import { formatInZone } from '../astro/time'
import { store } from '../state/store'
import type { Site, TargetType } from '../state/types'
import {
  defineTool,
  fail,
  isToolError,
  ok,
  stamp,
  type RejectedItem,
  type Stamp,
  type ToolError,
  type ToolResult,
} from './envelope'
import { resolveNightOf, resolveSite } from './resolveSite'
import { DATE_SCHEMA, SITE_SCHEMA, TARGET_REF_SCHEMA, TARGET_TYPES } from './schemas'

export const DEFAULT_TARGET_LIMIT = 12
export const MAX_TARGET_LIMIT = 40
export const UNKNOWN_TARGET_REASON = 'unknown target'

export interface TargetCandidate {
  id: string
  name: string
  type: TargetType
  magnitude: number | null
  constellation: string | null
  /** 0-100: altitude, time above the floor and Moon distance rolled into one number. */
  score: number
  window: { start: Stamp; peak: Stamp; end: Stamp; minutes: number }
  peak_altitude_deg: number
  peak_azimuth_deg: number
  peak_direction: string
  peak_airmass: number | null
  moon_separation_deg: number
  /** Share of the observing window with the Moon above the horizon, 0..1. */
  moon_up_fraction: number
  transit: Stamp
}

export interface FindFiltersUsed {
  min_altitude_deg: number
  types: TargetType[] | null
  max_magnitude: number | null
  min_moon_separation_deg: number
  min_window_minutes: number
  limit: number
  query: string | null
  ids: string[] | null
}

export interface FindObservableTargetsData {
  night_of: string
  darkness: { start: Stamp; end: Stamp; status: DarknessStatus }
  candidates: TargetCandidate[]
  /** Observable targets found, before `limit` cut the list down. */
  observable_count: number
  /** Targets actually examined: observable plus rejected. */
  targets_evaluated: number
  filters_used: FindFiltersUsed
}

export const FIND_OBSERVABLE_TARGETS_DESCRIPTION =
  'Use this to learn what is actually worth observing on a night: Messier objects, planets and the Moon filtered by minimum altitude, darkness window, Moon separation and magnitude, each with its observing window (start, peak, end), peak altitude and airmass, Moon separation, the share of the window with the Moon up and a 0-100 score. Bright stars are included only when you ask for them, with types ["star"] or by naming one in ids or query. Also returns the objects that were REJECTED and why (too low, Moon too close, window too short, no darkness), so you can explain trade-offs to the person. It works on the night, site and filters currently shown in the app unless you override them, and always echoes the values it used in data.filters_used. Pass ids to check specific targets.'

// --- input helpers -------------------------------------------------------------

function describeValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (value === null) return 'null'
  return typeof value === 'object' ? `a ${typeof value}` : String(value)
}

/** A number inside its schema range, the app's value when absent, or a refusal. */
function readNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
  fallback: number | null,
  opts?: { integer?: boolean },
): number | null | ToolError {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('invalid_input', `${field} must be a number, got ${describeValue(value)}.`)
  }
  if (opts?.integer && !Number.isInteger(value)) {
    return fail('invalid_input', `${field} must be a whole number, got ${value}.`)
  }
  if (value < min || value > max) {
    return fail('invalid_input', `${field} must be between ${min} and ${max}, got ${value}.`)
  }
  return value
}

function readStringArray(
  value: unknown,
  field: string,
  maxItems: number,
): string[] | null | ToolError {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) {
    return fail('invalid_input', `${field} must be an array of strings, got ${describeValue(value)}.`)
  }
  if (value.length > maxItems) {
    return fail('invalid_input', `${field} accepts at most ${maxItems} entries, got ${value.length}.`)
  }
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return fail('invalid_input', `${field} must contain non-empty strings, got ${describeValue(entry)}.`)
    }
    out.push(entry.trim())
  }
  return out.length > 0 ? out : null
}

function readTypes(value: unknown, fallback: TargetType[] | null): TargetType[] | null | ToolError {
  if (value === undefined || value === null) return fallback
  const names = readStringArray(value, 'types', TARGET_TYPES.length)
  if (isToolError(names)) return names
  if (names === null) return fallback
  for (const name of names) {
    if (!(TARGET_TYPES as readonly string[]).includes(name)) {
      return fail(
        'invalid_input',
        `types contains "${name}", which is not a target type.`,
        `Valid types: ${TARGET_TYPES.join(', ')}.`,
      )
    }
  }
  return names as TargetType[]
}

function readQuery(value: unknown): string | null | ToolError {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    return fail('invalid_input', `query must be a string, got ${describeValue(value)}.`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// --- output helpers -------------------------------------------------------------

function toCandidate(visibility: TargetVisibility, timeZone: string | null): TargetCandidate {
  const { target, window } = visibility
  return {
    id: target.id,
    name: target.name,
    type: target.type,
    // Apparent magnitude for this night: planets and the Moon carry no catalog value.
    magnitude: visibility.magnitude,
    constellation: target.con,
    score: visibility.score,
    window: {
      start: stamp(window?.startUtc ?? null, timeZone),
      peak: stamp(window?.peakUtc ?? null, timeZone),
      end: stamp(window?.endUtc ?? null, timeZone),
      minutes: window?.minutes ?? 0,
    },
    peak_altitude_deg: window?.peakAltDeg ?? 0,
    peak_azimuth_deg: window?.peakAzDeg ?? 0,
    peak_direction: window ? compass(window.peakAzDeg) : 'N',
    peak_airmass: window?.peakAirmass ?? null,
    moon_separation_deg: window?.moonSeparationDeg ?? 0,
    moon_up_fraction: window?.moonUpFraction ?? 0,
    transit: stamp(visibility.transitUtc, timeZone),
  }
}

const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]

function compass(azDeg: number): string {
  const wrapped = ((azDeg % 360) + 360) % 360
  return COMPASS_POINTS[Math.round(wrapped / 22.5) % 16]
}

/** 'below minimum altitude (peak 12° < 30°)' and its 57 siblings count as one group. */
function reasonGroup(reason: string): string {
  return reason.replace(/\s*\(.*$/, '').trim()
}

function countReasons(rejected: RejectedItem[]): string {
  const counts = new Map<string, number>()
  for (const item of rejected) {
    const group = reasonGroup(item.reason)
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([group, count]) => `${count} ${group}`)
    .join(', ')
}

/** 'M31 Andromeda' for a Messier object, plain 'Vega' or 'Moon' for everything else. */
function label(candidate: TargetCandidate): string {
  if (candidate.name === candidate.id) return candidate.name
  return /^M\d+$/.test(candidate.id) ? `${candidate.id} ${candidate.name}` : candidate.name
}

function clockOf(candidate: TargetCandidate, timeZone: string | null): string {
  const iso = candidate.window.peak.utc
  if (!iso) return 'unknown time'
  return timeZone ? `${formatInZone(iso, timeZone)} local` : `${iso.slice(11, 16)} UTC`
}

function buildSummary(
  data: FindObservableTargetsData,
  rejected: RejectedItem[],
  site: Site,
  night: { darknessStatus: DarknessStatus; explanation: string },
): string {
  if (data.observable_count === 0 && night.darknessStatus !== 'ok') {
    return `Nothing is observable on ${data.night_of} from ${site.name}: ${night.explanation}`
  }

  const head =
    `${data.observable_count} of ${data.targets_evaluated} targets are observable on ${data.night_of} ` +
    `from ${site.name} above ${Math.round(data.filters_used.min_altitude_deg)}°`

  if (data.candidates.length === 0) {
    return `${head}. Rejected ${rejected.length} (${countReasons(rejected)}).`
  }

  const shown = data.candidates.slice(0, 3)
  const best = shown
    .map((c) => `${label(c)} (peak ${Math.round(c.peak_altitude_deg)}°, ${clockOf(c, site.timeZone)})`)
    .join(', ')
  const more =
    data.candidates.length > shown.length
      ? ` and ${data.candidates.length - shown.length} more in the list`
      : ''
  const rejectedClause =
    rejected.length === 0 ? '' : ` Rejected ${rejected.length} (${countReasons(rejected)}).`

  return `${head}: best are ${best}${more}.${rejectedClause}`
}

/** One hour with one decimal, e.g. '9.4 h'. */
function hours(value: number | null): string {
  return value === null ? '0 h' : `${value.toFixed(1)} h`
}

/**
 * A bright Moon up through most of the darkness costs more than the Moon separation
 * filter can express: it lifts the sky background everywhere. Say so, with the hours.
 */
function moonCaveat(night: NightEphemeris): string | null {
  const upPct = night.moon.upDuringDarknessPct
  if (upPct === null || upPct <= 50) return null
  if (night.moon.illuminationPct <= 50) return null
  return (
    `The Moon is ${night.moon.illuminationPct}% lit and above the horizon for ${upPct}% of the darkness, ` +
    `leaving ${hours(night.darkness.usableHours)} usable out of ${hours(night.darkness.hours)} of darkness. ` +
    'Faint targets will look washed out even where the Moon separation filter passes them.'
  )
}

// --- the tool --------------------------------------------------------------------

export const findObservableTargetsTool = defineTool<FindObservableTargetsData>({
  name: 'find_observable_targets',
  title: 'Find observable targets for a night',
  description: FIND_OBSERVABLE_TARGETS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      date: DATE_SCHEMA,
      site: SITE_SCHEMA,
      min_altitude_deg: {
        type: 'number',
        minimum: 5,
        maximum: 85,
        description:
          'Lowest altitude above the horizon that still counts as observable, in degrees. OMIT this to honour the filter the person set in the app; the value actually used comes back as data.filters_used.min_altitude_deg. Pass a number only when the person asked to change the floor.',
      },
      types: {
        type: 'array',
        items: { type: 'string', enum: [...TARGET_TYPES] },
        maxItems: TARGET_TYPES.length,
        description:
          'Keep only these target types. Omit to honour the type filter set in the app (every type except "star" by default). Include "star" here to add the naked eye stars to the scan.',
      },
      max_magnitude: {
        type: 'number',
        minimum: -30,
        maximum: 20,
        description:
          'Faintest visual magnitude to keep (larger numbers are fainter); planets and the Moon are judged on their brightness on that night. OMIT this to honour the filter set in the app, which is no limit unless the person set one; the value used comes back as data.filters_used.max_magnitude.',
      },
      min_moon_separation_deg: {
        type: 'number',
        minimum: 0,
        maximum: 180,
        description:
          'Minimum angular distance from the Moon, in degrees, enforced only while the Moon is above the horizon. OMIT this to honour the filter the person set in the app; the value used comes back as data.filters_used.min_moon_separation_deg.',
      },
      min_window_minutes: {
        type: 'integer',
        minimum: 10,
        maximum: 600,
        default: 45,
        description: 'Shortest observing window worth listing, in minutes.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_TARGET_LIMIT,
        default: DEFAULT_TARGET_LIMIT,
        description: 'How many candidates to return, best first.',
      },
      query: {
        type: 'string',
        maxLength: 60,
        description: 'Free text filter over names and ids, e.g. "nebula" or "Andromeda".',
      },
      ids: {
        type: 'array',
        items: TARGET_REF_SCHEMA,
        maxItems: MAX_TARGET_LIMIT,
        description:
          'Check exactly these targets instead of the whole catalog. Names that cannot be resolved come back in rejected.',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  run: (input): ToolResult<FindObservableTargetsData> => {
    const state = store.getState()
    const filters = state.filters

    const resolved = resolveSite(input.site, state.site)
    if (isToolError(resolved)) return resolved
    const site = resolved.site

    const nightOf = resolveNightOf(input.date, state.nightOf)
    if (isToolError(nightOf)) return nightOf

    const minAltDeg = readNumber(input.min_altitude_deg, 'min_altitude_deg', 5, 85, filters.minAltDeg)
    if (isToolError(minAltDeg)) return minAltDeg
    const minMoonSepDeg = readNumber(
      input.min_moon_separation_deg,
      'min_moon_separation_deg',
      0,
      180,
      filters.minMoonSepDeg,
    )
    if (isToolError(minMoonSepDeg)) return minMoonSepDeg
    const maxMag = readNumber(input.max_magnitude, 'max_magnitude', -30, 20, filters.maxMag)
    if (isToolError(maxMag)) return maxMag
    const minWindowMinutes = readNumber(input.min_window_minutes, 'min_window_minutes', 10, 600, 45, {
      integer: true,
    })
    if (isToolError(minWindowMinutes)) return minWindowMinutes
    const limit = readNumber(input.limit, 'limit', 1, MAX_TARGET_LIMIT, DEFAULT_TARGET_LIMIT, {
      integer: true,
    })
    if (isToolError(limit)) return limit
    const types = readTypes(input.types, filters.types)
    if (isToolError(types)) return types
    const query = readQuery(input.query)
    if (isToolError(query)) return query
    const rawIds = readStringArray(input.ids, 'ids', MAX_TARGET_LIMIT)
    if (isToolError(rawIds)) return rawIds

    // Resolve names to catalog ids here so that "Klingon Homeworld" is a rejection
    // with a reason, not a silently missing row.
    const rejected: RejectedItem[] = []
    let ids: string[] | null = null
    if (rawIds) {
      const resolvedIds: string[] = []
      for (const raw of rawIds) {
        const target: Target | undefined = getTarget(raw)
        if (target) resolvedIds.push(target.id)
        else rejected.push({ id: raw, name: raw, reason: UNKNOWN_TARGET_REASON })
      }
      ids = resolvedIds
    }

    const night = getNight(nightOf, site)
    const found =
      ids !== null && ids.length === 0
        ? { candidates: [], rejected: [], starsExcluded: false }
        : findObservableTargets(night, site, {
            minAltDeg: minAltDeg ?? 30,
            types,
            maxMag,
            minMoonSepDeg: minMoonSepDeg ?? 30,
            minWindowMinutes: minWindowMinutes ?? 45,
            // Rank the whole catalog, then cut: the count in the summary has to be honest.
            limit: Number.MAX_SAFE_INTEGER,
            query,
            ids,
          })

    rejected.push(...found.rejected)

    const keep = limit ?? DEFAULT_TARGET_LIMIT
    const data: FindObservableTargetsData = {
      night_of: nightOf,
      darkness: {
        start: stamp(night.darkness.startUtc, site.timeZone),
        end: stamp(night.darkness.endUtc, site.timeZone),
        status: night.darkness.status,
      },
      candidates: found.candidates.slice(0, keep).map((v) => toCandidate(v, site.timeZone)),
      observable_count: found.candidates.length,
      targets_evaluated: found.candidates.length + rejected.length,
      filters_used: {
        min_altitude_deg: minAltDeg ?? 30,
        types,
        max_magnitude: maxMag,
        min_moon_separation_deg: minMoonSepDeg ?? 30,
        min_window_minutes: minWindowMinutes ?? 45,
        limit: keep,
        query,
        ids: rawIds,
      },
    }

    const caveats = [...resolved.caveats]
    if (found.starsExcluded) {
      caveats.push(
        'Bright stars were not scanned: ask for them with types ["star"], or name one in ids or query.',
      )
    }
    const moon = moonCaveat(night)
    if (moon) caveats.push(moon)

    const summary = buildSummary(data, rejected, site, {
      darknessStatus: night.darkness.status,
      explanation: night.explanation,
    })
    return ok(summary, data, site, { rejected, caveats })
  },
})
