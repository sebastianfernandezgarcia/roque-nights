/**
 * The plan as a portable document.
 *
 * `observing-plan.v1` is deliberately an OPEN format, published at
 * /schemas/observing-plan.v1.json: it carries the site, the night and the
 * darkness window, not just a list of names, so another observer (or another
 * agent, on another page) can recompute every time for their own sky instead of
 * trusting ours. That is the whole point of `import_plan`.
 *
 * Everything here is pure and synchronous: no store, no astronomy, no DOM.
 * Times are UTC ISO strings; local columns are rendered only when the document
 * carries an IANA zone, because a zone is never invented.
 */

import { localStamp, roundTo } from '../astro/time'
import type { RoqueState } from '../state/store'
import type { ActorSource, PlanItem } from '../state/types'

export const OBSERVING_PLAN_SCHEMA_URL =
  'https://roque-nights.netlify.app/schemas/observing-plan.v1.json'

export const OBSERVING_PLAN_GENERATOR = 'roque-nights'

export interface ObservingPlanSite {
  name: string
  latitude: number
  longitude: number
  elevation_m: number
  /** IANA zone, or null when the author did not know it. Never invented. */
  time_zone: string | null
}

export interface ObservingPlanItem {
  target_id: string
  name: string
  start_utc: string
  end_utc: string
  note?: string
  source: ActorSource
}

export interface ObservingPlanV1 {
  $schema: typeof OBSERVING_PLAN_SCHEMA_URL
  version: 1
  generator: string
  created_at: string
  site: ObservingPlanSite
  night_of: string
  darkness: { start_utc: string | null; end_utc: string | null }
  items: ObservingPlanItem[]
  author?: string
}

export type ParseResult = { plan: ObservingPlanV1 } | { error: string }

