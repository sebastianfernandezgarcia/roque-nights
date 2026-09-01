/**
 * Night ephemeris: the darkness window, the Sun and the Moon for one observing night.
 *
 * The night that "starts" on the calendar date `nightOf` runs from local noon of that
 * date to local noon of the next one, so evening and morning events land on the same
 * night the way an observer thinks about them. Everything here is UTC and pure: no
 * store, no DOM, no network.
 */

import {
  Body,
  Equator,
  Horizon,
  Illumination,
  MoonPhase,
  Observer,
  SearchAltitude,
  SearchRiseSet,
} from 'astronomy-engine'
import { DAY_MS, HOUR_MS, formatInZone, localNoonUtc, roundTo } from './time'

const CIVIL_TWILIGHT_DEG = -6
const NAUTICAL_TWILIGHT_DEG = -12
const ASTRONOMICAL_TWILIGHT_DEG = -18
/** Darkness is "usable" under a Moon this faint even when it is above the horizon. */
const FAINT_MOON_PCT = 15
const SAMPLE_STEP_MINUTES = 10
const SAMPLE_STEP_MS = SAMPLE_STEP_MINUTES * 60_000
const SAMPLE_COUNT = DAY_MS / SAMPLE_STEP_MS + 1 // 145 samples over the 24 h window

export interface SiteCoords {
  latitude: number
  longitude: number
  elevationM: number
  timeZone: string | null
}

export type SunStatus = 'normal' | 'never_sets' | 'never_rises'
export type DarknessStatus = 'ok' | 'no_astronomical_darkness' | 'continuous_darkness'

export interface Interval {
  startUtc: string
  endUtc: string
}

export interface NightEphemeris {
  nightOf: string
  windowStartUtc: string
  windowEndUtc: string
  sun: {
    status: SunStatus
    sunsetUtc: string | null
    sunriseUtc: string | null
    civilDuskUtc: string | null
    nauticalDuskUtc: string | null
    astronomicalDuskUtc: string | null
    astronomicalDawnUtc: string | null
    nauticalDawnUtc: string | null
    civilDawnUtc: string | null
  }
  darkness: {
    status: DarknessStatus
    startUtc: string | null
    endUtc: string | null
    hours: number | null
    moonFreeHours: number | null
    moonFreeIntervals: Interval[]
    usableHours: number | null
  }
  moon: {
    illuminationPct: number
    phaseName: string
    phaseAngleDeg: number
    riseUtc: string | null
    setUtc: string | null
    upDuringDarknessPct: number | null
    altitudeAtMidDarknessDeg: number | null
  }
  samples: {
    stepMinutes: number
    startUtc: string
    sunAltDeg: number[]
    moonAltDeg: number[]
  }
  explanation: string
}

export function makeObserver(site: SiteCoords): Observer {
  return new Observer(site.latitude, site.longitude, site.elevationM)
}

/**
 * Geometric (refraction free) altitude of the Sun's centre, in degrees.
 *
 * Twilight is defined on the geometric altitude, and that is also what
 * `SearchAltitude` searches for, so the samples here line up exactly with the dusk and
 * dawn times below. `Horizon(..., 'normal')` would add a held 0.52 degrees of
 * refraction below -1 degree and put the two out of step by a few minutes.
 */
export function sunAltitudeDeg(date: Date, observer: Observer): number {
  const eq = Equator(Body.Sun, date, observer, true, true)
  // Omitting the refraction argument asks astronomy-engine for the raw geometric angle.
  return Horizon(date, observer, eq.ra, eq.dec).altitude
}

/**
 * Apparent altitude of the Moon's centre, in degrees, refraction included: this one
 * answers "is the Moon in the sky right now", which is what rise and set mean.
 */
export function moonAltitudeDeg(date: Date, observer: Observer): number {
  const eq = Equator(Body.Moon, date, observer, true, true)
  return Horizon(date, observer, eq.ra, eq.dec, 'normal').altitude
}

/** The eight classic phase names, binned in 45 degree octants around the phase angle. */
export function phaseName(phaseAngleDeg: number): string {
  const angle = ((phaseAngleDeg % 360) + 360) % 360
  if (angle < 22.5 || angle >= 337.5) return 'new moon'
  if (angle < 67.5) return 'waxing crescent'
  if (angle < 112.5) return 'first quarter'
  if (angle < 157.5) return 'waxing gibbous'
  if (angle < 202.5) return 'full moon'
  if (angle < 247.5) return 'waning gibbous'
  if (angle < 292.5) return 'third quarter'
  return 'waning crescent'
}

