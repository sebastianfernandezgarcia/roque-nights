import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetStore, store } from '../state/store'
import type { PlanItem } from '../state/types'
import {
  BASE_TOOL_NAMES,
  PLAN_TOOL_NAMES,
  PROPOSAL_TOOL_NAMES,
} from '../tools/contextualNames'
import {
  APP_TOOLS,
  BASE_TOOLS,
  PLAN_TOOLS,
  PROPOSAL_TOOLS,
  currentToolNames,
  startContextualSync,
} from './contextual'

/**
 * A stand-in for the browser's WebMCP engine. It records what was registered,
 * honours the AbortSignal the way the spec says an engine should, and can be
 * built with or without the optional `unregisterTool` so both code paths of the
 * feature detection are exercised.
 */
class FakeModelContext extends EventTarget implements ModelContext {
  readonly registered = new Map<string, ModelContextToolDefinition>()
  readonly registerLog: string[] = []
  readonly unregisterLog: string[] = []
  ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null = null
  unregisterTool?: (name: string) => void
  private honourAbort = true

  constructor(options?: { withUnregisterTool?: boolean; honourAbort?: boolean }) {
    super()
    this.honourAbort = options?.honourAbort ?? true
    if (options?.withUnregisterTool) {
      this.unregisterTool = (name: string) => {
        this.unregisterLog.push(name)
        this.registered.delete(name)
      }
    }
  }

  registerTool(
    tool: ModelContextToolDefinition,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    this.registered.set(tool.name, tool)
    this.registerLog.push(tool.name)
    if (this.honourAbort) {
      options?.signal?.addEventListener('abort', () => {
        this.registered.delete(tool.name)
      })
    }
    return Promise.resolve()
  }

