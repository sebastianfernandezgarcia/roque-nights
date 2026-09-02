/**
 * The one sentence the tools use to say that the plan and the app disagree.
 *
 * A committed plan is scheduled for a particular sky: a site and an observing
 * night (see `planContext` in src/state/store.ts). Move the app to Mauna Kea and
 * every time in the plan silently becomes wrong, so the page raises a Revalidate
 * banner for the person and the tools stop pretending: `export_plan` refuses with
 * `plan_stale` and `get_current_plan` says so in a caveat. Both use exactly the
 * same wording, because an agent that hears two versions of a fact reports the
 * one it heard last.
 */

import { planStaleness, type RoqueData } from '../state/store'

export const PLAN_STALE_HINT =
  'Ask the person to click Revalidate plan or Keep anyway in the Plan panel, then export again.'

/** The part of the store this needs: safe to call with a plain snapshot. */
export type PlanStaleInput = Pick<RoqueData, 'plan' | 'planContext' | 'site' | 'nightOf'>

/** The sentence, or null when the plan still matches the sky the app is showing. */
export function planStaleMessage(state: PlanStaleInput): string | null {
  const { stale, builtFor } = planStaleness(state)
  if (!stale || !builtFor) return null
  return (
    `The plan was built for ${builtFor.siteName}, night of ${builtFor.nightOf}, ` +
    `and the app now shows ${state.site.name}, night of ${state.nightOf}.`
  )
}
