/**
 * Turning what an agent typed into an observing site, or into a clear refusal.
 *
 * The rule the whole app is built on: we never invent a time zone. Coordinates
 * with no known zone get `timeZone: null`, UTC-only times and a caveat saying
 * exactly how to ask for local times. Coordinates that land on a catalog site
 * (src/data/sites.ts) borrow that site's identity and zone, and say so.
 */

import { isValidTimeZone, parseIsoDate } from '../astro/time'
import { findSite, nearestSite } from '../data/sites'
import type { Site } from '../state/types'
import { fail, type ToolError } from './envelope'

/** Coordinates this close to a catalog site ARE that site (about 5.5 km). */
export const CATALOG_MATCH_DEG = 0.05
/** Coordinates this close borrow only the time zone of the nearest site (about 111 km). */
export const TIME_ZONE_INFERENCE_DEG = 1

export const LOCAL_TIMES_OMITTED_CAVEAT =
  "Local times omitted: no IANA time zone known for these coordinates. Pass site.time_zone (e.g. 'Pacific/Honolulu') to get local times."

export const SITE_HINT =
  'Pass site as { latitude, longitude } in decimal degrees (longitude EAST positive), plus optional elevation_m, time_zone (IANA) and name. Omit site to use the one shown in the app.'

export const TIME_ZONE_HINT =
  'Use an IANA name such as "Atlantic/Canary", "Pacific/Honolulu" or "America/Santiago", or omit time_zone and you will get UTC only.'

export const DATE_HINT = 'Use YYYY-MM-DD, e.g. 2026-09-12'

/** The caveat added whenever the zone came from the catalog rather than from the caller. */
export function inferredTimeZoneCaveat(siteName: string, timeZone: string): string {
  return `Time zone inferred from nearby site ${siteName} (${timeZone}).`
}

export function catalogNameCaveat(query: string, site: Site): string {
  return `Resolved "${query}" to the catalog site ${site.name} (${site.latitude.toFixed(3)}, ${site.longitude.toFixed(3)}).`
}

export interface ResolvedSite {
  site: Site
  caveats: string[]
}

const MIN_ELEVATION_M = -430
const MAX_ELEVATION_M = 9000
const MAX_NAME_LENGTH = 80

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `an array of ${value.length}`
  return `a ${typeof value}`
}

function defaultName(latitude: number, longitude: number): string {
  return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
}

function invalidCoordinate(field: 'latitude' | 'longitude', value: unknown, limit: number) {
  return fail(
    'invalid_site',
    `site.${field} must be a number between -${limit} and ${limit}, got ${describeValue(value)}.`,
    SITE_HINT,
  )
}

/**
 * Resolve the `site` argument of a tool.
 *
 * Accepted: nothing (use the app's site), `{ latitude, longitude, ... }`, or a
 * bare `{ name }` / `{ id }` naming a catalog site.
 */
export function resolveSite(input: unknown, fallback: Site): ResolvedSite | ToolError {
  if (input === undefined || input === null) return { site: fallback, caveats: [] }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return fail(
      'invalid_site',
      `site must be an object with latitude and longitude, got ${describeValue(input)}.`,
      SITE_HINT,
    )
  }

  const raw = input as Record<string, unknown>
  if (Object.keys(raw).length === 0) return { site: fallback, caveats: [] }

  const latitude = raw.latitude
  const longitude = raw.longitude
  const hasLatitude = latitude !== undefined && latitude !== null
  const hasLongitude = longitude !== undefined && longitude !== null

  if (!hasLatitude && !hasLongitude) {
    // A bare name or id is a common shortcut; honour it only for a catalog hit.
    const label = typeof raw.name === 'string' ? raw.name : typeof raw.id === 'string' ? raw.id : ''
    const catalogHit = label ? findSite(label) : undefined
    if (catalogHit) {
      const { country: _country, kind: _kind, ...site } = catalogHit
      return { site, caveats: [catalogNameCaveat(label, site)] }
    }
    return fail(
      'invalid_site',
      label
        ? `No dark-sky site matches "${label}", and site.latitude and site.longitude are missing.`
        : 'site.latitude and site.longitude are missing.',
      SITE_HINT,
    )
  }
  if (!hasLongitude) {
    return fail(
      'invalid_site',
      'site.longitude is missing: pass both latitude and longitude, or omit site entirely.',
      SITE_HINT,
    )
  }
  if (!hasLatitude) {
    return fail(
      'invalid_site',
      'site.latitude is missing: pass both latitude and longitude, or omit site entirely.',
      SITE_HINT,
    )
  }
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return invalidCoordinate('latitude', latitude, 90)
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return invalidCoordinate('longitude', longitude, 180)
  }

  const rawElevation = raw.elevation_m
  const hasElevation = rawElevation !== undefined && rawElevation !== null
  if (
    hasElevation &&
    (typeof rawElevation !== 'number' ||
      !Number.isFinite(rawElevation) ||
      rawElevation < MIN_ELEVATION_M ||
      rawElevation > MAX_ELEVATION_M)
  ) {
    return fail(
      'invalid_site',
      `site.elevation_m must be a number between ${MIN_ELEVATION_M} and ${MAX_ELEVATION_M} metres, got ${describeValue(rawElevation)}.`,
      SITE_HINT,
    )
  }

  const rawName = raw.name
  let name: string | null = null
  if (rawName !== undefined && rawName !== null) {
    if (typeof rawName !== 'string') {
      return fail('invalid_site', `site.name must be a string, got ${describeValue(rawName)}.`, SITE_HINT)
    }
    if (rawName.length > MAX_NAME_LENGTH) {
      return fail(
        'invalid_site',
        `site.name must be at most ${MAX_NAME_LENGTH} characters, got ${rawName.length}.`,
        SITE_HINT,
      )
    }
    const trimmed = rawName.trim()
    if (trimmed.length > 0) name = trimmed
  }

  const rawTimeZone = raw.time_zone
  let timeZone: string | null = null
  if (rawTimeZone !== undefined && rawTimeZone !== null) {
    if (!isValidTimeZone(rawTimeZone)) {
      return fail(
        'invalid_time_zone',
        `"${describeValue(rawTimeZone)}" is not an IANA time zone this browser knows.`,
        TIME_ZONE_HINT,
      )
    }
    timeZone = rawTimeZone
  }

  const nearest = nearestSite(latitude, longitude)
  const matched = nearest.distanceDeg <= CATALOG_MATCH_DEG ? nearest.site : null
  const caveats: string[] = []

  if (timeZone === null) {
    if (nearest.distanceDeg <= TIME_ZONE_INFERENCE_DEG && nearest.site.timeZone) {
      timeZone = nearest.site.timeZone
      caveats.push(inferredTimeZoneCaveat(nearest.site.name, timeZone))
    } else {
      caveats.push(LOCAL_TIMES_OMITTED_CAVEAT)
    }
  }

  const site: Site = {
    id: matched ? matched.id : null,
    name: name ?? matched?.name ?? defaultName(latitude, longitude),
    latitude,
    longitude,
    elevationM: hasElevation
      ? (rawElevation as number)
      : matched
        ? matched.elevationM
        : 0,
    timeZone,
  }
  return { site, caveats }
}

/** Resolve the `date` argument of a tool: a real calendar day or a structured refusal. */
export function resolveNightOf(input: unknown, fallback: string): string | ToolError {
  if (input === undefined || input === null) return fallback
  if (typeof input !== 'string' || !parseIsoDate(input)) {
    return fail(
      'invalid_date',
      `"${describeValue(input)}" is not a valid calendar date.`,
      DATE_HINT,
    )
  }
  return input
}
