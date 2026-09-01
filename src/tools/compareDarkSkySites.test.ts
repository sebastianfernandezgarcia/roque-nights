import { Ajv } from 'ajv'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DARK_SKY_SITES } from '../data/sites'
import { resetStore, store } from '../state/store'
import type { ToolError, ToolOk } from './envelope'
import {
  compareDarkSkySitesTool,
  type CompareDarkSkySitesData,
} from './compareDarkSkySites'

type Result = ToolOk<CompareDarkSkySitesData> | ToolError

async function call(input: Record<string, unknown> = {}): Promise<Result> {
  return (await compareDarkSkySitesTool.execute(input, {})) as Result
}

function expectOk(result: Result): ToolOk<CompareDarkSkySitesData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

/**
 * Open-Meteo, as it really answers: one entry per coordinate, hourly arrays that
 * cover the requested date range. Cloud cover is per site so ranking is testable.
 */
function forecastMock(cloudBySite: number[]) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input))
    const latitudes = url.searchParams.get('latitude')!.split(',')
    const startMs = Date.parse(`${url.searchParams.get('start_date')}T00:00:00Z`)
    const endMs = Date.parse(`${url.searchParams.get('end_date')}T23:00:00Z`)
    const slots = Math.round((endMs - startMs) / 3_600_000) + 1

    const payload = latitudes.map((_, index) => {
      const cover = cloudBySite[index % cloudBySite.length]
      const time: string[] = []
      const cloud: number[] = []
      for (let h = 0; h < slots; h++) {
        time.push(new Date(startMs + h * 3_600_000).toISOString().slice(0, 16))
        cloud.push(cover)
      }
      return {
        hourly: {
          time,
          cloud_cover: cloud,
          relative_humidity_2m: cloud.map(() => 50),
          wind_speed_10m: cloud.map(() => 10),
          wind_speed_200hPa: cloud.map(() => 60),
          relative_humidity_700hPa: cloud.map(() => 20),
        },
      }
    })
    return new Response(JSON.stringify(payload), { status: 200 })
  })
}

const THREE = { site_ids: ['roque', 'paranal', 'siding-spring'], include_current_site: false }

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: '2026-09-02' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the declaration an agent reads', () => {
  it('is the one tool that admits it touches the network', () => {
    expect(compareDarkSkySitesTool.name).toBe('compare_dark_sky_sites')
    expect(compareDarkSkySitesTool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: false,
    })
    expect(compareDarkSkySitesTool.description).toMatch(/ONLY tool that calls an external service/)
    expect(compareDarkSkySitesTool.description).toMatch(/Open-Meteo/)
  })

  it('has an input schema Ajv accepts and that closes the door on extra keys', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(compareDarkSkySitesTool.inputSchema!)
    expect(validate({})).toBe(true)
    expect(
      validate({
        date: '2026-09-02',
        site_ids: ['roque', 'paranal'],
        include_current_site: false,
        include_weather: true,
        limit: 5,
      }),
    ).toBe(true)
    expect(validate({ limit: 99 })).toBe(false)
    expect(validate({ include_weather: 'yes' })).toBe(false)
    expect(validate({ continent: 'Europe' })).toBe(false)
  })
})

describe('with a live forecast', () => {
  it('merges one multi-coordinate request into the ephemeris of every site', async () => {
    const fetchMock = forecastMock([0, 50, 100])
    vi.stubGlobal('fetch', fetchMock)

    const result = expectOk(await call(THREE))
    const { data } = result

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('latitude')!.split(',')).toHaveLength(3)
    expect(url.searchParams.get('timezone')).toBe('UTC')

    expect(data.night_of).toBe('2026-09-02')
    expect(data.weather_source).toBe('open-meteo')
    expect(data.sites_evaluated).toBe(3)
    expect(data.sites).toHaveLength(3)

    for (const site of data.sites) {
      expect(site.weather?.source).toBe('open-meteo')
      expect(site.usable_hours).not.toBeNull()
      expect(site.darkness.start.utc).not.toBeNull()
      expect(site.rank_score).toBeGreaterThan(0)
    }
    for (let i = 1; i < data.sites.length; i++) {
      expect(data.sites[i - 1].rank_score).toBeGreaterThanOrEqual(data.sites[i].rank_score)
    }

    const roque = data.sites.find((s) => s.id === 'roque')!
    expect(roque.country).toBe('ES')
    expect(roque.time_zone).toBe('Atlantic/Canary')
    expect(roque.weather!.clear_fraction).toBe(1)
    expect(roque.rank_score).toBeCloseTo(roque.usable_hours!, 1)

    const overcast = data.sites.find((s) => s.weather!.clear_fraction === 0)!
    expect(overcast.rank_score).toBeCloseTo(overcast.usable_hours! * 0.4, 1)
  }, 30_000)

  it('says "live forecast" and names the top sites with their numbers', async () => {
    vi.stubGlobal('fetch', forecastMock([0, 50, 100]))
    const result = expectOk(await call(THREE))
    expect(result.summary).toContain('live forecast')
    expect(result.summary).toContain('2026-09-02')
    expect(result.summary).toContain(result.data.sites[0].name)
    expect(result.summary).toMatch(/usable dark hours/)
    expect(result.summary).toMatch(/% mean cloud cover/)
    expect(result.summary).toMatch(/score \d/)
  }, 30_000)

  it('compares the whole catalog when no ids are given', async () => {
    vi.stubGlobal('fetch', forecastMock([10]))
    const result = expectOk(await call({ limit: 30 }))
    expect(result.data.sites_evaluated).toBe(DARK_SKY_SITES.length)
    expect(result.data.sites.length + result.rejected.length).toBe(DARK_SKY_SITES.length)
  }, 60_000)
})

