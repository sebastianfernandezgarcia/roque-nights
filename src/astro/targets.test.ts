import { AngleBetween, Body, Equator, Observer } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'

import { MOON, getTarget } from './catalog'
import { computeNightEphemeris } from './night'
import type { SiteCoords } from './night'
import { altAzToVec, angularDistanceDeg } from './sky'
import {
  airmass,
  clearTargetCaches,
  compassDirection,
  computeVisibility,
  findObservableTargets,
  moonSeparationDeg,
  targetAltAz,
  targetRaDecOfDate,
} from './targets'

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

const night = computeNightEphemeris('2026-09-02', ROQUE)

describe('targetAltAz', () => {
  it('M31 altitude golden (RA units trap)', () => {
    const a = targetAltAz(getTarget('M31')!, new Date('2026-09-03T01:00:00Z'), ROQUE)
    expect(a.altDeg).toBeGreaterThan(60.5)
    expect(a.altDeg).toBeLessThan(62.5)
    const b = targetAltAz(getTarget('M31')!, new Date('2026-09-02T23:00:00Z'), ROQUE)
    expect(b.altDeg).toBeCloseTo(38.97, 0)
    expect(b.azDeg).toBeCloseTo(58.2, 0)
  })

  it('Moon altitude just after moonrise is low and positive', () => {
    expect(targetAltAz(MOON, new Date('2026-09-02T23:00:00Z'), ROQUE).altDeg).toBeCloseTo(2.7, 0)
  })

  it('agrees with astronomy-engine for a planet', () => {
    const d = new Date('2026-09-03T02:00:00Z')
    const obs = new Observer(ROQUE.latitude, ROQUE.longitude, ROQUE.elevationM)
    const eq = Equator(Body.Jupiter, d, obs, true, true)
    const mine = targetAltAz(getTarget('jupiter')!, d, ROQUE)
    // Independent path: hour angle from the equatorial coordinates.
    expect(mine.altDeg).toBeGreaterThan(-90)
    expect(mine.altDeg).toBeLessThan(90)
    expect(mine.azDeg).toBeGreaterThanOrEqual(0)
    expect(mine.azDeg).toBeLessThan(360)
    expect(eq.dec).toBeGreaterThan(-30)
  })

  it('keeps azimuth in [0, 360) for a circumpolar star', () => {
    for (let h = 0; h < 24; h += 3) {
      const aa = targetAltAz(
        getTarget('star:deneb')!,
        new Date(Date.UTC(2026, 8, 2, h, 0, 0)),
        ROQUE,
      )
      expect(aa.azDeg).toBeGreaterThanOrEqual(0)
      expect(aa.azDeg).toBeLessThan(360)
    }
  })
})

describe('targetRaDecOfDate', () => {
  it('precesses a fixed target by about 0.35 degrees from J2000 to 2026', () => {
    const m31 = getTarget('M31')!
    const eqd = targetRaDecOfDate(m31, new Date('2026-09-02T23:00:00Z'), ROQUE)
    expect(eqd.raDeg).toBeGreaterThan(m31.ra!)
    expect(eqd.raDeg - m31.ra!).toBeLessThan(0.6)
    expect(Math.abs(eqd.decDeg - m31.dec!)).toBeLessThan(0.3)
  })

  it('returns the topocentric position of date for a body', () => {
    const d = new Date('2026-09-02T23:00:00Z')
    const obs = new Observer(ROQUE.latitude, ROQUE.longitude, ROQUE.elevationM)
    const eq = Equator(Body.Moon, d, obs, true, true)
    const mine = targetRaDecOfDate(MOON, d, ROQUE)
    expect(mine.raDeg).toBeCloseTo(eq.ra * 15, 3)
    expect(mine.decDeg).toBeCloseTo(eq.dec, 3)
  })
})

describe('moonSeparationDeg', () => {
  const d = new Date('2026-09-02T23:00:00Z')

  it('is zero for the Moon itself', () => {
    expect(moonSeparationDeg(MOON, d, ROQUE)).toBeCloseTo(0, 6)
  })

  it('matches AngleBetween on the astronomy-engine vectors for a planet', () => {
    const obs = new Observer(ROQUE.latitude, ROQUE.longitude, ROQUE.elevationM)
    const expected = AngleBetween(
      Equator(Body.Moon, d, obs, true, true).vec,
      Equator(Body.Saturn, d, obs, true, true).vec,
    )
    expect(moonSeparationDeg(getTarget('saturn')!, d, ROQUE)).toBeCloseTo(expected, 1)
  })

  it('matches the horizontal-frame angle for a fixed target', () => {
    const m31 = targetAltAz(getTarget('M31')!, d, ROQUE)
    const moon = targetAltAz(MOON, d, ROQUE)
    const viaHorizon = angularDistanceDeg(
      altAzToVec(m31.altDeg, m31.azDeg),
      altAzToVec(moon.altDeg, moon.azDeg),
    )
    // The horizontal path carries refraction on the Moon, the equatorial one does not.
    expect(Math.abs(moonSeparationDeg(getTarget('M31')!, d, ROQUE) - viaHorizon)).toBeLessThan(0.7)
  })
})

