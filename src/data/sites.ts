/**
 * Dark-sky sites: observatories, Starlight reserves and dark-sky parks.
 *
 * Two jobs:
 *  - `compare_dark_sky_sites` ranks these places for a given night;
 *  - `resolveSite` uses them to name a set of coordinates and, above all, to
 *    infer an IANA time zone for custom coordinates instead of inventing one.
 *
 * Coordinates are decimal degrees, longitude EAST positive, elevation in metres
 * above sea level. Every `timeZone` is checked against Intl in sites.test.ts.
 */

import type { Site } from '../state/types'

export type DarkSkySiteKind = 'observatory' | 'starlight_reserve' | 'dark_sky_park'

export interface DarkSkySite extends Site {
  /** Stable lowercase-kebab id, also used by tools and by the site form. */
  id: string
  /** ISO 3166-1 alpha-2 country code. */
  country: string
  kind: DarkSkySiteKind
}

export const EARTH_RADIUS_KM = 6371
/** Kilometres per degree of great-circle arc. */
export const KM_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_KM

export const DARK_SKY_SITES: DarkSkySite[] = [
  {
    id: 'roque',
    name: 'Roque de los Muchachos, La Palma',
    latitude: 28.7542,
    longitude: -17.8851,
    elevationM: 2396,
    timeZone: 'Atlantic/Canary',
    country: 'ES',
    kind: 'observatory',
  },
  {
    id: 'teide',
    name: 'Teide Observatory, Tenerife',
    latitude: 28.3005,
    longitude: -16.5097,
    elevationM: 2390,
    timeZone: 'Atlantic/Canary',
    country: 'ES',
    kind: 'observatory',
  },
  {
    id: 'mauna-kea',
    name: 'Mauna Kea, Hawaii',
    latitude: 19.8207,
    longitude: -155.4681,
    elevationM: 4205,
    timeZone: 'Pacific/Honolulu',
    country: 'US',
    kind: 'observatory',
  },
  {
    id: 'haleakala',
    name: 'Haleakalā, Maui',
    latitude: 20.7083,
    longitude: -156.2571,
    elevationM: 3055,
    timeZone: 'Pacific/Honolulu',
    country: 'US',
    kind: 'observatory',
  },
  {
    id: 'paranal',
    name: 'Cerro Paranal (VLT), Atacama',
    latitude: -24.6272,
    longitude: -70.4039,
    elevationM: 2635,
    timeZone: 'America/Santiago',
    country: 'CL',
    kind: 'observatory',
  },
  {
    id: 'la-silla',
    name: 'La Silla, Atacama',
    latitude: -29.2563,
    longitude: -70.738,
    elevationM: 2400,
    timeZone: 'America/Santiago',
    country: 'CL',
    kind: 'observatory',
  },
  {
    id: 'cerro-pachon',
    name: 'Cerro Pachón (Rubin, Gemini South)',
    latitude: -30.2446,
    longitude: -70.7494,
    elevationM: 2715,
    timeZone: 'America/Santiago',
    country: 'CL',
    kind: 'observatory',
  },
  {
    id: 'cerro-tololo',
    name: 'Cerro Tololo, Coquimbo',
    latitude: -30.1692,
    longitude: -70.8063,
    elevationM: 2200,
    timeZone: 'America/Santiago',
    country: 'CL',
    kind: 'observatory',
  },
  {
    id: 'chajnantor',
    name: 'Llano de Chajnantor (ALMA)',
    latitude: -23.0293,
    longitude: -67.7548,
    elevationM: 5058,
    timeZone: 'America/Santiago',
    country: 'CL',
    kind: 'observatory',
  },
  {
    id: 'kitt-peak',
    name: 'Kitt Peak, Arizona',
    latitude: 31.9583,
    longitude: -111.5967,
    elevationM: 2096,
    timeZone: 'America/Phoenix',
    country: 'US',
    kind: 'observatory',
  },
  {
    id: 'mount-graham',
    name: 'Mount Graham, Arizona',
    latitude: 32.7016,
    longitude: -109.8919,
    elevationM: 3221,
    timeZone: 'America/Phoenix',
    country: 'US',
    kind: 'observatory',
  },
  {
    id: 'mount-lemmon',
    name: 'Mount Lemmon, Arizona',
    latitude: 32.442,
    longitude: -110.7893,
    elevationM: 2791,
    timeZone: 'America/Phoenix',
    country: 'US',
    kind: 'observatory',
  },
  {
    id: 'palomar',
    name: 'Palomar Mountain, California',
    latitude: 33.3563,
    longitude: -116.865,
    elevationM: 1712,
    timeZone: 'America/Los_Angeles',
    country: 'US',
    kind: 'observatory',
  },
  {
    id: 'dantes-view',
    name: "Dante's View, Death Valley",
    latitude: 36.2203,
    longitude: -116.7264,
    elevationM: 1669,
    timeZone: 'America/Los_Angeles',
    country: 'US',
    kind: 'dark_sky_park',
  },
  {
    id: 'jasper',
    name: 'Jasper Dark Sky Preserve, Alberta',
    latitude: 52.8737,
    longitude: -118.0814,
    elevationM: 1062,
    timeZone: 'America/Edmonton',
    country: 'CA',
    kind: 'dark_sky_park',
  },
  {
    id: 'pic-du-midi',
    name: 'Pic du Midi de Bigorre',
    latitude: 42.9369,
    longitude: 0.1426,
    elevationM: 2877,
    timeZone: 'Europe/Paris',
    country: 'FR',
    kind: 'observatory',
  },
  {
    id: 'calar-alto',
    name: 'Calar Alto, Almería',
    latitude: 37.2236,
    longitude: -2.5461,
    elevationM: 2168,
    timeZone: 'Europe/Madrid',
    country: 'ES',
    kind: 'observatory',
  },
  {
    id: 'montsec',
    name: 'Montsec, Catalonia',
    latitude: 42.0517,
    longitude: 0.7297,
    elevationM: 1570,
    timeZone: 'Europe/Madrid',
    country: 'ES',
    kind: 'starlight_reserve',
  },
  {
    id: 'alqueva',
    name: 'Dark Sky Alqueva, Alentejo',
    latitude: 38.2,
    longitude: -7.5,
    elevationM: 150,
    timeZone: 'Europe/Lisbon',
    country: 'PT',
    kind: 'starlight_reserve',
  },
  {
    id: 'kerry',
    name: 'Kerry Dark Sky Reserve',
    latitude: 51.8,
    longitude: -10.1,
    elevationM: 50,
    timeZone: 'Europe/Dublin',
    country: 'IE',
    kind: 'dark_sky_park',
  },
  {
    id: 'brecon-beacons',
    name: 'Bannau Brycheiniog (Brecon Beacons)',
    latitude: 51.88,
    longitude: -3.44,
    elevationM: 500,
    timeZone: 'Europe/London',
    country: 'GB',
    kind: 'dark_sky_park',
  },
  {
    id: 'westhavelland',
    name: 'Westhavelland, Brandenburg',
    latitude: 52.7,
    longitude: 12.4,
    elevationM: 40,
    timeZone: 'Europe/Berlin',
    country: 'DE',
    kind: 'dark_sky_park',
  },
  {
    id: 'sutherland',
    name: 'Sutherland (SALT), Northern Cape',
    latitude: -32.376,
    longitude: 20.8107,
    elevationM: 1798,
    timeZone: 'Africa/Johannesburg',
    country: 'ZA',
    kind: 'observatory',
  },
  {
    id: 'namibrand',
    name: 'NamibRand Nature Reserve',
    latitude: -25,
    longitude: 16,
    elevationM: 1200,
    timeZone: 'Africa/Windhoek',
    country: 'NA',
    kind: 'dark_sky_park',
  },
  {
    id: 'hanle',
    name: 'Hanle, Ladakh (IAO)',
    latitude: 32.7794,
    longitude: 78.9642,
    elevationM: 4500,
    timeZone: 'Asia/Kolkata',
    country: 'IN',
    kind: 'observatory',
  },
  {
    id: 'ali',
    name: 'Ali Observatory, Tibet',
    latitude: 32.326,
    longitude: 80.026,
    elevationM: 5100,
    timeZone: 'Asia/Shanghai',
    country: 'CN',
    kind: 'observatory',
  },
  {
    id: 'siding-spring',
    name: 'Siding Spring, New South Wales',
    latitude: -31.2733,
    longitude: 149.0644,
    elevationM: 1165,
    timeZone: 'Australia/Sydney',
    country: 'AU',
    kind: 'observatory',
  },
  {
    id: 'aoraki-mackenzie',
    name: 'Aoraki Mackenzie (Mount John)',
    latitude: -43.9856,
    longitude: 170.465,
    elevationM: 1029,
    timeZone: 'Pacific/Auckland',
    country: 'NZ',
    kind: 'dark_sky_park',
  },
]

