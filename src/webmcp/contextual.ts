/**
 * The tool catalogue and the live registration that follows the store.
 *
 * Roque Nights does not show an agent 15 tools at all times. Eleven of them make
 * sense in an empty session; the three plan tools only exist while there IS a
 * plan, and `commit_proposal` only while a proposal is waiting for the person.
 * That is what `toolchange` is for, and it is honest here: the list an agent
 * sees really is a function of what the human and the agent have built so far.
 *
 * Two rules keep it safe:
 *  - the names live in `src/tools/contextualNames.ts`, the same module the
 *    mutating tools use to fill `tools_added` / `tools_removed`, so a tool's
 *    payload can never disagree with what is actually registered;
 *  - unregistration aborts the `AbortSignal` given to `registerTool` (the way
 *    the spec describes) AND calls `unregisterTool(name)` when the engine
 *    exposes it, because that method is optional in the current draft.
 *
 * Every registered tool is wrapped by `instrument`, so an agent call becomes a
 * visible line in the activity log: running, then ok or error, with a duration
 * and an excerpt of what the agent was told.
 */

import { store } from '../state/store'
import type { RoqueState } from '../state/store'
import {
  BASE_TOOL_NAMES,
  type ContextualState,
  contextualToolNames,
  currentToolNames,
  hasPendingProposal,
  hasPlan,
} from '../tools/contextualNames'
import { excerpt, fail } from '../tools/envelope'

import { clearPlanTool } from '../tools/clearPlan'
import { commitProposalTool } from '../tools/commitProposal'
import { compareDarkSkySitesTool } from '../tools/compareDarkSkySites'
import { describeCurrentViewTool } from '../tools/describeCurrentView'
import { exportPlanTool } from '../tools/exportPlan'
import { findObservableTargetsTool } from '../tools/findObservableTargets'
import { getCurrentPlanTool } from '../tools/getCurrentPlan'
import { getNightEphemerisTool } from '../tools/getNightEphemeris'
import { importPlanTool } from '../tools/importPlan'
import { modifyPlanTool } from '../tools/modifyPlan'
import { pointSkyMapTool } from '../tools/pointSkyMap'
import { proposePlanTool } from '../tools/proposePlan'
import { rankNightsTool } from '../tools/rankNights'
import { setObservingSiteTool } from '../tools/setObservingSite'
import { setObservingTimeTool } from '../tools/setObservingTime'

/** Which tools exist for a given state. Re-exported so callers need one import. */
export { currentToolNames }
export type { ContextualState }

// ---------------------------------------------------------------------------
// The groups. Order matches src/tools/contextualNames.ts on purpose: the names
// an agent is told about and the tools actually registered are the same list.
// ---------------------------------------------------------------------------

/** Always registered: tools 1, 2, 3, 4, 5, 6, 7, 11, 13, 14, 15 of docs/PLAN.md. */
export const BASE_TOOLS: ModelContextToolDefinition[] = [
  getNightEphemerisTool,
  findObservableTargetsTool,
  rankNightsTool,
  pointSkyMapTool,
  setObservingTimeTool,
  describeCurrentViewTool,
  proposePlanTool,
  importPlanTool,
  compareDarkSkySitesTool,
  clearPlanTool,
  setObservingSiteTool,
]

/** Registered while the committed plan has at least one item (tools 9, 10 and 12). */
export const PLAN_TOOLS: ModelContextToolDefinition[] = [
  getCurrentPlanTool,
  modifyPlanTool,
  exportPlanTool,
]

/** Registered while a proposal is still pending (tool 8). */
export const PROPOSAL_TOOLS: ModelContextToolDefinition[] = [commitProposalTool]

/** The 15 raw declarations, in the numbering of docs/PLAN.md. */
const ALL_TOOLS: ModelContextToolDefinition[] = [
  getNightEphemerisTool,
  findObservableTargetsTool,
  rankNightsTool,
  pointSkyMapTool,
  setObservingTimeTool,
  describeCurrentViewTool,
  proposePlanTool,
  commitProposalTool,
  modifyPlanTool,
  getCurrentPlanTool,
  clearPlanTool,
  exportPlanTool,
  importPlanTool,
  compareDarkSkySitesTool,
  setObservingSiteTool,
]

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------