/** '28.75°N' / '24.63°S', always two decimals. */
export function formatLatitude(latitude: number): string {
  return `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? 'N' : 'S'}`
}

function utcHhMm(iso: string | null): string {
  return formatInZone(iso, 'UTC')
}

export function computeNightEphemeris(nightOf: string, site: SiteCoords): NightEphemeris {
  const observer = makeObserver(site)
  const windowStart = localNoonUtc(nightOf, site)
  const startMs = windowStart.getTime()
  const endMs = startMs + DAY_MS
  const windowEnd = new Date(endMs)

  /** Days left in the window from `from`, so no search can ever leave the night. */
  const daysLeft = (from: Date): number => Math.max(0, (endMs - from.getTime()) / DAY_MS)

  const riseSet = (body: Body, direction: number, from: Date): Date | null => {
    const limit = daysLeft(from)
    if (limit <= 0) return null
    const found = SearchRiseSet(body, observer, direction, from, limit)
    if (!found || found.date.getTime() > endMs) return null
    return found.date
  }

  const twilight = (direction: number, from: Date, altitudeDeg: number): Date | null => {
    const limit = daysLeft(from)
    if (limit <= 0) return null
    const found = SearchAltitude(Body.Sun, observer, direction, from, limit, altitudeDeg)
    if (!found || found.date.getTime() > endMs) return null
    return found.date
  }

  // --- Sun -----------------------------------------------------------------
  const sunset = riseSet(Body.Sun, -1, windowStart)
  const sunrise = riseSet(Body.Sun, +1, sunset ?? windowStart)

  const civilDusk = twilight(-1, windowStart, CIVIL_TWILIGHT_DEG)
  const nauticalDusk = twilight(-1, windowStart, NAUTICAL_TWILIGHT_DEG)
  const astronomicalDusk = twilight(-1, windowStart, ASTRONOMICAL_TWILIGHT_DEG)
  const astronomicalDawn = twilight(+1, astronomicalDusk ?? windowStart, ASTRONOMICAL_TWILIGHT_DEG)
  const nauticalDawn = twilight(
    +1,
    astronomicalDawn ?? astronomicalDusk ?? windowStart,
    NAUTICAL_TWILIGHT_DEG,
  )
  const civilDawn = twilight(
    +1,
    nauticalDawn ?? astronomicalDawn ?? astronomicalDusk ?? windowStart,
    CIVIL_TWILIGHT_DEG,
  )

  let sunStatus: SunStatus = 'normal'
  if (!sunset && !sunrise) {
    sunStatus = sunAltitudeDeg(windowStart, observer) > 0 ? 'never_sets' : 'never_rises'
  }

  // --- Samples over the whole window (also feed the twilight bands in the UI) ---
  const sunAltDeg: number[] = new Array<number>(SAMPLE_COUNT)
  const moonAltDeg: number[] = new Array<number>(SAMPLE_COUNT)
  let maxSunAlt = Number.NEGATIVE_INFINITY
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const at = new Date(startMs + i * SAMPLE_STEP_MS)
    const sunAlt = sunAltitudeDeg(at, observer)
    if (sunAlt > maxSunAlt) maxSunAlt = sunAlt
    sunAltDeg[i] = roundTo(sunAlt, 2)
    moonAltDeg[i] = roundTo(moonAltitudeDeg(at, observer), 2)
  }

  // --- Darkness ------------------------------------------------------------
  let darknessStatus: DarknessStatus
  let darknessStartMs: number | null = null
  let darknessEndMs: number | null = null
  /** 'partial_start' / 'partial_end' feed a clause in the explanation. */
  let darknessEdge: 'none' | 'partial_start' | 'partial_end' = 'none'

  if (astronomicalDusk && astronomicalDawn) {
    darknessStatus = 'ok'
    darknessStartMs = astronomicalDusk.getTime()
    darknessEndMs = astronomicalDawn.getTime()
  } else if (!astronomicalDusk && astronomicalDawn) {
    // Darkness was already running at local noon (only happens at high latitude).
    darknessStatus = 'ok'
    darknessStartMs = startMs
    darknessEndMs = astronomicalDawn.getTime()
    darknessEdge = 'partial_start'
  } else if (astronomicalDusk && !astronomicalDawn) {
    // Darkness falls inside the window and is still running when it closes.
    darknessStatus = 'ok'
    darknessStartMs = astronomicalDusk.getTime()
    darknessEndMs = endMs
    darknessEdge = 'partial_end'
  } else if (maxSunAlt < ASTRONOMICAL_TWILIGHT_DEG) {
    darknessStatus = 'continuous_darkness'
    darknessStartMs = startMs
    darknessEndMs = endMs
  } else {
    darknessStatus = 'no_astronomical_darkness'
  }

  const hasDarkness = darknessStartMs !== null && darknessEndMs !== null
  const darknessStartIso = darknessStartMs === null ? null : new Date(darknessStartMs).toISOString()
  const darknessEndIso = darknessEndMs === null ? null : new Date(darknessEndMs).toISOString()
  const darknessHours = hasDarkness
    ? roundTo((darknessEndMs! - darknessStartMs!) / HOUR_MS, 2)
    : null

  // --- Moon ----------------------------------------------------------------
  const moonRise = riseSet(Body.Moon, +1, windowStart)
  const moonSet = riseSet(Body.Moon, -1, windowStart)

  // Illumination is quoted for the moment the observing night begins, which is what a
  // planner cares about (and what the golden values in docs/PLAN.md were taken at).
  const illuminationRef = new Date(darknessStartMs ?? sunset?.getTime() ?? startMs + DAY_MS / 2)
  const illuminationPct = Math.round(Illumination(Body.Moon, illuminationRef).phase_fraction * 100)
  const phaseAngleDeg = MoonPhase(illuminationRef)

  const moonFreeIntervals: Interval[] = []
  let moonFreeMs = 0
  let moonUpMs = 0
  let usableMs = 0
  let altitudeAtMidDarknessDeg: number | null = null

  if (hasDarkness) {
    const from = darknessStartMs!
    const to = darknessEndMs!
    altitudeAtMidDarknessDeg = roundTo(moonAltitudeDeg(new Date((from + to) / 2), observer), 2)
    let runStart: number | null = null
    for (let t = from; t < to; t += SAMPLE_STEP_MS) {
      const sliceMs = Math.min(SAMPLE_STEP_MS, to - t)
      const moonUp = moonAltitudeDeg(new Date(t + sliceMs / 2), observer) >= 0
      if (moonUp) {
        moonUpMs += sliceMs
        if (runStart !== null) {
          moonFreeIntervals.push({
            startUtc: new Date(runStart).toISOString(),
            endUtc: new Date(t).toISOString(),
          })
          runStart = null
        }
      } else {
        moonFreeMs += sliceMs
        if (runStart === null) runStart = t
      }
      if (!moonUp || illuminationPct <= FAINT_MOON_PCT) usableMs += sliceMs
    }
    if (runStart !== null) {
      moonFreeIntervals.push({
        startUtc: new Date(runStart).toISOString(),
        endUtc: new Date(to).toISOString(),
      })
    }
  }

  const darknessMs = hasDarkness ? darknessEndMs! - darknessStartMs! : 0
  const night: NightEphemeris = {
    nightOf,
    windowStartUtc: windowStart.toISOString(),
    windowEndUtc: windowEnd.toISOString(),
    sun: {
      status: sunStatus,
      sunsetUtc: sunset?.toISOString() ?? null,
      sunriseUtc: sunrise?.toISOString() ?? null,
      civilDuskUtc: civilDusk?.toISOString() ?? null,
      nauticalDuskUtc: nauticalDusk?.toISOString() ?? null,
      astronomicalDuskUtc: astronomicalDusk?.toISOString() ?? null,
      astronomicalDawnUtc: astronomicalDawn?.toISOString() ?? null,
      nauticalDawnUtc: nauticalDawn?.toISOString() ?? null,
      civilDawnUtc: civilDawn?.toISOString() ?? null,
    },
    darkness: {
      status: darknessStatus,
      startUtc: darknessStartIso,
      endUtc: darknessEndIso,
      hours: darknessHours,
      moonFreeHours: hasDarkness ? roundTo(moonFreeMs / HOUR_MS, 2) : null,
      moonFreeIntervals,
      usableHours: hasDarkness ? roundTo(usableMs / HOUR_MS, 2) : null,
    },
    moon: {
      illuminationPct,
      phaseName: phaseName(phaseAngleDeg),
      phaseAngleDeg: roundTo(phaseAngleDeg, 2),
      riseUtc: moonRise?.toISOString() ?? null,
      setUtc: moonSet?.toISOString() ?? null,
      upDuringDarknessPct:
        hasDarkness && darknessMs > 0 ? Math.round((100 * moonUpMs) / darknessMs) : null,
      altitudeAtMidDarknessDeg,
    },
    samples: {
      stepMinutes: SAMPLE_STEP_MINUTES,
      startUtc: windowStart.toISOString(),
      sunAltDeg,
      moonAltDeg,
    },
    explanation: '',
  }

  night.explanation = buildExplanation(night, site, darknessEdge)
  return night
}