/** Lookup by id. */
export const SITE_BY_ID: ReadonlyMap<string, DarkSkySite> = new Map(
  DARK_SKY_SITES.map((s) => [s.id, s]),
)

const RAD = Math.PI / 180

/**
 * Great-circle separation between two points, in DEGREES of arc.
 *
 * Haversine, so it behaves across the antimeridian and near the poles, where a
 * plain difference of coordinates does not.
 */
export function angularDistanceDeg(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = (bLat - aLat) * RAD
  const dLon = (bLon - aLon) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / RAD
}

export interface NearestSiteHit {
  site: DarkSkySite
  /** Great-circle distance in kilometres. */
  distanceKm: number
  /** The same distance in degrees of arc; this is what the site rules compare against. */
  distanceDeg: number
}

/** Closest catalog site to a point. The catalog is never empty, so this always returns a hit. */
export function nearestSite(lat: number, lon: number): NearestSiteHit {
  let best = DARK_SKY_SITES[0]
  let bestDeg = Number.POSITIVE_INFINITY
  for (const site of DARK_SKY_SITES) {
    const deg = angularDistanceDeg(lat, lon, site.latitude, site.longitude)
    if (deg < bestDeg) {
      bestDeg = deg
      best = site
    }
  }
  return { site: best, distanceKm: bestDeg * KM_PER_DEGREE, distanceDeg: bestDeg }
}

/** Lowercase, diacritics removed, punctuation collapsed to single spaces. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Find a site by id or by name. Tolerant on purpose: agents and humans type
 * "Mauna Kea", "mauna-kea" or "Haleakala" for the same place.
 */
export function findSite(idOrName: string): DarkSkySite | undefined {
  if (typeof idOrName !== 'string') return undefined
  const needle = normalize(idOrName)
  if (needle.length === 0) return undefined
  const byId = SITE_BY_ID.get(idOrName.trim().toLowerCase())
  if (byId) return byId
  const candidates = DARK_SKY_SITES.map((site) => ({
    site,
    id: normalize(site.id),
    name: normalize(site.name),
  }))
  return (
    candidates.find((c) => c.id === needle || c.name === needle)?.site ??
    candidates.find((c) => c.name.startsWith(needle) || c.id.startsWith(needle))?.site ??
    candidates.find((c) => c.name.includes(needle))?.site
  )
}
