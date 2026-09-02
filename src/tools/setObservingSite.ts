/**
 * Tool 15: set_observing_site.
 *
 * The only tool that moves the app to another place on Earth. Everything else
 * that takes a `site` argument answers ABOUT a place without moving the page,
 * which is what you want for a comparison and exactly what you do not want when
 * the person says "we are driving up to Mauna Kea tonight".
 *
 * There are deliberately two ways to do this: the declarative form in
 * src/ui/SiteForm.tsx (the agent submits the same form the human uses) and this
 * imperative tool (the agent asks for it by name, without hunting for a form in
 * a DOM it cannot see). They are not two implementations: both call
 * `applySitePayload`, so there is one validator, one set of error messages and
 * one place that writes the store.
 *
 * Changing the site does not delete the plan. It marks it stale: the person sees
 * a Revalidate banner, `export_plan` refuses with `plan_stale`, and this tool
 * says so in a caveat so the agent can explain it instead of being surprised.
 */

import { applySitePayload } from '../site/applySitePayload'
import { planStaleness, store, type PlanStaleReason } from '../state/store'
import type { SiteRef, ToolResult } from './envelope'
import { defineTool, fail, ok, siteRef } from './envelope'
import { SITE_SCHEMA, type JsonSchema } from './schemas'

export interface SetObservingSiteData {
  /** The site the app is now showing, exactly as every other tool reports it. */
  site: SiteRef
  night_of: string
  plan_items: number
  /** True when the committed plan was scheduled for another sky. */
  plan_stale: boolean
  plan_stale_reason: PlanStaleReason | null
  plan_built_for: { site_name: string; night_of: string } | null
}

const SITE_PROPERTIES = SITE_SCHEMA.properties as Record<string, JsonSchema>

const INPUT_SCHEMA = {
  type: 'object',
  description:
    'Where to move the app. Name a dark-sky catalog site with site_id (or id), OR pass BOTH latitude and longitude, plus time_zone (IANA) if you want local times rather than UTC only.',
  properties: {
    site_id: {
      type: 'string',
      maxLength: 40,
      description:
        'Dark-sky catalog id such as roque, mauna-kea, paranal. Same thing as id, spelled the way a form field is. Preferred over coordinates because it brings the exact elevation and IANA zone.',
    },
    ...SITE_PROPERTIES,
  },
  // No `required`: the two valid shapes (a catalog id or name, or a
  // latitude/longitude pair) cannot both be expressed here without constructs
  // that strict function-calling validators reject. `applySitePayload` enforces
  // them at runtime and returns invalid_site otherwise.
  additionalProperties: false,
} as const

export const SET_OBSERVING_SITE_DESCRIPTION =
  'Use this to move the whole app to another observing site: the night ephemeris, the sky map, the night strip and every altitude in the page recompute for it, and the person sees the move happen. Name a dark-sky catalog site with site_id ("mauna-kea", "paranal", "roque"), or pass latitude and longitude in decimal degrees (longitude EAST positive) with optional elevation_m, time_zone (IANA) and name. Every read-only tool also accepts its own one-off site argument, which answers for that place WITHOUT moving the app: use that to compare places, and use this only when the page itself should move. Idempotent. A committed plan is not deleted by the move: it is marked stale, the person gets a Revalidate banner, and export_plan refuses with plan_stale until they revalidate or keep it anyway.'

function run(input: Record<string, unknown>): ToolResult<SetObservingSiteData> {
  const applied = applySitePayload(input, 'agent')
  if (!applied.ok) return fail(applied.error.code, applied.error.message, applied.error.hint)

  const state = store.getState()
  const site = applied.site
  const staleness = planStaleness(state)
  const caveats: string[] = []

  if (site.timeZone === null) {
    caveats.push(
      'These coordinates have no IANA time zone, so every time from now on is UTC only. Call this again with time_zone to get local times.',
    )
  }
  if (staleness.stale && staleness.builtFor) {
    caveats.push(
      `The committed plan (${state.plan.length} item${state.plan.length === 1 ? '' : 's'}) was built for ${staleness.builtFor.siteName}, night of ${staleness.builtFor.nightOf}, so its times are no longer true here. The person now sees a "Revalidate plan" banner in the Plan panel; export_plan refuses with plan_stale until they click Revalidate plan or Keep anyway.`,
    )
  }

  const stalePhrase = staleness.stale
    ? ` The plan of ${state.plan.length} item${state.plan.length === 1 ? '' : 's'} was built for another sky and is now marked stale.`
    : ''
  const summary = `${applied.summary} The app is now on the night of ${state.nightOf} at ${site.name}.${stalePhrase}`

  return ok<SetObservingSiteData>(
    summary,
    {
      site: siteRef(site),
      night_of: state.nightOf,
      plan_items: state.plan.length,
      plan_stale: staleness.stale,
      plan_stale_reason: staleness.reason,
      plan_built_for: staleness.builtFor
        ? { site_name: staleness.builtFor.siteName, night_of: staleness.builtFor.nightOf }
        : null,
    },
    site,
    { caveats },
  )
}

export const setObservingSiteTool: ModelContextToolDefinition = defineTool<SetObservingSiteData>({
  name: 'set_observing_site',
  title: 'Move the app to another observing site',
  description: SET_OBSERVING_SITE_DESCRIPTION,
  inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run,
})
