import { describe, expect, it } from 'vitest'
import { NIGHT_CACHE_LIMIT, clearNightCache, getNight, nightCacheSize } from './cache'
import {
  FAINT_MOON_FRACTION,
  computeNightEphemeris,
  faintMoonWeight,
  makeObserver,
  moonAltitudeDeg,
  phaseName,
  resolveTimeKeyword,
  sunAltitudeDeg,
} from './night'
import type { SiteCoords } from './night'

const ROQUE: SiteCoords = {
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}
const TROMSO: SiteCoords = {
  latitude: 69.6492,
  longitude: 18.9553,
  elevationM: 10,
  timeZone: 'Europe/Oslo',
}
const LONDON: SiteCoords = {
  latitude: 51.5074,
  longitude: -0.1278,
  elevationM: 10,
  timeZone: 'Europe/London',
}
const POLE: SiteCoords = { latitude: 88, longitude: 0, elevationM: 0, timeZone: null }

describe('computeNightEphemeris', () => {
  it('golden night 2026-09-02 at the Roque', () => {
    const n = computeNightEphemeris('2026-09-02', ROQUE)
    expect(n.sun.status).toBe('normal')
    expect(n.darkness.status).toBe('ok')
    expect(n.darkness.startUtc).toMatch(/^2026-09-02T20:52:5/)
    expect(n.darkness.endUtc).toMatch(/^2026-09-03T05:29:3/)
    expect(n.darkness.hours).toBeCloseTo(8.61, 1)
    expect(n.moon.riseUtc).toMatch(/^2026-09-02T22:43:3/)
    expect(n.moon.illuminationPct).toBe(66)
    expect(n.darkness.moonFreeHours).toBeGreaterThan(1)
    expect(n.darkness.moonFreeHours!).toBeLessThan(n.darkness.hours!)
    expect(n.darkness.moonFreeIntervals[0].startUtc).toBe(n.darkness.startUtc)
    expect(n.samples.sunAltDeg).toHaveLength(145)
    expect(n.windowStartUtc).toBe('2026-09-02T11:00:00.000Z')
  })

  it('fills the rest of the golden night', () => {
    const n = computeNightEphemeris('2026-09-02', ROQUE)
    expect(n.nightOf).toBe('2026-09-02')
    expect(n.windowEndUtc).toBe('2026-09-03T11:00:00.000Z')
    expect(n.sun.sunsetUtc).toMatch(/^2026-09-02T19:31:2/)
    expect(n.sun.sunriseUtc).toMatch(/^2026-09-03T06:51:0/)
    expect(n.sun.civilDuskUtc).toMatch(/^2026-09-02T19:55:5/)
    expect(n.sun.nauticalDuskUtc).toMatch(/^2026-09-02T20:24:0/)
    expect(n.sun.astronomicalDuskUtc).toBe(n.darkness.startUtc)
    expect(n.sun.astronomicalDawnUtc).toBe(n.darkness.endUtc)
    expect(n.sun.nauticalDawnUtc).toMatch(/^2026-09-03T05:58:/)
    expect(n.sun.civilDawnUtc).toMatch(/^2026-09-03T06:26:/)
    expect(n.moon.phaseName).toBe('waning gibbous')
    expect(n.moon.phaseAngleDeg).toBeCloseTo(250.88, 1)
    expect(n.moon.altitudeAtMidDarknessDeg!).toBeCloseTo(28.92, 1)
    expect(n.moon.upDuringDarknessPct!).toBeGreaterThan(70)
    expect(n.moon.upDuringDarknessPct!).toBeLessThan(85)
    // The Moon is 66 % lit, so usable darkness is exactly the Moon free darkness.
    expect(n.darkness.usableHours).toBe(n.darkness.moonFreeHours)
    expect(n.darkness.moonFreeHours!).toBeCloseTo(1.83, 1)
    expect(n.darkness.moonFreeIntervals).toHaveLength(1)
    expect(Date.parse(n.darkness.moonFreeIntervals[0].endUtc)).toBeGreaterThan(
      Date.parse(n.moon.riseUtc!) - 11 * 60_000,
    )
    expect(n.samples.stepMinutes).toBe(10)
    expect(n.samples.startUtc).toBe(n.windowStartUtc)
    expect(n.samples.moonAltDeg).toHaveLength(145)
    expect(n.explanation).toContain('28.75°N')
    expect(n.explanation).toContain('2026-09-02')
    expect(n.explanation).not.toContain('—')
  })

  it('names the same Moon the same way at two sites on the same night', () => {
    // 2026-09-12: a 4-5 % crescent. The old octant rule called it a "new moon" at the
    // Roque (phase angle 21.5 deg) and a "waxing crescent" at Mauna Kea (26.0 deg).
    const maunaKea: SiteCoords = {
      latitude: 19.8207,
      longitude: -155.4681,
      elevationM: 4205,
      timeZone: 'Pacific/Honolulu',
    }
    const roque = computeNightEphemeris('2026-09-12', ROQUE)
    const hawaii = computeNightEphemeris('2026-09-12', maunaKea)
    expect(roque.moon.illuminationPct).toBeLessThan(10)
    expect(hawaii.moon.illuminationPct).toBeLessThan(10)
    expect(roque.moon.phaseName).toBe('waxing crescent')
    expect(hawaii.moon.phaseName).toBe('waxing crescent')
  })

  it('counts Moon-up dark time at the faint Moon weight, with no cliff at 15%', () => {
    const faint = computeNightEphemeris('2026-09-08', ROQUE)
    expect(faint.moon.illuminationPct).toBe(7)
    expect(faint.moon.illuminationFraction).toBeCloseTo(0.07, 2)
    expect(faint.moon.faintMoonWeight).toBeCloseTo(faintMoonWeight(faint.moon.illuminationFraction), 12)
    expect(faint.moon.faintMoonWeight).toBeGreaterThan(0)
    const moonUpHours = faint.darkness.hours! - faint.darkness.moonFreeHours!
    expect(faint.darkness.usableHours!).toBeCloseTo(
      faint.darkness.moonFreeHours! + faint.moon.faintMoonWeight * moonUpHours,
      1,
    )

    // 15 % lit is the top of the ramp: those hours are worth nothing at all.
    const edge = computeNightEphemeris('2026-09-14', ROQUE)
    expect(edge.moon.illuminationPct).toBe(15)
    expect(edge.moon.faintMoonWeight).toBe(0)
    expect(edge.darkness.usableHours).toBe(edge.darkness.moonFreeHours)
    expect(edge.darkness.moonFreeHours!).toBeLessThan(edge.darkness.hours!)
  })

  it('Tromso midsummer: Sun never sets, no darkness', () => {
    const n = computeNightEphemeris('2026-06-21', TROMSO)
    expect(n.sun.status).toBe('never_sets')
    expect(n.darkness.status).toBe('no_astronomical_darkness')
    expect(n.darkness.hours).toBeNull()
    expect(n.explanation).toMatch(/never sets/)
    expect(n.explanation).toContain('69.65°N')
    expect(n.explanation).toContain('2026-06-21')
    expect(n.darkness.startUtc).toBeNull()
    expect(n.darkness.endUtc).toBeNull()
    expect(n.darkness.moonFreeHours).toBeNull()
    expect(n.darkness.usableHours).toBeNull()
    expect(n.darkness.moonFreeIntervals).toEqual([])
    expect(n.moon.upDuringDarknessPct).toBeNull()
    expect(n.moon.altitudeAtMidDarknessDeg).toBeNull()
    expect(n.sun.sunsetUtc).toBeNull()
    expect(n.sun.civilDuskUtc).toBeNull()
  })

  it('London midsummer: Sun sets but never reaches -18 degrees', () => {
    const n = computeNightEphemeris('2026-06-21', LONDON)
    expect(n.sun.status).toBe('normal')
    expect(n.sun.sunsetUtc).not.toBeNull()
    expect(n.darkness.status).toBe('no_astronomical_darkness')
    expect(n.sun.nauticalDuskUtc).not.toBeNull()
    expect(n.sun.astronomicalDuskUtc).toBeNull()
    expect(n.sun.nauticalDawnUtc).not.toBeNull()
    expect(n.explanation).toContain('51.51°N')
    expect(n.explanation).toMatch(/nautical/)
  })

  it('deep polar night: continuous darkness', () => {
    const n = computeNightEphemeris('2026-12-21', POLE)
    expect(n.sun.status).toBe('never_rises')
    expect(n.darkness.status).toBe('continuous_darkness')
    expect(n.darkness.hours).toBe(24)
    expect(n.darkness.startUtc).toBe(n.windowStartUtc)
    expect(n.darkness.endUtc).toBe(n.windowEndUtc)
    expect(n.windowStartUtc).toBe('2026-12-21T12:00:00.000Z')
    expect(n.explanation).toContain('88.00°N')
    expect(n.explanation).toContain('2026-12-21')
  })

  it('reports southern latitudes with an S suffix', () => {
    const n = computeNightEphemeris('2026-09-02', {
      latitude: -24.6272,
      longitude: -70.4042,
      elevationM: 2635,
      timeZone: 'America/Santiago',
    })
    expect(n.darkness.status).toBe('ok')
    expect(n.explanation).toContain('24.63°S')
  })

  it('runs the Roque golden night well under the 250 ms budget', () => {
    computeNightEphemeris('2026-09-02', ROQUE) // warm up the engine's internal tables
    const t0 = performance.now()
    computeNightEphemeris('2026-09-02', ROQUE)
    const elapsed = performance.now() - t0
    console.log(`computeNightEphemeris(Roque, 2026-09-02): ${elapsed.toFixed(1)} ms`)
    expect(elapsed).toBeLessThan(250)
  })
})

