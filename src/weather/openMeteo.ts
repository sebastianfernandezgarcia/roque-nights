/**
 * The only network call in Roque Nights: one Open-Meteo request for every site.
 *
 * Everything else in this app is computed in the browser from an ephemeris, which
 * is precisely why WebMCP is the only way to agentify it. Cloud cover is the one
 * thing physics cannot give us, so `compare_dark_sky_sites` asks Open-Meteo for
 * all sites at once (comma separated coordinate lists, one HTTP round trip) and
 * averages each variable over that site's OWN hours of astronomical darkness.
 *
 * Two proxies for what observers actually care about, per docs/PLAN.md:
 *  - seeing        ~ wind_speed_200hPa  (the jet stream over the site)
 *  - transparency  ~ relative_humidity_700hPa (above the Roque inversion layer)
 *
 * The demo must never break on a bad hotel wifi, so any failure (throw, non-2xx,
 * unexpected payload, timeout, cancellation) falls back to `snapshot.json`, a real
 * forecast baked on 2026-09-01 for the nights of 2026-09-01 to 2026-09-05. The
 * fallback is labelled `source: 'cached'` and carries a `note`, and the tool turns
 * that into a caveat: the page says what it knows and how it knows it.
 */

import type { Interval } from '../astro/night'
import snapshot from './snapshot.json'

export const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

/** Hourly variables requested, in the order Open-Meteo echoes them back. */
export const HOURLY_VARIABLES = [
  'cloud_cover',
  'relative_humidity_2m',
  'wind_speed_10m',
  'wind_speed_200hPa',
  'relative_humidity_700hPa',
] as const

/** An hour counts as clear below this cloud cover. */
export const CLEAR_SKY_CLOUD_COVER_PCT = 30

/** Hard ceiling for the request: a slow forecast must not stall an agent turn. */
export const WEATHER_TIMEOUT_MS = 6000

const HOUR_MS = 3_600_000

/** One site to ask about: coordinates, plus the darkness window to average over. */
export interface WeatherSiteQuery {
  /** Key of the returned record, and the key used to look the site up in the snapshot. */
  id: string
  latitude: number
  longitude: number
  /** Night the darkness belongs to (YYYY-MM-DD); the snapshot is keyed by it. */
  nightOf?: string
  /** This site's own darkness window. Falls back to the shared one passed to the fetch. */
  darkness?: Interval | null
}

export interface NightWeather {
  cloud_cover_pct_mean: number
  cloud_cover_pct_max: number
  humidity_2m_pct_mean: number | null
  wind_10m_kmh_mean: number | null
  /** Jet stream speed at 200 hPa: high values mean poor seeing. */
  wind_200hpa_kmh_mean: number | null
  /** Humidity above the inversion layer: high values mean poor transparency. */
  humidity_700hpa_pct_mean: number | null
  /** Share of dark hours with cloud cover below 30 %, 0..1. */
  clear_fraction: number
  /** Dark hours the averages are built from. */
  hours: number
  source: 'open-meteo' | 'cached'
  fetched_at: string
  /** Why this is not a live forecast, when it is not. */
  note?: string
}

export type WeatherBySite = Record<string, NightWeather | null>

interface SnapshotRecord {
  dark_hours_sampled: number
  cloud_cover_pct_mean: number | null
  cloud_cover_pct_max: number | null
  humidity_2m_pct_mean: number | null
  wind_10m_kmh_mean: number | null
  wind_200hpa_kmh_mean: number | null
  humidity_700hpa_pct_mean: number | null
  clear_fraction: number | null
}

interface SnapshotFile {
  note: string
  generated_at: string
  source: string
  dates: string[]
  sites: Record<string, Record<string, SnapshotRecord>>
}

const SNAPSHOT = snapshot as SnapshotFile

// --- helpers -----------------------------------------------------------------

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  let total = 0
  for (const v of values) total += v
  return roundTo(total / values.length, 1)
}

function dateOf(iso: string): string {
  return iso.slice(0, 10)
}

function intervalOf(site: WeatherSiteQuery, fallback: Interval): Interval {
  return site.darkness ?? fallback
}

// --- request -----------------------------------------------------------------

/**
 * The multi-coordinate URL: comma separated latitude and longitude lists, UTC
 * timestamps, and a start/end date pair wide enough for every site's darkness.
 */
