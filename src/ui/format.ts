/**
 * Display formatting for the UI layer.
 *
 * Everything the app stores is UTC. Nothing here invents a time zone: when a
 * site has no IANA zone the value is rendered in UTC and the caller labels it
 * with `zoneLabel`.
 */

import { formatInZone } from '../astro/time'

/** Shown wherever a number or a time does not exist for this night. */
export const EMPTY = '—'

export interface ClockOptions {
  withDate?: boolean
}

/** 'HH:mm' (or 'YYYY-MM-DD HH:mm') in UTC. */
export function fmtUtc(isoUtc: string | null | undefined, opts?: ClockOptions): string {
  if (!isoUtc) return EMPTY
  return formatInZone(isoUtc, 'UTC', opts)
}

/**
 * 'HH:mm' (or 'YYYY-MM-DD HH:mm') in the site zone. Falls back to UTC when the
 * zone is unknown, which is why every caller pairs it with `zoneLabel`.
 */
export function fmtLocal(
  isoUtc: string | null | undefined,
  timeZone: string | null,
  opts?: ClockOptions,
): string {
  if (!isoUtc) return EMPTY
  return formatInZone(isoUtc, timeZone ?? 'UTC', opts)
}

/** 'Atlantic/Canary' or 'UTC' when the site has no zone. */
export function zoneLabel(timeZone: string | null): string {
  return timeZone ?? 'UTC'
}

/** '22:10-23:40' in the site zone, with a single dash and no spaces. */
export function fmtTimeRange(
  startUtc: string | null | undefined,
  endUtc: string | null | undefined,
  timeZone: string | null,
): string {
  return `${fmtLocal(startUtc, timeZone)}-${fmtLocal(endUtc, timeZone)}`
}

/** '3.0 h'. */
export function fmtHours(hours: number | null | undefined, decimals = 1): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return EMPTY
  return `${hours.toFixed(decimals)} h`
}

/** '41.3°'. */
export function fmtDeg(deg: number | null | undefined, decimals = 1): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return EMPTY
  return `${deg.toFixed(decimals)}°`
}

/** '66%'. */
export function fmtPct(pct: number | null | undefined, decimals = 0): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return EMPTY
  return `${pct.toFixed(decimals)}%`
}

/** '1.42' airmass, or the reason there is none. */
export function fmtAirmass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return value.toFixed(2)
}

/** 'mag 5.8'. */
export function fmtMag(mag: number | null | undefined): string {
  if (mag === null || mag === undefined || !Number.isFinite(mag)) return EMPTY
  return `mag ${mag.toFixed(1)}`
}

/** '312 ms', '1.4 s', '2m 05s'. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return EMPTY
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds < 10 ? '0' : ''}${seconds}s`
}

/** '45 min', '1 h 15 min'. */
export function fmtMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return EMPTY
  const total = Math.round(minutes)
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

const PHASE_GLYPHS: Record<string, string> = {
  'new moon': '🌑',
  'waxing crescent': '🌒',
  'first quarter': '🌓',
  'waxing gibbous': '🌔',
  'full moon': '🌕',
  'waning gibbous': '🌖',
  'third quarter': '🌗',
  'waning crescent': '🌘',
}

/** The Moon glyph for one of the eight phase names from src/astro/night.ts. */
export function phaseGlyph(phaseName: string | null | undefined): string {
  if (typeof phaseName !== 'string') return '●'
  return PHASE_GLYPHS[phaseName.trim().toLowerCase()] ?? '●'
}

/** Shortens to `max` characters, ellipsis included. */
export function truncate(text: string, max = 80): string {
  if (typeof text !== 'string') return ''
  if (text.length <= max) return text
  if (max <= 3) return text.slice(0, max)
  return `${text.slice(0, max - 3)}...`
}

/** 'item' / 'items' without repeating the ternary in every component. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`)
}
