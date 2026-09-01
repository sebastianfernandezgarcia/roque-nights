import { describe, expect, it } from 'vitest'

import { DOME_VIEW, makeFrame } from '../astro/sky'
import type { SiteCoords } from '../astro/sky'
import { buildScene } from './scene'
import type { Scene } from './scene'
import { renderSky, sceneFovDeg, skyPalette } from './render'
import type { RenderStyle } from './render'

const ROQUE: SiteCoords = {
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}

/**
 * A canvas context that records instead of painting. It cannot judge how the sky
 * looks, but it does prove that a frame can be drawn from end to end in a plain
 * node process, whatever the scene contains.
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const target: Record<string, unknown> = {
    canvas: { width: 1600, height: 1600 },
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: () => ({ width: 12 }),
  }
  const proxy = new Proxy(target, {
    get(store, property: string) {
      if (property in store) return store[property]
      return (...args: unknown[]) => {
        calls.push(`${property}(${args.length})`)
      }
    },
    set(store, property: string, value) {
      store[property] = value
      return true
    },
  })
  return { ctx: proxy as unknown as CanvasRenderingContext2D, calls }
}

class FakePath {
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  ellipse(): void {}
  rect(): void {}
  closePath(): void {}
  addPath(): void {}
}

const style: RenderStyle = {
  nightMode: true,
  dpr: 2,
  selectedId: 'M31',
  highlightedIds: new Set(['M13']),
  favoriteIds: new Set(['star:vega', 'saturn']),
  planIds: new Map([
    ['M31', 1],
    ['saturn', 2],
  ]),
  proposedIds: new Set(['M27']),
  showConstellationNames: true,
  showLabels: true,
  reticlePulse: 0.4,
}

function scene(timeUtc = '2026-09-02T23:00:00Z'): Scene {
  return buildScene({
    site: ROQUE,
    timeUtc,
    view: DOME_VIEW,
    width: 800,
    height: 800,
    maxStarMag: 6,
  })
}

describe('skyPalette', () => {
  it('is night below astronomical twilight and daylight above the horizon', () => {
    expect(skyPalette(-40).zenith).toEqual([5, 6, 10])
    expect(skyPalette(-90).horizon).toEqual([10, 13, 22])
    const day = skyPalette(30)
    expect(day.zenith[2]).toBeGreaterThan(day.zenith[0])
    expect(day.zenith[0]).toBeGreaterThan(100)
  })

  it('brightens monotonically through the twilights', () => {
    const brightness = [-18, -14, -10, -6, -3, 0, 4].map((alt) => {
      const p = skyPalette(alt)
      return p.zenith[0] + p.zenith[1] + p.zenith[2]
    })
    for (let i = 1; i < brightness.length; i++) {
      expect(brightness[i]).toBeGreaterThan(brightness[i - 1])
    }
  })

  it('survives nonsense', () => {
    expect(skyPalette(Number.NaN).zenith).toEqual([5, 6, 10])
  })
})

describe('sceneFovDeg', () => {
  it('recovers the field of view the scene was built with', () => {
    expect(sceneFovDeg(scene())).toBeCloseTo(186, 3)
    const narrow = buildScene({
      site: ROQUE,
      timeUtc: '2026-09-02T23:00:00Z',
      view: { centerAltDeg: 40, centerAzDeg: 120, fovDeg: 24 },
      width: 1000,
      height: 700,
      maxStarMag: 6,
    })
    expect(sceneFovDeg(narrow)).toBeCloseTo(24, 3)
  })
})

describe('renderSky', () => {
  const withFakePath = (run: () => void): void => {
    const original = (globalThis as { Path2D?: unknown }).Path2D
    ;(globalThis as { Path2D?: unknown }).Path2D = FakePath
    try {
      run()
    } finally {
      ;(globalThis as { Path2D?: unknown }).Path2D = original
    }
  }

  it('paints a whole night frame without touching the DOM', () => {
    withFakePath(() => {
      const { ctx, calls } = recordingContext()
      renderSky(ctx, scene(), style)
      expect(calls).toContain('setTransform(6)')
      expect(calls.filter((c) => c.startsWith('fill(')).length).toBeGreaterThan(5)
      expect(calls.filter((c) => c.startsWith('fillText(')).length).toBeGreaterThan(5)
    })
  })

  it('paints a twilight frame, where the Sun is up and the Moon may not be', () => {
    withFakePath(() => {
      const { ctx, calls } = recordingContext()
      renderSky(ctx, scene('2026-09-02T13:00:00Z'), { ...style, reticlePulse: 1 })
      expect(calls.length).toBeGreaterThan(50)
    })
  })

  it('paints a view from below the horizon, where the sky is the outside', () => {
    withFakePath(() => {
      const { ctx, calls } = recordingContext()
      const below = buildScene({
        site: ROQUE,
        timeUtc: '2026-09-02T23:00:00Z',
        view: { centerAltDeg: -30, centerAzDeg: 200, fovDeg: 120 },
        width: 900,
        height: 500,
        maxStarMag: 6,
      })
      renderSky(ctx, below, style)
      expect(calls.length).toBeGreaterThan(20)
    })
  })

  it('paints an empty scene', () => {
    withFakePath(() => {
      const { ctx } = recordingContext()
      const empty: Scene = {
        frame: makeFrame(DOME_VIEW, 100, 100),
        sunAltDeg: -20,
        horizon: [],
        cardinals: [],
        milkyWay: [],
        constellations: [],
        stars: [],
        objects: [],
        belowHorizonMask: true,
        width: 100,
        height: 100,
      }
      expect(() =>
        renderSky(ctx, empty, {
          ...style,
          selectedId: null,
          highlightedIds: new Set(),
          favoriteIds: new Set(),
          planIds: new Map(),
          proposedIds: new Set(),
        }),
      ).not.toThrow()
    })
  })
})