export function buildForecastUrl(sites: WeatherSiteQuery[], darkness: Interval): string {
  let startDate = dateOf(darkness.startUtc)
  let endDate = dateOf(darkness.endUtc)
  for (const site of sites) {
    const own = intervalOf(site, darkness)
    if (dateOf(own.startUtc) < startDate) startDate = dateOf(own.startUtc)
    if (dateOf(own.endUtc) > endDate) endDate = dateOf(own.endUtc)
  }

  const params = new URLSearchParams({
    latitude: sites.map((s) => String(s.latitude)).join(','),
    longitude: sites.map((s) => String(s.longitude)).join(','),
    hourly: HOURLY_VARIABLES.join(','),
    timezone: 'UTC',
    start_date: startDate,
    end_date: endDate,
  })
  return `${OPEN_METEO_ENDPOINT}?${params.toString()}`
}

/**
 * Caller cancellation plus our own 6 s ceiling, in whatever the engine supports.
 * `AbortSignal.any` is recent enough that the manual path still earns its keep.
 */
function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : null

  if (timeout && !signal) return timeout
  if (timeout && signal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, timeout])
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal) {
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  if (timeout) {
    if (timeout.aborted) abort()
    else timeout.addEventListener('abort', abort, { once: true })
  } else {
    setTimeout(abort, timeoutMs)
  }
  return controller.signal
}

interface HourlyBlock {
  time: string[]
  [variable: string]: unknown
}

function hourlyOf(entry: unknown): HourlyBlock | null {
  if (typeof entry !== 'object' || entry === null) return null
  const hourly = (entry as { hourly?: unknown }).hourly
  if (typeof hourly !== 'object' || hourly === null) return null
  const time = (hourly as { time?: unknown }).time
  if (!Array.isArray(time)) return null
  return hourly as HourlyBlock
}

/** Indices of the hourly slots whose hour overlaps the darkness window. */
function darkIndices(times: string[], darkness: Interval): number[] {
  const startMs = Date.parse(darkness.startUtc)
  const endMs = Date.parse(darkness.endUtc)
  const picked: number[] = []
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return picked
  for (let i = 0; i < times.length; i++) {
    // Open-Meteo returns 'YYYY-MM-DDTHH:mm' with timezone=UTC and no zone suffix.
    // A payload that puts anything else in there is a bad forecast, not a crash.
    const raw = times[i]
    if (typeof raw !== 'string') continue
    const slotMs = Date.parse(raw.endsWith('Z') ? raw : `${raw}:00Z`)
    if (!Number.isFinite(slotMs)) continue
    if (slotMs < endMs && slotMs + HOUR_MS > startMs) picked.push(i)
  }
  return picked
}

function numbersAt(hourly: HourlyBlock, variable: string, indices: number[]): number[] {
  const series = hourly[variable]
  if (!Array.isArray(series)) return []
  const values: number[] = []
  for (const i of indices) {
    const v = series[i]
    if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
  }
  return values
}

function nightWeatherFromHourly(hourly: HourlyBlock, darkness: Interval): NightWeather | null {
  const indices = darkIndices(hourly.time, darkness)
  const cloud = numbersAt(hourly, 'cloud_cover', indices)
  if (cloud.length === 0) return null
  const clear = cloud.filter((c) => c < CLEAR_SKY_CLOUD_COVER_PCT).length
  return {
    cloud_cover_pct_mean: mean(cloud) ?? 0,
    cloud_cover_pct_max: Math.max(...cloud),
    humidity_2m_pct_mean: mean(numbersAt(hourly, 'relative_humidity_2m', indices)),
    wind_10m_kmh_mean: mean(numbersAt(hourly, 'wind_speed_10m', indices)),
    wind_200hpa_kmh_mean: mean(numbersAt(hourly, 'wind_speed_200hPa', indices)),
    humidity_700hpa_pct_mean: mean(numbersAt(hourly, 'relative_humidity_700hPa', indices)),
    clear_fraction: roundTo(clear / cloud.length, 3),
    hours: cloud.length,
    source: 'open-meteo',
    fetched_at: new Date().toISOString(),
  }
}

// --- cached fallback ----------------------------------------------------------

/** The baked night closest to the one asked for, when the exact one is missing. */
function nearestSnapshotDate(available: string[], nightOf: string): string | null {
  if (available.length === 0) return null
  if (available.includes(nightOf)) return nightOf
  const wanted = Date.parse(`${nightOf}T00:00:00Z`)
  if (!Number.isFinite(wanted)) return available[0]
  let best = available[0]
  let bestGap = Number.POSITIVE_INFINITY
  for (const date of available) {
    const gap = Math.abs(Date.parse(`${date}T00:00:00Z`) - wanted)
    if (gap < bestGap) {
      bestGap = gap
      best = date
    }
  }
  return best
}

/**
 * The baked forecast for one site and night, or null when the snapshot never saw
 * that site (custom coordinates, for instance).
 */