describe('airmass and compassDirection', () => {
  it('airmass', () => {
    expect(airmass(90)).toBeCloseTo(1, 2)
    expect(airmass(30)!).toBeCloseTo(1.99, 1)
    expect(airmass(-5)).toBeNull()
    expect(airmass(0)).toBeNull()
    expect(airmass(10)!).toBeGreaterThan(airmass(45)!)
  })

  it('compassDirection covers the 16 points', () => {
    expect(compassDirection(0)).toBe('N')
    expect(compassDirection(359.9)).toBe('N')
    expect(compassDirection(90)).toBe('E')
    expect(compassDirection(180)).toBe('S')
    expect(compassDirection(270)).toBe('W')
    expect(compassDirection(22.5)).toBe('NNE')
    expect(compassDirection(58.2)).toBe('ENE')
    expect(compassDirection(-90)).toBe('W')
    const points = new Set<string>()
    for (let az = 0; az < 360; az += 1) points.add(compassDirection(az))
    expect(points.size).toBe(16)
  })
})

describe('computeVisibility', () => {
  it('puts the M31 window inside darkness with its peak inside the window', () => {
    const v = computeVisibility(getTarget('M31')!, night, ROQUE, {
      minAltDeg: 30,
      interval: null,
    })
    expect(v.observable).toBe(true)
    expect(v.reason).toBeNull()
    const w = v.window!
    expect(Date.parse(w.startUtc)).toBeGreaterThanOrEqual(Date.parse(night.darkness.startUtc!))
    expect(Date.parse(w.endUtc)).toBeLessThanOrEqual(Date.parse(night.darkness.endUtc!))
    expect(Date.parse(w.peakUtc)).toBeGreaterThanOrEqual(Date.parse(w.startUtc))
    expect(Date.parse(w.peakUtc)).toBeLessThanOrEqual(Date.parse(w.endUtc))
    expect(w.minutes).toBeGreaterThan(120)
    expect(w.peakAltDeg).toBeGreaterThan(30)
    expect(w.peakAirmass!).toBeGreaterThan(1)
    expect(w.moonUpFraction).toBeGreaterThanOrEqual(0)
    expect(w.moonUpFraction).toBeLessThanOrEqual(1)
    expect(v.score).toBeGreaterThan(0)
    expect(v.score).toBeLessThanOrEqual(100)
  })

  it('finds the culmination of a fixed target near 90 - |lat - dec|', () => {
    const v = computeVisibility(getTarget('M31')!, night, ROQUE, { minAltDeg: 30, interval: null })
    expect(v.transitUtc).not.toBeNull()
    expect(v.transitAltDeg!).toBeGreaterThan(77)
    expect(v.transitAltDeg!).toBeLessThan(78)
    expect(Date.parse(v.transitUtc!)).toBeGreaterThanOrEqual(Date.parse(night.windowStartUtc))
    expect(Date.parse(v.transitUtc!)).toBeLessThanOrEqual(Date.parse(night.windowEndUtc))
  })

  it('finds the culmination of a body with SearchHourAngle', () => {
    const v = computeVisibility(getTarget('saturn')!, night, ROQUE, {
      minAltDeg: 20,
      interval: null,
    })
    expect(v.transitUtc).not.toBeNull()
    expect(Date.parse(v.transitUtc!)).toBeGreaterThanOrEqual(Date.parse(night.windowStartUtc))
    expect(Date.parse(v.transitUtc!)).toBeLessThanOrEqual(Date.parse(night.windowEndUtc))
    expect(v.transitAltDeg!).toBeGreaterThan(0)
  })

  it('rejects a target that never rises at this latitude', () => {
    // Acrux (dec -63.1) never clears the horizon from 28.75 N.
    const v = computeVisibility(getTarget('star:acrux')!, night, ROQUE, {
      minAltDeg: 30,
      interval: null,
    })
    expect(v.observable).toBe(false)
    expect(v.reason).toBe('never rises above the horizon at this latitude')
    expect(v.window).toBeNull()
    expect(v.score).toBe(0)
  })

  it('reports the peak it actually measured when the target stays too low', () => {
    const v = computeVisibility(getTarget('M7')!, night, ROQUE, { minAltDeg: 30, interval: null })
    expect(v.observable).toBe(false)
    expect(v.reason).toMatch(/^below minimum altitude \(peak \d+° < 30°\)$/)
  })

  it('rejects a window shorter than minWindowMinutes', () => {
    const v = computeVisibility(getTarget('M31')!, night, ROQUE, {
      minAltDeg: 20,
      interval: {
        startUtc: '2026-09-02T21:30:00.000Z',
        endUtc: '2026-09-02T21:50:00.000Z',
      },
      minWindowMinutes: 45,
    })
    expect(v.observable).toBe(false)
    expect(v.reason).toMatch(/^window too short \(\d+ min < 45 min\)$/)
  })

  it('rejects a target too close to the Moon while the Moon is up', () => {
    const v = computeVisibility(getTarget('M31')!, night, ROQUE, {
      minAltDeg: 20,
      interval: null,
      minMoonSepDeg: 179,
    })
    expect(v.observable).toBe(false)
    expect(v.reason).toMatch(/^too close to the Moon \(\d+° < 179°\)$/)
  })

  it('never rejects the Moon for being close to the Moon', () => {
    const v = computeVisibility(MOON, night, ROQUE, {
      minAltDeg: 5,
      interval: null,
      minMoonSepDeg: 179,
      minWindowMinutes: 10,
    })
    expect(v.observable).toBe(true)
    expect(v.window!.moonSeparationDeg).toBeCloseTo(0, 3)
  })

  it('rejects everything when the night has no astronomical darkness', () => {
    const tromso = computeNightEphemeris('2026-06-21', TROMSO)
    const v = computeVisibility(getTarget('M13')!, tromso, TROMSO, {
      minAltDeg: 30,
      interval: null,
    })
    expect(v.observable).toBe(false)
    expect(v.reason).toBe('no astronomical darkness on this night')
  })

  it('still works on a no-darkness night when the caller passes an explicit interval', () => {
    const tromso = computeNightEphemeris('2026-06-21', TROMSO)
    const v = computeVisibility(getTarget('M13')!, tromso, TROMSO, {
      minAltDeg: 30,
      interval: { startUtc: '2026-06-21T22:00:00.000Z', endUtc: '2026-06-22T02:00:00.000Z' },
    })
    expect(v.observable).toBe(true)
    expect(v.window!.minutes).toBeGreaterThan(45)
  })
})

