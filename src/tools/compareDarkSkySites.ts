/**
 * Tool 14: the whole planet as one answer.
 *
 * Astronomical darkness comes from the ephemeris, which is free and exact. Clouds
 * do not, so this is the only tool in Roque Nights that leaves the browser: ONE
 * Open-Meteo request with comma separated coordinate lists for every site at once.
 * When that request fails the tool still answers, from the forecast baked into
 * src/weather/snapshot.json, and says "cached forecast" in the summary and in a
 * caveat. A demo that goes dark because a hotel wifi went dark is not a demo.
 *
 * Ranking is `usable_hours * (0.4 + 0.6 * clear_fraction)`: a perfectly clear site
 * keeps all its usable dark hours, a fully overcast one keeps 40 % of them, because
 * a forecast three days out is a probability, not a verdict.
 */

import { getNight } from '../astro/cache'
import type { Interval, NightEphemeris } from '../astro/night'
import { roundTo } from '../astro/time'
import { DARK_SKY_SITES, SITE_BY_ID, angularDistanceDeg, findSite } from '../data/sites'
import { store } from '../state/store'
import type { Site } from '../state/types'
import { fetchNightWeather, type NightWeather, type WeatherSiteQuery } from '../weather/openMeteo'
import {
  defineTool,
  fail,
  isToolError,
  ok,
  stamp,
  type RejectedItem,
  type Stamp,
  type ToolError,
  type ToolResult,
} from './envelope'
import { resolveNightOf } from './resolveSite'
import { DATE_SCHEMA } from './schemas'

export const DEFAULT_SITE_LIMIT = 10
export const MAX_SITE_LIMIT = 30
/** Weight kept by a site the forecast says is fully overcast. */
export const OVERCAST_WEIGHT = 0.4
/** Coordinates this close to a catalog site are treated as that same site. */
const SAME_SITE_DEG = 0.05

export interface SiteComparison {
  id: string
  name: string
  country: string | null
  latitude: number
  longitude: number
  time_zone: string | null
  darkness: { start: Stamp; end: Stamp }
  darkness_hours: number | null
  moon_free_hours: number | null
  usable_hours: number | null
  moon_illumination_pct: number
  weather: NightWeather | null
  /** usable_hours weighted by the clear-sky fraction; the ranking key. */
  rank_score: number
}

export interface CompareDarkSkySitesData {
  night_of: string
  /** 'open-meteo' when the live request answered, 'cached' on fallback, 'none' when not asked for. */
  weather_source: 'open-meteo' | 'cached' | 'none'
  sites_evaluated: number
  sites: SiteComparison[]
}

export const COMPARE_DARK_SKY_SITES_DESCRIPTION =
  "Use this to compare the world's dark-sky observatories and Starlight reserves for a night: for each site it returns astronomical darkness hours and Moon-free hours, plus (when the network allows) the night's mean cloud cover, humidity and 200 hPa wind (a seeing proxy) from Open-Meteo in ONE request. Ranks sites by usable dark hours and clear-sky fraction. Pass site_ids to restrict, or include_current_site to add the site shown in the app. This is the ONLY tool that calls an external service; if it fails it falls back to a cached forecast and says so in caveats."

interface Candidate {
  site: Site
  country: string | null
  night: NightEphemeris
  darkness: Interval
}

// --- input helpers ---------------------------------------------------------------

function readBoolean(value: unknown, field: string, fallback: boolean): boolean | ToolError {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') {
    return fail('invalid_input', `${field} must be true or false, got ${String(value)}.`)
  }
  return value
}

function readLimit(value: unknown): number | ToolError {
  if (value === undefined || value === null) return DEFAULT_SITE_LIMIT
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail('invalid_input', `limit must be a whole number, got ${String(value)}.`)
  }
  if (value < 1 || value > MAX_SITE_LIMIT) {
    return fail('invalid_input', `limit must be between 1 and ${MAX_SITE_LIMIT}, got ${value}.`)
  }
  return value
}

function readSiteIds(value: unknown): string[] | null | ToolError {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) {
    return fail(
      'invalid_input',
      `site_ids must be an array of dark-sky site ids, got ${typeof value}.`,
      `Known ids include ${DARK_SKY_SITES.slice(0, 4).map((s) => s.id).join(', ')}. Omit site_ids to compare all ${DARK_SKY_SITES.length}.`,
    )
  }
  if (value.length > MAX_SITE_LIMIT) {
    return fail('invalid_input', `site_ids accepts at most ${MAX_SITE_LIMIT} entries, got ${value.length}.`)
  }
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return fail('invalid_input', 'site_ids must contain non-empty strings.')
    }
    out.push(entry.trim())
  }
  return out
}

