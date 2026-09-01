// Shared vocabulary of the whole app. Humans (React UI) and agents (WebMCP
// tools) drive the same store, so both sides code against these names.

export type ActorSource = 'human' | 'agent'

export interface Site {
  id: string | null // id from src/data/sites.ts when it is a catalog site, else null
  name: string
  latitude: number // decimal degrees, north positive
  longitude: number // decimal degrees, EAST positive
  elevationM: number
  timeZone: string | null // IANA zone; null = unknown (custom coordinates without a zone)
}

export type TargetType =
  | 'galaxy'
  | 'open_cluster'
  | 'globular_cluster'
  | 'planetary_nebula'
  | 'diffuse_nebula'
  | 'supernova_remnant'
  | 'other' // Messier types (src/data)
  | 'planet'
  | 'moon'
  | 'star'

export interface PlanItem {
  id: string // crypto.randomUUID()
  targetId: string // e.g. 'M31', 'jupiter', 'moon', 'star:vega'
  targetName: string
  startUtc: string // ISO
  endUtc: string // ISO
  note?: string
  source: ActorSource
  proposalId?: string
}

export type ProposalDecision = 'accepted' | 'rejected'

export interface Proposal {
  id: string
  createdAt: string
  rationale?: string
  items: PlanItem[]
  unscheduled: { targetId: string; name: string; reason: string }[]
  replaceExisting: boolean
  status: 'pending' | 'committed' | 'dismissed'
  /** Keyed by item id. */
  decisions: Record<string, { decision: ProposalDecision; reason?: string; at: string }>
  origin: 'agent' | 'import'
}

export interface ActivityEntry {
  id: string
  at: string
  source: ActorSource
  action: string // tool name or UI action ('set_night', 'tap_object', ...)
  detail: string // compact input summary
  status: 'running' | 'ok' | 'error'
  durationMs?: number
  result?: string // summary excerpt or error message (<= 160 chars)
}

export type HumanActionKind =
  | 'drag_map'
  | 'zoom_map'
  | 'tap_object'
  | 'toggle_favorite'
  | 'set_time'
  | 'set_night'
  | 'set_site'
  | 'accept_item'
  | 'reject_item'
  | 'edit_plan'
  | 'clear_plan'
  | 'toggle_night_mode'

export interface HumanAction {
  at: string
  kind: HumanActionKind
  detail: string
}

export interface SkyViewState {
  centerAltDeg: number
  centerAzDeg: number
  fovDeg: number
  animate: boolean
}

export interface Filters {
  minAltDeg: number
  types: TargetType[] | null
  maxMag: number | null
  minMoonSepDeg: number
}

/**
 * A half-open time span in UTC ISO strings. Same shape as the `Interval` of
 * src/astro/night.ts, repeated here so the store depends on no astronomy code.
 */
export interface Interval {
  startUtc: string
  endUtc: string
}
