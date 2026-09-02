/**
 * Tool 4: point_sky_map.
 *
 * The tool that makes the demo: the agent moves the same canvas the human is
 * staring at, with the same store action the "Point map" button calls, and the
 * dome eases across the screen while the answer is still being typed. It never
 * touches the plan, and it never lies about a target that is under the horizon:
 * it centers there anyway (the map shows the horizon line) and says when the
 * object comes up.
 */

import { getNight } from '../astro/cache'
import { getTarget, searchTargets } from '../astro/catalog'
import type { Target } from '../astro/catalog'
import type { NightEphemeris, SiteCoords } from '../astro/night'
import { DOME_VIEW, MAX_FOV, MIN_FOV, clampView } from '../astro/sky'
import { airmass, compassDirection, computeVisibility, targetAltAz } from '../astro/targets'
import { formatInZone, roundTo } from '../astro/time'
import { store } from '../state/store'
import type { RejectedItem, Stamp, ToolResult } from './envelope'
import { defineTool, fail, ok, stamp } from './envelope'
import { TARGET_REF_SCHEMA } from './schemas'

/** Field of view used when the agent centers on a target and says nothing about zoom. */
export const DEFAULT_TARGET_FOV_DEG = 40

const MINUTE_MS = 60_000
/** Coarse scan for the next rise; refined to the minute by bisection. */
const RISE_SCAN_STEP_MS = 10 * MINUTE_MS

export interface PointSkyMapTargetData {
  id: string
  name: string
  type: string
  altitude_deg: number
  azimuth_deg: number
  direction: string
  above_horizon: boolean
  airmass: number | null
  /** When the target is below the horizon: the next time it comes up tonight. */
  next_rise: Stamp | null
}

export interface PointSkyMapData {
  view: { center_alt_deg: number; center_az_deg: number; fov_deg: number }
  time: Stamp
  target: PointSkyMapTargetData | null
  highlighted: string[]
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    target: {
      ...TARGET_REF_SCHEMA,
      description:
        'Target to center on: Messier id ("M31"), planet ("Saturn"), "Moon" or a bright star ("Vega"). Wins over altitude_deg and azimuth_deg.',
    },
    altitude_deg: {
      type: 'number',
      minimum: -30,
      maximum: 90,
      description: 'Center altitude in degrees above the horizon (90 = zenith). Ignored when target is given.',
    },
    azimuth_deg: {
      type: 'number',
      minimum: 0,
      maximum: 360,
      description:
        'Center azimuth in degrees clockwise from north (0 = N, 90 = E, 180 = S). Ignored when target is given.',
    },
    fov_deg: {
      type: 'number',
      minimum: MIN_FOV,
      maximum: MAX_FOV,
      description:
        'Field of view in degrees: 186 = the whole sky dome, 60 = a constellation, 10 = a cluster. Defaults to 40 when centering on a target.',
    },
    highlight: {
      type: 'array',
      maxItems: 20,
      items: TARGET_REF_SCHEMA,
      description: 'Replaces the current agent highlights; pass [] to clear.',
    },
    reset: { type: 'boolean', description: 'Return to the whole-sky dome view.' },
  },
  // No top-level anyOf here either (strict function-calling validators reject
  // it): the run body refuses an empty call with invalid_input, and the
  // description says which argument combinations are meaningful.
  additionalProperties: false,
} as const

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hhmm(isoUtc: string): string {
  return isoUtc.slice(11, 16)
}

/** '2026-09-03 00:00 local (23:00 UTC)', or plain UTC when the site has no zone. */
function whenPhrase(at: Stamp): string {
  if (at.utc === null) return 'an unknown time'
  if (at.local === null) return `${at.utc.slice(0, 10)} ${hhmm(at.utc)} UTC`
  return `${at.local} local (${hhmm(at.utc)} UTC)`
}

function riseClock(isoUtc: string, timeZone: string | null): string {
  const local = timeZone ? formatInZone(isoUtc, timeZone) : null
  return local ? `${hhmm(isoUtc)} UTC (${local} local)` : `${hhmm(isoUtc)} UTC`
}

