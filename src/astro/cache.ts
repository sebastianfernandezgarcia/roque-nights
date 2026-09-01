/**
 * Small LRU in front of `computeNightEphemeris`.
 *
 * The UI, the sky map and several tools ask for the same night over and over while the
 * human drags the time slider, so the ephemeris is memoized by night and coordinates.
 * The time zone is deliberately NOT part of the key: it labels times, it does not move
 * the sky. Identity matters, callers rely on getting the very same object back.
 */

import { computeNightEphemeris } from './night'
import type { NightEphemeris, SiteCoords } from './night'

export const NIGHT_CACHE_LIMIT = 64

const cache = new Map<string, NightEphemeris>()

function cacheKey(nightOf: string, site: SiteCoords): string {
  return `${nightOf}|${site.latitude}|${site.longitude}|${site.elevationM}`
}

/** Memoized computeNightEphemeris keyed by nightOf|lat|lon|elev (LRU of 64). */
export function getNight(nightOf: string, site: SiteCoords): NightEphemeris {
  const key = cacheKey(nightOf, site)
  const hit = cache.get(key)
  if (hit) {
    // Re-insert so the most recently used entry is last in iteration order.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const night = computeNightEphemeris(nightOf, site)
  cache.set(key, night)
  while (cache.size > NIGHT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return night
}

/** Test and site-change helper: drop every memoized night. */
export function clearNightCache(): void {
  cache.clear()
}

/** Number of nights currently memoized. */
export function nightCacheSize(): number {
  return cache.size
}