/** Longest compact input kept in the activity log. The log is a glance, not a transcript. */
export const INPUT_DETAIL_LIMIT = 120

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** The agent's arguments, short enough to read at a glance. */
function compactInput(input: unknown): string {
  if (input === undefined || input === null) return 'no arguments'
  let text: string
  try {
    text = JSON.stringify(input) ?? String(input)
  } catch {
    text = '[input could not be serialized]'
  }
  if (text === '' || text === '{}') return 'no arguments'
  if (text.length <= INPUT_DETAIL_LIMIT) return text
  return `${text.slice(0, INPUT_DETAIL_LIMIT - 1)}…`
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** What the activity log should show for whatever the tool returned. */
function outcome(value: unknown): { status: 'ok' | 'error'; result: string } {
  if (typeof value === 'object' && value !== null && 'ok' in value) {
    const envelope = value as { ok: unknown; summary?: unknown; error?: { message?: unknown } }
    if (envelope.ok === false) {
      const message =
        typeof envelope.error?.message === 'string'
          ? envelope.error.message
          : 'the tool returned an error'
      return { status: 'error', result: excerpt(message) }
    }
    if (typeof envelope.summary === 'string') {
      return { status: 'ok', result: excerpt(envelope.summary) }
    }
  }
  return { status: 'ok', result: excerpt(describeValue(value)) }
}

/**
 * Tool calls running right now.
 *
 * Unregistering a group while one of its own tools is mid-call makes the engine
 * reject that call: Chrome's implementation drops the pending `executeTool`
 * when its tool disappears, so `commit_proposal` (which removes itself by
 * committing) came back to the agent as a failure even though the plan had been
 * applied. Deactivations therefore wait until no tool is running, and then for
 * one more macrotask so the engine can deliver the result first.
 */
let inFlightCalls = 0
const deferredDeactivations = new Set<() => void>()

function runWhenIdle(task: () => void): void {
  if (inFlightCalls === 0) {
    task()
    return
  }
  deferredDeactivations.add(task)
}

function flushDeferred(): void {
  if (inFlightCalls > 0 || deferredDeactivations.size === 0) return
  const tasks = [...deferredDeactivations]
  deferredDeactivations.clear()
  setTimeout(() => {
    for (const task of tasks) task()
  }, 0)
}

/**
 * Wrap a tool so every agent call is visible to the human: one activity entry
 * that goes `running` and then `ok` or `error`, with the duration in ms and an
 * excerpt of the summary the agent received (or of the error message).
 *
 * The wrapper never rejects. `defineTool` already turns exceptions into the
 * error envelope, but a tool registered from elsewhere (or a future refactor)
 * must not be able to break an agent's turn either.
 */
export function instrument(tool: ModelContextToolDefinition): ModelContextToolDefinition {
  return {
    ...tool,
    execute: async (input, options) => {
      const activityId = store.getState().beginActivity('agent', tool.name, compactInput(input))
      const startedAt = nowMs()
      inFlightCalls += 1
      try {
        const value = await tool.execute(input, options)
        const { status, result } = outcome(value)
        store.getState().endActivity(activityId, status, result, elapsedSince(startedAt))
        return value
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        store
          .getState()
          .endActivity(activityId, 'error', excerpt(message), elapsedSince(startedAt))
        return fail(
          'internal_error',
          `${tool.name} failed unexpectedly: ${message}`,
          'This is a bug in the page, not in your request. Retry once; if it fails again, use a different tool.',
        )
      } finally {
        inFlightCalls = Math.max(0, inFlightCalls - 1)
        flushDeferred()
      }
    },
  }
}

function elapsedSince(startedAt: number): number {
  return Math.round((nowMs() - startedAt) * 10) / 10
}

/**
 * All 15 tools for the in-app harness, the audit script and the docs, already
 * instrumented: a manual call from the harness lands in the activity log
 * exactly like an agent call, which is what the harness is for when the browser
 * has no WebMCP engine. The group arrays above hold the raw declarations and
 * are instrumented when they are registered.
 */
export const APP_TOOLS: ModelContextToolDefinition[] = ALL_TOOLS.map((tool) => instrument(tool))

// ---------------------------------------------------------------------------
// Contextual registration
// ---------------------------------------------------------------------------

interface ToolGroup {
  readonly tools: readonly ModelContextToolDefinition[]
  readonly isActive: (state: ContextualState) => boolean
  controller: AbortController | null
  /** True while a deactivation is waiting for the current tool call to finish. */
  deactivating: boolean
}

function activate(mc: ModelContext, group: ToolGroup): void {
  const controller = new AbortController()
  group.controller = controller
  for (const tool of group.tools) {
    try {
      const pending = mc.registerTool(instrument(tool), { signal: controller.signal })
      // An engine that rejects one tool must not take the page down with it.
      if (pending && typeof pending.catch === 'function') pending.catch(() => {})
    } catch {
      /* same reason: registration is best effort, the store stays truthful */
    }
  }
}

function deactivate(mc: ModelContext, group: ToolGroup): void {
  group.controller?.abort()
  group.controller = null
  const unregisterTool = mc.unregisterTool
  if (typeof unregisterTool !== 'function') return
  for (const tool of group.tools) {
    try {
      unregisterTool.call(mc, tool.name)
    } catch {
      /* the engine may already have dropped it when the signal aborted */
    }
  }
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index])
}

