/**
 * Tool 9: modify_plan.
 *
 * One tool for every direct edit of the committed plan, in batches, because an
 * agent that has to call five tools to fix a night will call three of them and
 * stop. Every operation reports its own outcome: an unknown target or an
 * impossible time is a failed operation with a reason, not a failed call, and
 * whatever did work is applied in a single store write so the human sees one
 * change in the activity log instead of five.
 *
 * Prefer propose_plan when the person should review first; this one writes.
 */

import { getNight } from '../astro/cache'
import { getTarget } from '../astro/catalog'
import type { Target } from '../astro/catalog'
import type { NightEphemeris, SiteCoords } from '../astro/night'
import { scheduleTargets } from '../astro/schedule'
import { computeVisibility, targetAltAz } from '../astro/targets'
import { roundTo } from '../astro/time'
import { store } from '../state/store'
import type { PlanItem } from '../state/types'
import { toolsDelta } from './contextualNames'
import type { ToolResult } from './envelope'
import { defineTool, fail, ok } from './envelope'
import { minutesBetween, planItemView } from './getCurrentPlan'
import type { PlanItemView } from './getCurrentPlan'
import { TARGET_REF_SCHEMA } from './schemas'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
/**
 * How far outside the selected night's 24 h window a start_utc may sit.
 *
 * Wide enough for "the block runs past dawn" and for an agent that is one day
 * off, narrow enough that year 9999 and the Date boundary never reach the store.
 */
const START_SLACK_MS = 36 * HOUR_MS
export const MAX_OPERATIONS = 30
export const DEFAULT_DURATION_MINUTES = 45
const MIN_DURATION_MINUTES = 10
const MAX_DURATION_MINUTES = 300
/** Shortest block the reorder packer will try to keep. */
const MIN_WINDOW_MINUTES = 10

export type PlanOperation = 'add' | 'remove' | 'move' | 'note' | 'reorder'

export interface OperationResult {
  op: string
  ok: boolean
  item_id?: string
  target_id?: string
  reason?: string
}

export interface ModifyPlanData {
  results: OperationResult[]
  plan: PlanItemView[]
  plan_size: number
  total_minutes: number
}

const OPERATION_SCHEMA = {
  type: 'object',
  properties: {
    op: {
      type: 'string',
      enum: ['add', 'remove', 'move', 'note', 'reorder'],
      description:
        'Which edit to make, and the fields it needs: "add" needs target (start_utc, duration_minutes and note are optional; without start_utc the block is scheduled automatically inside the target visibility window); "remove" needs item_id OR target; "move" needs item_id OR target PLUS start_utc (duration_minutes optional, otherwise the block keeps its current length); "note" needs item_id OR target PLUS note (pass "" to clear it); "reorder" needs item_ids, at least two of them, in the order you want the objects observed, and RECOMPACTS their times: the listed items are rescheduled back to back from the earliest of their current starts, each keeping its own length and staying inside its own visibility window when possible (an item that cannot fit keeps its original time and comes back with the reason).',
    },
    target: {
      ...TARGET_REF_SCHEMA,
      description: 'Target for add, or the target to match for remove and note.',
    },
    item_id: { type: 'string', maxLength: 80, description: 'Plan item id, from get_current_plan.' },
    start_utc: {
      type: 'string',
      maxLength: 40,
      description:
        'ISO 8601 UTC start for add and move ("2026-09-12T22:30:00Z"). Must fall within 36 h of the night the app is on; to plan another night call set_observing_time with { "date": "YYYY-MM-DD" } first.',
    },
    duration_minutes: {
      type: 'integer',
      minimum: MIN_DURATION_MINUTES,
      maximum: MAX_DURATION_MINUTES,
      description: 'Block length for add and move. Defaults to 45 for add, unchanged for move.',
    },
    note: { type: 'string', maxLength: 200, description: 'Note text; an empty string clears it.' },
    item_ids: {
      type: 'array',
      items: { type: 'string', maxLength: 80 },
      minItems: 2,
      maxItems: 30,
      description: 'For reorder: the item ids in the order you want them observed.',
    },
  },
  required: ['op'],
  additionalProperties: false,
} as const

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_OPERATIONS,
      items: OPERATION_SCHEMA,
      description: 'The edits to apply, in order. Everything that works is applied in one write.',
    },
  },
  required: ['operations'],
  additionalProperties: false,
} as const