// --- assembly ----------------------------------------------------------------------

/** Why this site cannot be compared tonight, in the words the user will read. */
function darknessRejection(night: NightEphemeris): string {
  if (night.darkness.status === 'no_astronomical_darkness') {
    return `no astronomical darkness on this night (${night.explanation})`
  }
  return 'the darkness window could not be computed for this night'
}

function comparison(candidate: Candidate, weather: NightWeather | null): SiteComparison {
  const { site, night } = candidate
  const usableHours = night.darkness.usableHours ?? 0
  const weight = weather ? OVERCAST_WEIGHT + (1 - OVERCAST_WEIGHT) * weather.clear_fraction : 1
  return {
    id: site.id ?? 'current-site',
    name: site.name,
    country: candidate.country,
    latitude: roundTo(site.latitude, 4),
    longitude: roundTo(site.longitude, 4),
    time_zone: site.timeZone,
    darkness: {
      start: stamp(night.darkness.startUtc, site.timeZone),
      end: stamp(night.darkness.endUtc, site.timeZone),
    },
    darkness_hours: night.darkness.hours,
    moon_free_hours: night.darkness.moonFreeHours,
    usable_hours: night.darkness.usableHours,
    moon_illumination_pct: night.moon.illuminationPct,
    weather,
    rank_score: roundTo(usableHours * weight, 2),
  }
}

function siteClause(site: SiteComparison): string {
  const usable = (site.usable_hours ?? 0).toFixed(1)
  if (site.weather === null) {
    return `${site.name} ${usable} usable dark hours, no cloud forecast (score ${site.rank_score})`
  }
  return (
    `${site.name} ${usable} usable dark hours with ` +
    `${Math.round(site.weather.cloud_cover_pct_mean)}% mean cloud cover (score ${site.rank_score})`
  )
}

function sourceLabel(source: CompareDarkSkySitesData['weather_source']): string {
  if (source === 'open-meteo') return 'live forecast'
  if (source === 'cached') return 'cached forecast'
  return 'no forecast requested'
}

function buildSummary(data: CompareDarkSkySitesData, rejectedCount: number): string {
  if (data.sites.length === 0) {
    return `No dark-sky site in this comparison has astronomical darkness on ${data.night_of}: all ${rejectedCount} were rejected with a reason.`
  }
  const shown = data.sites.slice(0, 3)
  const [first, ...rest] = shown.map(siteClause)
  const tail = rest.length > 0 ? `, then ${rest.join(', then ')}` : ''
  const rejectedClause =
    rejectedCount === 0 ? '' : ` ${rejectedCount} site(s) rejected with a reason.`
  return (
    `Best dark-sky sites for the night of ${data.night_of} (${data.sites_evaluated} compared, ` +
    `${sourceLabel(data.weather_source)}): ${first}${tail}.${rejectedClause}`
  )
}

// --- the tool ------------------------------------------------------------------------

