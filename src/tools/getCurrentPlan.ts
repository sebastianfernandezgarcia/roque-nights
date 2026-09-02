/**
 * Tool 10: get_current_plan.
 *
 * The committed plan as an observer would check it before going out: every
 * block re-measured against tonight's real sky (altitude at the start, at the
 * end and at the peak, airmass and Moon distance at mid-block) and every problem
 * named out loud. A plan that says "M7 22:00-22:45" and nothing else is a lie by
 * omission if M7 never gets above 26 degrees.
 *
 * This module also owns `planItemView`, the one shape a plan item takes when an
 * agent reads it, reused by propose_plan, commit_proposal and modify_plan.
 */

import { getNight } from '../astro/cache'
import { getTarget } from '../astro/catalog'
import type { Target } from '../astro/catalog'
import type { DarknessStatus, NightEphemeris, SiteCoords } from '../astro/night'
import {
  airmass,
  apparentMagnitude,
  computeVisibility,
  moonSeparationDeg,
  targetAltAz,
} from '../astro/targets'
import { roundTo } from '../astro/time'
import { store } from '../state/store'
import type { ActorSource, Filters, PlanItem } from '../state/types'
import type { Stamp, ToolResult } from './envelope'
import { defineTool, ok, stamp } from './envelope'
import { planStaleMessage } from './planStale'

const MINUTE_MS = 60_000
/** Altitude sampling inside a block, for the peak. */
const BLOCK_STEP_MS = 5 * MINUTE_MS

/** How one plan item looks to an agent. Shared by every tool that returns plan items. */
export interface PlanItemView {
  item_id: string
  target_id: string
  name: string
  start: Stamp
  end: Stamp
  minutes: number
  note: string | null
  source: ActorSource
}

export interface PlanItemReport extends PlanItemView {
  type: string
  /** Apparent visual magnitude: the catalog value for fixed objects, computed for bodies. */
  magnitude: number | null
  /** When the target crosses the meridian during this night, null when it never does. */
  transit: Stamp
  transit_altitude_deg: number | null
  altitude_start_deg: number | null
  altitude_end_deg: number | null
  peak_altitude_deg: number | null
  airmass_mid: number | null
  moon_separation_deg: number | null
  warnings: string[]
}

