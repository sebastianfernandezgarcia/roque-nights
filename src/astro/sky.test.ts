import { Horizon, Observer } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'

import {
  DOME_VIEW,
  MAX_FOV,
  MIN_FOV,
  altAzToVec,
  angularDistanceDeg,
  bvToColor,
  clampView,
  easeInOutCubic,
  eqjToHorizontalVec,
  horizontalRotation,
  interpolateView,
  makeFrame,
  project,
  starRadiusPx,
  unproject,
  vecToAltAz,
} from './sky'
import type { SiteCoords, SkyView } from './sky'

const ROQUE: SiteCoords = {
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}

/** Deterministic PRNG so the "random" round trips are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('vectors', () => {
  it('uses x = East, y = North, z = Up', () => {
    const zenith = altAzToVec(90, 0)
    expect(zenith.z).toBeCloseTo(1, 12)
    const north = altAzToVec(0, 0)
    expect(north.x).toBeCloseTo(0, 12)
    expect(north.y).toBeCloseTo(1, 12)
    expect(north.z).toBeCloseTo(0, 12)
    const east = altAzToVec(0, 90)
    expect(east.x).toBeCloseTo(1, 12)
    expect(east.y).toBeCloseTo(0, 12)
    const west = altAzToVec(0, 270)
    expect(west.x).toBeCloseTo(-1, 12)
  })

  it('round trips alt/az through vectors', () => {
    const rnd = mulberry32(7)
    for (let i = 0; i < 50; i++) {
      const altDeg = rnd() * 180 - 90
      const azDeg = rnd() * 360
      const back = vecToAltAz(altAzToVec(altDeg, azDeg))
      expect(back.altDeg).toBeCloseTo(altDeg, 9)
      expect(back.azDeg).toBeCloseTo(azDeg, 9)
    }
  })

  it('normalises azimuth into [0, 360)', () => {
    expect(vecToAltAz(altAzToVec(10, -90)).azDeg).toBeCloseTo(270, 9)
    expect(vecToAltAz({ x: 0, y: 0, z: -1 }).altDeg).toBeCloseTo(-90, 9)
  })

  it('measures angular distance', () => {
    expect(angularDistanceDeg(altAzToVec(0, 0), altAzToVec(0, 90))).toBeCloseTo(90, 9)
    expect(angularDistanceDeg(altAzToVec(90, 0), altAzToVec(0, 123))).toBeCloseTo(90, 9)
    expect(angularDistanceDeg(altAzToVec(10, 20), altAzToVec(10, 20))).toBeCloseTo(0, 9)
    expect(angularDistanceDeg(altAzToVec(0, 0), altAzToVec(0, 180))).toBeCloseTo(180, 6)
  })
})

describe('view constants', () => {
  it('exposes the whole sky dome', () => {
    expect(DOME_VIEW).toEqual({ centerAltDeg: 90, centerAzDeg: 0, fovDeg: 186 })
    expect(MIN_FOV).toBe(4)
    expect(MAX_FOV).toBe(186)
  })

  it('clamps views into legal ranges', () => {
    expect(clampView({ centerAltDeg: 120, centerAzDeg: 370, fovDeg: 500 })).toEqual({
      centerAltDeg: 90,
      centerAzDeg: 10,
      fovDeg: MAX_FOV,
    })
    expect(clampView({ centerAltDeg: -80, centerAzDeg: -30, fovDeg: 0.5 })).toEqual({
      centerAltDeg: -30,
      centerAzDeg: 330,
      fovDeg: MIN_FOV,
    })
  })
})

describe('projection', () => {
  it('dome projection: zenith at center, north up, east LEFT, horizon on the circle', () => {
    const f = makeFrame(DOME_VIEW, 800, 800)
    expect(project(altAzToVec(90, 0), f, 800, 800)).toEqual({ x: 400, y: 400 })
    const n = project(altAzToVec(0, 0), f, 800, 800)!
    expect(n.x).toBeCloseTo(400, 0)
    expect(n.y).toBeLessThan(30)
    const e = project(altAzToVec(0, 90), f, 800, 800)!
    expect(e.x).toBeLessThan(30)
    expect(e.y).toBeCloseTo(400, 0)
    const back = unproject(e.x, e.y, f, 800, 800)!
    expect(back.altDeg).toBeCloseTo(0, 0)
    expect(back.azDeg).toBeCloseTo(90, 0)
  })

  it('puts the horizon on a circle of radius min(w,h)/2 * tan(45)/tan(46.5)', () => {
    const w = 1000
    const h = 700
    const f = makeFrame(DOME_VIEW, w, h)
    const rad = Math.PI / 180
    const expected = ((Math.min(w, h) / 2) * Math.tan(45 * rad)) / Math.tan(46.5 * rad)
    for (let az = 0; az < 360; az += 15) {
      const p = project(altAzToVec(0, az), f, w, h)!
      const r = Math.hypot(p.x - w / 2, p.y - h / 2)
      expect(r).toBeCloseTo(expected, 9)
    }
  })

  it('zoomed view facing south: up is zenith, east still left', () => {
    const f = makeFrame({ centerAltDeg: 30, centerAzDeg: 180, fovDeg: 60 }, 1000, 700)
    const higher = project(altAzToVec(40, 180), f, 1000, 700)!
    expect(higher.y).toBeLessThan(350)
    const east = project(altAzToVec(30, 170), f, 1000, 700)!
    expect(east.x).toBeLessThan(500)
    const west = project(altAzToVec(30, 190), f, 1000, 700)!
    expect(west.x).toBeGreaterThan(500)
  })

  it('returns null behind the observer (more than 179 degrees away)', () => {
    const f = makeFrame({ centerAltDeg: 90, centerAzDeg: 0, fovDeg: 60 }, 800, 800)
    expect(project(altAzToVec(-90, 0), f, 800, 800)).toBeNull()
    expect(project(altAzToVec(-89.5, 0), f, 800, 800)).toBeNull()
    // 178.5 degrees away: still projected, just very far off canvas.
    expect(project(altAzToVec(-88.5, 0), f, 800, 800)).not.toBeNull()
    expect(project({ x: 0, y: 0, z: 0 }, f, 800, 800)).toBeNull()
  })

  it('round trips project -> unproject for 20 random points at 3 views', () => {
    const views: { view: SkyView; w: number; h: number }[] = [
      { view: DOME_VIEW, w: 800, h: 800 },
      { view: { centerAltDeg: 30, centerAzDeg: 180, fovDeg: 60 }, w: 1000, h: 700 },
      { view: { centerAltDeg: -12, centerAzDeg: 305, fovDeg: 8 }, w: 640, h: 900 },
    ]
    const rnd = mulberry32(20260902)
    for (const { view, w, h } of views) {
      const f = makeFrame(view, w, h)
      let checked = 0
      while (checked < 20) {
        // Uniform on the sphere so the sample is not biased toward the poles.
        const z = rnd() * 2 - 1
        const azDeg = rnd() * 360
        const altDeg = (Math.asin(z) * 180) / Math.PI
        const p = project(altAzToVec(altDeg, azDeg), f, w, h)
        if (p === null) continue
        const back = unproject(p.x, p.y, f, w, h)!
        expect(back.altDeg).toBeCloseTo(altDeg, 6)
        // Azimuth is ill conditioned within a hair of the poles; compare the
        // full direction there instead of the raw azimuth.
        const sep = angularDistanceDeg(altAzToVec(altDeg, azDeg), altAzToVec(back.altDeg, back.azDeg))
        expect(sep).toBeLessThan(1e-6)
        checked++
      }
    }
  })

  it('unproject inverts the center of the canvas', () => {
    const view = { centerAltDeg: 42, centerAzDeg: 133, fovDeg: 25 }
    const f = makeFrame(view, 900, 600)
    const back = unproject(450, 300, f, 900, 600)!
    expect(back.altDeg).toBeCloseTo(42, 9)
    expect(back.azDeg).toBeCloseTo(133, 9)
  })
})

describe('equatorial to horizontal', () => {
  it('eqjToHorizontalVec matches astronomy-engine Horizon for M31 within 0.3 degrees', () => {
    const d = new Date('2026-09-02T23:00:00Z')
    const rot = horizontalRotation(d, ROQUE)
    const aa = vecToAltAz(eqjToHorizontalVec(10.6847, 41.269, rot))
    expect(aa.altDeg).toBeCloseTo(38.97, 0)
    expect(aa.azDeg).toBeCloseTo(58.22, 0)
  })

  it('agrees with Horizon() for a spread of catalog objects', () => {
    const d = new Date('2026-09-03T01:00:00Z')
    const rot = horizontalRotation(d, ROQUE)
    const observer = new Observer(ROQUE.latitude, ROQUE.longitude, ROQUE.elevationM)
    const objects = [
      { ra: 10.6847, dec: 41.269 }, // M31
      { ra: 250.4235, dec: 36.4613 }, // M13
      { ra: 56.75, dec: 24.1167 }, // M45
      { ra: 83.8221, dec: -5.3911 }, // M42
      { ra: 201.365, dec: -43.019 }, // M83, deep south
    ]
    for (const o of objects) {
      const ours = vecToAltAz(eqjToHorizontalVec(o.ra, o.dec, rot))
      // No refraction argument: Horizon() treats a falsy value as "no correction".
      // It also reads ra/dec as of-date, so precession leaves a ~0.35 degree gap
      // against our J2000 rotation. Plenty to catch an axis swap, which is the trap.
      const ref = Horizon(d, observer, o.ra / 15, o.dec)
      expect(ours.altDeg).toBeCloseTo(ref.altitude, 0)
      // Azimuth is meaningless at the zenith but none of these sit there.
      expect(Math.abs(((ours.azDeg - ref.azimuth + 540) % 360) - 180)).toBeLessThan(0.5)
    }
  })

  it('returns unit vectors', () => {
    const rot = horizontalRotation(new Date('2026-09-02T23:00:00Z'), ROQUE)
    const v = eqjToHorizontalVec(10.6847, 41.269, rot)
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12)
  })
})

describe('star styling', () => {
  it('colors and radii', () => {
    expect(bvToColor(1.8)).toMatch(/^#ff/)
    expect(starRadiusPx(-1.4, 186)).toBeGreaterThan(starRadiusPx(3, 186))
    expect(starRadiusPx(5, 20)).toBeGreaterThan(starRadiusPx(5, 186))
  })

  it('hits the documented color stops exactly', () => {
    expect(bvToColor(-0.4)).toBe('#9db4ff')
    expect(bvToColor(0)).toBe('#cad8ff')
    expect(bvToColor(0.3)).toBe('#f5f3ff')
    expect(bvToColor(0.6)).toBe('#fff4e8')
    expect(bvToColor(1)).toBe('#ffd9a8')
    expect(bvToColor(1.5)).toBe('#ffbf78')
    expect(bvToColor(2)).toBe('#ff9e5e')
    expect(bvToColor(3)).toBe('#ff9e5e')
    expect(bvToColor(-5)).toBe('#9db4ff')
  })

  it('interpolates between stops', () => {
    const mid = bvToColor(0.15)
    expect(mid).toMatch(/^#[0-9a-f]{6}$/)
    expect(mid).not.toBe('#cad8ff')
    expect(mid).not.toBe('#f5f3ff')
  })

  it('keeps radii inside the documented bounds', () => {
    expect(starRadiusPx(-1.5, MIN_FOV)).toBeLessThanOrEqual(9)
    expect(starRadiusPx(12, MAX_FOV)).toBeCloseTo(0.35, 6)
    expect(starRadiusPx(-10, MAX_FOV)).toBeCloseTo(5.5, 6)
  })
})

describe('animation helpers', () => {
  it('eases in and out', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12)
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25)
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75)
  })

  it('interpolateView takes the short way around', () => {
    const v = interpolateView(
      { centerAltDeg: 0, centerAzDeg: 350, fovDeg: 60 },
      { centerAltDeg: 0, centerAzDeg: 10, fovDeg: 60 },
      0.5,
    )
    expect(v.centerAzDeg).toBeCloseTo(0, 5)
  })

  it('interpolates fov in log space and returns the endpoints at t = 0 and 1', () => {
    const from: SkyView = { centerAltDeg: 90, centerAzDeg: 0, fovDeg: 186 }
    const to: SkyView = { centerAltDeg: 40, centerAzDeg: 120, fovDeg: 20 }
    expect(interpolateView(from, to, 0)).toEqual(from)
    expect(interpolateView(from, to, 1)).toEqual(to)
    const half = interpolateView(from, to, 0.5)
    expect(half.fovDeg).toBeCloseTo(Math.sqrt(186 * 20), 9)
    expect(half.centerAltDeg).toBeCloseTo(65, 9)
    expect(half.centerAzDeg).toBeCloseTo(60, 9)
  })
})