export const compareDarkSkySitesTool = defineTool<CompareDarkSkySitesData>({
  name: 'compare_dark_sky_sites',
  title: 'Compare the world dark-sky sites for a night',
  description: COMPARE_DARK_SKY_SITES_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      date: DATE_SCHEMA,
      site_ids: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 60 },
        maxItems: MAX_SITE_LIMIT,
        description: `Restrict the comparison to these dark-sky sites, by id or by name (for example ${DARK_SKY_SITES.slice(0, 3).map((s) => s.id).join(', ')}). Omit to compare all ${DARK_SKY_SITES.length}.`,
      },
      include_current_site: {
        type: 'boolean',
        default: true,
        description: 'Add the observing site currently shown in the app to the comparison.',
      },
      include_weather: {
        type: 'boolean',
        default: true,
        description:
          'Ask Open-Meteo for the cloud forecast. Set false for pure astronomy with no network call.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_SITE_LIMIT,
        default: DEFAULT_SITE_LIMIT,
        description: 'How many sites to return, best first.',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: false },
  run: async (input, options): Promise<ToolResult<CompareDarkSkySitesData>> => {
    const state = store.getState()

    const nightOf = resolveNightOf(input.date, state.nightOf)
    if (isToolError(nightOf)) return nightOf
    const siteIds = readSiteIds(input.site_ids)
    if (isToolError(siteIds)) return siteIds
    const includeCurrent = readBoolean(input.include_current_site, 'include_current_site', true)
    if (isToolError(includeCurrent)) return includeCurrent
    const includeWeather = readBoolean(input.include_weather, 'include_weather', true)
    if (isToolError(includeWeather)) return includeWeather
    const limit = readLimit(input.limit)
    if (isToolError(limit)) return limit

    const rejected: RejectedItem[] = []

    // 1. Which sites are we comparing?
    const chosen: { site: Site; country: string | null }[] = []
    const seen = new Set<string>()
    const push = (site: Site, country: string | null) => {
      const key = site.id ?? `${site.latitude.toFixed(3)},${site.longitude.toFixed(3)}`
      if (seen.has(key)) return
      seen.add(key)
      chosen.push({ site, country })
    }

    if (siteIds === null) {
      for (const entry of DARK_SKY_SITES) {
        const { country, kind: _kind, ...site } = entry
        push(site, country)
      }
    } else {
      for (const wanted of siteIds) {
        const hit = findSite(wanted)
        if (!hit) {
          rejected.push({ id: wanted, name: wanted, reason: 'unknown dark-sky site' })
          continue
        }
        const { country, kind: _kind, ...site } = hit
        push(site, country)
      }
    }

    if (includeCurrent) {
      const current = state.site
      const alreadyListed = chosen.some(
        (c) =>
          (current.id !== null && c.site.id === current.id) ||
          angularDistanceDeg(c.site.latitude, c.site.longitude, current.latitude, current.longitude) <=
            SAME_SITE_DEG,
      )
      // Keep the country when the app is sitting on a catalog site the ids left out.
      if (!alreadyListed) {
        const catalogEntry = current.id === null ? undefined : SITE_BY_ID.get(current.id)
        push(current, catalogEntry?.country ?? null)
      }
    }

    if (chosen.length === 0) {
      return fail(
        'invalid_input',
        'No dark-sky site matched the request.',
        `Pass ids from the catalog (${DARK_SKY_SITES.slice(0, 4).map((s) => s.id).join(', ')}, ...) or omit site_ids to compare all ${DARK_SKY_SITES.length}.`,
      )
    }

    // 2. The ephemeris for each of them. A site with no darkness is a rejection with a reason.
    const candidates: Candidate[] = []
    for (const { site, country } of chosen) {
      const night = getNight(nightOf, site)
      if (!night.darkness.startUtc || !night.darkness.endUtc) {
        rejected.push({
          id: site.id ?? 'current-site',
          name: site.name,
          reason: darknessRejection(night),
        })
        continue
      }
      candidates.push({
        site,
        country,
        night,
        darkness: { startUtc: night.darkness.startUtc, endUtc: night.darkness.endUtc },
      })
    }

    // 3. One request for every remaining site, each averaged over its own darkness.
    let weatherBySite: Record<string, NightWeather | null> = {}
    let weatherSource: CompareDarkSkySitesData['weather_source'] = 'none'
    const caveats: string[] = []

    if (includeWeather && candidates.length > 0) {
      const queries: WeatherSiteQuery[] = candidates.map((c) => ({
        id: c.site.id ?? 'current-site',
        latitude: c.site.latitude,
        longitude: c.site.longitude,
        nightOf,
        darkness: c.darkness,
      }))
      weatherBySite = await fetchNightWeather(queries, candidates[0].darkness, options.signal)

      const values = Object.values(weatherBySite).filter((w): w is NightWeather => w !== null)
      const live = values.filter((w) => w.source === 'open-meteo')
      weatherSource = live.length > 0 ? 'open-meteo' : values.length > 0 ? 'cached' : 'none'

      if (weatherSource === 'cached') {
        caveats.push(
          values[0]?.note ??
            'Cached forecast: the live Open-Meteo request failed, so the baked snapshot was used.',
        )
      } else if (weatherSource === 'open-meteo' && live.length < values.length) {
        caveats.push(
          `Live forecast for ${live.length} of ${values.length} sites; the rest fall back to the cached snapshot.`,
        )
      } else if (weatherSource === 'none') {
        caveats.push('No cloud forecast available for these sites, so ranking uses dark hours only.')
      }
      if (values.length < candidates.length) {
        caveats.push(
          `${candidates.length - values.length} site(s) have no forecast at all and are ranked on dark hours alone.`,
        )
      }
    }

    // 4. Rank and cut.
    const ranked = candidates
      .map((c) => comparison(c, weatherBySite[c.site.id ?? 'current-site'] ?? null))
      .sort((a, b) => b.rank_score - a.rank_score || a.name.localeCompare(b.name))

    const data: CompareDarkSkySitesData = {
      night_of: nightOf,
      weather_source: weatherSource,
      sites_evaluated: candidates.length,
      sites: ranked.slice(0, limit),
    }

    return ok(buildSummary(data, rejected.length), data, state.site, { rejected, caveats })
  },
})