describe('when the network fails', () => {
  it('falls back to the baked snapshot, says so in the summary and in a caveat', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = expectOk(await call(THREE))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.data.weather_source).toBe('cached')
    expect(result.summary).toContain('cached forecast')
    expect(result.caveats.join(' ')).toMatch(/cached/i)
    for (const site of result.data.sites) expect(site.weather?.source).toBe('cached')
  }, 30_000)
})

describe('without weather', () => {
  it('ranks on usable dark hours alone and never touches the network', async () => {
    const fetchMock = forecastMock([0])
    vi.stubGlobal('fetch', fetchMock)

    const result = expectOk(await call({ ...THREE, include_weather: false }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.data.weather_source).toBe('none')
    for (const site of result.data.sites) {
      expect(site.weather).toBeNull()
      expect(site.rank_score).toBeCloseTo(site.usable_hours ?? 0, 2)
    }
  }, 30_000)
})

describe('choosing the sites', () => {
  it('rejects an id that is not in the catalog', async () => {
    vi.stubGlobal('fetch', forecastMock([0]))
    const result = expectOk(await call({ site_ids: ['roque', 'atlantis'], include_current_site: false }))
    expect(result.data.sites.map((s) => s.id)).toEqual(['roque'])
    expect(result.rejected).toContainEqual({
      id: 'atlantis',
      name: 'atlantis',
      reason: 'unknown dark-sky site',
    })
  }, 30_000)

  it('adds the site currently shown in the app when asked to', async () => {
    vi.stubGlobal('fetch', forecastMock([0]))
    store.setState({
      site: {
        id: null,
        name: 'My backyard',
        latitude: 40.4,
        longitude: -3.7,
        elevationM: 650,
        timeZone: 'Europe/Madrid',
      },
    })
    const result = expectOk(await call({ site_ids: ['roque'], include_current_site: true }))
    expect(result.data.sites.map((s) => s.name)).toContain('My backyard')
    expect(result.data.sites_evaluated).toBe(2)
    const backyard = result.data.sites.find((s) => s.name === 'My backyard')!
    expect(backyard.weather).not.toBeNull()
  }, 30_000)

  it('does not list the current site twice when it is already in the catalog', async () => {
    vi.stubGlobal('fetch', forecastMock([0]))
    const result = expectOk(await call({ site_ids: ['roque'], include_current_site: true }))
    expect(result.data.sites_evaluated).toBe(1)
  }, 30_000)

  it('honours limit while still saying how many sites it looked at', async () => {
    vi.stubGlobal('fetch', forecastMock([0, 50, 100]))
    const result = expectOk(await call({ ...THREE, limit: 2 }))
    expect(result.data.sites).toHaveLength(2)
    expect(result.data.sites_evaluated).toBe(3)
  }, 30_000)

  it('resolves a site by name as well as by id', async () => {
    vi.stubGlobal('fetch', forecastMock([0]))
    const result = expectOk(
      await call({ site_ids: ['Mauna Kea'], include_current_site: false }),
    )
    expect(result.data.sites[0].id).toBe('mauna-kea')
  }, 30_000)
})

describe('nights that are not dark', () => {
  it('rejects a site with no astronomical darkness instead of ranking it', async () => {
    vi.stubGlobal('fetch', forecastMock([0]))
    const result = expectOk(
      await call({ date: '2026-06-21', site_ids: ['jasper'], include_current_site: false }),
    )
    expect(result.data.sites).toHaveLength(0)
    expect(result.rejected[0].id).toBe('jasper')
    expect(result.rejected[0].reason).toMatch(/no astronomical darkness/i)
    expect(result.summary).toMatch(/No .*site/i)
  }, 30_000)
})

describe('refusals', () => {
  it('rejects an impossible date and a bad limit', async () => {
    const bad = await call({ date: '2026-02-30' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('invalid_date')

    const badLimit = await call({ limit: 0 })
    expect(badLimit.ok).toBe(false)
    if (!badLimit.ok) expect(badLimit.error.code).toBe('invalid_input')

    const badIds = await call({ site_ids: 'roque' })
    expect(badIds.ok).toBe(false)
    if (!badIds.ok) expect(badIds.error.code).toBe('invalid_input')
  })
})
