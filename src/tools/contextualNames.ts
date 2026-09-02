/**
 * Which tools exist right now, and what changed after a mutation.
 *
 * Roque Nights registers three plan tools only while there is a plan and the
 * commit tool only while a proposal is waiting for the person, so the tool list
 * an agent sees is a function of the store. Models do not re-read that list on
 * their own: the tool that caused the change has to say so in its own payload
 * (`tools_added` / `tools_removed`). Every mutating tool therefore snapshots the
 * state before and after its work and diffs it with `toolsDelta`.
 *
 * Pure and dependency free on purpose: the WebMCP registration layer
 * (src/webmcp) reuses these names to decide what to register and unregister.
 */

import type { RoqueData } from '../state/store'

/** Always registered: they make sense with an empty app. */
export const BASE_TOOL_NAMES = [
  'get_night_ephemeris',
  'find_observable_targets',
  'rank_nights',
  'point_sky_map',
  'set_observing_time',
  'describe_current_view',
  'propose_plan',
  'import_plan',
  'compare_dark_sky_sites',
  // Always registered even with an empty plan: clear_plan hands out the undo
  // token, so unregistering it the moment it succeeds would take the undo away
  // with it.
  'clear_plan',
  // Moving the app to another site makes sense at any moment, plan or no plan.
  'set_observing_site',
] as const

/** Registered while the committed plan has at least one item. */
export const PLAN_TOOL_NAMES = ['get_current_plan', 'modify_plan', 'export_plan'] as const

/** Registered while at least one proposal is still pending. */
export const PROPOSAL_TOOL_NAMES = ['commit_proposal'] as const

/** The only part of the store that decides which tools exist. */
export type ContextualState = Pick<RoqueData, 'plan' | 'proposals'>

export function hasPlan(state: ContextualState): boolean {
  return state.plan.length > 0
}

export function hasPendingProposal(state: ContextualState): boolean {
  return state.proposals.some((proposal) => proposal.status === 'pending')
}

/** The contextual tool names alive for this state, in registration order. */
export function contextualToolNames(state: ContextualState): string[] {
  const names: string[] = []
  if (hasPlan(state)) names.push(...PLAN_TOOL_NAMES)
  if (hasPendingProposal(state)) names.push(...PROPOSAL_TOOL_NAMES)
  return names
}

/** Base plus contextual: everything an agent can call against this state. */
export function currentToolNames(state: ContextualState): string[] {
  return [...BASE_TOOL_NAMES, ...contextualToolNames(state)]
}

export interface ToolsDelta {
  tools_added: string[]
  tools_removed: string[]
}

/** What appeared and what disappeared between two states. Both lists keep registration order. */
export function toolsDelta(before: ContextualState, after: ContextualState): ToolsDelta {
  const had = new Set(contextualToolNames(before))
  const has = new Set(contextualToolNames(after))
  return {
    tools_added: contextualToolNames(after).filter((name) => !had.has(name)),
    tools_removed: contextualToolNames(before).filter((name) => !has.has(name)),
  }
}