describe('helpers', () => {
  it('computes Sun and Moon altitudes at the Roque', () => {
    const observer = makeObserver(ROQUE)
    expect(observer.latitude).toBe(ROQUE.latitude)
    expect(observer.height).toBe(ROQUE.elevationM)
    expect(sunAltitudeDeg(new Date('2026-09-02T20:52:50.668Z'), observer)).toBeCloseTo(-18, 1)
    expect(moonAltitudeDeg(new Date('2026-09-03T01:11:13.414Z'), observer)).toBeCloseTo(28.92, 1)
  })

  it('names the eight lunar phases from illumination and direction', () => {
    expect(phaseName(0, 0)).toBe('new moon')
    expect(phaseName(45, 0.15)).toBe('waxing crescent')
    expect(phaseName(90, 0.5)).toBe('first quarter')
    expect(phaseName(135, 0.85)).toBe('waxing gibbous')
    expect(phaseName(180, 1)).toBe('full moon')
    expect(phaseName(225, 0.85)).toBe('waning gibbous')
    expect(phaseName(270, 0.5)).toBe('third quarter')
    expect(phaseName(315, 0.15)).toBe('waning crescent')
    expect(phaseName(350, 0.01)).toBe('new moon')
  })

  it('a 4% crescent is a crescent whatever the phase angle rounds to', () => {
    // The octant boundary at 22.5 degrees used to call this a new moon at one site
    // and a waxing crescent at another on the very same night.
    expect(phaseName(21.46, 0.04)).toBe('waxing crescent')
    expect(phaseName(26.03, 0.05)).toBe('waxing crescent')
    expect(phaseName(338, 0.04)).toBe('waning crescent')
    // Only a genuinely dark disc is a new moon, and only a full one is full.
    expect(phaseName(10, 0.019)).toBe('new moon')
    expect(phaseName(179, 0.98)).toBe('full moon')
    expect(phaseName(181, 0.979)).toBe('waning gibbous')
  })

  it('the faint Moon weight ramps from 1 at new Moon to 0 at the faint limit', () => {
    expect(FAINT_MOON_FRACTION).toBe(0.15)
    expect(faintMoonWeight(0)).toBe(1)
    expect(faintMoonWeight(0.075)).toBeCloseTo(0.5, 6)
    expect(faintMoonWeight(0.15)).toBe(0)
    expect(faintMoonWeight(0.1501)).toBe(0)
    expect(faintMoonWeight(1)).toBe(0)
    expect(faintMoonWeight(Number.NaN)).toBe(0)
  })

  it('resolves time keywords', () => {
    const n = computeNightEphemeris('2026-09-02', ROQUE)
    expect(resolveTimeKeyword('darkness_start', n)).toBe(n.darkness.startUtc)
    const mid = Date.parse(resolveTimeKeyword('midnight', n)!)
    expect(mid).toBeGreaterThan(Date.parse(n.darkness.startUtc!))
    expect(mid).toBeLessThan(Date.parse(n.darkness.endUtc!))
  })

  it('resolves every keyword, including now and the no-darkness fallbacks', () => {
    const n = computeNightEphemeris('2026-09-02', ROQUE)
    expect(resolveTimeKeyword('sunset', n)).toBe(n.sun.sunsetUtc)
    expect(resolveTimeKeyword('sunrise', n)).toBe(n.sun.sunriseUtc)
    expect(resolveTimeKeyword('darkness_end', n)).toBe(n.darkness.endUtc)
    const now = new Date('2026-09-02T23:15:00.000Z')
    expect(resolveTimeKeyword('now', n, now)).toBe('2026-09-02T23:15:00.000Z')

    const tromso = computeNightEphemeris('2026-06-21', TROMSO)
    expect(resolveTimeKeyword('darkness_start', tromso)).toBeNull()
    expect(resolveTimeKeyword('sunset', tromso)).toBeNull()
    // No darkness: midnight is the middle of the 24 h window.
    expect(resolveTimeKeyword('midnight', tromso)).toBe('2026-06-21T22:00:00.000Z')

    const pole = computeNightEphemeris('2026-12-21', POLE)
    expect(resolveTimeKeyword('midnight', pole)).toBe('2026-12-22T00:00:00.000Z')
  })
})

