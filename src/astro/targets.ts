/**
 * Where a target is, when it is up, and whether it is worth pointing at.
 *
 * Positions come from astronomy-engine: fixed targets are rotated from J2000 to the
 * local horizon with the same `sky.ts` helpers the map uses (one shared code path, so
 * the numbers a tool quotes and the dot the human sees can never drift apart), solar
 * system bodies go through `Equator` + `Horizon`.
 *
 * Everything is UTC and pure. Rotations and Moon positions are memoized because a full
 * catalog scan asks for the same instants 140 times over.
 */

import {
  Body,
  Equator,
  Horizon,
  Illumination,
  MakeTime,
  Rotation_EQJ_EQD,
  SearchHourAngle,
} from 'astronomy-engine'
import type { Observer, RotationMatrix } from 'astronomy-engine'

import type { TargetType } from '../state/types'
import { ALL_TARGETS, searchTargets } from './catalog'
import type { Target } from './catalog'
import { makeObserver } from './night'
import type { Interval, NightEphemeris, SiteCoords } from './night'
import { eqjToHorizontalVec, horizontalRotation, vecToAltAz } from './sky'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
const MINUTE_MS = 60_000

/** Defaults every caller inherits unless it says otherwise. */
export const DEFAULT_MIN_ALT_DEG = 30
export const DEFAULT_MIN_MOON_SEP_DEG = 30
export const DEFAULT_MIN_WINDOW_MINUTES = 45
export const DEFAULT_STEP_MINUTES = 10
export const DEFAULT_LIMIT = 12

export interface AltAz {
  /** Altitude above the horizon in degrees, [-90, 90]. */
  altDeg: number
  /** Azimuth in degrees clockwise from north, [0, 360). */
  azDeg: number
}

// --- memo caches ------------------------------------------------------------
// A catalog scan evaluates ~145 instants for 140 targets. The rotation from J2000
// to the horizon depends only on the instant and the site, so it is computed once
// and reused by every fixed target.

const CACHE_LIMIT = 4096

