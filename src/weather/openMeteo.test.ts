import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CLEAR_SKY_CLOUD_COVER_PCT,
  HOURLY_VARIABLES,
  OPEN_METEO_ENDPOINT,
  WEATHER_TIMEOUT_MS,
  buildForecastUrl,
  cachedNightWeather,
  fetchNightWeather,
  type WeatherSiteQuery,
} from './openMeteo'
import snapshot from './snapshot.json'

const DARKNESS = { startUtc: '2026-09-02T21:00:00Z', endUtc: '2026-09-03T03:00:00Z' }

const THREE_SITES: WeatherSiteQuery[] = [
  { id: 'roque', latitude: 28.7542, longitude: -17.8851, nightOf: '2026-09-02', darkness: DARKNESS },
  { id: 'teide', latitude: 28.3005, longitude: -16.5097, nightOf: '2026-09-02', darkness: DARKNESS },
  { id: 'calar-alto', latitude: 37.2236, longitude: -2.5461, nightOf: '2026-09-02', darkness: DARKNESS },
]

/** 48 hourly slots from 2026-09-02T00:00Z, so the darkness above covers exactly 6 of them. */
function hourlyBlock(cloudAt: (hourIndex: number) => number) {
  const time: string[] = []
  const cloud: number[] = []
  for (let i = 0; i < 48; i++) {
    const at = new Date(Date.parse('2026-09-02T00:00:00Z') + i * 3_600_000)
    time.push(at.toISOString().slice(0, 16))
    cloud.push(cloudAt(i))
  }
  return {
    hourly: {
      time,
      cloud_cover: cloud,
      relative_humidity_2m: cloud.map(() => 40),
      wind_speed_10m: cloud.map(() => 12),
      wind_speed_200hPa: cloud.map(() => 80),
      relative_humidity_700hPa: cloud.map(() => 15),
    },
  }
}

