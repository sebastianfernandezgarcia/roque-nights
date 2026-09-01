/**
 * JSON Schema fragments shared by the tools.
 *
 * Data only: no logic lives here. The descriptions are read by the agent, so
 * they carry the rules the schema cannot express (pass BOTH coordinates, pass a
 * time zone if you want local times, dates are the EVENING the night starts).
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
    'Observing site. Omit to use the site currently shown in the app. When you pass coordinates, pass BOTH latitude and longitude, and pass time_zone (IANA, e.g. "Pacific/Honolulu") if you want local times; without it only UTC is returned.',
  properties: {
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
    name: { type: 'string', maxLength: 80 },
  },
  required: ['latitude', 'longitude'],
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
    'Target id or name: Messier id ("M31"), planet ("Jupiter"), "Moon", or a bright star name ("Vega").',
}