function trim<K, V>(cache: Map<K, V>): void {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as K | undefined
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

const observerCache = new Map<string, Observer>()
const rotationCache = new Map<string, RotationMatrix>()
const eqdRotationCache = new Map<number, RotationMatrix>()
const moonEqdCache = new Map<string, { raDeg: number; decDeg: number }>()
const magnitudeCache = new Map<string, number>()

function siteKey(site: SiteCoords): string {
  return `${site.latitude}|${site.longitude}|${site.elevationM}`
}

function observerFor(site: SiteCoords): Observer {
  const key = siteKey(site)
  let observer = observerCache.get(key)
  if (!observer) {
    observer = makeObserver(site)
    observerCache.set(key, observer)
    trim(observerCache)
  }
  return observer
}

function rotationFor(date: Date, site: SiteCoords): RotationMatrix {
  const key = `${date.getTime()}|${siteKey(site)}`
  let rot = rotationCache.get(key)
  if (!rot) {
    rot = horizontalRotation(date, site)
    rotationCache.set(key, rot)
    trim(rotationCache)
  }
  return rot
}

function eqdRotationFor(date: Date): RotationMatrix {
  const key = date.getTime()
  let rot = eqdRotationCache.get(key)
  if (!rot) {
    rot = Rotation_EQJ_EQD(MakeTime(date))
    eqdRotationCache.set(key, rot)
    trim(eqdRotationCache)
  }
  return rot
}

/** Drops every memoized rotation and Moon position. Tests and site changes use it. */
export function clearTargetCaches(): void {
  observerCache.clear()
  rotationCache.clear()
  eqdRotationCache.clear()
  moonEqdCache.clear()
  magnitudeCache.clear()
}

/**
 * Apparent visual magnitude. Catalog objects carry a fixed value; a planet's
 * brightness swings by whole magnitudes along its orbit, so it is computed for
 * the instant asked about.
 */
export function apparentMagnitude(target: Target, date: Date): number | null {
  if (target.kind !== 'body' || !target.body) return target.mag
  const key = `${target.id}|${date.getTime()}`
  const hit = magnitudeCache.get(key)
  if (hit !== undefined) return hit
  let mag: number
  try {
    mag = Illumination(target.body, date).mag
  } catch {
    return target.mag
  }
  magnitudeCache.set(key, mag)
  trim(magnitudeCache)
  return mag
}

// --- positions --------------------------------------------------------------

function normalizeAz(azDeg: number): number {
  return ((azDeg % 360) + 360) % 360
}

/** Altitude and azimuth of a target as seen from `site` at `date`. */
export function targetAltAz(target: Target, date: Date, site: SiteCoords): AltAz {
  if (target.kind === 'body' && target.body) {
    const observer = observerFor(site)
    const eq = Equator(target.body, date, observer, true, true)
    const hor = Horizon(date, observer, eq.ra, eq.dec, 'normal')
    return { altDeg: hor.altitude, azDeg: normalizeAz(hor.azimuth) }
  }
  const rot = rotationFor(date, site)
  const aa = vecToAltAz(eqjToHorizontalVec(target.ra ?? 0, target.dec ?? 0, rot))
  return { altDeg: aa.altDeg, azDeg: normalizeAz(aa.azDeg) }
}

/**
 * Equatorial coordinates of date, in degrees. Catalog targets are precessed from
 * J2000; bodies are topocentric, apparent, corrected for aberration.
 */
export function targetRaDecOfDate(
  target: Target,
  date: Date,
  site: SiteCoords,
): { raDeg: number; decDeg: number } {
  if (target.kind === 'body' && target.body) {
    const eq = Equator(target.body, date, observerFor(site), true, true)
    return { raDeg: normalizeAz(eq.ra * 15), decDeg: eq.dec }
  }
  const rot = eqdRotationFor(date)
  const ra = (target.ra ?? 0) * DEG
  const dec = (target.dec ?? 0) * DEG
  const cosDec = Math.cos(dec)
  const v = { x: cosDec * Math.cos(ra), y: cosDec * Math.sin(ra), z: Math.sin(dec) }
  const m = rot.rot
  // Same convention as astronomy-engine's RotateVector.
  const x = m[0][0] * v.x + m[1][0] * v.y + m[2][0] * v.z
  const y = m[0][1] * v.x + m[1][1] * v.y + m[2][1] * v.z
  const z = m[0][2] * v.x + m[1][2] * v.y + m[2][2] * v.z
  const len = Math.hypot(x, y, z) || 1
  return {
    raDeg: normalizeAz(Math.atan2(y, x) * RAD),
    decDeg: Math.asin(Math.max(-1, Math.min(1, z / len))) * RAD,
  }
}

function unitVector(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  const cosDec = Math.cos(dec)
  return [cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)]
}

function moonRaDecOfDate(date: Date, site: SiteCoords): { raDeg: number; decDeg: number } {
  const key = `${date.getTime()}|${siteKey(site)}`
  let hit = moonEqdCache.get(key)
  if (!hit) {
    const eq = Equator(Body.Moon, date, observerFor(site), true, true)
    hit = { raDeg: normalizeAz(eq.ra * 15), decDeg: eq.dec }
    moonEqdCache.set(key, hit)
    trim(moonEqdCache)
  }
  return hit
}

/** Angular distance between a target and the Moon, in degrees [0, 180]. */
export function moonSeparationDeg(target: Target, date: Date, site: SiteCoords): number {
  if (target.body === Body.Moon) return 0
  const moon = moonRaDecOfDate(date, site)
  const own = targetRaDecOfDate(target, date, site)
  const a = unitVector(own.raDeg, own.decDeg)
  const b = unitVector(moon.raDeg, moon.decDeg)
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const cross: [number, number, number] = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  // atan2 of the cross and dot products stays accurate at both ends of the range.
  return Math.atan2(Math.hypot(cross[0], cross[1], cross[2]), dot) * RAD
}

/** Relative air mass, Kasten & Young 1989. Null at or below the horizon. */
export function airmass(altDeg: number): number | null {
  if (!Number.isFinite(altDeg) || altDeg <= 0) return null
  const h = altDeg
  return 1 / (Math.sin(h * DEG) + 0.50572 * Math.pow(h + 6.07995, -1.6364))
}

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
]