const HAS_ZONE_RE = /([Zz]|[+-]\d{2}:?\d{2})$/

function newId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function hhmm(isoUtc: string): string {
  return isoUtc.slice(11, 16)
}

function byStart(a: PlanItem, b: PlanItem): number {
  return a.startUtc.localeCompare(b.startUtc)
}

/**
 * ISO 8601 to epoch ms, assuming UTC when the string carries no zone, and only
 * inside the night the app is on.
 *
 * The plan belongs to one night, so an instant 36 h away from that night's
 * window is a mistake, not an edit: it would put a block nobody can see on a
 * timeline that does not reach it, and at the extremes of the Date range it
 * used to escape as internal_error. The refusal is a per-operation failure with
 * a reason naming the night, like every other bad operation here.
 */
function parseStart(
  raw: unknown,
  night: NightEphemeris,
): { ms: number; assumedUtc: boolean } | string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return 'start_utc must be an ISO 8601 UTC instant such as "2026-09-12T22:30:00Z"'
  }
  const value = raw.trim()
  const assumedUtc = !HAS_ZONE_RE.test(value)
  const ms = Date.parse(assumedUtc ? `${value}Z` : value)
  if (!Number.isFinite(ms)) {
    return `"${value}" is not an ISO 8601 instant such as "2026-09-12T22:30:00Z"`
  }
  const earliest = Date.parse(night.windowStartUtc) - START_SLACK_MS
  const latest = Date.parse(night.windowEndUtc) + START_SLACK_MS
  if (ms < earliest || ms > latest) {
    return (
      `"${value}" is not within 36 h of the night of ${night.nightOf} ` +
      `(${night.windowStartUtc} to ${night.windowEndUtc} UTC); ` +
      'call set_observing_time with { "date": "YYYY-MM-DD" } to plan another night first'
    )
  }
  return { ms, assumedUtc }
}

function clampDuration(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, Math.round(raw)))
}

/** What is wrong with putting this target between these two instants, in plain words. */
function placementCaveats(
  target: Target,
  startMs: number,
  endMs: number,
  night: NightEphemeris,
  site: SiteCoords,
  minAltDeg: number,
): string[] {
  const caveats: string[] = []
  const darkStart = night.darkness.startUtc
  const darkEnd = night.darkness.endUtc
  if (!darkStart || !darkEnd) {
    caveats.push(
      `${target.id}: there is no astronomical darkness on the night of ${night.nightOf}, so the block sits in twilight.`,
    )
  } else {
    const darkStartMs = Date.parse(darkStart)
    const darkEndMs = Date.parse(darkEnd)
    if (endMs <= darkStartMs || startMs >= darkEndMs) {
      caveats.push(
        `${target.id} was placed outside astronomical darkness (${hhmm(darkStart)}-${hhmm(darkEnd)} UTC) and added anyway.`,
      )
    } else if (startMs < darkStartMs) {
      caveats.push(
        `${target.id} starts ${Math.round((darkStartMs - startMs) / MINUTE_MS)} min before astronomical darkness (${hhmm(darkStart)} UTC).`,
      )
    } else if (endMs > darkEndMs) {
      caveats.push(
        `${target.id} ends ${Math.round((endMs - darkEndMs) / MINUTE_MS)} min after astronomical darkness (${hhmm(darkEnd)} UTC).`,
      )
    }
  }

  const altStart = targetAltAz(target, new Date(startMs), site).altDeg
  const altEnd = targetAltAz(target, new Date(endMs), site).altDeg
  const altMid = targetAltAz(target, new Date(Math.round((startMs + endMs) / 2)), site).altDeg
  const lowest = Math.min(altStart, altMid, altEnd)
  if (Math.max(altStart, altMid, altEnd) <= 0) {
    caveats.push(
      `${target.id} is below the horizon for the whole block (altitude ${Math.round(lowest)}°).`,
    )
  } else if (lowest < minAltDeg) {
    caveats.push(
      `${target.id} drops to ${Math.round(lowest)}° during the block, under the ${Math.round(minAltDeg)}° minimum altitude.`,
    )
  }
  return caveats
}