describe('night cache', () => {
  it('cache returns the same object for the same key', () => {
    expect(getNight('2026-09-02', ROQUE)).toBe(getNight('2026-09-02', ROQUE))
    expect(NIGHT_CACHE_LIMIT).toBe(64)
  })

  it('keys on night, coordinates and time zone', () => {
    const a = getNight('2026-09-02', ROQUE)
    expect(getNight('2026-09-03', ROQUE)).not.toBe(a)
    expect(getNight('2026-09-02', { ...ROQUE, latitude: 28.7 })).not.toBe(a)
    expect(getNight('2026-09-02', { ...ROQUE, longitude: -17.8 })).not.toBe(a)
    expect(getNight('2026-09-02', { ...ROQUE, elevationM: 2400 })).not.toBe(a)
    expect(getNight('2026-09-02', ROQUE).nightOf).toBe('2026-09-02')
  })

  it('a different time zone is a different night, because local noon moves', () => {
    // Same coordinates, two zones: Honolulu noon is 11 h after Canary noon, so the
    // 24 h window (and the darkness inside it) is not the same one.
    const canary = getNight('2026-09-02', { ...ROQUE, timeZone: 'Atlantic/Canary' })
    const honolulu = getNight('2026-09-02', { ...ROQUE, timeZone: 'Pacific/Honolulu' })
    expect(honolulu).not.toBe(canary)
    expect(honolulu.windowStartUtc).not.toBe(canary.windowStartUtc)
    expect(honolulu.darkness.startUtc).not.toBe(canary.darkness.startUtc)
    // And an unknown zone (solar noon from the longitude) is a third answer.
    expect(getNight('2026-09-02', { ...ROQUE, timeZone: null })).not.toBe(canary)
  })

  it('holds at most 64 entries and evicts the least recently used', () => {
    clearNightCache()
    const site = (elevationM: number): SiteCoords => ({ ...ROQUE, elevationM })
    const first = getNight('2027-01-15', site(1))
    const second = getNight('2027-01-15', site(2))
    for (let i = 3; i <= 64; i++) getNight('2027-01-15', site(i))
    expect(nightCacheSize()).toBe(64)
    // Touch the oldest entry so it is no longer the eviction victim.
    expect(getNight('2027-01-15', site(1))).toBe(first)
    getNight('2027-01-15', site(65))
    expect(nightCacheSize()).toBe(64)
    expect(getNight('2027-01-15', site(1))).toBe(first)
    // Entry 2 was the least recently used, so it was dropped and is recomputed.
    expect(getNight('2027-01-15', site(2))).not.toBe(second)
    clearNightCache()
    expect(nightCacheSize()).toBe(0)
  })
})

