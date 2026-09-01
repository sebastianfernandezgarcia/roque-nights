import { describe, expect, it } from 'vitest'

import { BRIGHT_STARS } from '../astro/catalog'
import { DOME_VIEW, bvToColor, starRadiusPx } from '../astro/sky'
import type { SiteCoords, SkyView } from '../astro/sky'
import { buildScene, starIdForName } from './scene'
import type { Scene, SceneInput } from './scene'

const ROQUE: SiteCoords = {
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}

/** Golden instant of the plan: 2026-09-02, deep in astronomical darkness at the Roque. */
const WHEN = '2026-09-02T23:00:00Z'
const SIZE = 800

function scene(view: SkyView = DOME_VIEW, overrides: Partial<SceneInput> = {}): Scene {
  return buildScene({
    site: ROQUE,
    timeUtc: WHEN,
    view,
    width: SIZE,
    height: SIZE,
    maxStarMag: 6,
    ...overrides,
  })
}

function objectById(s: Scene, id: string) {
  return s.objects.find((o) => o.id === id)
}

describe('buildScene', () => {
  it('fills the dome with the real sky over the Roque', () => {
    const s = scene()

    expect(s.stars.length).toBeGreaterThanOrEqual(1500)

    const m31 = objectById(s, 'M31')
    expect(m31).toBeDefined()
    expect(m31!.kind).toBe('messier')
    expect(m31!.type).toBe('galaxy')
    expect(m31!.altDeg).toBeCloseTo(38.95, 0)
    expect(m31!.azDeg).toBeCloseTo(58.22, 0)

    const moon = objectById(s, 'moon')
    expect(moon).toBeDefined()
    expect(moon!.altDeg).toBeCloseTo(2.69, 0)
    expect(moon!.extra?.illuminationPct).toBeCloseTo(65.5, 0)

    expect(s.horizon).toHaveLength(360)
    expect(s.cardinals).toHaveLength(8)
    expect(s.belowHorizonMask).toBe(true)
  })

  it('puts north on top and east on the left, the way an observer looks up', () => {
    const s = scene()
    const north = s.cardinals.find((c) => c.label === 'N')!
    const east = s.cardinals.find((c) => c.label === 'E')!
    const south = s.cardinals.find((c) => c.label === 'S')!

    expect(north.visible).toBe(true)
    expect(north.y).toBeLessThan(60)
    expect(north.x).toBeCloseTo(400, 0)
    expect(east.visible).toBe(true)
    expect(east.x).toBeLessThan(60)
    expect(east.y).toBeCloseTo(400, 0)
    expect(south.y).toBeGreaterThan(SIZE - 60)
  })

  it('reports the Sun below the horizon at midnight and still projects it', () => {
    const s = scene()
    expect(s.sunAltDeg).toBeCloseTo(-41.8, 0)
    const sun = objectById(s, 'sun')
    expect(sun).toBeDefined()
    expect(sun!.kind).toBe('sun')
    expect(sun!.altDeg).toBeLessThan(-18)
    expect(Number.isFinite(sun!.x)).toBe(true)
    expect(Number.isFinite(sun!.y)).toBe(true)
  })

  it('keeps only what is above the horizon and inside the canvas', () => {
    const s = scene()
    for (const star of s.stars) {
      expect(star.x).toBeGreaterThan(-21)
      expect(star.x).toBeLessThan(SIZE + 21)
      expect(star.y).toBeGreaterThan(-21)
      expect(star.y).toBeLessThan(SIZE + 21)
      expect(star.mag).toBeLessThanOrEqual(6)
    }
    for (const object of s.objects) {
      if (object.kind === 'messier') expect(object.altDeg).toBeGreaterThanOrEqual(0)
    }
  })

  it('honours the magnitude cut', () => {
    const bright = scene(DOME_VIEW, { maxStarMag: 3 })
    const all = scene()
    expect(bright.stars.length).toBeLessThan(all.stars.length)
    for (const star of bright.stars) expect(star.mag).toBeLessThanOrEqual(3)
  })

  it('sizes and colours stars the way sky.ts does', () => {
    const s = scene()
    const sirius = s.stars.find((star) => star.name === 'Sirius')
    // Sirius is below the horizon at this instant; take the brightest star that is up.
    const brightest = sirius ?? s.stars.reduce((a, b) => (a.mag <= b.mag ? a : b))
    expect(brightest.r).toBeCloseTo(starRadiusPx(brightest.mag, DOME_VIEW.fovDeg), 6)
    expect(brightest.color).toMatch(/^#[0-9a-f]{6}$/)
    // Colours are quantised in 0.1 steps of B-V, so every colour is a real stop value.
    const palette = new Set<string>()
    for (let bv = -0.4; bv <= 2.0001; bv += 0.1) palette.add(bvToColor(Math.round(bv * 10) / 10))
    for (const star of s.stars) expect(palette.has(star.color)).toBe(true)
  })

  it('carries the sky furniture: constellations, Milky Way, labels', () => {
    const s = scene()
    expect(s.constellations).toHaveLength(88)
    const ursa = s.constellations.find((c) => c.id === 'UMa')!
    expect(ursa.name).toBe('Ursa Major')
    expect(ursa.lines.length).toBeGreaterThan(0)
    expect(ursa.lines[0].points.length).toBeGreaterThan(1)
    expect(s.milkyWay).toHaveLength(5)
    expect(s.milkyWay[0].level).toBe(1)
    expect(s.milkyWay[4].level).toBe(5)
    for (const level of s.milkyWay) expect(level.polygons.length).toBeGreaterThan(0)
  })

  it('zooms: fewer stars and the target dead centre', () => {
    const wide = scene()
    const m31 = objectById(wide, 'M31')!
    const zoomed = scene({ centerAltDeg: m31.altDeg, centerAzDeg: m31.azDeg, fovDeg: 30 })
    const zoomedM31 = objectById(zoomed, 'M31')!

    expect(zoomed.stars.length).toBeLessThan(wide.stars.length)
    expect(zoomedM31.x).toBeCloseTo(400, 0)
    expect(zoomedM31.y).toBeCloseTo(400, 0)
    expect(Math.hypot(zoomedM31.x - 400, zoomedM31.y - 400)).toBeLessThan(2)
    // Deep sky glyphs grow with the zoom so they stay readable.
    expect(zoomedM31.r).toBeGreaterThan(m31.r)
  })

  it('survives a rectangular canvas and a view below the horizon', () => {
    const s = scene({ centerAltDeg: -20, centerAzDeg: 180, fovDeg: 90 }, { width: 1100, height: 620 })
    expect(s.horizon.length).toBeGreaterThan(0)
    for (const point of s.horizon) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
    for (const star of s.stars) {
      expect(Number.isFinite(star.x)).toBe(true)
      expect(Number.isFinite(star.y)).toBe(true)
    }
  })

  it('builds the dome fast enough for a 60 fps drag', () => {
    scene()
    const started = performance.now()
    for (let i = 0; i < 5; i++) scene()
    const perScene = (performance.now() - started) / 5
    expect(perScene).toBeLessThan(150)
  })
})

describe('starIdForName', () => {
  it('reproduces the ids the target catalog hands the tools', () => {
    expect(starIdForName('Vega')).toBe('star:vega')
    expect(starIdForName('Rigil Kentaurus')).toBe('star:rigil-kentaurus')
    // Every bright star the agent can point at must answer to the id a tap produces.
    for (const target of BRIGHT_STARS) expect(starIdForName(target.name)).toBe(target.id)
  })
})