function run(input: Record<string, unknown>): ToolResult<ModifyPlanData> {
  const state = store.getState()
  const site = state.site
  const night = getNight(state.nightOf, site)
  const minAltDeg = state.filters.minAltDeg

  const rawOps = input.operations
  if (!Array.isArray(rawOps) || rawOps.length === 0) {
    return fail(
      'invalid_input',
      'operations must be a non empty array of edits, each with an op of add, remove, move, note or reorder.',
      'Example: { "operations": [{ "op": "add", "target": "M31" }, { "op": "remove", "target": "M13" }] }.',
    )
  }
  if (rawOps.length > MAX_OPERATIONS) {
    return fail('invalid_input', `operations accepts at most ${MAX_OPERATIONS} edits per call.`)
  }

  let items: PlanItem[] = [...state.plan].sort(byStart)
  const results: OperationResult[] = []
  const caveats: string[] = []
  const details: string[] = []

  const findItem = (itemId: unknown, targetRef: unknown): PlanItem[] => {
    if (typeof itemId === 'string' && itemId.trim() !== '') {
      return items.filter((item) => item.id === itemId)
    }
    if (typeof targetRef === 'string' && targetRef.trim() !== '') {
      const target = getTarget(targetRef)
      const wanted = (target?.id ?? targetRef).toLowerCase()
      return items.filter(
        (item) =>
          item.targetId.toLowerCase() === wanted ||
          item.targetName.toLowerCase() === targetRef.trim().toLowerCase(),
      )
    }
    return []
  }

  for (const rawOp of rawOps) {
    const entry: Record<string, unknown> =
      typeof rawOp === 'object' && rawOp !== null ? (rawOp as Record<string, unknown>) : {}
    const op = typeof entry.op === 'string' ? entry.op.trim().toLowerCase() : ''

    // --- add ---------------------------------------------------------------
    if (op === 'add') {
      const ref = entry.target
      if (typeof ref !== 'string' || ref.trim() === '') {
        results.push({ op, ok: false, reason: 'add needs a target id or name' })
        continue
      }
      const target = getTarget(ref)
      if (!target) {
        results.push({ op, ok: false, target_id: ref, reason: `unknown target "${ref}"` })
        continue
      }
      const duration = clampDuration(entry.duration_minutes, DEFAULT_DURATION_MINUTES)
      const note = typeof entry.note === 'string' ? entry.note.slice(0, 200) : undefined

      if (entry.start_utc !== undefined && entry.start_utc !== null) {
        const parsed = parseStart(entry.start_utc, night)
        if (typeof parsed === 'string') {
          results.push({ op, ok: false, target_id: target.id, reason: parsed })
          continue
        }
        const endMs = parsed.ms + duration * MINUTE_MS
        // A start time the agent chose is honoured even when it is a bad idea:
        // the caveats say why, the person can see it on the timeline.
        caveats.push(...placementCaveats(target, parsed.ms, endMs, night, site, minAltDeg))
        if (parsed.assumedUtc) {
          caveats.push(`start_utc "${String(entry.start_utc)}" had no time zone and was read as UTC.`)
        }
        const item: PlanItem = {
          id: newId(),
          targetId: target.id,
          targetName: target.name,
          startUtc: new Date(parsed.ms).toISOString(),
          endUtc: new Date(endMs).toISOString(),
          note,
          source: 'agent',
        }
        items.push(item)
        results.push({ op, ok: true, item_id: item.id, target_id: target.id })
        details.push(`add ${target.id} at ${hhmm(item.startUtc)}Z`)
        continue
      }

      const scheduled = scheduleTargets([{ target, durationMinutes: duration, note }], night, site, {
        minAltDeg,
        occupied: items.map((item) => ({ startUtc: item.startUtc, endUtc: item.endUtc })),
      })
      const block = scheduled.blocks[0]
      if (!block) {
        results.push({
          op,
          ok: false,
          target_id: target.id,
          reason: scheduled.unscheduled[0]?.reason ?? 'no room left in its visibility window',
        })
        continue
      }
      const item: PlanItem = {
        id: newId(),
        targetId: target.id,
        targetName: target.name,
        startUtc: block.startUtc,
        endUtc: block.endUtc,
        note: block.note,
        source: 'agent',
      }
      items.push(item)
      results.push({ op, ok: true, item_id: item.id, target_id: target.id })
      details.push(`add ${target.id}`)
      continue
    }

    // --- remove ------------------------------------------------------------
    if (op === 'remove') {
      const matches = findItem(entry.item_id, entry.target)
      if (matches.length === 0) {
        const what =
          typeof entry.item_id === 'string' && entry.item_id.trim() !== ''
            ? `item_id "${entry.item_id}"`
            : `target "${String(entry.target ?? '')}"`
        results.push({ op, ok: false, reason: `nothing in the plan matches ${what}` })
        continue
      }
      const ids = new Set(matches.map((item) => item.id))
      items = items.filter((item) => !ids.has(item.id))
      results.push({
        op,
        ok: true,
        item_id: matches[0].id,
        target_id: matches[0].targetId,
        reason: matches.length > 1 ? `removed ${matches.length} items` : undefined,
      })
      details.push(`remove ${matches.map((item) => item.targetId).join(',')}`)
      continue
    }

    // --- move --------------------------------------------------------------
    if (op === 'move') {
      const matches = findItem(entry.item_id, entry.target)
      if (matches.length === 0) {
        const what =
          typeof entry.item_id === 'string' && entry.item_id.trim() !== ''
            ? `item_id "${entry.item_id}"`
            : `target "${String(entry.target ?? '')}"`
        results.push({ op, ok: false, reason: `no plan item matches ${what}` })
        continue
      }
      if (entry.start_utc === undefined || entry.start_utc === null) {
        results.push({ op, ok: false, item_id: matches[0].id, reason: 'move needs start_utc' })
        continue
      }
      const parsed = parseStart(entry.start_utc, night)
      if (typeof parsed === 'string') {
        results.push({ op, ok: false, item_id: matches[0].id, reason: parsed })
        continue
      }
      const current = matches[0]
      const duration = clampDuration(
        entry.duration_minutes,
        Math.max(MIN_WINDOW_MINUTES, minutesBetween(current.startUtc, current.endUtc)),
      )
      const endMs = parsed.ms + duration * MINUTE_MS
      const target = getTarget(current.targetId)
      if (target) {
        caveats.push(...placementCaveats(target, parsed.ms, endMs, night, site, minAltDeg))
      }
      items = items.map((item) =>
        item.id === current.id
          ? {
              ...item,
              startUtc: new Date(parsed.ms).toISOString(),
              endUtc: new Date(endMs).toISOString(),
            }
          : item,
      )
      results.push({ op, ok: true, item_id: current.id, target_id: current.targetId })
      details.push(`move ${current.targetId} to ${hhmm(new Date(parsed.ms).toISOString())}Z`)
      continue
    }

    // --- note --------------------------------------------------------------
    if (op === 'note') {
      const matches = findItem(entry.item_id, entry.target)
      if (matches.length === 0) {
        results.push({ op, ok: false, reason: 'no plan item matches item_id or target' })
        continue
      }
      if (typeof entry.note !== 'string') {
        results.push({
          op,
          ok: false,
          item_id: matches[0].id,
          reason: 'note needs a note string (pass "" to clear it)',
        })
        continue
      }
      const text = entry.note.slice(0, 200)
      const current = matches[0]
      items = items.map((item) =>
        item.id === current.id ? { ...item, note: text === '' ? undefined : text } : item,
      )
      results.push({ op, ok: true, item_id: current.id, target_id: current.targetId })
      details.push(`note ${current.targetId}`)
      continue
    }

    // --- reorder -----------------------------------------------------------
    if (op === 'reorder') {
      const ids = Array.isArray(entry.item_ids)
        ? entry.item_ids.filter((id): id is string => typeof id === 'string')
        : []
      if (ids.length < 2) {
        results.push({ op, ok: false, reason: 'reorder needs at least two item_ids' })
        continue
      }
      const missing = ids.filter((id) => !items.some((item) => item.id === id))
      if (missing.length > 0) {
        results.push({
          op,
          ok: false,
          reason: `unknown item ids: ${missing.join(', ')}`,
        })
        continue
      }
      // Times are fixed by the sky, so "reorder" means: repack these blocks back
      // to back from the earliest of their current starts, keeping each one
      // inside its own visibility window.
      const listed = ids.map((id) => items.find((item) => item.id === id) as PlanItem)
      let cursor = Math.min(...listed.map((item) => Date.parse(item.startUtc)))
      for (const item of listed) {
        const duration = Math.max(MIN_WINDOW_MINUTES, minutesBetween(item.startUtc, item.endUtc))
        const startMs = cursor
        const endMs = startMs + duration * MINUTE_MS
        const target = getTarget(item.targetId)
        let reason: string | null = null
        if (target) {
          const visibility = computeVisibility(target, night, site, {
            minAltDeg,
            interval: null,
            minMoonSepDeg: 0,
            minWindowMinutes: MIN_WINDOW_MINUTES,
          })
          const window = visibility.window
          if (!window) {
            reason = visibility.reason ?? 'not observable on this night'
          } else if (
            startMs < Date.parse(window.startUtc) ||
            endMs > Date.parse(window.endUtc)
          ) {
            reason = `${item.targetId} is only above ${Math.round(minAltDeg)}° between ${hhmm(window.startUtc)} and ${hhmm(window.endUtc)} UTC, so it cannot start at ${hhmm(new Date(startMs).toISOString())} UTC`
          }
        }
        if (reason) {
          results.push({ op, ok: false, item_id: item.id, target_id: item.targetId, reason })
          caveats.push(`${item.targetId} kept its original time during the reorder: ${reason}.`)
          continue
        }
        items = items.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                startUtc: new Date(startMs).toISOString(),
                endUtc: new Date(endMs).toISOString(),
              }
            : candidate,
        )
        results.push({ op, ok: true, item_id: item.id, target_id: item.targetId })
        cursor = endMs
      }
      details.push(`reorder ${listed.length} items`)
      continue
    }

    results.push({
      op: op || 'missing',
      ok: false,
      reason: `unknown operation "${op || 'missing'}"; use add, remove, move, note or reorder`,
    })
  }

  // --- one write ------------------------------------------------------------
  items.sort(byStart)
  const changed = JSON.stringify(items) !== JSON.stringify([...state.plan].sort(byStart))
  const before = store.getState()
  if (changed) {
    const detail = details.join('; ').slice(0, 120) || `${results.length} operations`
    before.setPlan(items, 'agent', detail)
  }
  const after = store.getState()

  const planViews = after.plan.map((item) => planItemView(item, site.timeZone))
  const totalMinutes = planViews.reduce((sum, item) => sum + item.minutes, 0)
  const applied = results.filter((entry) => entry.ok).length
  const failedList = results
    .filter((entry) => !entry.ok)
    .slice(0, 3)
    .map((entry) => `${entry.op} (${entry.reason})`)

  const summary =
    `Applied ${applied} of ${results.length} operation${results.length === 1 ? '' : 's'} to the plan for the night of ${after.nightOf}: ` +
    `${details.length > 0 ? details.join('; ') : 'nothing changed'}.` +
    `${failedList.length > 0 ? ` Failed: ${failedList.join('; ')}.` : ''}` +
    ` The plan now has ${after.plan.length} item${after.plan.length === 1 ? '' : 's'} covering ${roundTo(totalMinutes / 60, 1)} h.`

  return ok(
    summary,
    { results, plan: planViews, plan_size: after.plan.length, total_minutes: totalMinutes },
    site,
    { caveats, ...toolsDelta(before, after) },
  )
}

export const modifyPlanTool: ModelContextToolDefinition = defineTool<ModifyPlanData>({
  name: 'modify_plan',
  title: 'Edit the committed plan in one batch',
  description: `Use this to edit the committed plan directly in one batch: add targets (auto-scheduled or at a given start time), remove items, move an item, change durations or notes, or reorder. "reorder" does not only relabel the order: it RECOMPACTS the listed items back to back from the earliest of their current starts, each inside its own visibility window when possible, and reports any item that had to keep its original time. Prefer propose_plan when the person should review first. Returns the resulting plan and each operation's outcome, including failures with reasons. NOT idempotent: sending the same "add" twice leaves two blocks on the same target, so check get_current_plan before retrying. Only available once a plan exists.`,
  inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    // "add" mints a fresh item id on every call, so the same batch sent twice
    // leaves two blocks on the same target: not idempotent, and saying so keeps
    // an agent from retrying a call it believes is free.
    idempotentHint: false,
    openWorldHint: false,
  },
  run,
})
