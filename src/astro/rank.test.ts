import { describe, expect, it } from 'vitest'
import { clearNightCache } from './cache'
import { rankNights } from './rank'
import { isoDateRange } from './time'
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
/** 88 degrees north: polar night in December, no time zone of its own. */
const POLE: SiteCoords = { latitude: 88, longitude: 0, elevationM: 0, timeZone: null }

describe('rankNights', () => {
  it('rank picks the darkest Moon-free nights of early September 2026', () => {
    const r = rankNights(isoDateRange('2026-08-31', '2026-09-14'), ROQUE)
    expect(r[0].nightOf >= '2026-09-09' && r[0].nightOf <= '2026-09-14').toBe(true)
    const aug31 = r.find((x) => x.nightOf === '2026-08-31')!
    expect(aug31.score).toBeLessThan(r[0].score)
    expect(aug31.moonIlluminationPct).toBeGreaterThan(80)
    expect(r[0].explanation).toMatch(/usable|Moon/)
  })

  it('rank honours AbortSignal', () => {
    const c = new AbortController()
    c.abort()
    expect(() => rankNights(['2026-09-01', '2026-09-02'], ROQUE, c.signal)).toThrow(/abort/i)
  })

  it('throws a DOMException named AbortError, not a plain Error', () => {
    const c = new AbortController()
    c.abort()
    let thrown: unknown
    try {
      rankNights(['2026-09-01'], ROQUE, c.signal)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(DOMException)
    expect((thrown as DOMException).name).toBe('AbortError')
  })

  it('checks the signal between nights, not only at the start', () => {
    let reads = 0
    // Reports "not aborted" the first time and "aborted" from then on, so the loop
    // has to look again after the first night for this to throw.
    const signal = {
      get aborted() {
        reads += 1
        return reads > 1
      },
    } as unknown as AbortSignal
    expect(() => rankNights(['2026-09-01', '2026-09-02', '2026-09-03'], ROQUE, signal)).toThrow(
      /abort/i,
    )
    expect(reads).toBeGreaterThan(1)
  })

  it('scores every requested night exactly once and keeps no date behind', () => {
    const dates = isoDateRange('2026-09-01', '2026-09-07')
    const r = rankNights(dates, ROQUE)
    expect(r).toHaveLength(dates.length)
    expect([...r.map((x) => x.nightOf)].sort()).toEqual(dates)
  })

  it('score is round(min(100, 10 * usableHours)) and stays in 0..100', () => {
    const r = rankNights(isoDateRange('2026-09-01', '2026-09-10'), ROQUE)
    for (const night of r) {
      const expected =
        night.usableHours === null ? 0 : Math.round(Math.min(100, 10 * night.usableHours))
      expect(night.score).toBe(expected)
      expect(night.score).toBeGreaterThanOrEqual(0)
      expect(night.score).toBeLessThanOrEqual(100)
    }
  })

  it('sorts best first and breaks ties by the earlier date', () => {
    const r = rankNights(isoDateRange('2026-08-31', '2026-09-14'), ROQUE)
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score)
      if (r[i - 1].score === r[i].score) {
        expect(r[i - 1].nightOf < r[i].nightOf).toBe(true)
      }
    }
  })

  it('reports usable hours that never exceed the darkness window', () => {
    const r = rankNights(isoDateRange('2026-09-01', '2026-09-08'), ROQUE)
    for (const night of r) {
      expect(night.darknessStatus).toBe('ok')
      expect(night.darkHours).toBeGreaterThan(7)
      expect(night.moonFreeHours!).toBeLessThanOrEqual(night.darkHours! + 1e-9)
      expect(night.usableHours!).toBeGreaterThanOrEqual(night.moonFreeHours! - 1e-9)
      expect(night.usableHours!).toBeLessThanOrEqual(night.darkHours! + 1e-9)
      expect(night.moonIlluminationPct).toBeGreaterThanOrEqual(0)
      expect(night.moonIlluminationPct).toBeLessThanOrEqual(100)
    }
  })

  it('explains a Moon free night in one quotable sentence', () => {
    const r = rankNights(isoDateRange('2026-09-08', '2026-09-14'), ROQUE)
    const best = r[0]
    expect(best.explanation).toMatch(
      /^\d+\.\d usable dark hours \(Moon \d+%, below the horizon all night\)$/,
    )
    expect(best.explanation).not.toMatch(/—/)
  })

  it('explains a Moon soaked night with the hours the Moon is up', () => {
    const [night] = rankNights(['2026-08-29'], ROQUE)
    expect(night.moonIlluminationPct).toBeGreaterThan(50)
    expect(night.explanation).toMatch(/^\d+\.\d usable dark hours \(Moon \d+%, above the horizon/)
  })

  it('gives no astronomical darkness a score of 0 and says so', () => {
    const [night] = rankNights(['2026-06-21'], TROMSO)
    expect(night.darknessStatus).toBe('no_astronomical_darkness')
    expect(night.score).toBe(0)
    expect(night.darkHours).toBeNull()
    expect(night.moonFreeHours).toBeNull()
    expect(night.usableHours).toBeNull()
    expect(night.explanation).toBe('0 usable hours: no astronomical darkness')
  })

  it('caps continuous polar darkness at 100', () => {
    // New Moon of 2026-12-09 under the polar night: 24 dark hours, 240 raw points.
    const [night] = rankNights(['2026-12-09'], POLE)
    expect(night.darknessStatus).toBe('continuous_darkness')
    expect(night.darkHours).toBe(24)
    expect(night.usableHours).toBe(24)
    expect(night.score).toBe(100)
    expect(night.explanation).toMatch(/^24\.0 usable hours of continuous darkness \(Moon \d+%,/)
  })

  it('matches the sentence quoted in the plan for the golden night', () => {
    const [night] = rankNights(['2026-09-12'], ROQUE)
    expect(night.explanation).toBe('8.9 usable dark hours (Moon 4%, below the horizon all night)')
    expect(night.score).toBe(89)
  })

  it('returns an empty list for an empty range', () => {
    expect(rankNights([], ROQUE)).toEqual([])
  })

  it('is deterministic with a cold cache', () => {
    const dates = isoDateRange('2026-09-01', '2026-09-04')
    const first = rankNights(dates, ROQUE)
    clearNightCache()
    const second = rankNights(dates, ROQUE)
    expect(second).toEqual(first)
  })

  it('ranks a 62 night range well under a second on a warm cache', () => {
    const dates = isoDateRange('2026-09-01', '2026-10-31')
    rankNights(dates, ROQUE)
    const started = performance.now()
    rankNights(dates, ROQUE)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
