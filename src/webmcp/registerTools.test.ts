import { Ajv } from 'ajv'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ROQUE_DE_LOS_MUCHACHOS, resetStore, store } from '../state/store'
import type { ActivityEntry, PlanItem } from '../state/types'
import { BASE_TOOL_NAMES, PLAN_TOOL_NAMES } from '../tools/contextualNames'
import { fail, ok } from '../tools/envelope'
import {
  APP_TOOLS,
  BASE_TOOLS,
  INPUT_DETAIL_LIMIT,
  getModelContext,
  instrument,
  registerWebMCPTools,
  stopWebMCPTools,
} from './registerTools'

const ajv = new Ajv({ allErrors: true, strict: false })

/** Minimal WebMCP engine: records registrations and honours the abort signal. */
class FakeModelContext extends EventTarget implements ModelContext {
  readonly registered = new Map<string, ModelContextToolDefinition>()
  readonly registerLog: string[] = []
  ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null = null
  /** Name the engine refuses, or '*' for all of them. */
  rejectTool: string | null = null

  registerTool(
    tool: ModelContextToolDefinition,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    if (this.rejectTool === '*' || this.rejectTool === tool.name) {
      return Promise.reject(new Error(`this engine refuses ${tool.name}`))
    }
    this.registered.set(tool.name, tool)
    this.registerLog.push(tool.name)
    options?.signal?.addEventListener('abort', () => {
      this.registered.delete(tool.name)
    })
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

  executeTool(tool: RegisteredModelContextTool): Promise<string> {
    const found = this.registered.get(tool.name)
    if (!found) return Promise.reject(new Error(`unknown tool ${tool.name}`))
    return Promise.resolve(found.execute({})).then((value) => JSON.stringify(value))
  }

  names(): string[] {
    return [...this.registered.keys()]
  }
}

const globalRef = globalThis as unknown as { document?: unknown; navigator?: unknown }

function stubDocument(mc: ModelContext): void {
  globalRef.document = { modelContext: mc }
}

function stubNavigator(mc: ModelContext): void {
  globalRef.navigator = { modelContext: mc }
}

function clearGlobals(): void {
  delete globalRef.document
  delete globalRef.navigator
}

function makeTool(
  name: string,
  execute: ModelContextToolDefinition['execute'],
): ModelContextToolDefinition {
  return {
    name,
    title: `Title of ${name}`,
    description: `Use this to exercise ${name} in a test.`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute,
  }
}

function latestEntry(action: string): ActivityEntry {
  const entry = store.getState().activity.find((item) => item.action === action)
  if (!entry) throw new Error(`no activity entry for ${action}`)
  return entry
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const M31: PlanItem = {
  id: 'item-m31',
  targetId: 'M31',
  targetName: 'Andromeda Galaxy',
  startUtc: '2026-09-02T22:00:00Z',
  endUtc: '2026-09-02T22:45:00Z',
  source: 'agent',
}

beforeEach(() => {
  resetStore()
  clearGlobals()
})

afterEach(() => {
  stopWebMCPTools()
  clearGlobals()
})

describe('getModelContext', () => {
  it('returns undefined when the browser has no WebMCP engine', () => {
    expect(getModelContext()).toBeUndefined()
  })

  it('prefers document.modelContext, the location the spec settled on', () => {
    const doc = new FakeModelContext()
    const nav = new FakeModelContext()
    stubDocument(doc)
    stubNavigator(nav)
    expect(getModelContext()).toBe(doc)
  })

  it('falls back to navigator.modelContext for pre-May-2026 engines', () => {
    const nav = new FakeModelContext()
    stubNavigator(nav)
    expect(getModelContext()).toBe(nav)
  })
})

describe('instrument', () => {
  it('keeps the declaration the agent reads', () => {
    const tool = makeTool('probe', () => ok('Fine.', {}, ROQUE_DE_LOS_MUCHACHOS))
    const wrapped = instrument(tool)
    expect(wrapped.name).toBe(tool.name)
    expect(wrapped.title).toBe(tool.title)
    expect(wrapped.description).toBe(tool.description)
    expect(wrapped.inputSchema).toBe(tool.inputSchema)
    expect(wrapped.annotations).toBe(tool.annotations)
  })

  it('records running while the tool works and ok with the summary excerpt after', async () => {
    let statusDuring: string | undefined
    const tool = makeTool('probe_ok', async () => {
      statusDuring = store.getState().activity[0]?.status
      await sleep(6)
      return ok('Two hours of moon-free darkness tonight.', { hours: 2 }, ROQUE_DE_LOS_MUCHACHOS)
    })

    const result = (await instrument(tool).execute({ date: '2026-09-02' })) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(statusDuring).toBe('running')

    const entry = latestEntry('probe_ok')
    expect(entry.source).toBe('agent')
    expect(entry.status).toBe('ok')
    expect(entry.detail).toBe('{"date":"2026-09-02"}')
    expect(entry.result).toBe('Two hours of moon-free darkness tonight.')
    expect(entry.durationMs).toBeGreaterThanOrEqual(1)
    expect(store.getState().activity.filter((item) => item.action === 'probe_ok')).toHaveLength(1)
  })

  it('writes "no arguments" instead of an empty object', async () => {
    const tool = makeTool('probe_empty', () => ok('Done.', {}, ROQUE_DE_LOS_MUCHACHOS))
    await instrument(tool).execute({})
    expect(latestEntry('probe_empty').detail).toBe('no arguments')
  })

  it('truncates a long input so the log stays a glance', async () => {
    const tool = makeTool('probe_long', () => ok('Done.', {}, ROQUE_DE_LOS_MUCHACHOS))
    await instrument(tool).execute({ note: 'M31 '.repeat(200) })
    expect(latestEntry('probe_long').detail.length).toBeLessThanOrEqual(INPUT_DETAIL_LIMIT)
  })

  it('cuts the summary excerpt at 160 characters', async () => {
    const long = `Tonight ${'is very long '.repeat(40)}indeed.`
    const tool = makeTool('probe_verbose', () => ok(long, {}, ROQUE_DE_LOS_MUCHACHOS))
    await instrument(tool).execute({})
    expect(latestEntry('probe_verbose').result!.length).toBeLessThanOrEqual(160)
  })

  it('turns a thrown exception into ok:false internal_error and an error entry', async () => {
    const tool = makeTool('probe_throw', () => {
      throw new Error('astronomy-engine exploded')
    })
    const result = (await instrument(tool).execute({})) as {
      ok: boolean
      error: { code: string; message: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('internal_error')
    expect(result.error.message).toContain('astronomy-engine exploded')

    const entry = latestEntry('probe_throw')
    expect(entry.status).toBe('error')
    expect(entry.result).toContain('astronomy-engine exploded')
  })

  it('never rejects, even when the tool rejects', async () => {
    const tool = makeTool('probe_reject', () => Promise.reject(new Error('network down')))
    await expect(instrument(tool).execute({})).resolves.toMatchObject({ ok: false })
    expect(latestEntry('probe_reject').status).toBe('error')
  })

  it('logs a structured tool error as an error with its message', async () => {
    const tool = makeTool('probe_fail', () =>
      fail('invalid_date', '"2026-13-99" is not a valid calendar date.', 'Use YYYY-MM-DD.'),
    )
    const result = (await instrument(tool).execute({ date: '2026-13-99' })) as { ok: boolean }
    expect(result.ok).toBe(false)
    const entry = latestEntry('probe_fail')
    expect(entry.status).toBe('error')
    expect(entry.result).toContain('not a valid calendar date')
  })

  it('accepts a tool that returns something other than the envelope', async () => {
    const tool = makeTool('probe_plain', () => 'a plain string')
    await expect(instrument(tool).execute({})).resolves.toBe('a plain string')
    expect(latestEntry('probe_plain').status).toBe('ok')
  })

  it('passes input and the abort signal straight through', async () => {
    let seenInput: Record<string, unknown> | undefined
    let seenSignal: AbortSignal | undefined
    const tool = makeTool('probe_signal', (input, options) => {
      seenInput = input
      seenSignal = options?.signal
      return ok('Done.', {}, ROQUE_DE_LOS_MUCHACHOS)
    })
    const controller = new AbortController()
    await instrument(tool).execute({ limit: 3 }, { signal: controller.signal })
    expect(seenInput).toEqual({ limit: 3 })
    expect(seenSignal).toBe(controller.signal)
  })
})

describe('tool declarations', () => {
  for (const tool of APP_TOOLS) {
    it(`${tool.name} declares a schema an agent can trust`, () => {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(tool.title).toBeTruthy()
      expect(tool.description.length).toBeGreaterThan(60)
      expect(tool.annotations).toBeDefined()

      const schema = tool.inputSchema as Record<string, unknown>
      expect(schema).toBeDefined()
      expect(schema.type).toBe('object')
      expect(schema.additionalProperties).toBe(false)
      expect(() => ajv.compile(schema)).not.toThrow()
      // Unknown keys must be refused, not silently ignored.
      const validate = ajv.compile(schema)
      expect(validate({ definitely_not_a_real_field: 1 })).toBe(false)
    })
  }
})

describe('registerWebMCPTools', () => {
  it('marks the page unsupported when there is no engine', async () => {
    await registerWebMCPTools()
    expect(store.getState().webmcp.status).toBe('unsupported')
    expect(store.getState().webmcp.toolNames).toEqual([])
    expect(store.getState().webmcp.toolCount).toBe(0)
  })

  it('registers the 9 base tools and reports them in the store', async () => {
    const mc = new FakeModelContext()
    stubDocument(mc)
    await registerWebMCPTools()

    expect(mc.names()).toEqual([...BASE_TOOL_NAMES])
    expect(mc.registered.size).toBe(BASE_TOOLS.length)
    expect(store.getState().webmcp.status).toBe('registered')
    expect(store.getState().webmcp.toolNames).toEqual([...BASE_TOOL_NAMES])
  })

  it('registers instrumented tools: an agent call shows up in the activity log', async () => {
    const mc = new FakeModelContext()
    stubDocument(mc)
    await registerWebMCPTools()

    await mc.registered.get('describe_current_view')!.execute({})
    const entry = latestEntry('describe_current_view')
    expect(entry.source).toBe('agent')
    expect(entry.status).toBe('ok')
    expect(entry.result).toBeTruthy()
  })

  it('starts the contextual sync so plan tools appear with the plan', async () => {
    const mc = new FakeModelContext()
    stubDocument(mc)
    await registerWebMCPTools()

    store.getState().setPlan([M31], 'agent', 'test')
    expect(mc.names()).toEqual([...BASE_TOOL_NAMES, ...PLAN_TOOL_NAMES])
    expect(store.getState().webmcp.toolNames).toHaveLength(13)

    store.getState().clearPlan('human')
    expect(mc.names()).toEqual([...BASE_TOOL_NAMES])
    expect(store.getState().webmcp.toolNames).toEqual([...BASE_TOOL_NAMES])
  })

  it('replaces a previous registration instead of stacking subscriptions', async () => {
    const first = new FakeModelContext()
    stubDocument(first)
    await registerWebMCPTools()

    const second = new FakeModelContext()
    stubDocument(second)
    await registerWebMCPTools()

    store.getState().setPlan([M31], 'agent', 'test')
    expect(second.names()).toEqual([...BASE_TOOL_NAMES, ...PLAN_TOOL_NAMES])
    // The first engine's tools were aborted and it is no longer driven.
    expect(first.names()).toEqual([])
  })

  it('keeps the other tools when the engine refuses one, and does not claim it', async () => {
    const mc = new FakeModelContext()
    mc.rejectTool = 'rank_nights'
    stubDocument(mc)
    await registerWebMCPTools()

    expect(mc.names()).toEqual(BASE_TOOL_NAMES.filter((name) => name !== 'rank_nights'))
    expect(store.getState().webmcp.status).toBe('registered')
    expect(store.getState().webmcp.toolNames).not.toContain('rank_nights')
    expect(store.getState().webmcp.toolCount).toBe(8)

    // The contextual sync still runs and still tells the truth.
    store.getState().setPlan([M31], 'agent', 'test')
    expect(store.getState().webmcp.toolNames).toHaveLength(12)
    expect(store.getState().webmcp.toolNames).toEqual(
      expect.arrayContaining([...PLAN_TOOL_NAMES]),
    )
  })

  it('falls back to unsupported when the engine refuses every tool', async () => {
    const mc = new FakeModelContext()
    mc.rejectTool = '*'
    stubDocument(mc)
    await registerWebMCPTools()

    expect(store.getState().webmcp.status).toBe('unsupported')
    expect(store.getState().webmcp.toolNames).toEqual([])
  })

  it('stopWebMCPTools unregisters everything and detaches the store listener', async () => {
    const mc = new FakeModelContext()
    stubDocument(mc)
    await registerWebMCPTools()
    stopWebMCPTools()

    expect(mc.names()).toEqual([])
    store.getState().setPlan([M31], 'agent', 'test')
    expect(mc.names()).toEqual([])
  })
})