  getTools(): Promise<RegisteredModelContextTool[]> {
    return Promise.resolve(
      [...this.registered.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    )
  }

  executeTool(
    tool: RegisteredModelContextTool,
    input?: Record<string, unknown>,
  ): Promise<string> {
    const found = this.registered.get(tool.name)
    if (!found) return Promise.reject(new Error(`unknown tool ${tool.name}`))
    return Promise.resolve(found.execute(input ?? {})).then((value) => JSON.stringify(value))
  }

  /** Names currently visible to an agent, in registration order. */
  names(): string[] {
    return [...this.registered.keys()]
  }
}

function planItem(targetId: string, startUtc: string, endUtc: string): PlanItem {
  return {
    id: `item-${targetId}`,
    targetId,
    targetName: targetId,
    startUtc,
    endUtc,
    source: 'agent',
  }
}

const M31 = planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')

function addPendingProposal(): string {
  return store.getState().addProposal({
    items: [],
    unscheduled: [],
    replaceExisting: false,
    origin: 'agent',
  }).id
}

beforeEach(() => {
  resetStore()
})

describe('tool groups', () => {
  it('registers the 9 tools that make sense with an empty session', () => {
    expect(BASE_TOOLS.map((tool) => tool.name)).toEqual([...BASE_TOOL_NAMES])
    expect(BASE_TOOLS).toHaveLength(9)
  })

  it('keeps the 4 plan tools and the 1 proposal tool contextual', () => {
    expect(PLAN_TOOLS.map((tool) => tool.name)).toEqual([...PLAN_TOOL_NAMES])
    expect(PROPOSAL_TOOLS.map((tool) => tool.name)).toEqual([...PROPOSAL_TOOL_NAMES])
  })

  it('exposes all 14 tools, once each, in the numbering of the plan', () => {
    expect(APP_TOOLS.map((tool) => tool.name)).toEqual([
      'get_night_ephemeris',
      'find_observable_targets',
      'rank_nights',
      'point_sky_map',
      'set_observing_time',
      'describe_current_view',
      'propose_plan',
      'commit_proposal',
      'modify_plan',
      'get_current_plan',
      'clear_plan',
      'export_plan',
      'import_plan',
      'compare_dark_sky_sites',
    ])
    expect(new Set(APP_TOOLS.map((tool) => tool.name)).size).toBe(14)
    expect(new Set(APP_TOOLS.map((tool) => tool.name))).toEqual(
      new Set([...BASE_TOOLS, ...PLAN_TOOLS, ...PROPOSAL_TOOLS].map((tool) => tool.name)),
    )
  })

  it('hands the harness instrumented copies so manual calls are logged too', async () => {
    const describeView = APP_TOOLS.find((tool) => tool.name === 'describe_current_view')
    expect(describeView).toBeDefined()
    const result = (await describeView!.execute({})) as { ok: boolean }
    expect(result.ok).toBe(true)

    const entry = store.getState().activity.find((item) => item.action === 'describe_current_view')
    expect(entry).toBeDefined()
    expect(entry!.source).toBe('agent')
    expect(entry!.status).toBe('ok')
  })

  it('keeps the declaration the harness and the docs read', () => {
    const raw = BASE_TOOLS.find((tool) => tool.name === 'get_night_ephemeris')!
    const exposed = APP_TOOLS.find((tool) => tool.name === 'get_night_ephemeris')!
    expect(exposed.title).toBe(raw.title)
    expect(exposed.description).toBe(raw.description)
    expect(exposed.inputSchema).toBe(raw.inputSchema)
    expect(exposed.annotations).toBe(raw.annotations)
  })
})

describe('currentToolNames', () => {
  it('lists only the base tools for an empty session', () => {
    expect(currentToolNames(store.getState())).toEqual([...BASE_TOOL_NAMES])
    expect(currentToolNames(store.getState())).toHaveLength(9)
  })

  it('adds the plan tools once the plan has items', () => {
    store.getState().setPlan([M31], 'agent', 'test')
    const names = currentToolNames(store.getState())
    expect(names).toHaveLength(13)
    expect(names).toContain('modify_plan')
    expect(names).not.toContain('commit_proposal')
  })

  it('adds commit_proposal while a proposal is pending', () => {
    addPendingProposal()
    const names = currentToolNames(store.getState())
    expect(names).toHaveLength(10)
    expect(names).toContain('commit_proposal')
  })

  it('lists all 14 with both a plan and a pending proposal', () => {
    store.getState().setPlan([M31], 'agent', 'test')
    addPendingProposal()
    expect(currentToolNames(store.getState()).slice().sort()).toEqual(
      APP_TOOLS.map((tool) => tool.name)
        .slice()
        .sort(),
    )
  })
})

describe('startContextualSync', () => {
  let mc: FakeModelContext
  let stop: () => void

  beforeEach(() => {
    mc = new FakeModelContext()
    stop = startContextualSync(mc)
  })

  afterEach(() => {
    stop()
  })

  it('registers nothing extra for an empty session but reports the base names', () => {
    expect(mc.names()).toEqual([])
    expect(store.getState().webmcp.toolNames).toEqual([...BASE_TOOL_NAMES])
    expect(store.getState().webmcp.toolCount).toBe(9)
  })

  it('registers the plan tools when the plan gets items and drops them when it is cleared', () => {
    store.getState().setPlan([M31], 'agent', 'test')
    expect(mc.names()).toEqual([...PLAN_TOOL_NAMES])
    expect(store.getState().webmcp.toolNames).toHaveLength(13)

    store.getState().clearPlan('human')
    expect(mc.names()).toEqual([])
    expect(store.getState().webmcp.toolNames).toEqual([...BASE_TOOL_NAMES])
  })

  it('does not re-register the plan tools while the plan keeps changing', () => {
    store.getState().setPlan([M31], 'agent', 'test')
    store.getState().setPlan(
      [M31, planItem('M13', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z')],
      'agent',
      'test',
    )
    expect(mc.registerLog).toEqual([...PLAN_TOOL_NAMES])
  })

  it('registers commit_proposal only while a proposal is pending', () => {
    const proposalId = addPendingProposal()
    expect(mc.names()).toEqual([...PROPOSAL_TOOL_NAMES])
    expect(store.getState().webmcp.toolNames).toContain('commit_proposal')

    store.getState().dismissProposal(proposalId, 'human')
    expect(mc.names()).toEqual([])
    expect(store.getState().webmcp.toolNames).not.toContain('commit_proposal')
  })

  it('registers instrumented tools: an agent call lands in the activity log', async () => {
    store.getState().setPlan([M31], 'agent', 'test')
    const clear = mc.registered.get('clear_plan')
    expect(clear).toBeDefined()

    const result = (await clear!.execute({})) as { ok: boolean }
    expect(result.ok).toBe(false)
    const entry = store.getState().activity.find((item) => item.action === 'clear_plan')
    expect(entry).toBeDefined()
    expect(entry!.source).toBe('agent')
    expect(entry!.status).toBe('error')
  })

  it('stops reacting to the store after the returned disposer runs', () => {
    stop()
    store.getState().setPlan([M31], 'agent', 'test')
    expect(mc.names()).toEqual([])
    expect(store.getState().webmcp.toolNames).toEqual([...BASE_TOOL_NAMES])
  })
})

describe('startContextualSync unregistration paths', () => {
  it('calls unregisterTool for every contextual tool when the engine exposes it', () => {
    const mc = new FakeModelContext({ withUnregisterTool: true })
    const stop = startContextualSync(mc)
    store.getState().setPlan([M31], 'agent', 'test')
    store.getState().clearPlan('agent')
    expect(mc.unregisterLog).toEqual([...PLAN_TOOL_NAMES])
    expect(mc.names()).toEqual([])
    stop()
  })

  it('survives an engine that ignores the abort signal and has no unregisterTool', () => {
    const mc = new FakeModelContext({ honourAbort: false })
    const stop = startContextualSync(mc)
    store.getState().setPlan([M31], 'agent', 'test')
    store.getState().clearPlan('agent')
    // The engine kept the tools; the page still reports the truthful list and
    // re-registration after a new plan does not duplicate anything.
    expect(store.getState().webmcp.toolNames).toEqual([...BASE_TOOL_NAMES])
    store.getState().setPlan([M31], 'agent', 'test')
    expect(store.getState().webmcp.toolNames).toHaveLength(13)
    stop()
  })

  it('tolerates an unregisterTool that throws', () => {
    const mc = new FakeModelContext({ withUnregisterTool: true })
    mc.unregisterTool = () => {
      throw new Error('engine does not know that tool')
    }
    const stop = startContextualSync(mc)
    store.getState().setPlan([M31], 'agent', 'test')
    expect(() => store.getState().clearPlan('agent')).not.toThrow()
    expect(store.getState().webmcp.toolNames).toEqual([...BASE_TOOL_NAMES])
    stop()
  })
})
