/**
 * JSON Schema fragments shared by the tools.
 *
 * Data only: no logic lives here. The descriptions are read by the agent, so
 * they carry the rules the schema cannot express (name a catalog site or pass
 * BOTH coordinates, pass a time zone if you want local times, dates are the
 * EVENING the night starts).
 */

export type JsonSchema = Record<string, unknown>

export const DATE_SCHEMA: JsonSchema = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description:
    'Local calendar date of the EVENING the night starts (YYYY-MM-DD). Omit for the night currently selected in the app.',
}

export const SITE_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'Observing site to compute for. Omit to use the site currently shown in the app. Otherwise name a dark-sky catalog site with id (preferred) or name, OR pass BOTH latitude and longitude, plus time_zone (IANA, e.g. "Pacific/Honolulu") if you want local times; without a zone only UTC is returned. An object that does neither comes back as invalid_site with a hint. Answering for a site here does NOT move the app: to change the site the page itself shows, call the tool set_observing_site (the page also carries a declarative form of the same name, and both go through the same validation).',
  properties: {
    id: {
      type: 'string',
      maxLength: 40,
      description:
        'Dark-sky catalog id such as roque, mauna-kea, paranal; preferred over coordinates because it brings the exact elevation and IANA zone.',
    },
    latitude: {
      type: 'number',
      minimum: -90,
      maximum: 90,
      description: 'Decimal degrees, north positive.',
    },
    longitude: {
      type: 'number',
      minimum: -180,
      maximum: 180,
      description: 'Decimal degrees, EAST positive (Mauna Kea is -155.47).',
    },
    elevation_m: { type: 'number', minimum: -430, maximum: 9000 },
    time_zone: { type: 'string', description: 'IANA time zone name.' },
    name: {
      type: 'string',
      maxLength: 80,
      description:
        'Catalog site name ("Mauna Kea", matched loosely) when you pass no coordinates, or the label for the coordinates when you do.',
    },
  },
  // No `required` and no top-level `anyOf`: the two valid shapes (a catalog id
  // or name, or a latitude/longitude pair) cannot both be expressed here
  // without constructs that strict function-calling validators reject.
  // `resolveSite` enforces them at runtime and returns invalid_site otherwise.
  additionalProperties: false,
}

export const TARGET_TYPES = [
  'galaxy',
  'open_cluster',
  'globular_cluster',
  'planetary_nebula',
  'diffuse_nebula',
  'supernova_remnant',
  'other',
  'planet',
  'moon',
  'star',
] as const

/** Union of the target types an agent may filter by; matches TargetType in src/state/types.ts. */
export type TargetTypeName = (typeof TARGET_TYPES)[number]

export const TARGET_REF_SCHEMA: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 60,
  description:
    'Target id or common name; matching ignores case, spaces and punctuation. Accepted: a Messier id in any spelling ("M31", "M 31", "messier 31"), the object common name or NGC designation ("Ring Nebula", "Andromeda Galaxy", "Pleiades", "NGC 7089"), a planet ("Jupiter", "Saturn"), "Moon", or a bright star ("Vega"). The Sun is not an observing target. A name that does not resolve comes back as unknown_target with the closest matches, so retry with one of those rather than guessing again.',
}
