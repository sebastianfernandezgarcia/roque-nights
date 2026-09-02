/**
 * Tool 6: describe_current_view.
 *
 * The page to agent direction of the circuit, and the reason Roque Nights is an
 * instrument rather than a data source: the agent can read what the human is
 * actually looking at (center, zoom, selection, favorites, filters, the ghost
 * plan and the last twenty things the person did) before it opens its mouth.
 * Everything here is derived, nothing is mutated.
 */

import { getNight } from '../astro/cache'
import { MESSIER_TARGETS, MOON, PLANETS, getTarget } from '../astro/catalog'
import type { Target } from '../astro/catalog'
import type { DarknessStatus } from '../astro/night'
import { altAzToVec, angularDistanceDeg } from '../astro/sky'
import { apparentMagnitude, compassDirection, targetAltAz } from '../astro/targets'
import { roundTo } from '../astro/time'
import { store } from '../state/store'
import type { HumanActionKind, ProposalDecision } from '../state/types'
import type { SiteRef, Stamp, ToolResult } from './envelope'
import { defineTool, ok, siteRef, stamp } from './envelope'

export const DEFAULT_MAX_VISIBLE_OBJECTS = 20
export const MAX_VISIBLE_OBJECTS = 60
/** A field of view this wide is the whole dome, so "inside the field of view" stops being news. */
const WHOLE_SKY_FOV_DEG = 170

/** Messier objects, planets and the Moon: what the map draws as pointable objects. */
const SCANNED_TARGETS: Target[] = [...MESSIER_TARGETS, ...PLANETS, MOON]

export interface VisibleObject {
  id: string
  name: string
  type: string
  altitude_deg: number
  azimuth_deg: number
  direction: string
  magnitude: number | null
  in_field_of_view: boolean
  is_favorite: boolean
  is_selected: boolean
  is_highlighted: boolean
  in_plan: boolean
}

export interface DescribeCurrentViewData {
  site: SiteRef
  night_of: string
  time: Stamp
  darkness_status: DarknessStatus
  darkness: { start: Stamp; end: Stamp }
  view: { center_alt_deg: number; center_az_deg: number; fov_deg: number }
  visible_objects: VisibleObject[]
  visible_object_count: number
  in_field_of_view_count: number
  selected: {
    id: string
    name: string
    type: string
    altitude_deg: number | null
    azimuth_deg: number | null
    direction: string | null
    in_field_of_view: boolean
  } | null
  favorites: { id: string; name: string }[]
  highlighted: { id: string; name: string }[]
  filters: {
    min_altitude_deg: number
    types: string[] | null
    max_magnitude: number | null
    min_moon_separation_deg: number
  }
  plan: { items: number; first_start: Stamp; last_end: Stamp; targets: string[] }
  proposals: {
    id: string
    status: string
    origin: string
    items: number
    rationale: string | null
    decisions: {
      item_id: string
      target: string
      decision: ProposalDecision
      reason: string | null
    }[]
  }[]
  recent_human_actions: {
    at: string
    kind: HumanActionKind
    detail: string
    seconds_ago: number
  }[]
  night_mode: boolean
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    include_visible_objects: {
      type: 'boolean',
      default: true,
      description: 'Set false to skip the object scan when you only need the view, plan and history.',
    },
    max_visible_objects: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_VISIBLE_OBJECTS,
      default: DEFAULT_MAX_VISIBLE_OBJECTS,
      description: 'How many objects to list, in-field first and brightest first.',
    },
  },
  additionalProperties: false,
} as const

/** How a human action reads in a sentence. */
const ACTION_VERB: Record<HumanActionKind, string> = {
  drag_map: 'dragged the map',
  zoom_map: 'zoomed the map',
  tap_object: 'tapped',
  toggle_favorite: 'toggled favorite',
  set_time: 'moved the time slider to',
  set_night: 'changed the night to',
  set_site: 'changed the site to',
  accept_item: 'accepted',
  reject_item: 'rejected',
  edit_plan: 'edited the plan',
  clear_plan: 'cleared the plan',
  toggle_night_mode: 'toggled red light',
}

function hhmm(isoUtc: string): string {
  return isoUtc.slice(11, 16)
}

function whenPhrase(at: Stamp): string {
  if (at.utc === null) return 'an unknown time'
  if (at.local === null) return `${hhmm(at.utc)} UTC`
  return `${at.local} local (${hhmm(at.utc)} UTC)`
}

