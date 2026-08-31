import { computeNightConditions, formatInZone } from '../astro/conditions'
import { store } from '../state/store'

/**
 * Spike tool: proves the full WebMCP circuit end-to-end (register → agent
 * call → real astronomy computed client-side → verifiable rich return →
 * activity visible in the UI).
 */
export const getObservingConditionsTool: ModelContextToolDefinition = {
  name: 'get_observing_conditions',
  title: 'Get observing conditions for a night',
  description:
    'Use this to get the real astronomical observing conditions for a night at a given site: sunset/sunrise, the true astronomical darkness window (Sun below -18 degrees), moonrise/moonset, Moon phase and illumination, total dark hours and how many of them are Moon-free. Computed locally in the browser with the astronomy-engine ephemeris, no server involved. Defaults to the night and site currently shown in the app. Times are returned in both UTC and the site local time zone so you can verify and quote them.',
  inputSchema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description:
          'Local calendar date of the EVENING the night starts, format YYYY-MM-DD. Omit to use the night currently selected in the app.',
      },
      latitude: {
        type: 'number',
        minimum: -90,
        maximum: 90,
        description: 'Decimal degrees. Omit to use the site currently shown in the app.',
      },
      longitude: {
        type: 'number',
        minimum: -180,
        maximum: 180,
        description: 'Decimal degrees, east positive. Omit to use the current site.',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  execute: async (input) => {
    const state = store.getState()
    const site =
      typeof input.latitude === 'number' && typeof input.longitude === 'number'
        ? {
            ...state.site,
            name: `${input.latitude.toFixed(3)}, ${input.longitude.toFixed(3)}`,
            latitude: input.latitude,
            longitude: input.longitude,
          }
        : state.site
    const nightOf = typeof input.date === 'string' ? input.date : state.nightOf

    const c = computeNightConditions(nightOf, site)
    const tz = site.timeZone

    const summary =
      `Night of ${c.nightOf} at ${site.name}: astronomical darkness from ` +
      `${formatInZone(c.darknessStartUtc, tz)} to ${formatInZone(c.darknessEndUtc, tz)} local ` +
      `(${c.darkHours ?? '—'} h), Moon ${c.moonIlluminationPct}% illuminated (${c.moonPhaseName}), ` +
      `${c.moonFreeDarkHours ?? '—'} of those dark hours are Moon-free.`

    return {
      ok: true,
      summary,
      data: {
        ...c,
        localTimes: {
          timeZone: tz,
          sunset: formatInZone(c.sunsetUtc, tz),
          darknessStart: formatInZone(c.darknessStartUtc, tz),
          darknessEnd: formatInZone(c.darknessEndUtc, tz),
          sunrise: formatInZone(c.sunriseUtc, tz),
          moonrise: formatInZone(c.moonriseUtc, tz),
          moonset: formatInZone(c.moonsetUtc, tz),
        },
      },
      site: { name: site.name, latitude: site.latitude, longitude: site.longitude },
      as_of: new Date().toISOString(),
    }
  },
}
