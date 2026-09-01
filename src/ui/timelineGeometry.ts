/**
 * Pure geometry for the night timeline.
 *
 * The timeline maps the 24 h window of a night onto a pixel width and turns the
 * 10-minute Sun and Moon altitude samples into contiguous bands. It is pure so
 * the shape of the night can be tested without a DOM.
 */

import type { NightEphemeris } from '../astro/night'

/** Twilight steps, from brightest to darkest. */
export type BandKind = 'day' | 'civil' | 'nautical' | 'astronomical' | 'darkness'

export interface Band {
  kind: BandKind
  /** Left edge in pixels. */
  x0: number
  /** Right edge in pixels. */
  x1: number
}

export interface Span {
  x0: number
  x1: number
}

export interface TimelineGeometry {
  width: number
  startMs: number
  endMs: number
  /** Pixel position of an instant, clamped to the night window. */
  x(instant: string | number | Date): number
  /** Instant at a pixel position, clamped to the night window. ISO UTC. */
  timeAt(x: number): string
  /** Contiguous, gap free, left to right. */
  bands: Band[]
  /** Spans where the Moon is above the horizon. */
  moonSpans: Span[]
  /** Opacity for the Moon hatch, scaled by illumination. */
  moonOpacity: number
}

/** Fill for each twilight band. Darker as the Sun sinks; darkness is the page ground. */
export const BAND_FILL: Record<BandKind, string> = {
  day: '#25324a',
  civil: '#1b2436',
  nautical: '#131a29',
  astronomical: '#0b0f18',
  darkness: '#05060a',
}

/** Sun altitude thresholds, in the order the bands darken. */
const THRESHOLDS = [0, -6, -12, -18]

export function bandKindForAltitude(sunAltDeg: number): BandKind {
  if (sunAltDeg > 0) return 'day'
  if (sunAltDeg > -6) return 'civil'
  if (sunAltDeg > -12) return 'nautical'
  if (sunAltDeg > -18) return 'astronomical'
  return 'darkness'
}

function toMs(instant: string | number | Date): number {
  if (instant instanceof Date) return instant.getTime()
  if (typeof instant === 'number') return instant
  return Date.parse(instant)
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * Splits one sample segment wherever it crosses a twilight threshold, so a band
 * edge lands on the interpolated crossing instead of on a 10-minute grid.
 */
function crossingsMs(t0: number, t1: number, a0: number, a1: number): number[] {
  const out: number[] = []
  if (a0 === a1) return out
  for (const level of THRESHOLDS) {
    const low = Math.min(a0, a1)
    const high = Math.max(a0, a1)
    if (level <= low || level >= high) continue
    const fraction = (level - a0) / (a1 - a0)
    out.push(t0 + fraction * (t1 - t0))
  }
  return out.sort((a, b) => a - b)
}

function pushBand(bands: Band[], kind: BandKind, x0: number, x1: number): void {
  if (!(x1 > x0)) return
  const last = bands[bands.length - 1]
  if (last && last.kind === kind) {
    last.x1 = x1
    return
  }
  bands.push({ kind, x0, x1 })
}

function pushSpan(spans: Span[], x0: number, x1: number): void {
  if (!(x1 > x0)) return
  const last = spans[spans.length - 1]
  if (last && Math.abs(last.x1 - x0) < 1e-9) {
    last.x1 = x1
    return
  }
  spans.push({ x0, x1 })
}

/**
 * Geometry of one night over `width` pixels. `width` is clamped to at least 1 px
 * so a timeline that is measured before layout still produces usable numbers.
 */
export function timelineGeometry(night: NightEphemeris, width: number): TimelineGeometry {
  const pixels = Number.isFinite(width) && width > 1 ? width : 1
  const startMs = Date.parse(night.windowStartUtc)
  const endMs = Date.parse(night.windowEndUtc)
  const spanMs = endMs > startMs ? endMs - startMs : 1

  const x = (instant: string | number | Date): number => {
    const ms = toMs(instant)
    if (!Number.isFinite(ms)) return 0
    return clamp(((ms - startMs) / spanMs) * pixels, 0, pixels)
  }

  const timeAt = (px: number): string => {
    const clamped = clamp(Number.isFinite(px) ? px : 0, 0, pixels)
    return new Date(startMs + (clamped / pixels) * spanMs).toISOString()
  }

  const stepMs = night.samples.stepMinutes * 60_000
  const sampleStartMs = Date.parse(night.samples.startUtc)
  const sun = night.samples.sunAltDeg
  const moon = night.samples.moonAltDeg

  const bands: Band[] = []
  for (let i = 0; i + 1 < sun.length; i++) {
    const t0 = sampleStartMs + i * stepMs
    const t1 = t0 + stepMs
    const a0 = sun[i]
    const a1 = sun[i + 1]
    let cursor = t0
    for (const crossing of crossingsMs(t0, t1, a0, a1)) {
      const mid = (cursor + crossing) / 2
      const alt = a0 + ((mid - t0) / stepMs) * (a1 - a0)
      pushBand(bands, bandKindForAltitude(alt), x(cursor), x(crossing))
      cursor = crossing
    }
    const mid = (cursor + t1) / 2
    const alt = a0 + ((mid - t0) / stepMs) * (a1 - a0)
    pushBand(bands, bandKindForAltitude(alt), x(cursor), x(t1))
  }
  // The samples may stop a hair before the window edge; never leave a gap.
  const lastBand = bands[bands.length - 1]
  if (lastBand && lastBand.x1 < pixels) lastBand.x1 = pixels
  if (bands.length > 0 && bands[0].x0 > 0) bands[0].x0 = 0

  const moonSpans: Span[] = []
  for (let i = 0; i + 1 < moon.length; i++) {
    const t0 = sampleStartMs + i * stepMs
    const t1 = t0 + stepMs
    const a0 = moon[i]
    const a1 = moon[i + 1]
    const up0 = a0 > 0
    const up1 = a1 > 0
    if (up0 && up1) {
      pushSpan(moonSpans, x(t0), x(t1))
    } else if (up0 !== up1 && a0 !== a1) {
      const crossing = t0 + ((0 - a0) / (a1 - a0)) * stepMs
      if (up0) pushSpan(moonSpans, x(t0), x(crossing))
      else pushSpan(moonSpans, x(crossing), x(t1))
    }
  }

  const illum = Number.isFinite(night.moon.illuminationPct) ? night.moon.illuminationPct : 0
  const moonOpacity = 0.15 + (0.35 * clamp(illum, 0, 100)) / 100

  return { width: pixels, startMs, endMs, x, timeAt, bands, moonSpans, moonOpacity }
}