/** Daylight hours are overcast, the six dark hours are not: only the dark ones must count. */
function nightPayload(darkCloud: number[]) {
  return hourlyBlock((i) => {
    const darkIndex = i - 21 // 21:00, 22:00, 23:00, 00:00, 01:00, 02:00
    return darkIndex >= 0 && darkIndex < 6 ? darkCloud[darkIndex] : 100
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildForecastUrl', () => {
  it('asks for every site in one multi-coordinate request', () => {
    const url = new URL(buildForecastUrl(THREE_SITES, DARKNESS))
    expect(`${url.origin}${url.pathname}`).toBe(OPEN_METEO_ENDPOINT)
    expect(url.searchParams.get('latitude')).toBe('28.7542,28.3005,37.2236')
    expect(url.searchParams.get('longitude')).toBe('-17.8851,-16.5097,-2.5461')
    expect(url.searchParams.get('hourly')).toBe(HOURLY_VARIABLES.join(','))
    expect(url.searchParams.get('timezone')).toBe('UTC')
    expect(url.searchParams.get('start_date')).toBe('2026-09-02')
    expect(url.searchParams.get('end_date')).toBe('2026-09-03')
  })

  it('spans every site darkness window, not just the shared one', () => {
    const url = new URL(
      buildForecastUrl(
        [
          { id: 'a', latitude: 0, longitude: 0, darkness: DARKNESS },
          {
            id: 'b',
            latitude: 1,
            longitude: 1,
            darkness: { startUtc: '2026-09-01T22:00:00Z', endUtc: '2026-09-04T04:00:00Z' },
          },
        ],
        DARKNESS,
      ),
    )
    expect(url.searchParams.get('start_date')).toBe('2026-09-01')
    expect(url.searchParams.get('end_date')).toBe('2026-09-04')
  })
})

describe('fetchNightWeather with a live answer', () => {
  it('averages only the hours inside darkness, for an array payload of 3 sites', async () => {
    const payload = [
      nightPayload([0, 10, 20, 20, 10, 0]),
      nightPayload([40, 40, 40, 40, 40, 40]),
      nightPayload([100, 100, 100, 100, 100, 100]),
    ]
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const weather = await fetchNightWeather(THREE_SITES, DARKNESS)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const roque = weather.roque!
    expect(roque.source).toBe('open-meteo')
    expect(roque.hours).toBe(6)
    expect(roque.cloud_cover_pct_mean).toBe(10)
    expect(roque.cloud_cover_pct_max).toBe(20)
    expect(roque.clear_fraction).toBe(1)
    expect(roque.humidity_2m_pct_mean).toBe(40)
    expect(roque.wind_10m_kmh_mean).toBe(12)
    expect(roque.wind_200hpa_kmh_mean).toBe(80)
    expect(roque.humidity_700hpa_pct_mean).toBe(15)
    expect(weather['teide']!.clear_fraction).toBe(0)
    expect(weather['calar-alto']!.cloud_cover_pct_mean).toBe(100)
  })

  it('accepts the bare object Open-Meteo returns for a single site', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(nightPayload([5, 5, 5, 5, 5, 5])), { status: 200 })),
    )
    const weather = await fetchNightWeather([THREE_SITES[0]], DARKNESS)
    expect(weather.roque?.source).toBe('open-meteo')
    expect(weather.roque?.cloud_cover_pct_mean).toBe(5)
  })

  it('counts an hour as clear below the clear-sky threshold', async () => {
    const edge = CLEAR_SKY_CLOUD_COVER_PCT
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(nightPayload([0, 0, 0, edge, edge, edge])), { status: 200 }),
      ),
    )
    const weather = await fetchNightWeather([THREE_SITES[0]], DARKNESS)
    expect(weather.roque?.clear_fraction).toBe(0.5)
  })

  it('sends the caller signal and a 6 s timeout', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify(nightPayload([0, 0, 0, 0, 0, 0])), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(WEATHER_TIMEOUT_MS).toBe(6000)
    await fetchNightWeather([THREE_SITES[0]], DARKNESS, new AbortController().signal)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('fetchNightWeather falling back to the baked snapshot', () => {
  it('uses the cached forecast when the network throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const weather = await fetchNightWeather(THREE_SITES, DARKNESS)
    for (const id of ['roque', 'teide', 'calar-alto']) {
      expect(weather[id]?.source).toBe('cached')
      expect(weather[id]?.note).toMatch(/cached/i)
    }
    expect(weather.roque?.cloud_cover_pct_mean).toBe(
      snapshot.sites.roque['2026-09-02'].cloud_cover_pct_mean,
    )
  })

  it('uses the cached forecast when the service answers with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))
    const weather = await fetchNightWeather([THREE_SITES[0]], DARKNESS)
    expect(weather.roque?.source).toBe('cached')
    expect(weather.roque?.note).toMatch(/429/)
  })

  it('uses the cached forecast when the payload is not the shape we expect', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: true }), { status: 200 })))
    const weather = await fetchNightWeather([THREE_SITES[0]], DARKNESS)
    expect(weather.roque?.source).toBe('cached')
  })

  it('degrades to the snapshot when hourly.time holds something that is not a time', async () => {
    // A payload that parses as JSON but puts numbers (or nulls) in hourly.time used
    // to throw out of the module, which the demo can never afford.
    const broken = {
      hourly: {
        time: [1, 2, 3, null],
        cloud_cover: [10, 10, 10, 10],
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(broken), { status: 200 })),
    )
    const weather = await fetchNightWeather([THREE_SITES[0]], DARKNESS)
    expect(weather.roque?.source).toBe('cached')
    expect(weather.roque?.note).toMatch(/cached/i)
  })

  it('degrades to the snapshot when a series is not an array at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ hourly: { time: ['2026-09-02T21:00'], cloud_cover: 42 } }), {
            status: 200,
          }),
      ),
    )
    const weather = await fetchNightWeather([THREE_SITES[0]], DARKNESS)
    expect(weather.roque?.source).toBe('cached')
  })

  it('returns null for a site the snapshot never saw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    const weather = await fetchNightWeather(
      [{ id: 'my-backyard', latitude: 40, longitude: -3, nightOf: '2026-09-02', darkness: DARKNESS }],
      DARKNESS,
    )
    expect(weather['my-backyard']).toBeNull()
  })

  it('does not call the network at all when the caller already aborted', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    const weather = await fetchNightWeather([THREE_SITES[0]], DARKNESS, controller.signal)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(weather.roque?.source).toBe('cached')
  })
})

describe('cachedNightWeather', () => {
  it('reads the baked snapshot for a night it covers', () => {
    const w = cachedNightWeather('mauna-kea', '2026-09-03')
    expect(w?.source).toBe('cached')
    expect(w?.cloud_cover_pct_mean).toBe(snapshot.sites['mauna-kea']['2026-09-03'].cloud_cover_pct_mean)
    expect(w?.fetched_at).toBe(snapshot.generated_at)
  })

  it('falls back to the nearest baked night and says so', () => {
    const w = cachedNightWeather('roque', '2027-01-15')
    expect(w?.source).toBe('cached')
    expect(w?.note).toMatch(/2026-09-05/)
  })

  it('knows nothing about sites outside the catalog', () => {
    expect(cachedNightWeather('atlantis', '2026-09-02')).toBeNull()
  })
})

describe('the baked snapshot itself', () => {
  it('covers every dark-sky site for five nights and admits what it is', () => {
    expect(snapshot.dates).toHaveLength(5)
    expect(Object.keys(snapshot.sites).length).toBeGreaterThanOrEqual(22)
    expect(snapshot.note.length).toBeGreaterThan(40)
    expect(snapshot.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
