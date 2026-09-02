/**
 * Tool 11: clear_plan.
 *
 * The only destructive tool in the app, and the one place where the human veto
 * is wired into the protocol instead of into a modal: without `confirm:true`
 * nothing is deleted, the page raises a confirmation banner for the person, and
 * the agent gets `confirmation_required` back so it can ask out loud. The
 * execute path never waits for a click (an agent turn must not hang on a human).
 *
 * A successful clear returns an undo token that is good for five minutes, and
 * this is the one plan tool that is registered even when the plan is empty:
 * clearing it is exactly what empties it, so an agent that lost the tool the
 * moment it succeeded would be holding an undo token it could never spend.
 */

import { UNDO_TTL_MS, store } from '../state/store'
import { toolsDelta } from './contextualNames'
import type { ToolResult } from './envelope'
import { defineTool, fail, ok } from './envelope'

export const CLEAR_PLAN_CONFIRMATION_MESSAGE =
  'The agent asked to clear the plan. Confirm in the Plan panel or tell the agent to proceed.'

export interface ClearPlanData {
  action: 'cleared' | 'restored'
  removed_items: number
  restored_items: number
  undo_token: string | null
  undo_expires_at: string | null
  plan_size: number
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    confirm: {
      type: 'boolean',
      description:
        'Must be true to actually delete the plan. Ask the person first; without it nothing is deleted.',
    },
    undo_token: {
      type: 'string',
      minLength: 1,
      maxLength: 80,
      description: 'Token returned by a previous clear_plan; restores that plan within 5 minutes.',
    },
  },
  additionalProperties: false,
} as const

function undoMinutes(): number {
  return Math.round(UNDO_TTL_MS / 60_000)
}

function run(input: Record<string, unknown>): ToolResult<ClearPlanData> {
  const state = store.getState()
  const site = state.site

  const rawToken = input.undo_token
  if (rawToken !== undefined && rawToken !== null && typeof rawToken !== 'string') {
    return fail('invalid_input', 'undo_token must be the string a previous clear_plan returned.')
  }
  if (input.confirm !== undefined && input.confirm !== null && typeof input.confirm !== 'boolean') {
    return fail('invalid_input', 'confirm must be true or false.')
  }

  const hasToken = typeof rawToken === 'string' && rawToken.trim() !== ''
  // Deleting and restoring in one call is two opposite intentions: doing either
  // one silently would be a coin toss with the person's plan.
  if (hasToken && input.confirm === true) {
    return fail(
      'invalid_input',
      'Pass either confirm:true to clear or undo_token to restore, not both.',
      'Example: { "undo_token": "<token>" }',
    )
  }

  // --- branch 1: undo -------------------------------------------------------
  if (hasToken) {
    const before = store.getState()
    const restored = before.undoClear(rawToken, 'agent')
    if (!restored) {
      return fail(
        'nothing_to_undo',
        `No plan can be restored with that token: it is unknown or older than ${undoMinutes()} minutes.`,
        'Rebuild the plan with propose_plan, or ask the person whether they still want it.',
      )
    }
    const after = store.getState()
    return ok(
      `Restored ${after.plan.length} item${after.plan.length === 1 ? '' : 's'} to the plan for the night of ${after.nightOf} at ${site.name}.`,
      {
        action: 'restored',
        removed_items: 0,
        restored_items: after.plan.length,
        undo_token: null,
        undo_expires_at: null,
        plan_size: after.plan.length,
      },
      site,
      { ...toolsDelta(before, after) },
    )
  }

  // --- branch 2: no confirmation -------------------------------------------
  if (input.confirm !== true) {
    store.getState().setPendingConfirmation({
      tool: 'clear_plan',
      message: CLEAR_PLAN_CONFIRMATION_MESSAGE,
      at: new Date().toISOString(),
    })
    const count = state.plan.length
    return fail(
      'confirmation_required',
      `Clearing the plan would delete ${count} item${count === 1 ? '' : 's'} and nothing was deleted. The person now sees a confirmation banner in the Plan panel.`,
      'Ask the person, then call again with confirm:true.',
    )
  }

  // --- branch 3: clear ------------------------------------------------------
  const before = store.getState()
  const removed = before.plan.length
  const token = before.clearPlan('agent')
  const after = store.getState()
  const expiresAt = after.undo?.expiresAt ?? new Date(Date.now() + UNDO_TTL_MS).toISOString()

  const caveats: string[] =
    removed === 0
      ? ['The plan was already empty, so nothing was removed.']
      : [`The undo token expires at ${expiresAt} (${undoMinutes()} minutes).`]

  return ok(
    `Cleared ${removed} item${removed === 1 ? '' : 's'} from the plan for the night of ${after.nightOf} at ${site.name}. Call clear_plan again with undo_token "${token}" within ${undoMinutes()} minutes to restore it.`,
    {
      action: 'cleared',
      removed_items: removed,
      restored_items: 0,
      undo_token: token,
      undo_expires_at: expiresAt,
      plan_size: 0,
    },
    site,
    { caveats, ...toolsDelta(before, after) },
  )
}

export const clearPlanTool: ModelContextToolDefinition = defineTool<ClearPlanData>({
  name: 'clear_plan',
  title: 'Delete the whole plan (destructive)',
  description: `Use this to delete the whole committed plan. DESTRUCTIVE: requires confirm:true. Without confirm nothing is deleted; instead the app shows the person a confirmation banner and this returns confirmation_required. On success returns an undo_token valid for 5 minutes; call clear_plan again with { undo_token } to restore the plan. confirm:true and undo_token in the same call are opposite intentions and come back as invalid_input. Stays registered when the plan is empty so the undo is always reachable.`,
  inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  run,
})
