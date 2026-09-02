/**
 * Rebuilding a committed plan for the sky that is actually on screen.
 *
 * A plan is a set of times, and a time only means something at one place on one
 * night. The moment the person or the agent moves the app to another site or
 * another night the committed plan stops being true (`planStaleness` in the
 * store says so out loud), and the honest answer is not to renumber the rows: it
 * is to ask the sky again. Every target is rescheduled for the CURRENT site and
 * night with the duration it was given, whatever cannot work here is dropped
 * with the astronomical reason attached, and everything that had to move says
 * where it moved from.
 *
 * The whole plan is rebuilt in one pass, so nothing is treated as occupied: the
 * blocks compete with each other exactly as they did the first time.
 */

import { getNight } from '../astro/cache'
import { getTarget } from '../astro/catalog'
import { MIN_BLOCK_MINUTES, scheduleTargets } from '../astro/schedule'
import type { ScheduleRequest, ScheduledBlock } from '../astro/schedule'
import { store } from '../state/store'
import type { ActorSource, PlanItem } from '../state/types'

/** A start that shifts by less than this is the same block, not a move. */
export const MOVED_TOLERANCE_MS = 60_000

/** Said of a target the catalog of this app does not know. */
export const UNKNOWN_TARGET_REASON = 'not in the catalog of this app'

export interface RevalidationResult {
  /** The plan as it now stands, in start order. */
  kept: PlanItem[]
  /** Items whose start moved by more than a minute, with both times in UTC. */
  moved: { targetId: string; name: string; from: string; to: string }[]
  /** Items this sky cannot take, with the reason the scheduler gave. */
  dropped: { targetId: string; name: string; reason: string }[]
}

function newId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  // randomUUID needs a secure context; keep the app alive on plain http.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** How long this block was meant to last, never shorter than a usable block. */
function durationMinutesOf(item: PlanItem): number {
  const minutes = Math.round((Date.parse(item.endUtc) - Date.parse(item.startUtc)) / 60_000)
  return Number.isFinite(minutes) ? Math.max(MIN_BLOCK_MINUTES, minutes) : MIN_BLOCK_MINUTES
}

/**
 * Reschedules the committed plan for the site and night selected right now and
 * writes the result through `setPlan`, which re-stamps `planContext` so the plan
 * stops being stale. Returns what survived, what moved and what was dropped, for
 * the banner the person reads and for the agent that asked.
 *
 * An empty plan is left alone: there is nothing to revalidate and nothing to log.
 */
export function revalidatePlan(source: ActorSource): RevalidationResult {
  const state = store.getState()
  const plan = state.plan
  const kept: PlanItem[] = []
  const moved: RevalidationResult['moved'] = []
  const dropped: RevalidationResult['dropped'] = []
  if (plan.length === 0) return { kept, moved, dropped }

  const site = state.site
  const nightOf = state.nightOf
  const night = getNight(nightOf, site)

  const resolved = plan.map((item) => ({ item, target: getTarget(item.targetId) }))
  const requests: ScheduleRequest[] = []
  for (const { item, target } of resolved) {
    if (!target) continue
    requests.push({ target, durationMinutes: durationMinutesOf(item) })
  }

  const scheduled = scheduleTargets(requests, night, site, {
    minAltDeg: state.filters.minAltDeg,
    // The whole plan is rebuilt at once: nothing is booked before this pass.
    occupied: [],
    // Null means the darkness window of the night.
    interval: null,
  })

  // Two plan items may share a target, so the blocks queue up per target id and
  // are handed out in plan order.
  const blocksByTarget = new Map<string, ScheduledBlock[]>()
  for (const block of scheduled.blocks) {
    const queue = blocksByTarget.get(block.target.id)
    if (queue) queue.push(block)
    else blocksByTarget.set(block.target.id, [block])
  }
  const reasonByTarget = new Map(scheduled.unscheduled.map((missed) => [missed.targetId, missed.reason]))
  const usedIds = new Set<string>()

  for (const { item, target } of resolved) {
    const block = target ? blocksByTarget.get(target.id)?.shift() : undefined
    if (!block) {
      dropped.push({
        targetId: item.targetId,
        name: item.targetName,
        reason: target
          ? (reasonByTarget.get(target.id) ?? 'could not be scheduled on this night')
          : UNKNOWN_TARGET_REASON,
      })
      continue
    }
    // Ids are kept so notes, selection and the timeline stay attached to the same
    // row; a duplicate id (an imported plan can carry one) gets a fresh one.
    const id = usedIds.has(item.id) || item.id === '' ? newId() : item.id
    usedIds.add(id)
    kept.push({ ...item, id, startUtc: block.startUtc, endUtc: block.endUtc })

    const fromMs = Date.parse(item.startUtc)
    const toMs = Date.parse(block.startUtc)
    if (!Number.isFinite(fromMs) || Math.abs(toMs - fromMs) > MOVED_TOLERANCE_MS) {
      moved.push({
        targetId: item.targetId,
        name: item.targetName,
        from: item.startUtc,
        to: block.startUtc,
      })
    }
  }

  store
    .getState()
    .setPlan(
      kept,
      source,
      `revalidated for ${site.name}, night of ${nightOf}: ${kept.length} kept, ${moved.length} moved, ${dropped.length} dropped`,
    )

  return { kept, moved, dropped }
}