/** ISO instants this format accepts: UTC only, seconds and milliseconds optional. */
export const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,6})?Z$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MAX_ITEMS = 200

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUtcIso(value: unknown): value is string {
  return typeof value === 'string' && UTC_ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function nullableIso(value: unknown): string | null {
  return isUtcIso(value) ? value : null
}

function toSource(value: unknown): ActorSource {
  return value === 'agent' ? 'agent' : 'human'
}

/**
 * Snapshot the current plan as an `observing-plan.v1` document.
 *
 * `darkness` is passed in rather than computed so that this module stays free of
 * astronomy: the caller already has the night ephemeris in hand.
 */
export function toObservingPlanV1(
  state: Pick<RoqueState, 'site' | 'nightOf' | 'plan'>,
  darkness: { startUtc: string | null; endUtc: string | null },
  author?: string,
): ObservingPlanV1 {
  const items: ObservingPlanItem[] = [...state.plan]
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    .map((item: PlanItem) => ({
      target_id: item.targetId,
      name: item.targetName,
      start_utc: item.startUtc,
      end_utc: item.endUtc,
      ...(item.note ? { note: item.note } : {}),
      source: item.source,
    }))

  const document: ObservingPlanV1 = {
    $schema: OBSERVING_PLAN_SCHEMA_URL,
    version: 1,
    generator: OBSERVING_PLAN_GENERATOR,
    created_at: new Date().toISOString(),
    site: {
      name: state.site.name,
      latitude: roundTo(state.site.latitude, 5),
      longitude: roundTo(state.site.longitude, 5),
      elevation_m: Math.round(state.site.elevationM),
      time_zone: state.site.timeZone,
    },
    night_of: state.nightOf,
    darkness: { start_utc: darkness.startUtc, end_utc: darkness.endUtc },
    items,
  }
  const signature = optionalString(author)
  if (signature) document.author = signature.trim()
  return document
}

/**
 * Read a document written by this page or by anyone else.
 *
 * Validation is done by hand on purpose: shipping Ajv to the browser to read a
 * seven field document would be a dependency for nothing. The published JSON
 * Schema is the contract; this is the reader, and it is forgiving about what it
 * can default (generator, created_at, source, name) and strict about what it
 * cannot invent (version, site coordinates, item times).
 */
export function parseObservingPlanV1(text: string): ParseResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { error: 'The document is empty.' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { error: `The document is not valid JSON: ${(error as Error).message}` }
  }

  if (!isPlainObject(raw)) {
    return { error: 'The document must be a JSON object with version, site and items.' }
  }

  if (raw.version !== 1) {
    return {
      error: `Unsupported observing plan version ${JSON.stringify(raw.version ?? null)}: this page reads version 1.`,
    }
  }

  if (!Array.isArray(raw.items)) {
    return { error: 'The document has no items array.' }
  }
  if (raw.items.length > MAX_ITEMS) {
    return { error: `Too many items: ${raw.items.length} (the limit is ${MAX_ITEMS}).` }
  }

  const rawSite = raw.site
  if (!isPlainObject(rawSite)) {
    return { error: 'The document has no site object; a plan without a site cannot be revalidated.' }
  }
  const latitude = rawSite.latitude
  const longitude = rawSite.longitude
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  ) {
    return { error: 'The document site needs numeric latitude and longitude in decimal degrees.' }
  }

  const items: ObservingPlanItem[] = []
  for (let i = 0; i < raw.items.length; i++) {
    const entry = raw.items[i]
    if (!isPlainObject(entry)) return { error: `items[${i}] is not an object.` }
    const targetId = optionalString(entry.target_id)
    const name = optionalString(entry.name)
    if (!targetId && !name) return { error: `items[${i}] needs a target_id or a name.` }
    if (!isUtcIso(entry.start_utc)) {
      return {
        error: `items[${i}].start_utc must be a UTC ISO instant such as 2026-09-12T21:00:00Z, got ${JSON.stringify(entry.start_utc ?? null)}.`,
      }
    }
    if (!isUtcIso(entry.end_utc)) {
      return {
        error: `items[${i}].end_utc must be a UTC ISO instant such as 2026-09-12T21:45:00Z, got ${JSON.stringify(entry.end_utc ?? null)}.`,
      }
    }
    const note = optionalString(entry.note)
    items.push({
      target_id: targetId ?? (name as string),
      name: name ?? (targetId as string),
      start_utc: entry.start_utc,
      end_utc: entry.end_utc,
      ...(note ? { note } : {}),
      source: toSource(entry.source),
    })
  }

  const rawDarkness = isPlainObject(raw.darkness) ? raw.darkness : {}
  const nightOf =
    typeof raw.night_of === 'string' && DATE_PATTERN.test(raw.night_of)
      ? raw.night_of
      : (items[0]?.start_utc.slice(0, 10) ?? '')

  const plan: ObservingPlanV1 = {
    $schema: OBSERVING_PLAN_SCHEMA_URL,
    version: 1,
    generator: optionalString(raw.generator) ?? OBSERVING_PLAN_GENERATOR,
    created_at: optionalString(raw.created_at) ?? new Date().toISOString(),
    site: {
      name: optionalString(rawSite.name) ?? `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
      latitude,
      longitude,
      elevation_m:
        typeof rawSite.elevation_m === 'number' && Number.isFinite(rawSite.elevation_m)
          ? Math.round(rawSite.elevation_m)
          : 0,
      time_zone: optionalString(rawSite.time_zone) ?? null,
    },
    night_of: nightOf,
    darkness: {
      start_utc: nullableIso(rawDarkness.start_utc),
      end_utc: nullableIso(rawDarkness.end_utc),
    },
    items,
  }
  const author = optionalString(raw.author)
  if (author) plan.author = author
  return { plan }
}

// --- calendar ----------------------------------------------------------------

const CRLF = '\r\n'

/** '2026-09-12T21:00:00.000Z' -> '20260912T210000Z'. */
export function toIcsStamp(isoUtc: string): string {
  const ms = Date.parse(isoUtc)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function eventSummary(item: ObservingPlanItem): string {
  return item.name && item.name !== item.target_id
    ? `Observe ${item.target_id} (${item.name})`
    : `Observe ${item.target_id}`
}

/**
 * The plan as a calendar anyone can drop into their agenda. Every instant is
 * UTC, so the events land correctly whatever zone the calendar app is in.
 */
export function toIcs(plan: ObservingPlanV1): string {
  const stamp = toIcsStamp(plan.created_at) || toIcsStamp(new Date().toISOString())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Roque Nights//Observing Plan v1//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(`Observing plan ${plan.night_of}`)}`,
  ]

  for (const item of plan.items) {
    const start = toIcsStamp(item.start_utc)
    const description = `${item.note ? `${item.note}. ` : ''}Night of ${plan.night_of}. Site: ${plan.site.name}.`
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.target_id}-${start}@roque-nights`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${toIcsStamp(item.end_utc)}`,
      `SUMMARY:${icsText(eventSummary(item))}`,
      `DESCRIPTION:${icsText(description)}`,
      `LOCATION:${icsText(plan.site.name)}`,
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return `${lines.join(CRLF)}${CRLF}`
}

// --- spreadsheet -------------------------------------------------------------

export const CSV_HEADER = 'target_id,name,start_utc,end_utc,start_local,end_local,note,source'

/** RFC 4180 field: newlines collapsed to spaces so one item is always one row. */
function csvField(value: string | null | undefined): string {
  const flat = String(value ?? '')
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim()
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat
}

/**
 * The plan as a spreadsheet. Local columns stay empty when the document carries
 * no time zone: a blank cell is honest, a guessed hour is not.
 */
export function toCsv(plan: ObservingPlanV1): string {
  const zone = plan.site.time_zone
  const rows = plan.items.map((item) =>
    [
      csvField(item.target_id),
      csvField(item.name),
      csvField(item.start_utc),
      csvField(item.end_utc),
      csvField(localStamp(item.start_utc, zone)),
      csvField(localStamp(item.end_utc, zone)),
      csvField(item.note),
      csvField(item.source),
    ].join(','),
  )
  return [CSV_HEADER, ...rows].join('\n')
}