/** Azimuth to one of the 16 compass points. */
export function compassDirection(azDeg: number): string {
  if (!Number.isFinite(azDeg)) return 'N'
  const index = Math.round(normalizeAz(azDeg) / 22.5) % 16
  return COMPASS[index]
}

// --- visibility --------------------------------------------------------------

export interface VisibilityWindow {
  startUtc: string
  endUtc: string
  peakUtc: string
  peakAltDeg: number
  peakAzDeg: number
  peakAirmass: number | null
  /** Moon separation at the peak, degrees. */
  moonSeparationDeg: number
  /** Share of the window during which the Moon is above the horizon, 0..1. */
  moonUpFraction: number
  minutes: number
}

export interface TargetVisibility {
  target: Target
  observable: boolean
  /** Why it is not observable, null when it is. */
  reason: string | null
  window: VisibilityWindow | null
  transitUtc: string | null
  transitAltDeg: number | null
  /** Position at the instant the caller asked about, when it passed one. */
  altNow?: AltAz
  /** 0..100, higher is a better use of the night. */
  score: number
}

export interface VisibilityOptions {
  minAltDeg: number
  interval: Interval | null
  stepMinutes?: number
  minMoonSepDeg?: number
  minWindowMinutes?: number
  /**
   * Extension over the plan contract: an instant to report `altNow` for.
   * ISO string or Date, null to skip.
   */
  at?: string | Date | null
}