export function cachedNightWeather(
  siteId: string,
  nightOf: string,
  reason?: string,
): NightWeather | null {
  const perDate = SNAPSHOT.sites[siteId]
  if (!perDate) return null
  const date = nearestSnapshotDate(Object.keys(perDate), nightOf)
  if (!date) return null
  const record = perDate[date]
  if (!record || record.cloud_cover_pct_mean === null || record.cloud_cover_pct_max === null) {
    return null
  }

  const parts = [
    reason
      ? `Cached forecast: ${reason}`
      : 'Cached forecast baked into the page, not a live request',
  ]
  if (date !== nightOf) parts.push(`the snapshot only covers ${SNAPSHOT.dates.join(', ')}, so the night of ${date} is used instead`)
  parts.push(`forecast issued ${SNAPSHOT.generated_at.slice(0, 10)}`)

  return {
    cloud_cover_pct_mean: record.cloud_cover_pct_mean,
    cloud_cover_pct_max: record.cloud_cover_pct_max,
    humidity_2m_pct_mean: record.humidity_2m_pct_mean,
    wind_10m_kmh_mean: record.wind_10m_kmh_mean,
    wind_200hpa_kmh_mean: record.wind_200hpa_kmh_mean,
    humidity_700hpa_pct_mean: record.humidity_700hpa_pct_mean,
    clear_fraction: record.clear_fraction ?? 0,
    hours: record.dark_hours_sampled,
    source: 'cached',
    fetched_at: SNAPSHOT.generated_at,
    note: `${parts.join('; ')}.`,
  }
}

function cachedForAll(
  sites: WeatherSiteQuery[],
  darkness: Interval,
  reason: string,
): WeatherBySite {
  const result: WeatherBySite = {}
  for (const site of sites) {
    const nightOf = site.nightOf ?? dateOf(intervalOf(site, darkness).startUtc)
    result[site.id] = cachedNightWeather(site.id, nightOf, reason)
  }
  return result
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'TimeoutError'
      ? `the forecast request was cancelled or timed out after ${WEATHER_TIMEOUT_MS / 1000} s`
      : `the forecast request failed (${error.message})`
  }
  return `the forecast request failed (${String(error)})`
}

// --- public entry point --------------------------------------------------------

/**
 * Night averages for every site, live when the network allows and cached when it
 * does not. Never throws and never rejects: a weather outage degrades the answer,
 * it does not break the tool.
 */
export async function fetchNightWeather(
  sites: WeatherSiteQuery[],
  darkness: Interval,
  signal?: AbortSignal,
): Promise<WeatherBySite> {
  if (sites.length === 0) return {}
  if (signal?.aborted) {
    return cachedForAll(sites, darkness, 'the caller cancelled before the request was sent')
  }
  if (typeof fetch !== 'function') {
    return cachedForAll(sites, darkness, 'this browser exposes no fetch')
  }

  let payload: unknown
  try {
    const response = await fetch(buildForecastUrl(sites, darkness), {
      signal: requestSignal(signal, WEATHER_TIMEOUT_MS),
    })
    if (!response.ok) {
      return cachedForAll(
        sites,
        darkness,
        `Open-Meteo answered HTTP ${response.status}`,
      )
    }
    payload = await response.json()
  } catch (error) {
    return cachedForAll(sites, darkness, describeError(error))
  }

  // One site comes back as an object, several come back as an array.
  const entries = Array.isArray(payload) ? payload : [payload]
  if (entries.length < sites.length) {
    return cachedForAll(
      sites,
      darkness,
      `Open-Meteo returned ${entries.length} of the ${sites.length} sites requested`,
    )
  }

  const result: WeatherBySite = {}
  let live = 0
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]
    let weather: NightWeather | null = null
    let reason = 'Open-Meteo returned no usable hours for this site'
    try {
      const hourly = hourlyOf(entries[i])
      weather = hourly ? nightWeatherFromHourly(hourly, intervalOf(site, darkness)) : null
    } catch {
      // Belt and braces: one malformed site must not take the whole answer down.
      weather = null
      reason = 'Open-Meteo returned an unexpected payload shape for this site'
    }
    if (weather) {
      live++
      result[site.id] = weather
    } else {
      const nightOf = site.nightOf ?? dateOf(intervalOf(site, darkness).startUtc)
      result[site.id] = cachedNightWeather(site.id, nightOf, reason)
    }
  }

  // A payload that parsed but held nothing usable is a failure, not a forecast.
  if (live === 0) {
    return cachedForAll(sites, darkness, 'Open-Meteo returned no usable hourly data')
  }
  return result
}