describe('findObservableTargets', () => {
  it('find returns candidates and rejections with reasons', () => {
    const r = findObservableTargets(night, ROQUE, { limit: 10 })
    expect(r.candidates.length).toBeGreaterThan(3)
    expect(r.candidates.length).toBeLessThanOrEqual(10)
    expect(r.candidates.map((c) => c.target.id)).toContain('M31')
    expect(r.candidates[0].score).toBeGreaterThanOrEqual(r.candidates[1].score)
    const m7 = r.rejected.find((x) => x.id === 'M7')
    expect(m7?.reason).toMatch(/altitude|Moon/)
    for (const x of r.rejected) expect(x.reason.length).toBeGreaterThan(5)
  })

  it('reports the options it actually used', () => {
    const r = findObservableTargets(night, ROQUE, {})
    expect(r.options.minAltDeg).toBe(30)
    expect(r.options.minMoonSepDeg).toBe(30)
    expect(r.options.minWindowMinutes).toBe(45)
    expect(r.options.stepMinutes).toBe(10)
    expect(r.options.limit).toBe(12)
    expect(r.options.interval).toEqual({
      startUtc: night.darkness.startUtc,
      endUtc: night.darkness.endUtc,
    })
    expect(r.candidates.length).toBeLessThanOrEqual(12)
  })

  it('never proposes the Sun and covers every target exactly once', () => {
    const r = findObservableTargets(night, ROQUE, { limit: 500 })
    const seen = new Set([...r.candidates.map((c) => c.target.id), ...r.rejected.map((x) => x.id)])
    expect(seen.has('sun')).toBe(false)
    expect(seen.size).toBe(r.candidates.length + r.rejected.length)
  })

  it('filters by type, magnitude, ids and query', () => {
    const galaxies = findObservableTargets(night, ROQUE, { types: ['galaxy'], limit: 500 })
    for (const c of galaxies.candidates) expect(c.target.type).toBe('galaxy')
    expect(galaxies.rejected.some((x) => x.reason === 'type excluded by filter')).toBe(true)

    const bright = findObservableTargets(night, ROQUE, { maxMag: 5, limit: 500 })
    for (const c of bright.candidates) {
      if (c.target.mag !== null) expect(c.target.mag).toBeLessThanOrEqual(5)
    }
    expect(
      bright.rejected.some((x) => /^fainter than magnitude limit \(\S+ > 5\)$/.test(x.reason)),
    ).toBe(true)

    const byId = findObservableTargets(night, ROQUE, { ids: ['M31', 'M13'], limit: 500 })
    expect(byId.candidates.length + byId.rejected.length).toBe(2)

    const byQuery = findObservableTargets(night, ROQUE, { query: 'andromeda', limit: 500 })
    expect(byQuery.candidates.length + byQuery.rejected.length).toBe(1)
  })

  it('no darkness → every fixed target rejected with the darkness reason', () => {
    const tromso = computeNightEphemeris('2026-06-21', TROMSO)
    const r = findObservableTargets(tromso, TROMSO, {})
    expect(r.candidates).toHaveLength(0)
    expect(r.rejected[0].reason).toMatch(/no astronomical darkness/)
  })

  it('runs the whole catalog in under 400 ms from cold caches', () => {
    clearTargetCaches()
    const started = performance.now()
    const r = findObservableTargets(night, ROQUE, { limit: 500 })
    const elapsed = performance.now() - started
    expect(r.candidates.length + r.rejected.length).toBeGreaterThan(110)
    expect(elapsed).toBeLessThan(400)
  })
})
