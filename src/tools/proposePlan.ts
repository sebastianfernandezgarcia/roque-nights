/**
 * Tool 7: propose_plan.
 *
 * The human-in-the-loop primitive of Roque Nights. The agent never writes the
 * plan behind the person's back: it drops a dotted ghost plan on the night
 * timeline, the person accepts or rejects it item by item with a reason, and the
 * agent reads that reason back. What cannot be fitted comes back with the
 * astronomical excuse attached, which is far more useful than a shorter list.
 */

import { getNight } from '../astro/cache'
import { getTarget } from '../astro/catalog'
import type { Target } from '../astro/catalog'
import { scheduleTargets } from '../astro/schedule'
import type { ScheduleRequest } from '../astro/schedule'
import { roundTo } from '../astro/time'
import { planIntervals, store } from '../state/store'
import type { PlanItem } from '../state/types'
import { toolsDelta } from './contextualNames'
import type { RejectedItem, Stamp, ToolResult } from './envelope'
import { defineTool, fail, ok, stamp } from './envelope'
import { planItemView } from './getCurrentPlan'
import type { PlanItemView } from './getCurrentPlan'
import { TARGET_REF_SCHEMA } from './schemas'

export const DEFAULT_DURATION_MINUTES = 45
export const MIN_DURATION_MINUTES = 10
export const MAX_DURATION_MINUTES = 300
export const MAX_TARGETS = 20

export const HOW_TO_APPLY =
  'Call commit_proposal with this proposal_id after the person reviews it, or they can click Accept in the Plan panel.'

export interface ProposedItem extends PlanItemView {
  peak_altitude_deg: number
}

export interface ProposePlanData {
  proposal_id: string | null
  items: ProposedItem[]
  unscheduled: { target_id: string; name: string; reason: string }[]
  replace_existing: boolean
  min_altitude_deg: number
  night_of: string
  darkness: { start: Stamp; end: Stamp }
  how_to_apply: string
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    targets: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_TARGETS,
      description: 'The targets to fit into tonight, in any order; the app schedules them.',
      items: {
        type: 'object',
        properties: {
          target: TARGET_REF_SCHEMA,
          duration_minutes: {
            type: 'integer',
            minimum: MIN_DURATION_MINUTES,
            maximum: MAX_DURATION_MINUTES,
            default: DEFAULT_DURATION_MINUTES,
          },
          note: { type: 'string', maxLength: 200 },
        },
        required: ['target'],
        additionalProperties: false,
      },
    },
    rationale: {
      type: 'string',
      maxLength: 400,
      description: 'One or two sentences the person will read next to the ghost plan.',
    },
    replace_existing: {
      type: 'boolean',
      default: false,
      description: 'True to propose replacing the committed plan instead of adding to it.',
    },
    min_altitude_deg: {
      type: 'number',
      minimum: 5,
      maximum: 85,
      description: 'Altitude floor for the blocks. Defaults to the filter the person set in the app.',
    },
  },
  required: ['targets'],
  additionalProperties: false,
} as const

function newId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function hhmm(isoUtc: string | null): string {
  return isoUtc ? isoUtc.slice(11, 16) : 'unknown'
}

function clock(at: Stamp): string {
  if (at.local) return at.local.slice(11)
  return hhmm(at.utc)
}

interface ParsedRequest {
  target: Target
  durationMinutes: number
  note?: string
}

