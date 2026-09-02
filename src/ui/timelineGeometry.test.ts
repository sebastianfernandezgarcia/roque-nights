import { describe, expect, it } from 'vitest'

import { getNight } from '../astro/cache'
import type { SiteCoords } from '../astro/night'
import { bandKindForAltitude, domainBounds, timelineGeometry } from './timelineGeometry'

const ROQUE: SiteCoords = {
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}

/** Northern summer above the Arctic Circle: the Sun never sets. */
const TROMSO: SiteCoords = {
  latitude: 69.6492,
  longitude: 18.9553,
  elevationM: 10,
  timeZone: 'Europe/Oslo',
}

const WIDTH = 1000

describe('bandKindForAltitude', () => {
  it('maps the twilight thresholds', () => {
    expect(bandKindForAltitude(12)).toBe('day')
    expect(bandKindForAltitude(0)).toBe('civil')
    expect(bandKindForAltitude(-5.9)).toBe('civil')
    expect(bandKindForAltitude(-6)).toBe('nautical')
    expect(bandKindForAltitude(-12)).toBe('astronomical')
    expect(bandKindForAltitude(-18)).toBe('darkness')
    expect(bandKindForAltitude(-40)).toBe('darkness')
  })
})

describe('timelineGeometry at the Roque', () => {
  const night = getNight('2026-09-02', ROQUE)
  const geo = timelineGeometry(night, WIDTH)

  it('maps the night window onto the full width', () => {
    expect(geo.x(night.windowStartUtc)).toBeCloseTo(0, 6)
    expect(geo.x(night.windowEndUtc)).toBeCloseTo(WIDTH, 6)
    expect(geo.x('1999-01-01T00:00:00Z')).toBe(0)
    expect(geo.x('2999-01-01T00:00:00Z')).toBe(WIDTH)
    expect(geo.x('not a date')).toBe(0)
  })

  it('round trips a pixel to an instant', () => {
    const midpoint = geo.timeAt(WIDTH / 2)
    expect(geo.x(midpoint)).toBeCloseTo(WIDTH / 2, 6)
    expect(geo.timeAt(-50)).toBe(new Date(geo.startMs).toISOString())
    expect(geo.timeAt(WIDTH + 50)).toBe(new Date(geo.endMs).toISOString())
  })

  it('produces contiguous bands with no gaps or overlaps', () => {
    expect(geo.bands.length).toBeGreaterThan(4)
    expect(geo.bands[0].x0).toBe(0)
    expect(geo.bands[geo.bands.length - 1].x1).toBeCloseTo(WIDTH, 6)
    for (let i = 0; i + 1 < geo.bands.length; i++) {
      expect(geo.bands[i].x1).toBeCloseTo(geo.bands[i + 1].x0, 9)
      expect(geo.bands[i].x1).toBeGreaterThan(geo.bands[i].x0)
      expect(geo.bands[i].kind).not.toBe(geo.bands[i + 1].kind)
    }
  })

  it('starts in daylight, darkens to darkness and comes back', () => {
    const kinds = geo.bands.map((b) => b.kind)
    expect(kinds[0]).toBe('day')
    expect(kinds[kinds.length - 1]).toBe('day')
    expect(kinds).toContain('civil')
    expect(kinds).toContain('nautical')
    expect(kinds).toContain('astronomical')
    expect(kinds).toContain('darkness')
  })

  it('puts the darkness band edges on the ephemeris darkness window', () => {
    const dark = geo.bands.filter((b) => b.kind === 'darkness')
    expect(dark).toHaveLength(1)
    expect(dark[0].x0).toBeCloseTo(geo.x(night.darkness.startUtc!), 0)
    expect(dark[0].x1).toBeCloseTo(geo.x(night.darkness.endUtc!), 0)
  })

  it('keeps the Moon spans inside the window and scales the hatch by illumination', () => {
    expect(geo.moonSpans.length).toBeGreaterThan(0)
    for (const span of geo.moonSpans) {
      expect(span.x0).toBeGreaterThanOrEqual(0)
      expect(span.x1).toBeLessThanOrEqual(WIDTH)
      expect(span.x1).toBeGreaterThan(span.x0)
    }
    expect(geo.moonOpacity).toBeGreaterThanOrEqual(0.15)
    expect(geo.moonOpacity).toBeLessThanOrEqual(0.5)
  })
})

describe('timelineGeometry in degenerate cases', () => {
  it('handles a night with no darkness at all', () => {
    const night = getNight('2026-06-21', TROMSO)
    const geo = timelineGeometry(night, WIDTH)
    expect(geo.bands.every((b) => b.kind === 'day')).toBe(true)
    expect(geo.bands[0].x0).toBe(0)
    expect(geo.bands[geo.bands.length - 1].x1).toBeCloseTo(WIDTH, 6)
  })

  it('survives a zero width container', () => {
    const night = getNight('2026-09-02', ROQUE)
    const geo = timelineGeometry(night, 0)
    expect(geo.width).toBe(1)
    expect(geo.x(night.windowEndUtc)).toBe(1)
    expect(Number.isNaN(Date.parse(geo.timeAt(0.5)))).toBe(false)
  })
})

describe('the observable domain', () => {
  const night = getNight('2026-09-02', ROQUE)

  it('spans sunset minus an hour to sunrise plus an hour', () => {
    const bounds = domainBounds(night, 'observable')
    expect(bounds.startMs).toBe(Date.parse(night.sun.sunsetUtc!) - 3_600_000)
    expect(bounds.endMs).toBe(Date.parse(night.sun.sunriseUtc!) + 3_600_000)
  })

  it('gives the dark hours most of the pixels instead of a third of them', () => {
    const full = timelineGeometry(night, WIDTH)
    const trimmed = timelineGeometry(night, WIDTH, 'observable')
    const darkPx = (geo: ReturnType<typeof timelineGeometry>) =>
      geo.x(night.darkness.endUtc!) - geo.x(night.darkness.startUtc!)
    expect(darkPx(full) / WIDTH).toBeLessThan(0.4)
    expect(darkPx(trimmed) / WIDTH).toBeGreaterThan(0.6)
    expect(darkPx(trimmed)).toBeGreaterThan(darkPx(full) * 1.6)
  })

  it('still fills the width with contiguous bands, in the same colours', () => {
    const geo = timelineGeometry(night, WIDTH, 'observable')
    expect(geo.bands[0].x0).toBe(0)
    expect(geo.bands[geo.bands.length - 1].x1).toBeCloseTo(WIDTH, 6)
    for (let i = 0; i + 1 < geo.bands.length; i++) {
      expect(geo.bands[i].x1).toBeCloseTo(geo.bands[i + 1].x0, 9)
    }
    expect(geo.bands.map((b) => b.kind)).toContain('darkness')
  })

  it('falls back to the whole window when the Sun never sets', () => {
    const polar = getNight('2026-06-21', TROMSO)
    expect(domainBounds(polar, 'observable')).toEqual(domainBounds(polar, 'window'))
  })

  it('leaves the window domain alone, so the time slider still scrubs 24 h', () => {
    const bounds = domainBounds(night, 'window')
    expect(bounds.startMs).toBe(Date.parse(night.windowStartUtc))
    expect(bounds.endMs).toBe(Date.parse(night.windowEndUtc))
  })
})