/** Refine a rise to the minute between a sample below the horizon and the next one above it. */
function bisectRise(target: Target, site: SiteCoords, belowMs: number, aboveMs: number): number {
  let low = belowMs
  let high = aboveMs
  while (high - low > MINUTE_MS) {
    const mid = Math.round((low + high) / 2)
    if (targetAltAz(target, new Date(mid), site).altDeg >= 0) high = mid
    else low = mid
  }
  return high
}

/**
 * The next time the target crosses the horizon inside the night's 24 h window.
 *
 * `computeVisibility` with a 0 degree floor answers "does it ever come up
 * tonight"; the scan then finds the crossing that is still ahead of the slider,
 * which is not always the start of the longest run (a planet can set in the
 * afternoon and rise again before dawn).
 */
function nextRiseUtc(
  target: Target,
  night: NightEphemeris,
  site: SiteCoords,
  fromMs: number,
): { utc: string | null; everUp: boolean } {
  const visibility = computeVisibility(target, night, site, {
    minAltDeg: 0,
    interval: { startUtc: night.windowStartUtc, endUtc: night.windowEndUtc },
    minMoonSepDeg: 0,
    minWindowMinutes: 0,
  })
  if (!visibility.window) return { utc: null, everUp: false }

  const windowEndMs = Date.parse(night.windowEndUtc)
  let prevMs = fromMs
  let prevAlt = targetAltAz(target, new Date(fromMs), site).altDeg
  for (let t = fromMs + RISE_SCAN_STEP_MS; t <= windowEndMs; t += RISE_SCAN_STEP_MS) {
    const alt = targetAltAz(target, new Date(t), site).altDeg
    if (prevAlt < 0 && alt >= 0) {
      return { utc: new Date(bisectRise(target, site, prevMs, t)).toISOString(), everUp: true }
    }
    prevMs = t
    prevAlt = alt
  }
  return { utc: null, everUp: true }
}

