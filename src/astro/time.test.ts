import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  HOUR_MS,
  addDays,
  formatInZone,
  isValidTimeZone,
  isoDateRange,
  localDate,
  localNoonUtc,
  localStamp,
  parseIsoDate,
  roundTo,
  timeZoneOffsetMinutes,
} from './time'

describe('parseIsoDate', () => {
  it('accepts real calendar dates', () =>
    expect(parseIsoDate('2026-09-02')).toEqual({ year: 2026, month: 9, day: 2 }))

  it('rejects impossible dates that pass a regex', () => {
    expect(parseIsoDate('2026-13-99')).toBeNull()
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('2026-9-2')).toBeNull()
    expect(parseIsoDate('2026-09-02T00:00')).toBeNull()
    expect(parseIsoDate(20260902)).toBeNull()
    expect(parseIsoDate('1800-01-01')).toBeNull()
  })

  it('accepts leap day', () => expect(parseIsoDate('2028-02-29')).not.toBeNull())

  it('rejects non-leap 29 February, blanks and non-strings', () => {
    expect(parseIsoDate('2026-02-29')).toBeNull()
    expect(parseIsoDate('2026-09-02 ')).toBeNull()
    expect(parseIsoDate('')).toBeNull()
    expect(parseIsoDate(null)).toBeNull()
    expect(parseIsoDate(undefined)).toBeNull()
    expect(parseIsoDate({ year: 2026 })).toBeNull()
    expect(parseIsoDate('2101-01-01')).toBeNull()
  })

  it('accepts the range bounds', () => {
    expect(parseIsoDate('1900-01-01')).toEqual({ year: 1900, month: 1, day: 1 })
    expect(parseIsoDate('2100-12-31')).toEqual({ year: 2100, month: 12, day: 31 })
  })
})

describe('time zones', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone('Atlantic/Canary')).toBe(true)
    expect(isValidTimeZone('Pacific/Honolulu')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone(42)).toBe(false)
    expect(isValidTimeZone(null)).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('formats in a zone', () => {
    expect(formatInZone('2026-09-02T20:52:50Z', 'Atlantic/Canary')).toBe('21:52')
    expect(formatInZone('2026-09-02T20:52:50Z', 'Atlantic/Canary', { withDate: true })).toBe(
      '2026-09-02 21:52',
    )
    expect(formatInZone(null, 'Atlantic/Canary')).toBe('—')
  })

  it('formats midnight as 00:00 and rolls the date over', () => {
    expect(formatInZone('2026-09-02T23:00:00Z', 'Atlantic/Canary')).toBe('00:00')
    expect(formatInZone('2026-09-02T23:30:00Z', 'Atlantic/Canary', { withDate: true })).toBe(
      '2026-09-03 00:30',
    )
    expect(formatInZone('2026-09-02T20:52:50Z', 'UTC')).toBe('20:52')
  })

  it('knows offsets', () => {
    expect(timeZoneOffsetMinutes('Atlantic/Canary', new Date('2026-09-02T12:00:00Z'))).toBe(60)
    expect(timeZoneOffsetMinutes('Pacific/Honolulu', new Date('2026-09-02T12:00:00Z'))).toBe(-600)
  })

  it('knows half-hour offsets and winter offsets', () => {
    expect(timeZoneOffsetMinutes('Asia/Kolkata', new Date('2026-09-02T12:00:00Z'))).toBe(330)
    expect(timeZoneOffsetMinutes('Atlantic/Canary', new Date('2026-12-21T12:00:00Z'))).toBe(0)
    expect(timeZoneOffsetMinutes('UTC', new Date('2026-09-02T12:00:00Z'))).toBe(0)
  })

  it('local noon uses the zone when known and longitude otherwise', () => {
    expect(
      localNoonUtc('2026-09-02', { longitude: -17.8851, timeZone: 'Atlantic/Canary' }).toISOString(),
    ).toBe('2026-09-02T11:00:00.000Z')
    // Mauna Kea, no zone: 12:00Z + 155.4681/15 h = 22:21:52Z (solar noon)
    const t = localNoonUtc('2026-09-02', { longitude: -155.4681, timeZone: null })
    expect(Math.abs(t.getTime() - Date.parse('2026-09-02T22:21:52Z'))).toBeLessThan(2000)
  })

  it('local noon in winter and in a far western zone', () => {
    expect(
      localNoonUtc('2026-12-21', { longitude: -17.8851, timeZone: 'Atlantic/Canary' }).toISOString(),
    ).toBe('2026-12-21T12:00:00.000Z')
    expect(
      localNoonUtc('2026-09-02', { longitude: -155.4681, timeZone: 'Pacific/Honolulu' }).toISOString(),
    ).toBe('2026-09-02T22:00:00.000Z')
  })

  it('local noon falls back to solar noon for an unusable zone', () => {
    const t = localNoonUtc('2026-09-02', { longitude: 0, timeZone: 'Mars/Olympus' })
    expect(t.toISOString()).toBe('2026-09-02T12:00:00.000Z')
  })

  it('localStamp is null without a zone', () => {
    expect(localStamp('2026-09-02T20:52:50Z', null)).toBeNull()
    expect(localStamp('2026-09-02T20:52:50Z', 'Atlantic/Canary')).toBe('2026-09-02 21:52')
    expect(localStamp(null, 'Atlantic/Canary')).toBeNull()
  })

  it('localDate reads the calendar day in the zone', () => {
    expect(localDate('Atlantic/Canary', new Date('2026-09-02T23:30:00Z'))).toBe('2026-09-03')
    expect(localDate(null, new Date('2026-09-02T23:30:00Z'))).toBe('2026-09-02')
    expect(localDate('Pacific/Honolulu', new Date('2026-09-02T05:00:00Z'))).toBe('2026-09-01')
  })
})

describe('ranges', () => {
  it('builds inclusive ranges and caps them', () => {
    expect(isoDateRange('2026-08-31', '2026-09-02')).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
    expect(() => isoDateRange('2026-01-01', '2026-12-31')).toThrow(RangeError)
    expect(() => isoDateRange('2026-09-02', '2026-09-01')).toThrow(RangeError)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('honours a custom cap and rejects invalid endpoints', () => {
    expect(isoDateRange('2026-08-31', '2026-09-02', 3)).toHaveLength(3)
    expect(() => isoDateRange('2026-08-31', '2026-09-03', 3)).toThrow(RangeError)
    expect(() => isoDateRange('2026-13-01', '2026-09-03')).toThrow(RangeError)
    expect(() => isoDateRange('2026-09-01', 'tomorrow')).toThrow(RangeError)
    expect(isoDateRange('2026-09-02', '2026-09-02')).toEqual(['2026-09-02'])
  })

  it('adds days across month and leap boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-09-02', 0)).toBe('2026-09-02')
    expect(() => addDays('2026-99-99', 1)).toThrow(RangeError)
  })
})

describe('numbers and constants', () => {
  it('rounds to a number of decimals', () => {
    expect(roundTo(8.6123, 2)).toBe(8.61)
    expect(roundTo(66.666, 1)).toBe(66.7)
    expect(roundTo(2.5, 0)).toBe(3)
    expect(roundTo(-2.345, 2)).toBe(-2.35)
    expect(roundTo(Number.NaN, 2)).toBeNaN()
  })

  it('exposes millisecond constants', () => {
    expect(HOUR_MS).toBe(3_600_000)
    expect(DAY_MS).toBe(86_400_000)
  })
})
