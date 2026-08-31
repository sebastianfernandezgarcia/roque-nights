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

export interface SiteInput {
  latitude: number
  longitude: number
  elevationM: number
  timeZone: string
}

export interface NightConditions {
  nightOf: string
  sunsetUtc: string | null
  sunriseUtc: string | null
  darknessStartUtc: string | null
  darknessEndUtc: string | null
  darkHours: number | null
  moonriseUtc: string | null
  moonsetUtc: string | null
  moonIlluminationPct: number
  moonPhaseName: string
  moonFreeDarkHours: number | null
}

const ASTRONOMICAL_TWILIGHT_DEG = -18

function phaseName(phaseAngleDeg: number): string {
  if (phaseAngleDeg < 22.5 || phaseAngleDeg >= 337.5) return 'new moon'
  if (phaseAngleDeg < 67.5) return 'waxing crescent'
  if (phaseAngleDeg < 112.5) return 'first quarter'
  if (phaseAngleDeg < 157.5) return 'waxing gibbous'
  if (phaseAngleDeg < 202.5) return 'full moon'
  if (phaseAngleDeg < 247.5) return 'waning gibbous'
  if (phaseAngleDeg < 292.5) return 'third quarter'
  return 'waning crescent'
}

function moonAltitudeDeg(date: Date, observer: Observer): number {
  const eq = Equator(Body.Moon, date, observer, true, true)
  return Horizon(date, observer, eq.ra, eq.dec, 'normal').altitude
}

/**
 * Conditions for the night that STARTS on the local calendar date `nightOf`
 * (evening) and ends the following morning. All searches start from local
 * noon so evening and morning events land on the intended night.
 */
export function computeNightConditions(nightOf: string, site: SiteInput): NightConditions {
  const observer = new Observer(site.latitude, site.longitude, site.elevationM)
  // Local noon approximated from longitude; only needs to fall before sunset.
  const noonUtcMs = Date.parse(`${nightOf}T12:00:00Z`) - (site.longitude / 15) * 3_600_000
  const searchStart = new Date(noonUtcMs)

  const sunset = SearchRiseSet(Body.Sun, observer, -1, searchStart, 1)
  const sunrise = sunset ? SearchRiseSet(Body.Sun, observer, +1, sunset.date, 1) : null
  const dusk = SearchAltitude(Body.Sun, observer, -1, searchStart, 1, ASTRONOMICAL_TWILIGHT_DEG)
  const dawn = dusk
    ? SearchAltitude(Body.Sun, observer, +1, dusk.date, 1, ASTRONOMICAL_TWILIGHT_DEG)
    : null
  const moonrise = SearchRiseSet(Body.Moon, observer, +1, searchStart, 1.2)
  const moonset = SearchRiseSet(Body.Moon, observer, -1, searchStart, 1.2)

  const midNightRef = dusk?.date ?? sunset?.date ?? searchStart
  const illum = Illumination(Body.Moon, midNightRef)
  const phaseAngle = MoonPhase(midNightRef)

  let darkHours: number | null = null
  let moonFreeDarkHours: number | null = null
  if (dusk && dawn) {
    const startMs = dusk.date.getTime()
    const endMs = dawn.date.getTime()
    darkHours = (endMs - startMs) / 3_600_000
    // Sample the darkness window to measure how much of it is Moon-free.
    const stepMs = 10 * 60_000
    let moonFreeMs = 0
    for (let t = startMs; t < endMs; t += stepMs) {
      const sliceMs = Math.min(stepMs, endMs - t)
      if (moonAltitudeDeg(new Date(t + sliceMs / 2), observer) < 0) moonFreeMs += sliceMs
    }
    moonFreeDarkHours = moonFreeMs / 3_600_000
  }

  return {
    nightOf,
    sunsetUtc: sunset?.date.toISOString() ?? null,
    sunriseUtc: sunrise?.date.toISOString() ?? null,
    darknessStartUtc: dusk?.date.toISOString() ?? null,
    darknessEndUtc: dawn?.date.toISOString() ?? null,
    darkHours: darkHours === null ? null : round2(darkHours),
    moonriseUtc: moonrise?.date.toISOString() ?? null,
    moonsetUtc: moonset?.date.toISOString() ?? null,
    moonIlluminationPct: Math.round(illum.phase_fraction * 100),
    moonPhaseName: phaseName(phaseAngle),
    moonFreeDarkHours: moonFreeDarkHours === null ? null : round2(moonFreeDarkHours),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatInZone(isoUtc: string | null, timeZone: string): string {
  if (!isoUtc) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoUtc))
}

/** Today's calendar date in the given time zone, as YYYY-MM-DD. */
export function localDate(timeZone: string, from: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(from)
}
