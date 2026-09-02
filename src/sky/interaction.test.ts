import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getTarget } from '../astro/catalog'
import {
  DOME_VIEW,
  MAX_FOV,
  MIN_FOV,
  altAzToVec,
  angularDistanceDeg,
  makeFrame,
  project,
  unproject,
} from '../astro/sky'
import type { SiteCoords } from '../astro/sky'
import { buildScene } from './scene'
import type { Scene } from './scene'
import { dragToView, hitTest, trailingBurst, wheelToFov } from './interaction'

const ROQUE: SiteCoords = {
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}
const WHEN = '2026-09-02T23:00:00Z'
const SIZE = 800

const dome: Scene = buildScene({
  site: ROQUE,
  timeUtc: WHEN,
  view: DOME_VIEW,
  width: SIZE,
  height: SIZE,
  maxStarMag: 6,
})

/** A patch of canvas with nothing within 40 px of it. */
function emptySpot(scene: Scene): { x: number; y: number } {
  for (let x = 60; x < SIZE - 60; x += 7) {
    for (let y = 60; y < SIZE - 60; y += 7) {
      const nearObject = scene.objects.some((o) => Math.hypot(o.x - x, o.y - y) < 40)
      if (nearObject) continue
      const nearStar = scene.stars.some(
        (s) => s.name !== '' && Math.hypot(s.x - x, s.y - y) < 40,
      )
      if (!nearStar) return { x, y }
    }
  }
  throw new Error('the sky is unexpectedly crowded')
}

describe('hitTest', () => {
  it('finds a deep sky object under the pointer', () => {
    const m31 = dome.objects.find((o) => o.id === 'M31')!
    const hit = hitTest(dome, m31.x, m31.y)
    expect(hit).not.toBeNull()
    expect(hit!.id).toBe('M31')
    expect(hit!.kind).toBe('messier')
    expect(hit!.distancePx).toBeLessThan(1)
  })

  it('finds the Moon, which is bigger than the default radius', () => {
    const moon = dome.objects.find((o) => o.id === 'moon')!
    const hit = hitTest(dome, moon.x + 6, moon.y)
    expect(hit?.id).toBe('moon')
    expect(hit?.kind).toBe('moon')
  })

  it('returns nothing over empty sky', () => {
    const spot = emptySpot(dome)
    expect(hitTest(dome, spot.x, spot.y)).toBeNull()
  })

  it('never reports the Sun, which is not an observing target', () => {
    const sun = dome.objects.find((o) => o.id === 'sun')!
    const hit = hitTest(dome, sun.x, sun.y)
    expect(hit?.id).not.toBe('sun')
  })

  it('reports named stars with an id the catalog resolves', () => {
    const named = dome.stars.filter((s) => s.name !== '' && s.mag <= 1.6)
    expect(named.length).toBeGreaterThan(0)
    const star = named[0]
    const hit = hitTest(dome, star.x, star.y)
    expect(hit).not.toBeNull()
    expect(hit!.kind).toBe('star')
    expect(hit!.name).toBe(star.name)
    expect(getTarget(hit!.id)?.id).toBe(hit!.id)
  })

  it('ignores anonymous stars', () => {
    const anonymous = dome.stars.find(
      (s) =>
        s.name === '' &&
        dome.stars.every((o) => o === s || o.name === '' || Math.hypot(o.x - s.x, o.y - s.y) > 20) &&
        dome.objects.every((o) => Math.hypot(o.x - s.x, o.y - s.y) > 40),
    )!
    expect(anonymous).toBeDefined()
    expect(hitTest(dome, anonymous.x, anonymous.y)).toBeNull()
  })

  it('honours a wider radius for touch', () => {
    // A lone object: M31 has M110 two pixels away, which would win either radius.
    const lonely = dome.objects.find(
      (o) =>
        o.kind === 'messier' &&
        dome.objects.every((other) => other === o || Math.hypot(other.x - o.x, other.y - o.y) > 60) &&
        dome.stars.every((s) => s.name === '' || Math.hypot(s.x - o.x, s.y - o.y) > 60),
    )!
    expect(lonely).toBeDefined()
    expect(hitTest(dome, lonely.x + 24, lonely.y)).toBeNull()
    expect(hitTest(dome, lonely.x + 24, lonely.y, 30)?.id).toBe(lonely.id)
  })
})

