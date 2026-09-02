/**
 * One validation path for the observing site, shared by the two ways to change it.
 *
 * Roque Nights exposes the site change twice on purpose: the declarative WebMCP
 * form in `src/ui/SiteForm.tsx` (the agent submits the very form the human uses)
 * and the imperative tool `set_observing_site` in `src/tools/setObservingSite.ts`
 * (the agent asks for it by name, without hunting for a form in the DOM). Both
 * paths call `applySitePayload`, so there is exactly one set of rules, one set of
 * error messages and one place that writes the store.
 *
 * The payload is keyed like a tool argument (snake_case) because that is also
 * what `new FormData(form)` produces from the form's field names: a submit and an
 * `agentInvoked` can therefore never disagree about what was asked for.
 *
 * The rule the whole app is built on holds here too: we never invent a time zone.
 * Coordinates with no zone get `timeZone: null` and UTC-only times; coordinates
 * that land on a dark-sky catalog site borrow that site's identity and zone.
 */

import { DARK_SKY_SITES, findSite } from '../data/sites'
import { ROQUE_DE_LOS_MUCHACHOS, store } from '../state/store'
import type { ActorSource, Site } from '../state/types'
import type { ToolErrorCode } from '../tools/envelope'
import { isToolError } from '../tools/envelope'
import { TIME_ZONE_HINT, resolveSite } from '../tools/resolveSite'

/** The value the site select uses for "not a catalog site"; never an id. */
export const CUSTOM_SITE_ID = 'custom'

/** How many catalog ids to spell out when the caller named one that does not exist. */
const HINT_IDS = 6

export const SITE_PAYLOAD_HINT =
  'Name a dark-sky catalog site with site_id (roque, mauna-kea, paranal, ...), or pass BOTH latitude and longitude in decimal degrees (longitude EAST positive), plus optional elevation_m, time_zone (IANA) and name.'

export interface SitePayloadError {
  ok: false
  error: { code: ToolErrorCode; message: string; hint: string }
}

export interface SitePayloadResolved {
  ok: true
  site: Site
  /** What the resolver had to admit: an inferred zone, or no zone at all. */
  caveats: string[]
}

export interface SitePayloadApplied {
  ok: true
  site: Site
  summary: string
}

/** One sentence a human can read in the form and an agent can quote back. */
export function describeSite(site: Site): string {
  const zone = site.timeZone ?? 'no time zone, local times will be UTC'
  return `Site set to ${site.name} (${site.latitude.toFixed(3)}, ${site.longitude.toFixed(3)}, ${Math.round(site.elevationM)} m, ${zone}).`
}

function catalogHint(): string {
  return `Use one of: ${DARK_SKY_SITES.slice(0, HINT_IDS)
    .map((site) => site.id)
    .join(', ')} (${DARK_SKY_SITES.length} in total), or pass latitude and longitude.`
}

function siteError(message: string, hint: string, code: ToolErrorCode = 'invalid_site'): SitePayloadError {
  return { ok: false, error: { code, message, hint } }
}

/** The first of `keys` present as a non-empty string. Numbers are accepted as text. */
function readText(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed !== '') return trimmed
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  }
  return null
}

/**
 * A coordinate as the caller sent it: a number from an agent, a string from a
 * form field. An unparseable value is passed through untouched so `resolveSite`
 * can name it in the error instead of silently dropping it.
 */
function readNumeric(payload: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = payload[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '') continue
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : value
    }
    return value
  }
  return undefined
}

function fromCatalog(idOrName: string): Site | null {
  const hit = findSite(idOrName)
  if (!hit) return null
  const { country: _country, kind: _kind, ...site } = hit
  return site
}

/**
 * Turn a payload into a site, or into a refusal. Pure: nothing is applied.
 *
 * Accepted shapes, in this order of precedence:
 *  - `site_id` or `id` naming a dark-sky catalog site (matched the same forgiving
 *    way the tools match it: "Mauna Kea", "MAUNA-KEA" and " mauna-kea " all work);
 *  - `latitude` and `longitude`, with optional `elevation_m`, `time_zone`, `name`;
 *  - a bare `name` that happens to be a catalog site.
 *
 * Coordinates win over an id that resolves to nothing, so a caller that guessed an
 * id but knows where it is standing still gets the right sky.
 */
export function resolveSitePayload(
  payload: Record<string, unknown>,
): SitePayloadResolved | SitePayloadError {
  const rawId = readText(payload, 'site_id', 'id')
  const namedId = rawId !== null && rawId.toLowerCase() !== CUSTOM_SITE_ID ? rawId : null
  const latitude = readNumeric(payload, 'latitude')
  const longitude = readNumeric(payload, 'longitude')
  const hasCoordinates = latitude !== undefined || longitude !== undefined
  const name = readText(payload, 'name')

  if (namedId !== null) {
    const site = fromCatalog(namedId)
    if (site) return { ok: true, site, caveats: [] }
    // An id nobody knows must never be answered with "site set to" the place the
    // app was already showing: that is the one failure mode a person cannot see.
    if (!hasCoordinates) {
      return siteError(`"${namedId}" is not a known dark-sky site id.`, catalogHint())
    }
  }

  if (!hasCoordinates) {
    if (name !== null) {
      const site = fromCatalog(name)
      if (site) return { ok: true, site, caveats: [] }
      return siteError(
        `No dark-sky site matches "${name}", and latitude and longitude are missing.`,
        SITE_PAYLOAD_HINT,
      )
    }
    return siteError(
      'Nothing to set: name a dark-sky catalog site, or pass both latitude and longitude.',
      SITE_PAYLOAD_HINT,
    )
  }

  const elevation = readNumeric(payload, 'elevation_m', 'elevation')
  const timeZone = readText(payload, 'time_zone', 'timezone')
  // The fallback is unreachable: `resolveSite` only returns it for an empty
  // object, and at least one coordinate is present here.
  const resolved = resolveSite(
    {
      latitude,
      longitude,
      ...(elevation === undefined ? {} : { elevation_m: elevation }),
      ...(timeZone === null ? {} : { time_zone: timeZone }),
      ...(name === null ? {} : { name }),
    },
    ROQUE_DE_LOS_MUCHACHOS,
  )
  if (isToolError(resolved)) {
    const code = resolved.error.code
    return siteError(
      resolved.error.message,
      code === 'invalid_time_zone' ? (resolved.error.hint ?? TIME_ZONE_HINT) : SITE_PAYLOAD_HINT,
      code,
    )
  }
  return { ok: true, site: resolved.site, caveats: resolved.caveats }
}

/**
 * Resolve a payload and move the app to it, attributed to whoever asked.
 *
 * This is the only function that writes the site: the form's submit button, the
 * form's `agentInvoked` handler and the `set_observing_site` tool all end here.
 */
export function applySitePayload(
  payload: Record<string, unknown>,
  source: ActorSource,
): SitePayloadApplied | SitePayloadError {
  const resolved = resolveSitePayload(payload)
  if (!resolved.ok) return resolved
  store.getState().setSite(resolved.site, source)
  return { ok: true, site: resolved.site, summary: describeSite(resolved.site) }
}
