import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetStore, store } from '../state/store'
import type { ToolError, ToolOk } from './envelope'
import { getNightEphemerisTool, type NightEphemerisData } from './getNightEphemeris'

type Result = ToolOk<NightEphemerisData> | ToolError

async function call(input: Record<string, unknown> = {}): Promise<Result> {
  return (await getNightEphemerisTool.execute(input, {})) as Result
}

function expectOk(result: Result): ToolOk<NightEphemerisData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

const MAUNA_KEA = { latitude: 19.8207, longitude: -155.4681 }

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: '2026-09-02' })
})

describe('the declaration an agent reads', () => {
  it('is a read-only, closed-world, idempotent tool with the planned name', () => {
    expect(getNightEphemerisTool.name).toBe('get_night_ephemeris')
    expect(getNightEphemerisTool.title).toBe('Night ephemeris: darkness window, Sun and Moon')
    expect(getNightEphemerisTool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    })
  })

  it('says out loud that it has no weather in it', () => {
    expect(getNightEphemerisTool.description).toMatch(/does NOT include weather/)
    expect(getNightEphemerisTool.description).toMatch(/compare_dark_sky_sites/)
  })

  it('has an input schema Ajv accepts and that closes the door on extra keys', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(getNightEphemerisTool.inputSchema!)
    expect(validate({})).toBe(true)
    expect(validate({ date: '2026-09-12' })).toBe(true)
    expect(validate({ site: { latitude: 19.8207, longitude: -155.4681, time_zone: 'Pacific/Honolulu' } })).toBe(true)
    expect(validate({ date: '12/09/2026' })).toBe(false)
    expect(validate({ site: { latitude: 19.8207 } })).toBe(false)
    expect(validate({ moon: true })).toBe(false)
  })
})

describe('the golden night at the Roque', () => {
  it('returns the darkness window in UTC and in local time', async () => {
    const result = expectOk(await call({ date: '2026-09-02' }))
    const { data } = result

    expect(data.night_of).toBe('2026-09-02')
    expect(data.time_zone).toBe('Atlantic/Canary')
    expect(data.sun.status).toBe('normal')
    expect(data.darkness.status).toBe('ok')
    expect(data.darkness.start.utc).toMatch(/^2026-09-02T20:52:5/)
    expect(data.darkness.start.local).toBe('2026-09-02 21:52')
    expect(data.darkness.end.utc).toMatch(/^2026-09-03T05:29:3/)
    expect(data.darkness.end.local).toBe('2026-09-03 06:29')
    expect(data.darkness.hours).toBeCloseTo(8.61, 1)
    expect(data.moon.illumination_pct).toBe(66)
    expect(data.moon.rise.utc).toMatch(/^2026-09-02T22:43:3/)
    expect(data.moon.rise.local).toBe('2026-09-02 23:43')
    expect(data.sun.sunset.utc).not.toBeNull()
    expect(data.sun.nautical_dusk.utc).not.toBeNull()
    expect(data.darkness.moon_free_intervals.length).toBeGreaterThan(0)
    expect(result.caveats).toEqual([])
    expect(result.site.id).toBe('roque')
  })

  it('quotes local times first and the UTC ones in parentheses', async () => {
    const { summary } = expectOk(await call({ date: '2026-09-02' }))
    expect(summary).toContain('Night of 2026-09-02')
    expect(summary).toContain('Roque de los Muchachos')
    expect(summary).toContain('21:52')
    expect(summary).toContain('06:29')
    expect(summary).toContain('(20:52')
    expect(summary).toContain('05:29 UTC')
    expect(summary).toContain('8.6 h')
    expect(summary).toContain('66%')
    expect(summary).toMatch(/Moon-free/)
    expect(summary).not.toContain('—')
  })

  it('defaults to the night and site currently shown in the app', async () => {
    const { data } = expectOk(await call())
    expect(data.night_of).toBe('2026-09-02')
    store.setState({ nightOf: '2026-09-12' })
    expect(expectOk(await call()).data.night_of).toBe('2026-09-12')
  })
})

describe('sites the app was not built around', () => {
  it('infers the zone of coordinates that land on a catalog site, and says so', async () => {
    const result = expectOk(await call({ date: '2026-09-02', site: MAUNA_KEA }))
    expect(result.data.time_zone).toBe('Pacific/Honolulu')
    expect(result.site.time_zone).toBe('Pacific/Honolulu')
    expect(result.caveats.join(' ')).toMatch(/inferred from nearby site/i)
    expect(result.data.darkness.start.local).toMatch(/^2026-09-02 \d\d:\d\d$/)
  })

  it('never invents a zone: no zone means UTC only, plus a caveat and a UTC summary', async () => {
    const result = expectOk(await call({ date: '2026-09-02', site: { latitude: 0, longitude: 0 } }))
    expect(result.data.time_zone).toBeNull()
    expect(result.data.darkness.start.local).toBeNull()
    expect(result.data.darkness.end.local).toBeNull()
    expect(result.data.moon.rise.local).toBeNull()
    expect(result.caveats.join(' ')).toMatch(/Local times omitted/)
    expect(result.summary).toContain('UTC')
    expect(result.summary).not.toContain('local')
  })

  it('honours an explicit time zone', async () => {
    const result = expectOk(
      await call({ date: '2026-09-02', site: { ...MAUNA_KEA, time_zone: 'Pacific/Honolulu', name: 'Mauna Kea' } }),
    )
    expect(result.site.name).toBe('Mauna Kea')
    expect(result.caveats).toEqual([])
  })
})

describe('refusals', () => {
  it('rejects a date that passes a regex but is not a day', async () => {
    const result = await call({ date: '2026-13-99' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_date')
    expect(result.error.hint).toMatch(/YYYY-MM-DD/)
  })

  it('rejects half a coordinate pair', async () => {
    const result = await call({ site: { latitude: 10 } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_site')
  })

  it('rejects a time zone no browser knows', async () => {
    const result = await call({ site: { latitude: 10, longitude: 20, time_zone: 'Mars/Olympus' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_time_zone')
  })
})

describe('places where the night is not a night', () => {
  it('is explicit about a Sun that never sets', async () => {
    const result = expectOk(
      await call({
        date: '2026-06-21',
        site: { latitude: 69.6492, longitude: 18.9553, time_zone: 'Europe/Oslo', name: 'Tromso' },
      }),
    )
    expect(result.data.sun.status).toBe('never_sets')
    expect(result.data.darkness.status).toBe('no_astronomical_darkness')
    expect(result.data.darkness.hours).toBeNull()
    expect(result.summary).toMatch(/never sets/)
  })

  it('is explicit about darkness that never ends', async () => {
    const result = expectOk(
      await call({ date: '2026-12-21', site: { latitude: 88, longitude: 0, time_zone: 'UTC' } }),
    )
    expect(result.data.darkness.status).toBe('continuous_darkness')
    expect(result.data.darkness.hours).toBe(24)
    expect(result.summary).toMatch(/[Cc]ontinuous/)
  })
})