/** Deepest twilight the Sun actually reaches inside the window. */
function deepestTwilight(sun: NightEphemeris['sun']): 'astronomical' | 'nautical' | 'civil' | 'none' {
  if (sun.astronomicalDuskUtc) return 'astronomical'
  if (sun.nauticalDuskUtc) return 'nautical'
  if (sun.civilDuskUtc) return 'civil'
  return 'none'
}

/** One quotable English sentence a tool can put straight into its `summary`. */
function buildExplanation(
  night: NightEphemeris,
  site: SiteCoords,
  darknessEdge: 'none' | 'partial_start' | 'partial_end',
): string {
  const where = formatLatitude(site.latitude)
  const when = night.nightOf
  const { darkness, moon, sun } = night

  if (darkness.status === 'continuous_darkness') {
    const sunClause =
      sun.status === 'never_rises' ? 'the Sun never rises' : 'the Sun stays far below the horizon'
    return `Continuous astronomical darkness at ${where} on ${when}: ${sunClause} and the sky is dark for the whole 24 h window, with the Moon ${moon.illuminationPct}% lit.`
  }

  if (darkness.status === 'no_astronomical_darkness') {
    if (sun.status === 'never_sets') {
      return `No astronomical darkness at ${where} on ${when}: the Sun never sets.`
    }
    const reached = deepestTwilight(sun)
    if (reached === 'none') {
      return `No astronomical darkness at ${where} on ${when}: the sky never gets darker than daylight in this 24 h window.`
    }
    const setClause = sun.sunsetUtc
      ? `the Sun sets at ${utcHhMm(sun.sunsetUtc)} UTC but`
      : 'the Sun stays up and'
    return `No astronomical darkness at ${where} on ${when}: ${setClause} the night only reaches ${reached} twilight, so the sky never gets fully dark.`
  }

  const hours = darkness.hours ?? 0
  const moonFree = darkness.moonFreeHours ?? 0

  let spanClause: string
  if (darknessEdge === 'partial_start') {
    spanClause = `, already under way at local noon and ending at ${utcHhMm(darkness.endUtc)} UTC`
  } else if (darknessEdge === 'partial_end') {
    spanClause = `, starting at ${utcHhMm(darkness.startUtc)} UTC and still running when the window closes`
  } else {
    spanClause = `, from ${utcHhMm(darkness.startUtc)} to ${utcHhMm(darkness.endUtc)} UTC`
  }

  let moonClause: string
  if (moonFree >= hours - 0.01) {
    moonClause = `with the Moon (${moon.illuminationPct}% lit) below the horizon throughout`
  } else if (moonFree <= 0.01) {
    moonClause = `with the Moon (${moon.illuminationPct}% lit) above the horizon throughout`
  } else {
    moonClause = `of which ${moonFree.toFixed(2)} h are Moon free with the Moon ${moon.illuminationPct}% lit`
  }

  return `${hours.toFixed(2)} h of astronomical darkness at ${where} on ${when}${spanClause}, ${moonClause}.`
}

export type TimeKeyword = 'now' | 'sunset' | 'darkness_start' | 'midnight' | 'darkness_end' | 'sunrise'

/**
 * Resolve a keyword against a night. 'midnight' is the middle of darkness when there is
 * darkness, and the middle of the 24 h window otherwise. Returns null when the event
 * does not exist on that night (polar cases).
 */
export function resolveTimeKeyword(
  keyword: TimeKeyword,
  night: NightEphemeris,
  now?: Date,
): string | null {
  switch (keyword) {
    case 'now':
      return (now ?? new Date()).toISOString()
    case 'sunset':
      return night.sun.sunsetUtc
    case 'sunrise':
      return night.sun.sunriseUtc
    case 'darkness_start':
      return night.darkness.startUtc
    case 'darkness_end':
      return night.darkness.endUtc
    case 'midnight': {
      const usable =
        (night.darkness.status === 'ok' || night.darkness.status === 'continuous_darkness') &&
        night.darkness.startUtc !== null &&
        night.darkness.endUtc !== null
      const from = usable ? night.darkness.startUtc! : night.windowStartUtc
      const to = usable ? night.darkness.endUtc! : night.windowEndUtc
      return new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString()
    }
    default:
      return null
  }
}