function run(input: Record<string, unknown>): ToolResult<ProposePlanData> {
  const state = store.getState()
  const site = state.site
  const nightOf = state.nightOf
  const night = getNight(nightOf, site)

  const rawTargets = input.targets
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
    return fail(
      'invalid_input',
      'targets must be a non empty array of { target, duration_minutes?, note? }.',
      'Example: { "targets": [{ "target": "M31" }, { "target": "Saturn", "duration_minutes": 30 }] }.',
    )
  }
  if (rawTargets.length > MAX_TARGETS) {
    return fail('invalid_input', `targets accepts at most ${MAX_TARGETS} entries per call.`)
  }

  const rawFloor = input.min_altitude_deg
  if (rawFloor !== undefined && rawFloor !== null) {
    if (typeof rawFloor !== 'number' || !Number.isFinite(rawFloor) || rawFloor < 5 || rawFloor > 85) {
      return fail('invalid_input', 'min_altitude_deg must be a number of degrees between 5 and 85.')
    }
  }
  const minAltDeg = typeof rawFloor === 'number' ? rawFloor : state.filters.minAltDeg

  const rationale = typeof input.rationale === 'string' ? input.rationale.slice(0, 400) : undefined
  const replaceExisting = input.replace_existing === true

  // --- read the wish list ---------------------------------------------------
  const requests: ParsedRequest[] = []
  const rejected: RejectedItem[] = []
  const caveats: string[] = []

  for (const raw of rawTargets) {
    const entry: Record<string, unknown> =
      typeof raw === 'string' ? { target: raw } : ((raw ?? {}) as Record<string, unknown>)
    const ref = entry.target
    if (typeof ref !== 'string' || ref.trim() === '') {
      rejected.push({ id: String(ref), name: String(ref), reason: 'not a target id or name' })
      continue
    }
    const target = getTarget(ref)
    if (!target) {
      rejected.push({ id: ref, name: ref, reason: 'unknown target' })
      continue
    }
    if (requests.some((r) => r.target.id === target.id)) {
      rejected.push({ id: target.id, name: target.name, reason: 'listed twice in this call' })
      continue
    }
    let duration = DEFAULT_DURATION_MINUTES
    const rawDuration = entry.duration_minutes
    if (typeof rawDuration === 'number' && Number.isFinite(rawDuration)) {
      duration = Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, Math.round(rawDuration)))
      if (duration !== Math.round(rawDuration)) {
        caveats.push(
          `duration_minutes for ${target.id} was clamped to ${duration} min (allowed ${MIN_DURATION_MINUTES}-${MAX_DURATION_MINUTES}).`,
        )
      }
    }
    const note = typeof entry.note === 'string' ? entry.note.slice(0, 200) : undefined
    requests.push({ target, durationMinutes: duration, note })
  }

  if (requests.length === 0) {
    const names = rejected.map((item) => `"${item.id}"`).join(', ')
    return fail(
      'unknown_target',
      `None of the requested targets exist in the catalog: ${names}.`,
      'Use Messier ids ("M31"), planet names ("Saturn"), "Moon" or bright star names ("Vega"). find_observable_targets lists what is up tonight.',
    )
  }

  // --- fit them into the night ----------------------------------------------
  const scheduleRequests: ScheduleRequest[] = requests.map((r) => ({
    target: r.target,
    durationMinutes: r.durationMinutes,
    note: r.note,
  }))
  const scheduled = scheduleTargets(scheduleRequests, night, site, {
    minAltDeg,
    occupied: replaceExisting ? [] : planIntervals(state.plan),
  })

  for (const missed of scheduled.unscheduled) {
    rejected.push({ id: missed.targetId, name: missed.name, reason: missed.reason })
  }

  const darkness = {
    start: stamp(night.darkness.startUtc, site.timeZone),
    end: stamp(night.darkness.endUtc, site.timeZone),
  }
  const unscheduled = scheduled.unscheduled.map((missed) => ({
    target_id: missed.targetId,
    name: missed.name,
    reason: missed.reason,
  }))

  if (scheduled.blocks.length === 0) {
    caveats.push(
      'No proposal was created because none of the requested targets can be scheduled on this night. Lower min_altitude_deg, pick another night with rank_nights, or ask find_observable_targets what is up.',
    )
    return ok(
      `Nothing could be scheduled for the night of ${nightOf} at ${site.name}: ${unscheduled
        .map((item) => `${item.target_id} (${item.reason})`)
        .join('; ')}.`,
      {
        proposal_id: null,
        items: [],
        unscheduled,
        replace_existing: replaceExisting,
        min_altitude_deg: minAltDeg,
        night_of: nightOf,
        darkness,
        how_to_apply: HOW_TO_APPLY,
      },
      site,
      { rejected, caveats },
    )
  }

  // --- hand the ghost plan to the person -------------------------------------
  const peakById = new Map<string, number>()
  const items: PlanItem[] = scheduled.blocks.map((block) => {
    peakById.set(block.target.id, block.peakAltDeg)
    return {
      id: newId(),
      targetId: block.target.id,
      targetName: block.target.name,
      startUtc: block.startUtc,
      endUtc: block.endUtc,
      note: block.note,
      source: 'agent' as const,
    }
  })

  const before = store.getState()
  const proposal = before.addProposal({
    items,
    unscheduled: scheduled.unscheduled,
    replaceExisting,
    origin: 'agent',
    rationale,
  })
  const after = store.getState()

  const itemViews: ProposedItem[] = proposal.items.map((item) => ({
    ...planItemView(item, site.timeZone),
    peak_altitude_deg: roundTo(peakById.get(item.targetId) ?? 0, 2),
  }))

  const listed = itemViews
    .slice(0, 4)
    .map((item) => `${item.target_id} ${clock(item.start)}-${clock(item.end)}`)
    .join(', ')
  const more = itemViews.length > 4 ? ` and ${itemViews.length - 4} more` : ''
  const missedClause =
    rejected.length > 0
      ? ` Could not fit ${rejected.map((item) => `${item.id} (${item.reason})`).join('; ')}.`
      : ''
  const darkClause =
    darkness.start.utc && darkness.end.utc
      ? ` (darkness ${clock(darkness.start)}-${clock(darkness.end)}${site.timeZone ? ' local' : ' UTC'})`
      : ''

  const summary =
    `Proposed ${itemViews.length} target${itemViews.length === 1 ? '' : 's'} for the night of ${nightOf} at ${site.name}${darkClause}: ${listed}${more}.` +
    `${missedClause} Waiting for the person's review; nothing is committed yet.`

  return ok(
    summary,
    {
      proposal_id: proposal.id,
      items: itemViews,
      unscheduled,
      replace_existing: replaceExisting,
      min_altitude_deg: minAltDeg,
      night_of: nightOf,
      darkness,
      how_to_apply: HOW_TO_APPLY,
    },
    site,
    { rejected, caveats, ...toolsDelta(before, after) },
  )
}

export const proposePlanTool: ModelContextToolDefinition = defineTool<ProposePlanData>({
  name: 'propose_plan',
  title: 'Propose a ghost observing plan',
  description: `Use this to propose an observing plan WITHOUT applying it. The proposal appears on the person's night timeline as a dotted "proposed by agent" ghost plan they can accept or reject item by item (with a reason you can read back). Give targets by id or name, optionally a duration per target and a rationale; the app schedules each target inside its visibility window during astronomical darkness, avoiding overlaps with the existing plan, and returns the proposal_id, the scheduled items with times (UTC and local) and the targets it could NOT fit with reasons. Nothing changes in the committed plan until commit_proposal is called or the person clicks Accept.`,
  inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  run,
})