describe('explanations', () => {
  it('are quotable sentences that name the latitude and the night', () => {
    expect(computeNightEphemeris('2026-09-02', ROQUE).explanation).toBe(
      '8.61 h of astronomical darkness at 28.75°N on 2026-09-02, from 20:52 to 05:29 UTC, of which 1.83 h are Moon free with the Moon 66% lit.',
    )
    expect(computeNightEphemeris('2026-06-21', TROMSO).explanation).toBe(
      'No astronomical darkness at 69.65°N on 2026-06-21: the Sun never sets.',
    )
    expect(computeNightEphemeris('2026-06-21', LONDON).explanation).toBe(
      'No astronomical darkness at 51.51°N on 2026-06-21: the Sun sets at 20:21 UTC but the night only reaches nautical twilight, so the sky never gets fully dark.',
    )
    expect(computeNightEphemeris('2026-12-21', POLE).explanation).toBe(
      'Continuous astronomical darkness at 88.00°N on 2026-12-21: the Sun never rises and the sky is dark for the whole 24 h window, with the Moon 90% lit.',
    )
  })

  it('describe a Moon free night and a Moon soaked one', () => {
    expect(computeNightEphemeris('2026-09-11', ROQUE).explanation).toContain(
      'with the Moon (1% lit) below the horizon throughout',
    )
    expect(computeNightEphemeris('2026-08-28', ROQUE).explanation).toContain(
      'with the Moon (99% lit) above the horizon throughout',
    )
  })

  it('never leaves an em dash placeholder or an empty slot in a sentence', () => {
    const nights = [
      computeNightEphemeris('2026-09-02', ROQUE),
      computeNightEphemeris('2026-06-21', TROMSO),
      computeNightEphemeris('2026-06-21', LONDON),
      computeNightEphemeris('2026-12-21', POLE),
      computeNightEphemeris('2026-03-20', {
        latitude: 78.22,
        longitude: 15.65,
        elevationM: 10,
        timeZone: 'Arctic/Longyearbyen',
      }),
      computeNightEphemeris('2026-02-10', {
        latitude: 78.22,
        longitude: 15.65,
        elevationM: 10,
        timeZone: 'Arctic/Longyearbyen',
      }),
    ]
    for (const n of nights) {
      expect(n.explanation).not.toContain('—')
      expect(n.explanation).not.toContain('null')
      expect(n.explanation).not.toContain('undefined')
      expect(n.explanation.endsWith('.')).toBe(true)
      expect(n.explanation).toContain(n.nightOf)
      expect(n.explanation).toMatch(/\d+\.\d{2}°[NS]/)
    }
  })
})