function ago(seconds: number): string {
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 360) / 10} h ago`
}

function nameOf(id: string): string {
  return getTarget(id)?.name ?? id
}

function run(input: Record<string, unknown>): ToolResult<DescribeCurrentViewData> {
  const state = store.getState()
  const site = state.site
  const at = new Date(state.timeUtc)
  const when = stamp(state.timeUtc, site.timeZone)
  const night = getNight(state.nightOf, site)

  const includeObjects = input.include_visible_objects !== false
  const rawMax = input.max_visible_objects
  const maxObjects =
    typeof rawMax === 'number' && Number.isFinite(rawMax)
      ? Math.min(MAX_VISIBLE_OBJECTS, Math.max(1, Math.round(rawMax)))
      : DEFAULT_MAX_VISIBLE_OBJECTS

  const view = state.view
  const centerVec = altAzToVec(view.centerAltDeg, view.centerAzDeg)
  const halfFov = view.fovDeg / 2
  const favorites = new Set(state.favoriteIds)
  const highlighted = new Set(state.highlightedIds)
  const planTargets = new Set(state.plan.map((item) => item.targetId))

  // --- what is up right now -------------------------------------------------
  const scanned: VisibleObject[] = []
  for (const target of SCANNED_TARGETS) {
    const aa = targetAltAz(target, at, site)
    if (aa.altDeg <= 0) continue
    const mag = apparentMagnitude(target, at)
    scanned.push({
      id: target.id,
      name: target.name,
      type: target.type,
      altitude_deg: roundTo(aa.altDeg, 2),
      azimuth_deg: roundTo(aa.azDeg, 2),
      direction: compassDirection(aa.azDeg),
      magnitude: mag === null ? null : roundTo(mag, 2),
      in_field_of_view: angularDistanceDeg(centerVec, altAzToVec(aa.altDeg, aa.azDeg)) <= halfFov,
      is_favorite: favorites.has(target.id),
      is_selected: state.selectedId === target.id,
      is_highlighted: highlighted.has(target.id),
      in_plan: planTargets.has(target.id),
    })
  }
  scanned.sort(
    (a, b) =>
      Number(b.in_field_of_view) - Number(a.in_field_of_view) ||
      (a.magnitude ?? 99) - (b.magnitude ?? 99) ||
      a.id.localeCompare(b.id),
  )
  const inFovCount = scanned.filter((o) => o.in_field_of_view).length
  const visibleObjects = includeObjects ? scanned.slice(0, maxObjects) : []

  const caveats: string[] = []
  if (includeObjects && scanned.length > visibleObjects.length) {
    caveats.push(
      `Listing ${visibleObjects.length} of the ${scanned.length} catalog objects above the horizon (in-field first, then brightest); raise max_visible_objects for more.`,
    )
  }

  // --- selection, favorites, highlights -------------------------------------
  let selected: DescribeCurrentViewData['selected'] = null
  if (state.selectedId) {
    const target = getTarget(state.selectedId)
    if (target) {
      const aa = targetAltAz(target, at, site)
      selected = {
        id: target.id,
        name: target.name,
        type: target.type,
        altitude_deg: roundTo(aa.altDeg, 2),
        azimuth_deg: roundTo(aa.azDeg, 2),
        direction: compassDirection(aa.azDeg),
        in_field_of_view: angularDistanceDeg(centerVec, altAzToVec(aa.altDeg, aa.azDeg)) <= halfFov,
      }
    } else {
      selected = {
        id: state.selectedId,
        name: state.selectedId,
        type: 'other',
        altitude_deg: null,
        azimuth_deg: null,
        direction: null,
        in_field_of_view: false,
      }
    }
  }

  // --- plan and proposals ----------------------------------------------------
  const plan = state.plan
  const planData = {
    items: plan.length,
    first_start: stamp(plan.length > 0 ? plan[0].startUtc : null, site.timeZone),
    last_end: stamp(
      plan.length > 0
        ? plan.reduce((latest, item) => (item.endUtc > latest ? item.endUtc : latest), plan[0].endUtc)
        : null,
      site.timeZone,
    ),
    targets: plan.map((item) => item.targetId),
  }

  const proposals = state.proposals.slice(0, 5).map((proposal) => ({
    id: proposal.id,
    status: proposal.status,
    origin: proposal.origin,
    items: proposal.items.length,
    rationale: proposal.rationale ?? null,
    decisions: proposal.items
      .filter((item) => proposal.decisions[item.id] !== undefined)
      .map((item) => ({
        item_id: item.id,
        target: item.targetId,
        decision: proposal.decisions[item.id].decision,
        reason: proposal.decisions[item.id].reason ?? null,
      })),
  }))

  const nowMs = Date.now()
  const recent = state.humanActions.map((action) => ({
    at: action.at,
    kind: action.kind,
    detail: action.detail,
    seconds_ago: Math.max(0, Math.round((nowMs - Date.parse(action.at)) / 1000)),
  }))

  // --- one quotable sentence -------------------------------------------------
  const wholeSky = view.fovDeg >= WHOLE_SKY_FOV_DEG && view.centerAltDeg >= 80
  const viewClause = wholeSky
    ? `Looking at the whole sky (fov ${roundTo(view.fovDeg, 0)}°)`
    : `Looking at altitude ${roundTo(view.centerAltDeg, 0)}°, azimuth ${roundTo(view.centerAzDeg, 0)}° ${compassDirection(view.centerAzDeg)} (fov ${roundTo(view.fovDeg, 0)}°)`

  const parts: string[] = [
    `${viewClause} from ${site.name} at ${whenPhrase(when)} on the night of ${state.nightOf}`,
  ]
  parts.push(
    wholeSky
      ? `${scanned.length} catalog objects above the horizon`
      : `${scanned.length} catalog objects above the horizon, ${inFovCount} inside the field of view`,
  )
  if (selected) parts.push(`selected ${selected.id}`)
  if (state.favoriteIds.length > 0) {
    parts.push(`favorites: ${state.favoriteIds.map(nameOf).join(', ')}`)
  }
  parts.push(plan.length > 0 ? `plan has ${plan.length} items` : 'the plan is empty')

  const pending = state.proposals.filter((proposal) => proposal.status === 'pending')
  if (pending.length > 0) {
    let accepted = 0
    let rejected = 0
    let firstReason: string | null = null
    for (const proposal of pending) {
      for (const decision of Object.values(proposal.decisions)) {
        if (decision.decision === 'accepted') accepted++
        else {
          rejected++
          if (firstReason === null && decision.reason) firstReason = decision.reason
        }
      }
    }
    const detail =
      accepted + rejected > 0
        ? ` (${accepted} accepted, ${rejected} rejected${firstReason ? `: "${firstReason}"` : ''})`
        : ' (no decisions yet)'
    parts.push(
      `${pending.length} proposal${pending.length === 1 ? '' : 's'} pending${detail}`,
    )
  }

  let summary = `${parts.join('; ')}.`
  const last = recent[0]
  if (last) {
    summary += ` Last action: ${ACTION_VERB[last.kind]}${last.detail ? ` ${last.detail}` : ''} ${ago(last.seconds_ago)}.`
  }

  return ok(
    summary,
    {
      site: siteRef(site),
      night_of: state.nightOf,
      time: when,
      darkness_status: night.darkness.status,
      darkness: {
        start: stamp(night.darkness.startUtc, site.timeZone),
        end: stamp(night.darkness.endUtc, site.timeZone),
      },
      view: {
        center_alt_deg: roundTo(view.centerAltDeg, 2),
        center_az_deg: roundTo(view.centerAzDeg, 2),
        fov_deg: roundTo(view.fovDeg, 2),
      },
      visible_objects: visibleObjects,
      visible_object_count: scanned.length,
      in_field_of_view_count: inFovCount,
      selected,
      favorites: state.favoriteIds.map((id) => ({ id, name: nameOf(id) })),
      highlighted: state.highlightedIds.map((id) => ({ id, name: nameOf(id) })),
      filters: {
        min_altitude_deg: state.filters.minAltDeg,
        types: state.filters.types,
        max_magnitude: state.filters.maxMag,
        min_moon_separation_deg: state.filters.minMoonSepDeg,
      },
      plan: planData,
      proposals,
      recent_human_actions: recent,
      night_mode: state.nightMode,
    },
    site,
    { caveats },
  )
}

export const describeCurrentViewTool: ModelContextToolDefinition =
  defineTool<DescribeCurrentViewData>({
    name: 'describe_current_view',
    title: 'Read what the person is looking at',
    description: `Use this to see what the person sees BEFORE proposing anything: site, selected night, slider time, sky-map center and field of view, the objects currently on screen above the horizon (planets, Moon, Messier objects with altitude, azimuth and whether they are inside the field of view), the selected object, the person's favorites (objects they tapped on the map), agent highlights, active filters, a summary of the committed plan, pending proposals with the person's accept/reject decisions and reasons, and the last 20 human actions on the page (drags, taps, edits) with timestamps. Read-only and cheap; call it whenever the person refers to "this", "that one", "here" or "what I'm looking at". To change the site the page shows, submit the page form named set_observing_site (fields: site_id, latitude, longitude, elevation_m, time_zone, name); no tool moves the app to another site.`,
    inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    run,
  })
