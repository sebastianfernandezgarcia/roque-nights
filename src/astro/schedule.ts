/**
 * Turning a wish list into a timetable for one night.
 *
 * Greedy and deliberately simple, because the human has to be able to read the
 * result and argue with it: take the targets in the order their best moment
 * arrives, put each block as close to its culmination as the free time allows,
 * and never overlap something that is already booked.
 */

import { computeVisibility } from './targets'
import type { Target } from './catalog'
import type { Interval, NightEphemeris, SiteCoords } from './night'

const MINUTE_MS = 60_000

/** No block is worth pointing a telescope at for less than this. */
export const MIN_BLOCK_MINUTES = 10

export interface ScheduleRequest {
  target: Target
  durationMinutes: number
  note?: string
}

export interface ScheduledBlock {
  target: Target
  startUtc: string
  endUtc: string
  /** Peak altitude of the target inside its visibility window, degrees. */
  peakAltDeg: number
  note?: string
}

export interface ScheduleResult {
  blocks: ScheduledBlock[]
  unscheduled: { targetId: string; name: string; reason: string }[]
}

export interface ScheduleOptions {
  minAltDeg: number
  /** Time already taken by existing plan items. */
  occupied: Interval[]
  /** Defaults to the darkness window of the night. */
  interval?: Interval | null
}

interface Span {
  from: number
  to: number
}

function toSpans(intervals: Interval[]): Span[] {
  return intervals
    .map((i) => ({ from: Date.parse(i.startUtc), to: Date.parse(i.endUtc) }))
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to > s.from)
    .sort((a, b) => a.from - b.from)
}

/** Merges overlapping or touching spans so the gap search stays simple. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to)
    else merged.push({ ...span })
  }
  return merged
}

/** The parts of `window` that no busy span covers. */
function freeSpans(window: Span, busy: Span[]): Span[] {
  const free: Span[] = []
  let cursor = window.from
  for (const span of busy) {
    if (span.to <= cursor) continue
    if (span.from >= window.to) break
    if (span.from > cursor) free.push({ from: cursor, to: Math.min(span.from, window.to) })
    cursor = Math.max(cursor, span.to)
    if (cursor >= window.to) break
  }
  if (cursor < window.to) free.push({ from: cursor, to: window.to })
  return free.filter((s) => s.to > s.from)
}

function joinNotes(...parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
  return kept.length > 0 ? kept.join('; ') : undefined
}

/**
 * Places each request inside its own visibility window, centred on the moment the
 * target is highest and shifted to the nearest free slot when something is already
 * booked there. A target whose window is shorter than the requested duration keeps
 * the whole window and says so in its note; anything under 10 minutes is dropped
 * with a reason instead of being scheduled.
 */
export function scheduleTargets(
  requests: ScheduleRequest[],
  night: NightEphemeris,
  site: SiteCoords,
  opts: ScheduleOptions,
): ScheduleResult {
  const blocks: ScheduledBlock[] = []
  const unscheduled: { targetId: string; name: string; reason: string }[] = []
  if (requests.length === 0) return { blocks, unscheduled }

  interface Placeable {
    request: ScheduleRequest
    window: Span
    peakMs: number
    peakAltDeg: number
  }

  const placeable: Placeable[] = []

  for (const request of requests) {
    const visibility = computeVisibility(request.target, night, site, {
      minAltDeg: opts.minAltDeg,
      interval: opts.interval ?? null,
      // The scheduler only cares about altitude: Moon distance and a comfortable
      // window length are the caller's filters, not the timetable's.
      minMoonSepDeg: 0,
      minWindowMinutes: MIN_BLOCK_MINUTES,
    })
    if (!visibility.observable || !visibility.window) {
      unscheduled.push({
        targetId: request.target.id,
        name: request.target.name,
        reason: visibility.reason ?? 'not observable inside the requested interval',
      })
      continue
    }
    placeable.push({
      request,
      window: {
        from: Date.parse(visibility.window.startUtc),
        to: Date.parse(visibility.window.endUtc),
      },
      peakMs: Date.parse(visibility.window.peakUtc),
      peakAltDeg: visibility.window.peakAltDeg,
    })
  }

  // Chronological greedy: whoever culminates first gets first pick of the night.
  placeable.sort((a, b) => a.peakMs - b.peakMs || b.peakAltDeg - a.peakAltDeg)

  const busy = merge(toSpans(opts.occupied))

  for (const item of placeable) {
    const requested = Math.max(
      MIN_BLOCK_MINUTES,
      Math.round(item.request.durationMinutes || MIN_BLOCK_MINUTES),
    )
    const windowMinutes = Math.round((item.window.to - item.window.from) / MINUTE_MS)
    if (windowMinutes < MIN_BLOCK_MINUTES) {
      unscheduled.push({
        targetId: item.request.target.id,
        name: item.request.target.name,
        reason: `window too short (${windowMinutes} min < ${MIN_BLOCK_MINUTES} min)`,
      })
      continue
    }

    const free = freeSpans(item.window, busy).filter(
      (s) => s.to - s.from >= MIN_BLOCK_MINUTES * MINUTE_MS,
    )
    if (free.length === 0) {
      unscheduled.push({
        targetId: item.request.target.id,
        name: item.request.target.name,
        reason: 'no free slot left in its visibility window',
      })
      continue
    }

    // Pick the free slot whose centre can sit closest to the culmination.
    let best: { from: number; to: number; distance: number } | null = null
    for (const slot of free) {
      const durationMs = Math.min(requested * MINUTE_MS, slot.to - slot.from)
      const ideal = item.peakMs - durationMs / 2
      const from = Math.min(Math.max(ideal, slot.from), slot.to - durationMs)
      const distance = Math.abs(from + durationMs / 2 - item.peakMs)
      if (!best || distance < best.distance) best = { from, to: from + durationMs, distance }
    }
    if (!best) continue

    const placedMinutes = Math.round((best.to - best.from) / MINUTE_MS)
    let shortened: string | undefined
    if (placedMinutes < requested) {
      shortened = windowMinutes < requested ? 'shortened to window' : 'shortened to available time'
    }

    blocks.push({
      target: item.request.target,
      startUtc: new Date(best.from).toISOString(),
      endUtc: new Date(best.to).toISOString(),
      peakAltDeg: item.peakAltDeg,
      note: joinNotes(item.request.note, shortened),
    })
    busy.push({ from: best.from, to: best.to })
    busy.splice(0, busy.length, ...merge(busy))
  }

  blocks.sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
  return { blocks, unscheduled }
}
