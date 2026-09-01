import { describe, expect, it } from 'vitest'

import {
  EMPTY,
  fmtAirmass,
  fmtDeg,
  fmtDuration,
  fmtHours,
  fmtLocal,
  fmtMag,
  fmtMinutes,
  fmtPct,
  fmtTimeRange,
  fmtUtc,
  phaseGlyph,
  plural,
  truncate,
  zoneLabel,
} from './format'

describe('clock formatting', () => {
  it('formats UTC and the site zone', () => {
    expect(fmtUtc('2026-09-02T20:52:50Z')).toBe('20:52')
    expect(fmtUtc('2026-09-02T20:52:50Z', { withDate: true })).toBe('2026-09-02 20:52')
    expect(fmtLocal('2026-09-02T20:52:50Z', 'Atlantic/Canary')).toBe('21:52')
    expect(fmtLocal('2026-09-02T20:52:50Z', 'Pacific/Honolulu', { withDate: true })).toBe(
      '2026-09-02 10:52',
    )
  })

  it('falls back to UTC when the site has no zone', () => {
    expect(fmtLocal('2026-09-02T20:52:50Z', null)).toBe('20:52')
    expect(zoneLabel(null)).toBe('UTC')
    expect(zoneLabel('Atlantic/Canary')).toBe('Atlantic/Canary')
  })

  it('renders missing instants as the empty marker', () => {
    expect(fmtUtc(null)).toBe(EMPTY)
    expect(fmtLocal(null, 'Atlantic/Canary')).toBe(EMPTY)
    expect(fmtLocal(undefined, null)).toBe(EMPTY)
  })

  it('joins a range with a single dash', () => {
    expect(fmtTimeRange('2026-09-02T20:52:50Z', '2026-09-03T04:59:00Z', 'Atlantic/Canary')).toBe(
      '21:52-05:59',
    )
    expect(fmtTimeRange(null, null, null)).toBe(`${EMPTY}-${EMPTY}`)
  })
})

describe('numbers', () => {
  it('formats hours, degrees, percentages, airmass and magnitude', () => {
    expect(fmtHours(3)).toBe('3.0 h')
    expect(fmtHours(3.456, 2)).toBe('3.46 h')
    expect(fmtHours(null)).toBe(EMPTY)
    expect(fmtDeg(41.269)).toBe('41.3°')
    expect(fmtDeg(-0.04)).toBe('-0.0°')
    expect(fmtDeg(Number.NaN)).toBe(EMPTY)
    expect(fmtPct(66.4)).toBe('66%')
    expect(fmtPct(null)).toBe(EMPTY)
    expect(fmtAirmass(1.4142)).toBe('1.41')
    expect(fmtAirmass(null)).toBe(EMPTY)
    expect(fmtMag(5.75)).toBe('mag 5.8')
    expect(fmtMag(null)).toBe(EMPTY)
  })

  it('formats durations for the activity log', () => {
    expect(fmtDuration(312)).toBe('312 ms')
    expect(fmtDuration(0)).toBe('0 ms')
    expect(fmtDuration(1400)).toBe('1.4 s')
    expect(fmtDuration(125_000)).toBe('2m 05s')
    expect(fmtDuration(undefined)).toBe(EMPTY)
    expect(fmtDuration(-5)).toBe(EMPTY)
  })

  it('formats block lengths', () => {
    expect(fmtMinutes(45)).toBe('45 min')
    expect(fmtMinutes(60)).toBe('1 h')
    expect(fmtMinutes(75)).toBe('1 h 15 min')
    expect(fmtMinutes(null)).toBe(EMPTY)
  })
})

describe('phaseGlyph', () => {
  it('maps the eight phase names', () => {
    expect(phaseGlyph('new moon')).toBe('🌑')
    expect(phaseGlyph('waxing crescent')).toBe('🌒')
    expect(phaseGlyph('first quarter')).toBe('🌓')
    expect(phaseGlyph('waxing gibbous')).toBe('🌔')
    expect(phaseGlyph('full moon')).toBe('🌕')
    expect(phaseGlyph('waning gibbous')).toBe('🌖')
    expect(phaseGlyph('third quarter')).toBe('🌗')
    expect(phaseGlyph('waning crescent')).toBe('🌘')
  })

  it('is case insensitive and safe on junk', () => {
    expect(phaseGlyph('Full Moon')).toBe('🌕')
    expect(phaseGlyph('gibbous?')).toBe('●')
    expect(phaseGlyph(null)).toBe('●')
  })
})

describe('text helpers', () => {
  it('truncates with an ellipsis', () => {
    expect(truncate('Andromeda', 20)).toBe('Andromeda')
    expect(truncate('Andromeda Galaxy', 10)).toBe('Androme...')
    expect(truncate('abc', 2)).toBe('ab')
  })

  it('pluralizes', () => {
    expect(plural(1, 'item')).toBe('item')
    expect(plural(2, 'item')).toBe('items')
    expect(plural(0, 'entry', 'entries')).toBe('entries')
  })
})