function round(n: number): number {
  return Math.round(n)
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

/** '8' for 8, '9.5' for 9.5: magnitudes read badly with trailing zeros. */
function formatMag(mag: number): string {
  return Number.isInteger(mag) ? String(mag) : String(roundTo(mag, 2))
}

/** Moon altitude read off the night's own 10-minute sample grid (linear in between). */
function moonAltAt(night: NightEphemeris, ms: number): number {
  const samples = night.samples.moonAltDeg
  if (samples.length === 0) return -90
  const stepMs = night.samples.stepMinutes * MINUTE_MS
  const x = (ms - Date.parse(night.samples.startUtc)) / stepMs
  if (x <= 0) return samples[0]
  if (x >= samples.length - 1) return samples[samples.length - 1]
  const i = Math.floor(x)
  return samples[i] + (samples[i + 1] - samples[i]) * (x - i)
}

/** The sample instants of an interval: every `stepMinutes`, always including the end. */
function sampleTimes(startMs: number, endMs: number, stepMs: number): number[] {
  const times: number[] = []
  for (let t = startMs; t < endMs; t += stepMs) times.push(t)
  times.push(endMs)
  return times
}

interface Culmination {
  utc: string | null
  altDeg: number | null
}

/** Highest point the target reaches inside the 24 h window of the night. */
function culmination(target: Target, night: NightEphemeris, site: SiteCoords): Culmination {
  const windowStartMs = Date.parse(night.windowStartUtc)
  const windowEndMs = Date.parse(night.windowEndUtc)

  if (target.kind === 'body' && target.body) {
    try {
      const event = SearchHourAngle(target.body, observerFor(site), 0, new Date(windowStartMs), 1)
      const ms = event.time.date.getTime()
      if (ms > windowEndMs) return { utc: null, altDeg: null }
      return { utc: new Date(ms).toISOString(), altDeg: roundTo(event.hor.altitude, 2) }
    } catch {
      // A body with no culmination in this window is simply not reported.
      return { utc: null, altDeg: null }
    }
  }

  // Coarse scan on the night's own grid (shared rotations), then one minute steps.
  const stepMs = night.samples.stepMinutes * MINUTE_MS
  let bestMs = windowStartMs
  let bestAlt = Number.NEGATIVE_INFINITY
  for (let t = windowStartMs; t <= windowEndMs; t += stepMs) {
    const alt = targetAltAz(target, new Date(t), site).altDeg
    if (alt > bestAlt) {
      bestAlt = alt
      bestMs = t
    }
  }
  const from = Math.max(windowStartMs, bestMs - stepMs)
  const to = Math.min(windowEndMs, bestMs + stepMs)
  for (let t = from; t <= to; t += MINUTE_MS) {
    const alt = targetAltAz(target, new Date(t), site).altDeg
    if (alt > bestAlt) {
      bestAlt = alt
      bestMs = t
    }
  }
  return { utc: new Date(bestMs).toISOString(), altDeg: roundTo(bestAlt, 2) }
}

function rejected(target: Target, reason: string, transit: Culmination): TargetVisibility {
  return {
    target,
    observable: false,
    reason,
    window: null,
    transitUtc: transit.utc,
    transitAltDeg: transit.altDeg,
    score: 0,
  }
}

const NO_TRANSIT: Culmination = { utc: null, altDeg: null }

/**
 * How good an opportunity this is, 0..100.
 *
 * Four things decide whether a night is well spent: how high the target gets, how
 * long it stays there, how far the Moon is from it while the Moon is up, and how
 * bright it is. The plan of 2026-09-01 weighted only the first three (0.5 / 0.3 /
 * 0.2); with the real catalog that ranks magnitude 8 globulars above the Andromeda
 * Galaxy, so brightness carries a quarter of the score and Moon distance a tenth
 * (targets closer to the Moon than `minMoonSepDeg` are rejected outright anyway).
 */
function observingScore(input: {
  peakAltDeg: number
  minutes: number
  separation: number
  moonUpAtPeak: boolean
  mag: number | null
}): number {
  const altitudeTerm = Math.min(Math.max(input.peakAltDeg, 0) / 90, 1)
  const durationTerm = Math.min(input.minutes / 240, 1)
  const moonTerm = input.moonUpAtPeak ? Math.min(input.separation / 90, 1) : 1
  // Magnitude 9 is roughly the limit of a small telescope under a dark sky.
  const brightnessTerm =
    input.mag === null ? 0.5 : Math.min(Math.max((9 - input.mag) / 9, 0), 1)
  return Math.round(
    100 * (0.4 * altitudeTerm + 0.25 * durationTerm + 0.1 * moonTerm + 0.25 * brightnessTerm),
  )
}

/**
 * When and how well a target can be observed inside an interval (the darkness
 * window by default). Samples the interval, keeps the longest run above
 * `minAltDeg`, and reports the peak of that run.
 */
export function computeVisibility(
  target: Target,
  night: NightEphemeris,
  site: SiteCoords,
  opts: VisibilityOptions,
): TargetVisibility {
  const minAltDeg = opts.minAltDeg
  const stepMinutes = opts.stepMinutes ?? DEFAULT_STEP_MINUTES
  const minMoonSepDeg = opts.minMoonSepDeg ?? DEFAULT_MIN_MOON_SEP_DEG
  const minWindowMinutes = opts.minWindowMinutes ?? DEFAULT_MIN_WINDOW_MINUTES

  const interval =
    opts.interval ??
    (night.darkness.startUtc && night.darkness.endUtc
      ? { startUtc: night.darkness.startUtc, endUtc: night.darkness.endUtc }
      : null)

  const withAltNow = (visibility: TargetVisibility): TargetVisibility => {
    if (opts.at === undefined || opts.at === null) return visibility
    const at = opts.at instanceof Date ? opts.at : new Date(opts.at)
    if (Number.isNaN(at.getTime())) return visibility
    const aa = targetAltAz(target, at, site)
    return { ...visibility, altNow: { altDeg: roundTo(aa.altDeg, 2), azDeg: roundTo(aa.azDeg, 2) } }
  }

  if (!interval) {
    return withAltNow(rejected(target, 'no astronomical darkness on this night', NO_TRANSIT))
  }

  const startMs = Date.parse(interval.startUtc)
  const endMs = Date.parse(interval.endUtc)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return withAltNow(rejected(target, 'the requested interval is empty', NO_TRANSIT))
  }

  const transit = culmination(target, night, site)
  if (transit.altDeg !== null && transit.altDeg <= 0) {
    return withAltNow(
      rejected(target, 'never rises above the horizon at this latitude', transit),
    )
  }

  const stepMs = Math.max(1, Math.round(stepMinutes)) * MINUTE_MS
  const times = sampleTimes(startMs, endMs, stepMs)
  const altitudes: number[] = new Array<number>(times.length)
  const azimuths: number[] = new Array<number>(times.length)
  let overallPeak = Number.NEGATIVE_INFINITY
  for (let i = 0; i < times.length; i++) {
    const aa = targetAltAz(target, new Date(times[i]), site)
    altitudes[i] = aa.altDeg
    azimuths[i] = aa.azDeg
    if (aa.altDeg > overallPeak) overallPeak = aa.altDeg
  }

  // Longest contiguous run above the altitude floor.
  let bestFrom = -1
  let bestTo = -1
  let runFrom = -1
  for (let i = 0; i < altitudes.length; i++) {
    if (altitudes[i] >= minAltDeg) {
      if (runFrom < 0) runFrom = i
      if (bestFrom < 0 || times[i] - times[runFrom] > times[bestTo] - times[bestFrom]) {
        bestFrom = runFrom
        bestTo = i
      }
    } else {
      runFrom = -1
    }
  }

  if (bestFrom < 0) {
    return withAltNow(
      rejected(
        target,
        `below minimum altitude (peak ${round(overallPeak)}° < ${round(minAltDeg)}°)`,
        transit,
      ),
    )
  }

  let peakIndex = bestFrom
  for (let i = bestFrom; i <= bestTo; i++) {
    if (altitudes[i] > altitudes[peakIndex]) peakIndex = i
  }

  const windowStartMs = times[bestFrom]
  const windowEndMs = times[bestTo]
  const minutes = Math.round((windowEndMs - windowStartMs) / MINUTE_MS)
  const peakMs = times[peakIndex]
  const peakAltDeg = roundTo(altitudes[peakIndex], 2)
  const peakAzDeg = roundTo(azimuths[peakIndex], 2)

  let moonUp = 0
  for (let i = bestFrom; i <= bestTo; i++) {
    if (moonAltAt(night, times[i]) >= 0) moonUp++
  }
  const moonUpFraction = roundTo(moonUp / (bestTo - bestFrom + 1), 3)
  const separation = roundTo(moonSeparationDeg(target, new Date(peakMs), site), 2)
  const moonUpAtPeak = moonAltAt(night, peakMs) >= 0

  const window: VisibilityWindow = {
    startUtc: new Date(windowStartMs).toISOString(),
    endUtc: new Date(windowEndMs).toISOString(),
    peakUtc: new Date(peakMs).toISOString(),
    peakAltDeg,
    peakAzDeg,
    peakAirmass: airmass(peakAltDeg) === null ? null : roundTo(airmass(peakAltDeg)!, 3),
    moonSeparationDeg: separation,
    moonUpFraction,
    minutes,
  }

  const fail = (reason: string): TargetVisibility =>
    withAltNow({
      target,
      observable: false,
      reason,
      window,
      transitUtc: transit.utc,
      transitAltDeg: transit.altDeg,
      score: 0,
    })

  if (minutes < minWindowMinutes) {
    return fail(`window too short (${minutes} min < ${round(minWindowMinutes)} min)`)
  }
  // The Moon is always allowed to be next to itself.
  if (target.body !== Body.Moon && moonUpAtPeak && separation < minMoonSepDeg) {
    return fail(`too close to the Moon (${round(separation)}° < ${round(minMoonSepDeg)}°)`)
  }

  const score = observingScore({
    peakAltDeg,
    minutes,
    separation,
    moonUpAtPeak: moonUpAtPeak && target.body !== Body.Moon,
    mag: apparentMagnitude(target, new Date(peakMs)),
  })

  return withAltNow({
    target,
    observable: true,
    reason: null,
    window,
    transitUtc: transit.utc,
    transitAltDeg: transit.altDeg,
    score,
  })
}

