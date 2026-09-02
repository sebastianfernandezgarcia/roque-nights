/**
 * Tool 13: `import_plan`. The lever this whole project turns on.
 *
 * Someone else's plan is not data to copy: it is a set of intentions made under
 * a different sky. A plan from Madrid pasted here is recomputed target by target
 * for THIS latitude and THIS night, kept items are moved to when they actually
 * culminate, and whatever cannot work here is returned with the reason it
 * cannot. Nothing is committed: the result is a ghost proposal the human accepts
 * or rejects item by item.
 *
 * Accepted input, in this order: a share URL of this app (`#plan=...`), an
 * `observing-plan.v1` JSON document, or a plain list of target names.
 */

import { getNight } from '../astro/cache'
import { getTarget, type Target } from '../astro/catalog'
import { formatLatitude, type NightEphemeris } from '../astro/night'
import { scheduleTargets, type ScheduleRequest } from '../astro/schedule'
import { computeVisibility, targetAltAz } from '../astro/targets'
import { formatInZone } from '../astro/time'
import { parseObservingPlanV1, type ObservingPlanSite, type ObservingPlanV1 } from '../plan/serialize'
import { decodePlanFromHash } from '../plan/shareUrl'
import { planIntervals, store } from '../state/store'
import type { Interval, PlanItem, Site } from '../state/types'
import { toolsDelta, type ContextualState } from './contextualNames'
import { defineTool, fail, ok, stamp, type RejectedItem, type Stamp, type ToolResult } from './envelope'

export interface ImportPlanKept {
  target_id: string
  name: string
  /** The times the source asked for, or null when the source was a list of names. */
  original: { start: string; end: string } | null
  new: { start: Stamp; end: Stamp }
  changed: boolean
  /** Why this block sits where it sits now. */
  why: string
}

export interface ImportPlanDropped {
  target_id: string
  name: string
  reason: string
}

export interface ImportPlanData {
  proposal_id: string
  original: { site: ObservingPlanSite; night_of: string; item_count: number } | null
  kept: ImportPlanKept[]
  dropped: ImportPlanDropped[]
  summary_counts: { kept: number; dropped: number }
}

/** Altitude floor the agent may ask for, degrees. */
export const MIN_ALTITUDE_FLOOR_DEG = 5
export const MIN_ALTITUDE_CEILING_DEG = 85
/** Block length used when the source carries no times. */
export const DEFAULT_BLOCK_MINUTES = 45
const MIN_BLOCK_MINUTES = 10
const MAX_BLOCK_MINUTES = 240
/** A list of names longer than this is almost certainly a paste accident. */
export const MAX_NAMES = 40
const MAX_SOURCE_LENGTH = 200_000
/** Two sites this close are the same place for the purpose of the diff. */
const SAME_SITE_DEG = 0.05

const SOURCE_HINT =
  'Paste a share URL of this app (it contains #plan=), the text of an observing-plan.v1 JSON document, or just the target names separated by commas or newlines.'

const WHY_KEPT = 'kept original time'
const WHY_DARKNESS = 'moved into local darkness window'
const WHY_BUSY = 'moved to a free slot in the current plan'
const WHY_LATER = 'culminates later here'
const WHY_EARLIER = 'culminates earlier here'
const WHY_NO_SOURCE_TIME = 'no time in the source, scheduled at its best moment tonight'

/** One target the source asked for, before this sky has had its say. */
interface Wanted {
  /** What the source called it, used in messages when it resolves to nothing. */
  label: string
  targetId?: string
  startUtc?: string
  endUtc?: string
  note?: string
}

interface Candidate {
  target: Target
  wanted: Wanted
  durationMinutes: number
  overlappedBusy: boolean
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null) return 'null'
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (typeof value === 'object') return 'an object'
  return String(value)
}