/**
 * Keep the engine's tool list in step with the store, and the store's
 * `webmcp.toolNames` in step with both. Returns a disposer that stops listening
 * and unregisters the contextual tools it had registered.
 *
 * `baseNames` is what the caller actually managed to register; it defaults to
 * all eleven, and the only reason to pass anything else is an engine that refused
 * one of them, in which case the badge should not claim it exists.
 */
export function startContextualSync(
  mc: ModelContext,
  baseNames: readonly string[] = BASE_TOOL_NAMES,
): () => void {
  const groups: ToolGroup[] = [
    { tools: PLAN_TOOLS, isActive: hasPlan, controller: null, deactivating: false },
    { tools: PROPOSAL_TOOLS, isActive: hasPendingProposal, controller: null, deactivating: false },
  ]
  // `setWebMCPStatus` is itself a store write, which calls this listener again.
  // The flag makes that second pass a no-op instead of a loop.
  let reconciling = false

  function reconcile(state: RoqueState): void {
    if (reconciling) return
    reconciling = true
    try {
      for (const group of groups) {
        const wanted = group.isActive(state)
        if (wanted && group.controller === null) activate(mc, group)
        else if (!wanted && group.controller !== null && !group.deactivating) {
          group.deactivating = true
          runWhenIdle(() => {
            group.deactivating = false
            // The state may have flipped back while the call was finishing.
            if (group.controller !== null && !group.isActive(store.getState())) {
              deactivate(mc, group)
            }
          })
        }
      }
      // The store is updated now, not when the engine catches up: `tools_removed`
      // in the payload of the call that caused the change has to be true the
      // moment the agent reads it.
      const names = [...baseNames, ...contextualToolNames(state)]
      if (!sameNames(state.webmcp.toolNames, names)) {
        store.getState().setWebMCPStatus(state.webmcp.status, names)
      }
    } finally {
      reconciling = false
    }
  }

  reconcile(store.getState())
  const unsubscribe = store.subscribe((state) => {
    reconcile(state)
  })

  return () => {
    unsubscribe()
    for (const group of groups) {
      // Tearing down is unconditional: a deferred deactivation for this engine
      // would otherwise fire after the page has moved on.
      group.deactivating = false
      if (group.controller !== null) deactivate(mc, group)
    }
  }
}