// --- catalog scan -------------------------------------------------------------

export interface FindOptions {
  minAltDeg?: number
  types?: TargetType[] | null
  maxMag?: number | null
  minMoonSepDeg?: number
  minWindowMinutes?: number
  limit?: number
  query?: string | null
  ids?: string[] | null
  interval?: Interval | null
  /** Extension over the plan contract: fills `altNow` on every result. */
  at?: string | Date | null
  /** Extension over the plan contract: sampling resolution in minutes. */
  stepMinutes?: number
}

export interface FindResult {
  candidates: TargetVisibility[]
  rejected: { id: string; name: string; reason: string }[]
  options: Required<FindOptions>
}

/**
 * Walks the whole catalog for one night and splits it into what is worth
 * observing and what is not, with a reason for every rejection. The Sun is not
 * in the catalog; the Moon is a legitimate candidate.
 */
export function findObservableTargets(
  night: NightEphemeris,
  site: SiteCoords,
  opts: FindOptions,
): FindResult {
  const interval =
    opts.interval ??
    (night.darkness.startUtc && night.darkness.endUtc
      ? { startUtc: night.darkness.startUtc, endUtc: night.darkness.endUtc }
      : null)

  const resolved: Required<FindOptions> = {
    minAltDeg: opts.minAltDeg ?? DEFAULT_MIN_ALT_DEG,
    types: opts.types ?? null,
    maxMag: opts.maxMag ?? null,
    minMoonSepDeg: opts.minMoonSepDeg ?? DEFAULT_MIN_MOON_SEP_DEG,
    minWindowMinutes: opts.minWindowMinutes ?? DEFAULT_MIN_WINDOW_MINUTES,
    limit: opts.limit ?? DEFAULT_LIMIT,
    query: opts.query ?? null,
    ids: opts.ids ?? null,
    interval,
    at: opts.at ?? null,
    stepMinutes: opts.stepMinutes ?? DEFAULT_STEP_MINUTES,
  }

  // `ids` and `query` narrow the catalog before anything is computed: a target the
  // caller did not ask about is not a rejection, it is simply out of scope.
  let scope: Set<Target> | null = null
  if (resolved.ids) {
    scope = new Set<Target>()
    for (const id of resolved.ids) {
      const found = ALL_TARGETS.find((t) => t.id === id)
      if (found) scope.add(found)
    }
  }
  if (resolved.query) {
    const hits = new Set(searchTargets(resolved.query, ALL_TARGETS.length))
    scope = scope ? new Set([...scope].filter((t) => hits.has(t))) : hits
  }

  const typeFilter = resolved.types && resolved.types.length > 0 ? new Set(resolved.types) : null

  const candidates: TargetVisibility[] = []
  const rejections: { id: string; name: string; reason: string }[] = []

  for (const target of ALL_TARGETS) {
    if (scope && !scope.has(target)) continue

    if (typeFilter && !typeFilter.has(target.type)) {
      rejections.push({ id: target.id, name: target.name, reason: 'type excluded by filter' })
      continue
    }
    if (resolved.maxMag !== null && target.mag !== null && target.mag > resolved.maxMag) {
      rejections.push({
        id: target.id,
        name: target.name,
        reason: `fainter than magnitude limit (${formatMag(target.mag)} > ${formatMag(resolved.maxMag)})`,
      })
      continue
    }

    const visibility = computeVisibility(target, night, site, {
      minAltDeg: resolved.minAltDeg,
      interval: resolved.interval,
      stepMinutes: resolved.stepMinutes,
      minMoonSepDeg: resolved.minMoonSepDeg,
      minWindowMinutes: resolved.minWindowMinutes,
      at: resolved.at,
    })

    if (visibility.observable) candidates.push(visibility)
    else {
      rejections.push({
        id: target.id,
        name: target.name,
        reason: visibility.reason ?? 'not observable tonight',
      })
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (b.window?.peakAltDeg ?? 0) - (a.window?.peakAltDeg ?? 0) ||
      a.target.id.localeCompare(b.target.id),
  )

  return {
    candidates: candidates.slice(0, Math.max(0, resolved.limit)),
    rejected: rejections,
    options: resolved,
  }
}
