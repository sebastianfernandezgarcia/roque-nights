import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { UNDO_TTL_MS, resetStore, store } from '../state/store'
import type { PlanItem } from '../state/types'
import { CLEAR_PLAN_CONFIRMATION_MESSAGE, clearPlanTool } from './clearPlan'
import type { ClearPlanData } from './clearPlan'
import type { ToolError, ToolOk } from './envelope'

const NIGHT_OF = '2026-09-02'
const AT = '2026-09-02T23:00:00Z'

const ajv = new Ajv({ allErrors: true, strict: false })

type Result = ToolOk<ClearPlanData> | ToolError

async function run(input: Record<string, unknown> = {}): Promise<Result> {
  return (await clearPlanTool.execute(input)) as Result
}

function expectOk(result: Result): ToolOk<ClearPlanData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

function expectFail(result: Result): ToolError {
  if (result.ok) throw new Error(`expected a failure, got "${result.summary}"`)
  return result
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

function seedPlan(): void {
  store
    .getState()
    .setPlan(
      [
        planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z'),
        planItem('M13', '2026-09-02T21:00:00Z', '2026-09-02T21:45:00Z'),
      ],
      'human',
      'seed',
    )
}

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: NIGHT_OF, timeUtc: AT })
})

describe('clear_plan declaration', () => {
  it('is flagged destructive and not idempotent', () => {
    expect(clearPlanTool.name).toBe('clear_plan')
    expect(clearPlanTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(clearPlanTool.description.startsWith('Use this to delete the whole committed plan.')).toBe(
      true,
    )
  })

  it('has an input schema Ajv compiles with only confirm and undo_token', () => {
    const validate = ajv.compile(clearPlanTool.inputSchema as object)
    expect(validate({})).toBe(true)
    expect(validate({ confirm: true })).toBe(true)
    expect(validate({ undo_token: 'abc' })).toBe(true)
    expect(validate({ confirm: 'yes' })).toBe(false)
    expect(validate({ everything: true })).toBe(false)
  })
})

describe('clear_plan without confirm', () => {
  it('deletes nothing and asks the person through the app', async () => {
    seedPlan()
    const error = expectFail(await run({}))

    expect(error.error.code).toBe('confirmation_required')
    expect(error.error.hint).toContain('confirm')
    expect(store.getState().plan).toHaveLength(2)
    expect(store.getState().pendingConfirmation).toMatchObject({
      tool: 'clear_plan',
      message: CLEAR_PLAN_CONFIRMATION_MESSAGE,
    })
  })

  it('treats confirm:false the same way', async () => {
    seedPlan()
    expect(expectFail(await run({ confirm: false })).error.code).toBe('confirmation_required')
    expect(store.getState().plan).toHaveLength(2)
  })
})

describe('clear_plan with confirm', () => {
  it('clears the plan, hands back an undo token and drops the plan tools', async () => {
    seedPlan()
    store.getState().setPendingConfirmation({
      tool: 'clear_plan',
      message: CLEAR_PLAN_CONFIRMATION_MESSAGE,
      at: new Date().toISOString(),
    })

    const result = expectOk(await run({ confirm: true }))

    expect(store.getState().plan).toEqual([])
    expect(store.getState().pendingConfirmation).toBeNull()
    expect(result.data.action).toBe('cleared')
    expect(result.data.removed_items).toBe(2)
    expect(result.data.undo_token).toBe(store.getState().undo?.token)
    expect(Date.parse(result.data.undo_expires_at as string)).toBeGreaterThan(Date.now())
    expect(Date.parse(result.data.undo_expires_at as string)).toBeLessThanOrEqual(
      Date.now() + UNDO_TTL_MS + 1000,
    )
    expect(result.tools_removed).toEqual([
      'get_current_plan',
      'modify_plan',
      'clear_plan',
      'export_plan',
    ])
    expect(result.summary).toContain('Cleared 2 items')
    expect(result.summary).toContain('undo_token')
  })

  it('accepts an empty plan without inventing work', async () => {
    const result = expectOk(await run({ confirm: true }))
    expect(result.data.removed_items).toBe(0)
    expect(result.caveats.join(' ')).toContain('already empty')
  })
})

describe('clear_plan with undo_token', () => {
  it('restores the plan and brings the plan tools back', async () => {
    seedPlan()
    const cleared = expectOk(await run({ confirm: true }))
    const token = cleared.data.undo_token as string

    const restored = expectOk(await run({ undo_token: token }))

    expect(store.getState().plan).toHaveLength(2)
    expect(restored.data.action).toBe('restored')
    expect(restored.data.restored_items).toBe(2)
    expect(restored.tools_added).toEqual([
      'get_current_plan',
      'modify_plan',
      'clear_plan',
      'export_plan',
    ])
    expect(restored.summary).toContain('Restored 2 items')
  })

  it('refuses a token it does not know', async () => {
    seedPlan()
    expect(expectFail(await run({ undo_token: 'not-a-token' })).error.code).toBe('nothing_to_undo')
  })

  it('refuses a token older than the five minute window', async () => {
    seedPlan()
    const cleared = expectOk(await run({ confirm: true }))
    const undo = store.getState().undo
    store.setState({
      undo: { ...undo!, expiresAt: new Date(Date.now() - 1000).toISOString() },
    })

    const error = expectFail(await run({ undo_token: cleared.data.undo_token as string }))
    expect(error.error.code).toBe('nothing_to_undo')
    expect(store.getState().plan).toEqual([])
  })

  it('undoes before it confirms: a token wins over confirm', async () => {
    seedPlan()
    const cleared = expectOk(await run({ confirm: true }))
    const result = expectOk(
      await run({ undo_token: cleared.data.undo_token as string, confirm: true }),
    )
    expect(result.data.action).toBe('restored')
    expect(store.getState().plan).toHaveLength(2)
  })
})

describe('clearPlan robustness', () => {
  it('never throws and always answers with an ok flag, whatever the agent sends', async () => {
    const malformed: unknown[] = [null, 42, 'clear', [], { confirm: 'yes' }, { undo_token: 42 }, { undo_token: '' }, { confirm: true, undo_token: null }]
    for (const bad of malformed) {
      const result = (await clearPlanTool.execute(bad as Record<string, unknown>)) as Result
      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) expect(typeof result.error.code).toBe('string')
    }
  })
})