function run(input: Record<string, unknown>): ToolResult<PointSkyMapData> {
  const state = store.getState()
  const site = state.site
  const timeUtc = state.timeUtc
  const at = new Date(timeUtc)
  const when = stamp(timeUtc, site.timeZone)

  const rawTarget = input.target
  if (rawTarget !== undefined && rawTarget !== null && typeof rawTarget !== 'string') {
    return fail('invalid_input', 'target must be a target id or name, such as "M31" or "Saturn".')
  }
  const rawHighlight = input.highlight
  if (rawHighlight !== undefined && rawHighlight !== null && !Array.isArray(rawHighlight)) {
    return fail('invalid_input', 'highlight must be an array of target ids or names, or [] to clear.')
  }
  for (const key of ['altitude_deg', 'azimuth_deg', 'fov_deg'] as const) {
    const value = input[key]
    if (value !== undefined && value !== null && !isFiniteNumber(value)) {
      return fail('invalid_input', `${key} must be a number in degrees.`)
    }
  }

  const wantsReset = input.reset === true
  const hasAlt = isFiniteNumber(input.altitude_deg)
  const hasAz = isFiniteNumber(input.azimuth_deg)
  const hasFov = isFiniteNumber(input.fov_deg)
  const hasHighlight = Array.isArray(rawHighlight)
  const query = typeof rawTarget === 'string' ? rawTarget.trim() : ''

  if (!query && !wantsReset && !hasAlt && !hasAz && !hasFov && !hasHighlight) {
    return fail(
      'invalid_input',
      'point_sky_map needs something to do: pass target, or altitude_deg and azimuth_deg, or fov_deg, or reset:true, or highlight.',
      'Example: { "target": "M31", "fov_deg": 40 }.',
    )
  }

  // Two arguments that cancel each other are a misunderstanding, not a request.
  // A schema cannot express "these are mutually exclusive" in a form strict
  // function-calling validators accept, so the refusal happens here, with the
  // corrected call spelled out.
  if (query && wantsReset) {
    return fail(
      'invalid_input',
      'Pass either target or reset:true, not both.',
      'Example: { "target": "M31", "fov_deg": 40 }',
    )
  }
  if (hasAlt !== hasAz) {
    return fail(
      'invalid_input',
      'Pass altitude_deg and azimuth_deg together.',
      'Example: { "altitude_deg": 45, "azimuth_deg": 180, "fov_deg": 60 }',
    )
  }

  let target: Target | null = null
  if (query) {
    const found = getTarget(query)
    if (!found) {
      const suggestions = searchTargets(query, 3).map((t) => `${t.id} (${t.name})`)
      return fail(
        'unknown_target',
        `"${query}" does not match any target in the catalog (110 Messier objects, 7 planets, the Moon and the bright stars).`,
        suggestions.length > 0
          ? `Did you mean ${suggestions.join(', ')}?`
          : 'Use a Messier id like "M31", a planet name, "Moon" or a bright star name.',
      )
    }
    target = found
  }

  // --- where to point ------------------------------------------------------
  const current = state.view
  let center = { altDeg: current.centerAltDeg, azDeg: current.centerAzDeg }
  let fov = current.fovDeg
  let targetAlt = { altDeg: 0, azDeg: 0 }

  if (wantsReset) {
    center = { altDeg: DOME_VIEW.centerAltDeg, azDeg: DOME_VIEW.centerAzDeg }
    fov = DOME_VIEW.fovDeg
  }
  if (target) {
    targetAlt = targetAltAz(target, at, site)
    center = { altDeg: targetAlt.altDeg, azDeg: targetAlt.azDeg }
    fov = hasFov ? (input.fov_deg as number) : DEFAULT_TARGET_FOV_DEG
  } else {
    if (hasAlt) center.altDeg = input.altitude_deg as number
    if (hasAz) center.azDeg = input.azimuth_deg as number
    if (hasFov) fov = input.fov_deg as number
  }

  const view = clampView({ centerAltDeg: center.altDeg, centerAzDeg: center.azDeg, fovDeg: fov })

  // --- highlights ----------------------------------------------------------
  const rejected: RejectedItem[] = []
  let highlighted: string[] = [...state.highlightedIds]
  if (hasHighlight) {
    const ids: string[] = []
    for (const raw of rawHighlight as unknown[]) {
      if (typeof raw !== 'string' || raw.trim() === '') {
        rejected.push({ id: String(raw), name: String(raw), reason: 'not a target id or name' })
        continue
      }
      const hit = getTarget(raw)
      if (!hit) {
        rejected.push({ id: raw, name: raw, reason: 'unknown target' })
        continue
      }
      if (!ids.includes(hit.id)) ids.push(hit.id)
    }
    highlighted = ids
  }

  // --- caveats -------------------------------------------------------------
  const caveats: string[] = []
  let nextRise: Stamp | null = null
  if (target && targetAlt.altDeg < 0) {
    const night = getNight(state.nightOf, site)
    const rise = nextRiseUtc(target, night, site, at.getTime())
    if (rise.utc) {
      nextRise = stamp(rise.utc, site.timeZone)
      caveats.push(
        `${target.id} is below the horizon at ${hhmm(timeUtc)} UTC (altitude ${Math.round(targetAlt.altDeg)}°); it rises at ${riseClock(rise.utc, site.timeZone)}.`,
      )
    } else if (rise.everUp) {
      caveats.push(
        `${target.id} is below the horizon at ${hhmm(timeUtc)} UTC (altitude ${Math.round(targetAlt.altDeg)}°) and does not rise again during the night of ${state.nightOf}.`,
      )
    } else {
      caveats.push(
        `${target.id} never rises above the horizon at ${site.name} on the night of ${state.nightOf}.`,
      )
    }
  }
  if (rejected.length > 0) {
    caveats.push(`${rejected.length} highlight target(s) were not recognised and were skipped.`)
  }

  // The reticle pulse is shorter than the swing of the dome, so the mark that
  // says "the agent put you here" would be gone by the time the map arrives.
  // Centring on a target therefore also highlights it, and the red agent ring
  // stays on the object after the pulse. Anything the caller highlighted is
  // kept.
  if (target && !highlighted.includes(target.id)) highlighted = [...highlighted, target.id]

  // --- move the shared map -------------------------------------------------
  store.getState().setView({ ...view, animate: true }, 'agent')
  if (target) store.getState().select(target.id, 'agent')
  if (hasHighlight || target) store.getState().setHighlights(highlighted, 'agent')

  // --- what to tell the agent ---------------------------------------------
  const aboveHorizon = target ? targetAlt.altDeg > 0 : false
  const targetData: PointSkyMapTargetData | null = target
    ? {
        id: target.id,
        name: target.name,
        type: target.type,
        altitude_deg: roundTo(targetAlt.altDeg, 2),
        azimuth_deg: roundTo(targetAlt.azDeg, 2),
        direction: compassDirection(targetAlt.azDeg),
        above_horizon: aboveHorizon,
        airmass: aboveHorizon ? roundTo(airmass(targetAlt.altDeg) ?? 0, 3) : null,
        next_rise: nextRise,
      }
    : null

  const fovClause = `field of view ${roundTo(view.fovDeg, 1)}°`
  let summary: string
  if (targetData) {
    const place = `altitude ${roundTo(targetData.altitude_deg, 1)}°, azimuth ${Math.round(targetData.azimuth_deg)}° ${targetData.direction}`
    summary = aboveHorizon
      ? `Sky map centered on ${targetData.id} (${targetData.name}) at ${place}, airmass ${targetData.airmass}, ${fovClause}, at ${whenPhrase(when)}.`
      : `Sky map centered on ${targetData.id} (${targetData.name}), which is below the horizon at ${place}, ${fovClause}, at ${whenPhrase(when)}.`
  } else if (wantsReset && !hasAlt && !hasAz) {
    summary = `Sky map reset to the whole sky dome (${fovClause}) at ${whenPhrase(when)}.`
  } else if (hasAlt || hasAz) {
    summary = `Sky map centered on altitude ${roundTo(view.centerAltDeg, 1)}°, azimuth ${Math.round(view.centerAzDeg)}° ${compassDirection(view.centerAzDeg)}, ${fovClause}, at ${whenPhrase(when)}.`
  } else if (hasFov) {
    summary = `Sky map zoomed to ${fovClause} at ${whenPhrase(when)}.`
  } else {
    summary = `Sky map highlights updated at ${whenPhrase(when)}.`
  }
  if (hasHighlight) {
    summary +=
      highlighted.length > 0
        ? ` Highlighted ${highlighted.join(', ')}.`
        : ' Agent highlights cleared.'
  }

  return ok(
    summary,
    {
      view: {
        center_alt_deg: roundTo(view.centerAltDeg, 2),
        center_az_deg: roundTo(view.centerAzDeg, 2),
        fov_deg: roundTo(view.fovDeg, 2),
      },
      time: when,
      target: targetData,
      highlighted,
    },
    site,
    { rejected, caveats },
  )
}

export const pointSkyMapTool: ModelContextToolDefinition = defineTool<PointSkyMapData>({
  name: 'point_sky_map',
  title: 'Point the shared sky map',
  description: `Use this to move the shared sky map the person is looking at: center it on a target (Messier id like "M31", a planet, "Moon" or a bright star) or on an explicit altitude/azimuth, set the zoom as a field of view in degrees (186 = whole sky dome, 60 = a constellation, 10 = a cluster), and optionally highlight objects. Pass at least one of target, altitude_deg with azimuth_deg, fov_deg, highlight or reset: an empty call is refused with invalid_input. Two combinations are refused as well, each with the corrected call in the hint: target together with reset:true (they contradict each other), and altitude_deg without azimuth_deg or the other way round (a direction needs both). The map animates smoothly so the person sees the move and the object you centred on keeps a red agent ring afterwards; call describe_current_view afterwards if you need to know what became visible. Returns where the target is at the map's current time (altitude, azimuth, compass direction, above or below the horizon) and warns when it is below the horizon. Does not change the plan.`,
  inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run,
})