describe('dragToView', () => {
  const frame = makeFrame(DOME_VIEW, SIZE, SIZE)

  it('makes the sky follow the pointer', () => {
    const start = { x: 400, y: 400, view: DOME_VIEW }
    const current = { x: 500, y: 400 }
    const grabbed = unproject(start.x, start.y, frame, SIZE, SIZE)!
    const under = unproject(current.x, current.y, frame, SIZE, SIZE)!
    const view = dragToView(start, current, frame, SIZE, SIZE)

    // Dragging the zenith westwards swings the centre of the view east.
    expect(view.centerAzDeg).toBeCloseTo(90, 0)
    const travelled = angularDistanceDeg(
      altAzToVec(grabbed.altDeg, grabbed.azDeg),
      altAzToVec(under.altDeg, under.azDeg),
    )
    expect(view.centerAltDeg).toBeCloseTo(90 - travelled, 1)
    expect(view.fovDeg).toBe(DOME_VIEW.fovDeg)
  })

  it('leaves the grabbed patch of sky under the pointer', () => {
    const startView = { centerAltDeg: 45, centerAzDeg: 180, fovDeg: 70 }
    const startFrame = makeFrame(startView, 1000, 700)
    const start = { x: 480, y: 300, view: startView }
    const current = { x: 620, y: 380 }
    const grabbed = unproject(start.x, start.y, startFrame, 1000, 700)!
    const under = unproject(current.x, current.y, startFrame, 1000, 700)!

    const view = dragToView(start, current, startFrame, 1000, 700)
    const nextFrame = makeFrame(view, 1000, 700)

    const landed = project(altAzToVec(grabbed.altDeg, grabbed.azDeg), nextFrame, 1000, 700)!
    expect(landed.x).toBeCloseTo(current.x, 1)
    expect(landed.y).toBeCloseTo(current.y, 1)
    // The view really moved: it is not simply returning the start view.
    expect(
      angularDistanceDeg(
        altAzToVec(view.centerAltDeg, view.centerAzDeg),
        altAzToVec(startView.centerAltDeg, startView.centerAzDeg),
      ),
    ).toBeGreaterThan(5)
    expect(under.azDeg).not.toBeCloseTo(grabbed.azDeg, 3)
  })

  it('does not move when the pointer does not', () => {
    const start = { x: 300, y: 220, view: DOME_VIEW }
    const view = dragToView(start, { x: 300, y: 220 }, frame, SIZE, SIZE)
    expect(view.centerAltDeg).toBeCloseTo(DOME_VIEW.centerAltDeg, 6)
    expect(view.fovDeg).toBe(DOME_VIEW.fovDeg)
  })

  it('stays inside the clamped range', () => {
    const start = { x: 400, y: 100, view: DOME_VIEW }
    const view = dragToView(start, { x: 400, y: 780 }, frame, SIZE, SIZE)
    expect(view.centerAltDeg).toBeGreaterThanOrEqual(-30)
    expect(view.centerAltDeg).toBeLessThanOrEqual(90)
    expect(view.centerAzDeg).toBeGreaterThanOrEqual(0)
    expect(view.centerAzDeg).toBeLessThan(360)
  })
})

describe('wheelToFov', () => {
  it('zooms in when the wheel goes up and out when it goes down', () => {
    expect(wheelToFov(60, -100)).toBeLessThan(60)
    expect(wheelToFov(60, 100)).toBeGreaterThan(60)
    expect(wheelToFov(60, 0)).toBe(60)
  })

  it('clamps to the projection limits', () => {
    expect(wheelToFov(MIN_FOV, -10_000)).toBe(MIN_FOV)
    expect(wheelToFov(MAX_FOV, 10_000)).toBe(MAX_FOV)
    expect(wheelToFov(60, -10_000)).toBe(MIN_FOV)
    expect(wheelToFov(60, 10_000)).toBe(MAX_FOV)
    expect(wheelToFov(Number.NaN, 10)).toBe(MAX_FOV)
  })

  it('is symmetric: zooming in and back out returns to the start', () => {
    expect(wheelToFov(wheelToFov(60, -120), 120)).toBeCloseTo(60, 6)
  })
})

describe('trailingBurst', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once, after the last notch of a burst', () => {
    let fired = 0
    const burst = trailingBurst(400, () => {
      fired += 1
    })
    burst.bump()
    vi.advanceTimersByTime(300)
    burst.bump()
    vi.advanceTimersByTime(300)
    burst.bump()
    expect(fired).toBe(0)
    vi.advanceTimersByTime(399)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(1)
    expect(fired).toBe(1)
  })

  it('reads the value at the END of the burst, not at its start', () => {
    let fov = 140
    const seen: number[] = []
    const burst = trailingBurst(400, () => seen.push(fov))
    for (const next of [130, 125, 120, 118.6]) {
      fov = next
      burst.bump()
      vi.advanceTimersByTime(50)
    }
    vi.advanceTimersByTime(400)
    expect(seen).toEqual([118.6])
  })

  it('cancel stops a pending entry, so an unmount logs nothing', () => {
    let fired = 0
    const burst = trailingBurst(400, () => {
      fired += 1
    })
    burst.bump()
    burst.cancel()
    vi.advanceTimersByTime(2000)
    expect(fired).toBe(0)
  })
})