export interface GetCurrentPlanData {
  night_of: string
  darkness: { start: Stamp; end: Stamp; status: DarknessStatus }
  items: PlanItemReport[]
  total_minutes: number
  proposals_pending: number
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

export function minutesBetween(startUtc: string, endUtc: string): number {
  const minutes = (Date.parse(endUtc) - Date.parse(startUtc)) / MINUTE_MS
  return Number.isFinite(minutes) ? Math.round(minutes) : 0
}

export function planItemView(item: PlanItem, timeZone: string | null): PlanItemView {
  return {
    item_id: item.id,
    target_id: item.targetId,
    name: item.targetName,
    start: stamp(item.startUtc, timeZone),
    end: stamp(item.endUtc, timeZone),
    minutes: minutesBetween(item.startUtc, item.endUtc),
    note: item.note ?? null,
    source: item.source,
  }
}

function hhmm(isoUtc: string): string {
  return isoUtc.slice(11, 16)
}

/** Highest altitude reached inside the block, sampled every 5 minutes. */
function peakAltitude(target: Target, startMs: number, endMs: number, site: SiteCoords): number {
  let peak = Number.NEGATIVE_INFINITY
  for (let t = startMs; t < endMs; t += BLOCK_STEP_MS) {
    peak = Math.max(peak, targetAltAz(target, new Date(t), site).altDeg)
  }
  return Math.max(peak, targetAltAz(target, new Date(endMs), site).altDeg)
}

/** Everything wrong with one block, in the order an observer would notice it. */
function blockWarnings(
  item: PlanItem,
  target: Target | undefined,
  night: NightEphemeris,
  filters: Filters,
  others: PlanItem[],
  altitudes: { start: number | null; end: number | null; peak: number | null; mid: number | null },
  moonSep: number | null,
): string[] {
  const warnings: string[] = []
  const startMs = Date.parse(item.startUtc)
  const endMs = Date.parse(item.endUtc)

  // --- darkness ------------------------------------------------------------
  const darkStart = night.darkness.startUtc
  const darkEnd = night.darkness.endUtc
  if (!darkStart || !darkEnd) {
    warnings.push(
      `there is no astronomical darkness on the night of ${night.nightOf} (${night.darkness.status})`,
    )
  } else {
    const darkStartMs = Date.parse(darkStart)
    const darkEndMs = Date.parse(darkEnd)
    if (endMs <= darkStartMs || startMs >= darkEndMs) {
      warnings.push(
        `outside astronomical darkness (${hhmm(darkStart)}-${hhmm(darkEnd)} UTC)`,
      )
    } else {
      if (startMs < darkStartMs) {
        warnings.push(
          `starts ${Math.round((darkStartMs - startMs) / MINUTE_MS)} min before astronomical darkness (${hhmm(darkStart)} UTC)`,
        )
      }
      if (endMs > darkEndMs) {
        warnings.push(
          `ends ${Math.round((endMs - darkEndMs) / MINUTE_MS)} min after astronomical darkness (${hhmm(darkEnd)} UTC)`,
        )
      }
    }
  }

  // --- altitude ------------------------------------------------------------
  if (!target) {
    warnings.push(`${item.targetId} is not in the catalog, so its altitude cannot be checked`)
  } else if (altitudes.peak !== null) {
    const floor = filters.minAltDeg
    if (altitudes.peak < floor) {
      warnings.push(
        `stays below the minimum altitude of ${Math.round(floor)}° for the whole block (peak ${Math.round(altitudes.peak)}°)`,
      )
    } else {
      if (altitudes.start !== null && altitudes.start < floor) {
        warnings.push(
          `below the minimum altitude of ${Math.round(floor)}° at the start (${Math.round(altitudes.start)}°)`,
        )
      }
      if (altitudes.mid !== null && altitudes.mid < floor) {
        warnings.push(
          `below the minimum altitude of ${Math.round(floor)}° at mid-block (${Math.round(altitudes.mid)}°)`,
        )
      }
      if (altitudes.end !== null && altitudes.end < floor) {
        warnings.push(
          `below the minimum altitude of ${Math.round(floor)}° at the end (${Math.round(altitudes.end)}°)`,
        )
      }
    }
    if (altitudes.start !== null && altitudes.start <= 0) warnings.push('below the horizon at the start')
    if (altitudes.end !== null && altitudes.end <= 0) warnings.push('below the horizon at the end')
  }

  // --- Moon ----------------------------------------------------------------
  if (
    moonSep !== null &&
    target?.type !== 'moon' &&
    moonSep < filters.minMoonSepDeg &&
    (night.moon.upDuringDarknessPct ?? 0) > 0
  ) {
    warnings.push(
      `the Moon is only ${Math.round(moonSep)}° away at mid-block (minimum ${Math.round(filters.minMoonSepDeg)}°)`,
    )
  }

  // --- overlaps ------------------------------------------------------------
  for (const other of others) {
    if (other.id === item.id) continue
    const otherStart = Date.parse(other.startUtc)
    const otherEnd = Date.parse(other.endUtc)
    if (startMs < otherEnd && otherStart < endMs) {
      warnings.push(
        `overlaps ${other.targetId} (${hhmm(other.startUtc)}-${hhmm(other.endUtc)} UTC)`,
      )
    }
  }

  return warnings
}

function run(): ToolResult<GetCurrentPlanData> {
  const state = store.getState()
  const site = state.site
  const night = getNight(state.nightOf, site)
  const plan = [...state.plan].sort((a, b) => a.startUtc.localeCompare(b.startUtc))
  const pending = state.proposals.filter((proposal) => proposal.status === 'pending').length

  const darkness = {
    start: stamp(night.darkness.startUtc, site.timeZone),
    end: stamp(night.darkness.endUtc, site.timeZone),
    status: night.darkness.status,
  }

  if (plan.length === 0) {
    return ok(
      'The plan is empty.',
      {
        night_of: state.nightOf,
        darkness,
        items: [],
        total_minutes: 0,
        proposals_pending: pending,
      },
      site,
      {
        caveats:
          pending > 0
            ? [`${pending} proposal(s) are waiting for the person; call commit_proposal to apply one.`]
            : [],
      },
    )
  }

  const items: PlanItemReport[] = plan.map((item) => {
    const target = getTarget(item.targetId)
    const startMs = Date.parse(item.startUtc)
    const endMs = Date.parse(item.endUtc)
    const midMs = Math.round((startMs + endMs) / 2)

    let altStart: number | null = null
    let altEnd: number | null = null
    let altMid: number | null = null
    let peak: number | null = null
    let airmassMid: number | null = null
    let moonSep: number | null = null
    let magnitude: number | null = null
    let transitUtc: string | null = null
    let transitAltDeg: number | null = null

    if (target && Number.isFinite(startMs) && Number.isFinite(endMs)) {
      altStart = roundTo(targetAltAz(target, new Date(startMs), site).altDeg, 2)
      altEnd = roundTo(targetAltAz(target, new Date(endMs), site).altDeg, 2)
      altMid = roundTo(targetAltAz(target, new Date(midMs), site).altDeg, 2)
      peak = roundTo(peakAltitude(target, startMs, endMs, site), 2)
      const am = airmass(altMid)
      airmassMid = am === null ? null : roundTo(am, 3)
      moonSep = roundTo(moonSeparationDeg(target, new Date(midMs), site), 1)
      // A planet's brightness swings by whole magnitudes along its orbit, so it
      // is computed for the middle of this block; a catalog object carries its
      // fixed value. "How faint is it" is the question a person asks next.
      const mag = apparentMagnitude(target, new Date(midMs))
      magnitude = mag === null ? null : roundTo(mag, 2)
      // Transit over the WHOLE night, not over the block: knowing that M31 peaks
      // an hour after the slot it was given is what makes a plan worth editing.
      const visibility = computeVisibility(target, night, site, {
        minAltDeg: 0,
        interval: { startUtc: night.windowStartUtc, endUtc: night.windowEndUtc },
        minMoonSepDeg: 0,
        minWindowMinutes: 0,
      })
      transitUtc = visibility.transitUtc
      transitAltDeg =
        visibility.transitAltDeg === null ? null : roundTo(visibility.transitAltDeg, 2)
    }

    return {
      ...planItemView(item, site.timeZone),
      type: target?.type ?? 'other',
      magnitude,
      transit: stamp(transitUtc, site.timeZone),
      transit_altitude_deg: transitAltDeg,
      altitude_start_deg: altStart,
      altitude_end_deg: altEnd,
      peak_altitude_deg: peak,
      airmass_mid: airmassMid,
      moon_separation_deg: moonSep,
      warnings: blockWarnings(
        item,
        target,
        night,
        state.filters,
        plan,
        { start: altStart, end: altEnd, peak, mid: altMid },
        moonSep,
      ),
    }
  })

  const totalMinutes = items.reduce((sum, item) => sum + item.minutes, 0)
  const firstStart = plan[0].startUtc
  const lastEnd = plan.reduce((latest, item) => (item.endUtc > latest ? item.endUtc : latest), plan[0].endUtc)
  const span = site.timeZone
    ? `${stamp(firstStart, site.timeZone).local?.slice(11)} to ${stamp(lastEnd, site.timeZone).local?.slice(11)} local`
    : `${hhmm(firstStart)} to ${hhmm(lastEnd)} UTC`
  const warned = items.filter((item) => item.warnings.length > 0)

  const tail =
    warned.length === 0
      ? 'no warnings'
      : `${warned.length} item${warned.length === 1 ? '' : 's'} with warnings: ${warned
          .slice(0, 3)
          .map((item) => `${item.target_id} ${item.warnings[0]}`)
          .join('; ')}`

  const summary =
    `Plan for the night of ${state.nightOf} at ${site.name}: ${items.length} item${items.length === 1 ? '' : 's'}, ` +
    `${roundTo(totalMinutes / 60, 1)} h from ${span}, ${tail}.`

  const caveats: string[] = []
  // The plan was scheduled for one sky; the app may now be showing another.
  // Every time below is still the time that was committed, so say so before the
  // agent reads the altitudes as if they were tonight's.
  const staleMessage = planStaleMessage(state)
  if (staleMessage) caveats.push(staleMessage)
  if (pending > 0) {
    caveats.push(`${pending} proposal(s) are still waiting for the person's review.`)
  }

  return ok(
    summary,
    {
      night_of: state.nightOf,
      darkness,
      items,
      total_minutes: totalMinutes,
      proposals_pending: pending,
    },
    site,
    { caveats },
  )
}

export const getCurrentPlanTool: ModelContextToolDefinition = defineTool<GetCurrentPlanData>({
  name: 'get_current_plan',
  title: 'Read the committed observing plan',
  description: `Use this to read the committed observing plan: ordered items with target, scheduled window (UTC and local), apparent magnitude, transit time and transit altitude for the night, altitude at start and end, peak altitude, airmass and Moon separation at mid-block, notes and who added them (person or agent), plus warnings (block outside astronomical darkness, target below the minimum altitude during the block, overlaps) and the status of pending proposals. If the app has moved to another site or night since the plan was committed, a caveat says so: the times below are the ones that were committed, not recomputed for the new sky. Read-only.`,
  inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run,
})
