import { Body } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'

import {
  ALL_TARGETS,
  BRIGHT_STARS,
  MESSIER_TARGETS,
  MOON,
  PLANETS,
  TARGET_BY_ID,
  getTarget,
  normalizeRA,
  searchTargets,
} from './catalog'

describe('normalizeRA', () => {
  it('wraps degrees into [0, 360)', () => {
    expect(normalizeRA(-170)).toBe(190)
    expect(normalizeRA(370)).toBe(10)
    expect(normalizeRA(10.685)).toBeCloseTo(10.685)
    expect(normalizeRA(360)).toBe(0)
    expect(normalizeRA(-720.5)).toBeCloseTo(359.5)
  })

  it('returns 0 for values that are not finite numbers', () => {
    expect(normalizeRA(Number.NaN)).toBe(0)
    expect(normalizeRA(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('the catalog', () => {
  it('has 110 Messier objects, 7 planets, the Moon and the bright stars', () => {
    expect(MESSIER_TARGETS).toHaveLength(110)
    expect(PLANETS).toHaveLength(7)
    expect(PLANETS.map((p) => p.id)).toEqual([
      'mercury',
      'venus',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ])
    expect(MOON.id).toBe('moon')
    expect(MOON.type).toBe('moon')
    expect(BRIGHT_STARS.length).toBeGreaterThan(10)
    expect(ALL_TARGETS).toHaveLength(
      MESSIER_TARGETS.length + PLANETS.length + 1 + BRIGHT_STARS.length,
    )
  })

  it('never lists the Sun as a target', () => {
    expect(ALL_TARGETS.some((t) => t.body === Body.Sun)).toBe(false)
    expect(getTarget('sun')).toBeUndefined()
  })

  it('gives every target a unique id and a non-empty name', () => {
    const ids = new Set<string>()
    for (const t of ALL_TARGETS) {
      expect(t.id).not.toBe('')
      expect(t.name).not.toBe('')
      expect(ids.has(t.id)).toBe(false)
      ids.add(t.id)
      expect(TARGET_BY_ID.get(t.id)).toBe(t)
    }
  })

  it('keeps fixed targets and bodies well formed', () => {
    for (const t of ALL_TARGETS) {
      if (t.kind === 'fixed') {
        expect(typeof t.ra).toBe('number')
        expect(typeof t.dec).toBe('number')
        expect(t.ra!).toBeGreaterThanOrEqual(0)
        expect(t.ra!).toBeLessThan(360)
        expect(Math.abs(t.dec!)).toBeLessThanOrEqual(90)
        expect(t.body).toBeUndefined()
      } else {
        expect(t.body).toBeDefined()
        expect(t.ra).toBeUndefined()
      }
      for (const alias of t.aliases) expect(alias).toBe(alias.toLowerCase())
    }
  })

  it('carries the Messier golden values', () => {
    const m31 = getTarget('M31')!
    expect(m31.kind).toBe('fixed')
    expect(m31.type).toBe('galaxy')
    expect(m31.ra!).toBeCloseTo(10.68, 1)
    expect(m31.dec!).toBeCloseTo(41.27, 1)
    expect(m31.con).toBe('And')
    expect(m31.mag).toBeCloseTo(3.4, 1)
  })
})

describe('getTarget', () => {
  it('resolves ids and names', () => {
    expect(getTarget('m 31')?.id).toBe('M31')
    expect(getTarget('Andromeda Galaxy')?.id).toBe('M31')
    expect(getTarget('Jupiter')?.kind).toBe('body')
    expect(getTarget('vega')?.id).toBe('star:vega')
    expect(getTarget('Klingon')).toBeUndefined()
  })

  it('is case, space and punctuation insensitive', () => {
    expect(getTarget('M31')?.id).toBe('M31')
    expect(getTarget('  m31  ')?.id).toBe('M31')
    expect(getTarget('m-31')?.id).toBe('M31')
    expect(getTarget('M110')?.id).toBe('M110')
    expect(getTarget('ngc 7089')?.id).toBe('M2')
    expect(getTarget("Ptolemy's Cluster")?.id).toBe('M7')
    expect(getTarget('THE MOON')?.id).toBe('moon')
    expect(getTarget('star:vega')?.id).toBe('star:vega')
  })

  it('rejects rubbish without throwing', () => {
    expect(getTarget('')).toBeUndefined()
    expect(getTarget('   ')).toBeUndefined()
    expect(getTarget('M999')).toBeUndefined()
  })
})

describe('searchTargets', () => {
  it('finds targets by prefix and by substring, best match first', () => {
    const hits = searchTargets('androm')
    expect(hits[0].id).toBe('M31')
    expect(searchTargets('cluster').length).toBeGreaterThan(5)
    expect(searchTargets('jup')[0].id).toBe('jupiter')
  })

  it('honours the limit and returns nothing for an empty query', () => {
    expect(searchTargets('nebula', 3)).toHaveLength(3)
    expect(searchTargets('')).toHaveLength(0)
    expect(searchTargets('zzzzz')).toHaveLength(0)
  })
})

describe('BRIGHT_STARS', () => {
  it('slugifies names into ids and keeps them bright', () => {
    for (const star of BRIGHT_STARS) {
      expect(star.id.startsWith('star:')).toBe(true)
      expect(star.id).toBe(star.id.toLowerCase())
      expect(star.id).not.toMatch(/\s/)
      expect(star.mag!).toBeLessThanOrEqual(1.6)
      expect(star.type).toBe('star')
      expect(star.kind).toBe('fixed')
    }
    expect(BRIGHT_STARS.map((s) => s.id)).toContain('star:vega')
    expect(BRIGHT_STARS.map((s) => s.id)).toContain('star:rigil-kentaurus')
  })
})