function looksLikeShareUrl(source: string): boolean {
  return /[#?&]plan=/.test(source)
}

function looksLikeJson(source: string): boolean {
  return source.startsWith('{') || source.startsWith('[')
}

/** Names separated by commas, newlines or semicolons; blanks and repeats dropped. */
export function splitTargetNames(source: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const piece of source.split(/[,;\n\r]+/)) {
    const name = piece.trim()
    if (name === '') continue
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

function overlaps(startMs: number, endMs: number, spans: Interval[]): boolean {
  return spans.some(
    (span) => startMs < Date.parse(span.endUtc) && Date.parse(span.startUtc) < endMs,
  )
}

function blockMinutes(startUtc?: string, endUtc?: string): number {
  if (!startUtc || !endUtc) return DEFAULT_BLOCK_MINUTES
  const minutes = Math.round((Date.parse(endUtc) - Date.parse(startUtc)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < MIN_BLOCK_MINUTES) return DEFAULT_BLOCK_MINUTES
  return Math.min(minutes, MAX_BLOCK_MINUTES)
}

/** Is the target above the floor at both ends of the block it came with? */
function upAtBothEnds(target: Target, site: Site, startMs: number, endMs: number, minAltDeg: number): boolean {
  return (
    targetAltAz(target, new Date(startMs), site).altDeg >= minAltDeg &&
    targetAltAz(target, new Date(endMs), site).altDeg >= minAltDeg
  )
}

function explainMove(
  candidate: Candidate,
  newStartMs: number,
  night: NightEphemeris,
): string {
  const { startUtc, endUtc } = candidate.wanted
  if (!startUtc || !endUtc) return WHY_NO_SOURCE_TIME
  const originalStart = Date.parse(startUtc)
  const originalEnd = Date.parse(endUtc)
  const darkStart = night.darkness.startUtc ? Date.parse(night.darkness.startUtc) : null
  const darkEnd = night.darkness.endUtc ? Date.parse(night.darkness.endUtc) : null
  if (darkStart !== null && darkEnd !== null && (originalStart < darkStart || originalEnd > darkEnd)) {
    return WHY_DARKNESS
  }
  if (candidate.overlappedBusy) return WHY_BUSY
  if (newStartMs > originalStart) return WHY_LATER
  if (newStartMs < originalStart) return WHY_EARLIER
  return WHY_KEPT
}

function hhmm(isoUtc: string, timeZone: string | null): string {
  return formatInZone(isoUtc, timeZone ?? 'UTC')
}

function run(input: Record<string, unknown>): ToolResult<ImportPlanData> {
  const state = store.getState()
  const site = state.site

  // --- 1. what did the agent hand us -----------------------------------------
  const rawSource = input.source
  if (typeof rawSource !== 'string' || rawSource.trim() === '') {
    return fail(
      'invalid_input',
      `source must be a non-empty string, got ${describeValue(rawSource)}.`,
      SOURCE_HINT,
    )
  }
  if (rawSource.length > MAX_SOURCE_LENGTH) {
    return fail(
      'invalid_input',
      `source is ${rawSource.length} characters long; the limit is ${MAX_SOURCE_LENGTH}.`,
      SOURCE_HINT,
    )
  }
  const source = rawSource.trim()

  const rawKeep = input.keep_original_times
  if (rawKeep !== undefined && rawKeep !== null && typeof rawKeep !== 'boolean') {
    return fail(
      'invalid_input',
      `keep_original_times must be true or false, got ${describeValue(rawKeep)}.`,
    )
  }
  const keepOriginalTimes = rawKeep === true

  const rawMinAlt = input.min_altitude_deg
  if (rawMinAlt !== undefined && rawMinAlt !== null) {
    if (
      typeof rawMinAlt !== 'number' ||
      !Number.isFinite(rawMinAlt) ||
      rawMinAlt < MIN_ALTITUDE_FLOOR_DEG ||
      rawMinAlt > MIN_ALTITUDE_CEILING_DEG
    ) {
      return fail(
        'invalid_input',
        `min_altitude_deg must be a number between ${MIN_ALTITUDE_FLOOR_DEG} and ${MIN_ALTITUDE_CEILING_DEG}, got ${describeValue(rawMinAlt)}.`,
        'Leave it out to use the minimum altitude currently set in the app.',
      )
    }
  }
  const minAltDeg = typeof rawMinAlt === 'number' ? rawMinAlt : state.filters.minAltDeg

  // --- 2. share URL, then JSON, then plain names ------------------------------
  const caveats: string[] = []
  let document: ObservingPlanV1 | null = null

  if (looksLikeShareUrl(source)) {
    document = decodePlanFromHash(source)
    if (!document) {
      return fail(
        'invalid_input',
        'That share URL does not carry a readable plan: the #plan= payload is missing, truncated or from another format.',
        'Ask for the link again, or paste the observing-plan.v1 JSON document itself.',
      )
    }
  } else if (looksLikeJson(source)) {
    const parsed = parseObservingPlanV1(source)
    if ('error' in parsed) {
      return fail('invalid_input', parsed.error, SOURCE_HINT)
    }
    document = parsed.plan
  }

  const wanted: Wanted[] = []
  if (document) {
    if (document.items.length === 0) {
      return fail(
        'invalid_input',
        'That plan document has no items, so there is nothing to import.',
        SOURCE_HINT,
      )
    }
    for (const item of document.items) {
      wanted.push({
        label: item.name || item.target_id,
        targetId: item.target_id,
        startUtc: item.start_utc,
        endUtc: item.end_utc,
        note: item.note,
      })
    }
  } else {
    const names = splitTargetNames(source)
    if (names.length === 0) {
      return fail(
        'invalid_input',
        'No target names could be read from source.',
        SOURCE_HINT,
      )
    }
    if (names.length > MAX_NAMES) {
      caveats.push(
        `The list had ${names.length} names; only the first ${MAX_NAMES} were imported.`,
      )
    }
    for (const name of names.slice(0, MAX_NAMES)) wanted.push({ label: name })
  }

  // --- 3. revalidate every target for THIS sky --------------------------------
  const night = getNight(state.nightOf, site)
  const occupied: Interval[] = planIntervals(state.plan)
  const dropped: ImportPlanDropped[] = []
  const candidates: Candidate[] = []
  const seenTargets = new Set<string>()

  for (const item of wanted) {
    const target =
      (item.targetId ? getTarget(item.targetId) : undefined) ?? getTarget(item.label)
    if (!target) {
      dropped.push({
        target_id: item.targetId ?? item.label,
        name: item.label,
        reason:
          'unknown target, not in this catalog of 110 Messier objects, the planets, the Moon and the bright stars',
      })
      continue
    }
    // The same object asked for twice is one block, not two.
    if (seenTargets.has(target.id)) continue
    seenTargets.add(target.id)

    const visibility = computeVisibility(target, night, site, {
      minAltDeg,
      interval: null,
      minMoonSepDeg: state.filters.minMoonSepDeg,
    })
    if (!visibility.observable) {
      dropped.push({
        target_id: target.id,
        name: target.name,
        reason: visibility.reason ?? 'not observable from here on this night',
      })
      continue
    }

    const startMs = item.startUtc ? Date.parse(item.startUtc) : Number.NaN
    const endMs = item.endUtc ? Date.parse(item.endUtc) : Number.NaN
    const overlappedBusy =
      Number.isFinite(startMs) && Number.isFinite(endMs) && overlaps(startMs, endMs, occupied)

    candidates.push({
      target,
      wanted: item,
      durationMinutes: blockMinutes(item.startUtc, item.endUtc),
      overlappedBusy,
    })
  }

  // --- 4. keep what already fits, reschedule the rest -------------------------
  const kept: ImportPlanKept[] = []
  const toSchedule: Candidate[] = []
  const darkStartMs = night.darkness.startUtc ? Date.parse(night.darkness.startUtc) : null
  const darkEndMs = night.darkness.endUtc ? Date.parse(night.darkness.endUtc) : null

  for (const candidate of candidates) {
    const { startUtc, endUtc } = candidate.wanted
    const startMs = startUtc ? Date.parse(startUtc) : Number.NaN
    const endMs = endUtc ? Date.parse(endUtc) : Number.NaN
    const fits =
      keepOriginalTimes &&
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      endMs > startMs &&
      darkStartMs !== null &&
      darkEndMs !== null &&
      startMs >= darkStartMs &&
      endMs <= darkEndMs &&
      !overlaps(startMs, endMs, occupied) &&
      upAtBothEnds(candidate.target, site, startMs, endMs, minAltDeg)

    if (!fits) {
      toSchedule.push(candidate)
      continue
    }
    occupied.push({ startUtc: startUtc as string, endUtc: endUtc as string })
    kept.push({
      target_id: candidate.target.id,
      name: candidate.target.name,
      original: { start: startUtc as string, end: endUtc as string },
      new: { start: stamp(startUtc as string, site.timeZone), end: stamp(endUtc as string, site.timeZone) },
      changed: false,
      why: WHY_KEPT,
    })
  }

  const byTargetId = new Map(toSchedule.map((c) => [c.target.id, c]))
  const requests: ScheduleRequest[] = toSchedule.map((c) => ({
    target: c.target,
    durationMinutes: c.durationMinutes,
    note: c.wanted.note,
  }))
  const schedule = scheduleTargets(requests, night, site, { minAltDeg, occupied })

  for (const block of schedule.blocks) {
    const candidate = byTargetId.get(block.target.id)
    if (!candidate) continue
    const original =
      candidate.wanted.startUtc && candidate.wanted.endUtc
        ? { start: candidate.wanted.startUtc, end: candidate.wanted.endUtc }
        : null
    const changed =
      original === null || block.startUtc !== original.start || block.endUtc !== original.end
    kept.push({
      target_id: block.target.id,
      name: block.target.name,
      original,
      new: { start: stamp(block.startUtc, site.timeZone), end: stamp(block.endUtc, site.timeZone) },
      changed,
      why: changed ? explainMove(candidate, Date.parse(block.startUtc), night) : WHY_KEPT,
    })
  }

  for (const missed of schedule.unscheduled) {
    dropped.push({ target_id: missed.targetId, name: missed.name, reason: missed.reason })
  }

  kept.sort((a, b) => String(a.new.start.utc).localeCompare(String(b.new.start.utc)))

  // --- 5. the ghost proposal --------------------------------------------------
  const noteFor = (targetId: string): string | undefined => {
    const fromSchedule = schedule.blocks.find((b) => b.target.id === targetId)?.note
    if (fromSchedule) return fromSchedule
    return candidates.find((c) => c.target.id === targetId)?.wanted.note
  }

  const items: PlanItem[] = kept.map((entry) => {
    const note = noteFor(entry.target_id)
    return {
      // The store fills the id in; it owns crypto.randomUUID and its fallback.
      id: '',
      targetId: entry.target_id,
      targetName: entry.name,
      startUtc: entry.new.start.utc as string,
      endUtc: entry.new.end.utc as string,
      ...(note ? { note } : {}),
      source: 'agent' as const,
    }
  })

  const fromLabel = document ? document.site.name : 'a plan'
  // A ghost proposal is what makes commit_proposal exist; the agent is told so
  // in the payload, because models do not re-read the tool list on their own.
  const before: ContextualState = { plan: state.plan, proposals: state.proposals }
  const proposal = store.getState().addProposal({
    rationale: `Imported from ${fromLabel}`,
    items,
    unscheduled: dropped.map((d) => ({ targetId: d.target_id, name: d.name, reason: d.reason })),
    replaceExisting: false,
    origin: 'import',
  })

  // --- 6. say what happened ---------------------------------------------------
  if (document) {
    if (document.night_of && document.night_of !== state.nightOf) {
      caveats.push(
        `The source plan was made for the night of ${document.night_of}; it was revalidated for ${state.nightOf}, the night selected here.`,
      )
    }
    const movedSite =
      Math.abs(document.site.latitude - site.latitude) > SAME_SITE_DEG ||
      Math.abs(document.site.longitude - site.longitude) > SAME_SITE_DEG
    if (movedSite) {
      caveats.push(
        `The source site was ${document.site.name} (${formatLatitude(document.site.latitude)}); every time was recomputed for ${site.name} (${formatLatitude(site.latitude)}).`,
      )
    }
  }
  if (site.timeZone === null) {
    caveats.push(
      'This site has no IANA time zone, so the new times are UTC only and local times are null.',
    )
  }
  if (night.darkness.status !== 'ok') {
    caveats.push(
      `This night has no ordinary darkness window here (${night.darkness.status.replace(/_/g, ' ')}).`,
    )
  }

  const sourceCount = wanted.length
  const origin = document
    ? `a plan made at ${document.site.name} (${formatLatitude(document.site.latitude)}) for ${document.night_of}`
    : 'a list of target names'

  // Prefer an example whose reason reads as a sentence: "because it culminates later here".
  const movedExamples = kept.filter((entry) => entry.changed && entry.original !== null)
  const moved = movedExamples.find((entry) => entry.why.startsWith('culminates')) ?? movedExamples[0]
  const movedClause = moved
    ? ` (${moved.target_id} moved ${hhmm(moved.original!.start, site.timeZone)}→${hhmm(String(moved.new.start.utc), site.timeZone)}${moved.why.startsWith('culminates') ? ` because it ${moved.why}` : `: ${moved.why}`})`
    : ''
  const droppedClause =
    dropped.length > 0 ? ` (${dropped[0].target_id}: ${dropped[0].reason})` : ''

  const summary =
    `Imported ${sourceCount} item${sourceCount === 1 ? '' : 's'} from ${origin}; ` +
    `${kept.length} observable from ${site.name} on the night of ${state.nightOf}${movedClause}, ` +
    `${dropped.length} dropped${droppedClause}. ` +
    `Nothing is committed yet: call commit_proposal with proposal_id ${proposal.id} to apply it.`

  const rejected: RejectedItem[] = dropped.map((d) => ({
    id: d.target_id,
    name: d.name,
    reason: d.reason,
  }))

  return ok<ImportPlanData>(
    summary,
    {
      proposal_id: proposal.id,
      original: document
        ? { site: document.site, night_of: document.night_of, item_count: document.items.length }
        : null,
      kept,
      dropped,
      summary_counts: { kept: kept.length, dropped: dropped.length },
    },
    site,
    { rejected, caveats, ...toolsDelta(before, store.getState()) },
  )
}

export const importPlanTool = defineTool<ImportPlanData>({
  name: 'import_plan',
  title: 'Import another observer plan and revalidate it for this sky',
  description:
    "Use this to bring in another observer's plan and REVALIDATE it for the site and night shown here. Accepts a share URL of this app, an observing-plan.v1 JSON document, or a plain list of target names separated by commas or newlines. Every target is recomputed for THIS sky: targets that remain observable are rescheduled into their local windows; targets that do not work here (never rise at this latitude, below minimum altitude, no darkness, Moon too close) are listed with reasons. Creates a ghost proposal (nothing committed) and returns its proposal_id plus the diff versus the original plan, so you can explain what changed and why. Use commit_proposal to apply.",
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_SOURCE_LENGTH,
        description:
          'A share URL of this app (contains #plan=), the text of an observing-plan.v1 JSON document, or target names separated by commas or newlines ("M31, M13, Jupiter").',
      },
      min_altitude_deg: {
        type: 'number',
        minimum: MIN_ALTITUDE_FLOOR_DEG,
        maximum: MIN_ALTITUDE_CEILING_DEG,
        description:
          'Lowest altitude above the horizon that still counts as observable. Defaults to the minimum altitude currently set in the app.',
      },
      keep_original_times: {
        type: 'boolean',
        default: false,
        description:
          "Try the original UTC times first when they fall inside this night's darkness and the target is up.",
      },
    },
    required: ['source'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  run,
})
