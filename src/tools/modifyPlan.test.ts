import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetStore, store } from '../state/store'
import type { PlanItem } from '../state/types'
import type { ToolError, ToolOk } from './envelope'
import { modifyPlanTool } from './modifyPlan'
import type { ModifyPlanData } from './modifyPlan'

const NIGHT_OF = '2026-09-02'
const AT = '2026-09-02T23:00:00Z'
const DARK_START = Date.parse('2026-09-02T20:52:50.668Z')
const DARK_END = Date.parse('2026-09-03T05:29:36.161Z')

const ajv = new Ajv({ allErrors: true, strict: false })

type Result = ToolOk<ModifyPlanData> | ToolError

async function run(operations: unknown): Promise<Result> {
  return (await modifyPlanTool.execute({ operations })) as Result
}

function expectOk(result: Result): ToolOk<ModifyPlanData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

function expectFail(result: Result): ToolError {
  if (result.ok) throw new Error(`expected a failure, got "${result.summary}"`)
  return result
}

function planItem(
  targetId: string,
  startUtc: string,
  endUtc: string,
  extra: Partial<PlanItem> = {},
): PlanItem {
  return {
    id: `item-${targetId}`,
    targetId,
    targetName: targetId,
    startUtc,
    endUtc,
    source: 'human',
    ...extra,
  }
}

function seedPlan(items: PlanItem[]): void {
  store.getState().setPlan(items, 'human', 'seed')
}

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: NIGHT_OF, timeUtc: AT })
})

describe('modify_plan declaration', () => {
  it('warns the agent that reorder recompacts the times', () => {
    expect(modifyPlanTool.description).toContain('RECOMPACTS')
    const properties = (modifyPlanTool.inputSchema as { properties: Record<string, unknown> })
      .properties
    const operations = properties.operations as { items: { properties: Record<string, { description?: string }> } }
    expect(operations.items.properties.op.description).toContain('RECOMPACTS')
  })

  it('is named as the plan says and does not claim to be idempotent', () => {
    expect(modifyPlanTool.name).toBe('modify_plan')
    // "add" mints a new item id per call, so a repeated batch duplicates blocks.
    expect(modifyPlanTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(modifyPlanTool.description.startsWith('Use this to edit the committed plan')).toBe(true)
  })

  it('spells out the fields each op needs, and gives op a type', () => {
    const schema = modifyPlanTool.inputSchema as {
      properties: { operations: { items: { properties: { op: Record<string, unknown> } } } }
    }
    const op = schema.properties.operations.items.properties.op
    // A bare enum with no type is the one property strict validators trip on.
    expect(op.type).toBe('string')
    const text = op.description as string
    expect(text).toContain('"add" needs target')
    expect(text).toContain('"remove" needs item_id OR target')
    expect(text).toContain('"move" needs item_id OR target PLUS start_utc')
    expect(text).toContain('"note" needs item_id OR target PLUS note')
    expect(text).toContain('"reorder" needs item_ids')
  })

  it('has an input schema Ajv compiles that pins the operation batch', () => {
    const validate = ajv.compile(modifyPlanTool.inputSchema as object)
    expect(validate({ operations: [{ op: 'add', target: 'M31' }] })).toBe(true)
    expect(validate({ operations: [{ op: 'remove', item_id: 'x' }] })).toBe(true)
    expect(
      validate({
        operations: [{ op: 'reorder', item_ids: ['a', 'b'] }, { op: 'note', item_id: 'a', note: 'hi' }],
      }),
    ).toBe(true)
    expect(validate({})).toBe(false)
    expect(validate({ operations: [] })).toBe(false)
    expect(validate({ operations: [{ op: 'delete' }] })).toBe(false)
    expect(validate({ operations: [{ op: 'add', target: 'M31', speed: 2 }] })).toBe(false)
  })
})

describe('modify_plan add', () => {
  it('schedules a new target inside the darkness window and announces the plan tools', async () => {
    const result = expectOk(await run([{ op: 'add', target: 'M31', duration_minutes: 60 }]))
    const item = store.getState().plan[0]

    expect(result.data.results[0]).toMatchObject({ op: 'add', ok: true, target_id: 'M31' })
    expect(store.getState().plan).toHaveLength(1)
    expect(item.source).toBe('agent')
    expect(item.targetName).toBe('Andromeda')
    expect(Date.parse(item.startUtc)).toBeGreaterThanOrEqual(DARK_START)
    expect(Date.parse(item.endUtc)).toBeLessThanOrEqual(DARK_END)
    expect(Date.parse(item.endUtc) - Date.parse(item.startUtc)).toBe(60 * 60_000)
    expect(result.tools_added).toEqual([
      'get_current_plan',
      'modify_plan',
      'export_plan',
    ])
    expect(result.summary).toContain('M31')
  })

  it('places a block at the start time it was given', async () => {
    const result = expectOk(
      await run([{ op: 'add', target: 'M13', start_utc: '2026-09-02T21:30:00Z' }]),
    )
    const item = store.getState().plan[0]

    expect(result.data.results[0].ok).toBe(true)
    expect(item.startUtc).toBe('2026-09-02T21:30:00.000Z')
    expect(item.endUtc).toBe('2026-09-02T22:15:00.000Z')
    expect(result.caveats).toEqual([])
  })

  it('still adds a block outside astronomical darkness, with a caveat', async () => {
    const result = expectOk(
      await run([{ op: 'add', target: 'M13', start_utc: '2026-09-02T19:00:00Z' }]),
    )
    expect(result.data.results[0].ok).toBe(true)
    expect(store.getState().plan).toHaveLength(1)
    expect(result.caveats.join(' ')).toContain('astronomical darkness')
  })

  it('refuses a start time that belongs to another night, naming the night', async () => {
    const result = expectOk(
      await run([{ op: 'add', target: 'M13', start_utc: '2026-10-20T22:30:00Z' }]),
    )
    const entry = result.data.results[0]

    expect(entry.ok).toBe(false)
    expect(entry.reason).toContain('2026-09-02')
    expect(entry.reason).toContain('36 h')
    expect(store.getState().plan).toEqual([])
  })

  it('refuses the extremes of the Date range instead of leaking internal_error', async () => {
    for (const start_utc of [
      '9999-12-31T23:59:59Z',
      '-271821-04-20T00:00:00Z',
      '+275760-09-13T00:00:00.000Z',
    ]) {
      const result = expectOk(await run([{ op: 'add', target: 'M13', start_utc }]))
      expect(result.data.results[0].ok).toBe(false)
      expect(result.data.results[0].reason).toBeTruthy()
    }
    expect(store.getState().plan).toEqual([])
  })

  it('still accepts a start time just outside the night window', async () => {
    // A block that runs into the morning after the 24 h window is a real edit.
    const result = expectOk(
      await run([{ op: 'add', target: 'M13', start_utc: '2026-09-03T13:00:00Z' }]),
    )
    expect(result.data.results[0].ok).toBe(true)
    expect(store.getState().plan).toHaveLength(1)
  })

  it('warns when a block placed by hand sits under the altitude floor', async () => {
    const result = expectOk(
      await run([{ op: 'add', target: 'M7', start_utc: '2026-09-02T23:00:00Z' }]),
    )
    expect(result.data.results[0].ok).toBe(true)
    expect(result.caveats.join(' ').toLowerCase()).toContain('altitude')
  })

  it('reports an unknown target as a failed operation, not an error', async () => {
    const result = expectOk(await run([{ op: 'add', target: 'Vulcan' }]))
    expect(result.data.results[0]).toMatchObject({ op: 'add', ok: false })
    expect(result.data.results[0].reason).toContain('unknown target')
    expect(store.getState().plan).toEqual([])
  })

  it('explains when a target cannot be scheduled tonight', async () => {
    const result = expectOk(await run([{ op: 'add', target: 'M7' }]))
    expect(result.data.results[0].ok).toBe(false)
    expect(result.data.results[0].reason).toContain('altitude')
    expect(store.getState().plan).toEqual([])
  })

  it('avoids the blocks already in the plan', async () => {
    seedPlan([planItem('M27', '2026-09-03T02:00:00Z', '2026-09-03T04:00:00Z')])
    expectOk(await run([{ op: 'add', target: 'M31', duration_minutes: 60 }]))

    const added = store.getState().plan.find((item) => item.targetId === 'M31') as PlanItem
    const overlaps =
      Date.parse(added.startUtc) < Date.parse('2026-09-03T04:00:00Z') &&
      Date.parse('2026-09-03T02:00:00Z') < Date.parse(added.endUtc)
    expect(overlaps).toBe(false)
  })
})

describe('modify_plan remove, move and note', () => {
  it('removes by item id and by target', async () => {
    seedPlan([
      planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z'),
      planItem('M13', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z'),
    ])

    const byId = expectOk(await run([{ op: 'remove', item_id: 'item-M31' }]))
    expect(byId.data.results[0]).toMatchObject({ op: 'remove', ok: true, item_id: 'item-M31' })
    expect(store.getState().plan.map((item) => item.targetId)).toEqual(['M13'])

    const byTarget = expectOk(await run([{ op: 'remove', target: 'M13' }]))
    expect(byTarget.data.results[0].ok).toBe(true)
    expect(store.getState().plan).toEqual([])
    expect(byTarget.tools_removed).toEqual([
      'get_current_plan',
      'modify_plan',
      'export_plan',
    ])
  })

  it('says when there is nothing to remove', async () => {
    seedPlan([planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')])
    const result = expectOk(await run([{ op: 'remove', item_id: 'ghost' }]))
    expect(result.data.results[0].ok).toBe(false)
    expect(result.data.results[0].reason).toContain('ghost')
    expect(store.getState().plan).toHaveLength(1)
  })

  it('moves an item and can change its length', async () => {
    seedPlan([planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')])
    const result = expectOk(
      await run([
        {
          op: 'move',
          item_id: 'item-M31',
          start_utc: '2026-09-03T01:00:00Z',
          duration_minutes: 90,
        },
      ]),
    )
    const item = store.getState().plan[0]

    expect(result.data.results[0].ok).toBe(true)
    expect(item.startUtc).toBe('2026-09-03T01:00:00.000Z')
    expect(item.endUtc).toBe('2026-09-03T02:30:00.000Z')
  })

  it('refuses a move without a start time', async () => {
    seedPlan([planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')])
    const result = expectOk(await run([{ op: 'move', item_id: 'item-M31' }]))
    expect(result.data.results[0].ok).toBe(false)
    expect(result.data.results[0].reason).toContain('start_utc')
  })

  it('sets a note on an item', async () => {
    seedPlan([planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')])
    const result = expectOk(
      await run([{ op: 'note', target: 'M31', note: 'use the 24 mm eyepiece' }]),
    )
    expect(result.data.results[0].ok).toBe(true)
    expect(store.getState().plan[0].note).toBe('use the 24 mm eyepiece')
  })
})

describe('modify_plan reorder', () => {
  it('repacks the listed items back to back from the earliest start', async () => {
    seedPlan([
      planItem('M31', '2026-09-03T01:00:00Z', '2026-09-03T01:45:00Z'),
      planItem('M13', '2026-09-02T22:30:00Z', '2026-09-02T23:00:00Z'),
    ])

    const result = expectOk(await run([{ op: 'reorder', item_ids: ['item-M31', 'item-M13'] }]))
    const plan = store.getState().plan

    expect(result.data.results.every((entry) => entry.op === 'reorder' && entry.ok)).toBe(true)
    const m31 = plan.find((item) => item.id === 'item-M31') as PlanItem
    const m13 = plan.find((item) => item.id === 'item-M13') as PlanItem
    // Earliest start of the two is 22:30, and each block keeps its own length.
    expect(m31.startUtc).toBe('2026-09-02T22:30:00.000Z')
    expect(m31.endUtc).toBe('2026-09-02T23:15:00.000Z')
    expect(m13.startUtc).toBe('2026-09-02T23:15:00.000Z')
    expect(m13.endUtc).toBe('2026-09-02T23:45:00.000Z')
  })

  it('reports the items it cannot move into their window and leaves them alone', async () => {
    seedPlan([
      planItem('M31', '2026-09-03T04:00:00Z', '2026-09-03T04:45:00Z'),
      planItem('M42', '2026-09-03T05:00:00Z', '2026-09-03T05:29:00Z'),
    ])
    // M42 only clears 30 degrees at the very end of the night, so it cannot move earlier.
    const result = expectOk(await run([{ op: 'reorder', item_ids: ['item-M42', 'item-M31'] }]))
    const failed = result.data.results.filter((entry) => !entry.ok)

    expect(failed).toHaveLength(1)
    expect(failed[0].item_id).toBe('item-M42')
    expect(failed[0].reason).toBeTruthy()
    const m42 = store.getState().plan.find((item) => item.id === 'item-M42') as PlanItem
    expect(m42.startUtc).toBe('2026-09-03T05:00:00Z')
  })

  it('needs at least two known ids', async () => {
    seedPlan([planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')])
    const result = expectOk(await run([{ op: 'reorder', item_ids: ['item-M31', 'ghost'] }]))
    expect(result.data.results[0].ok).toBe(false)
    expect(result.data.results[0].reason).toContain('ghost')
  })
})

describe('modify_plan batches', () => {
  it('applies a mixed batch in one store write and reports every outcome', async () => {
    seedPlan([planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')])
    const activityBefore = store.getState().activity.length

    const result = expectOk(
      await run([
        { op: 'add', target: 'M13', start_utc: '2026-09-02T23:00:00Z' },
        { op: 'remove', item_id: 'item-M31' },
        { op: 'move', item_id: 'ghost', start_utc: '2026-09-03T01:00:00Z' },
      ]),
    )

    expect(result.data.results.map((entry) => entry.ok)).toEqual([true, true, false])
    expect(store.getState().plan.map((item) => item.targetId)).toEqual(['M13'])
    // One edit_plan entry for the whole batch, not one per operation.
    expect(store.getState().activity.length - activityBefore).toBe(1)
    expect(result.summary).toContain('2 of 3')
    expect(result.data.plan).toHaveLength(1)
  })

  it('leaves the plan untouched when every operation fails', async () => {
    seedPlan([planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')])
    const before = JSON.stringify(store.getState().plan)
    const activityBefore = store.getState().activity.length

    const result = expectOk(await run([{ op: 'remove', item_id: 'ghost' }]))

    expect(JSON.stringify(store.getState().plan)).toBe(before)
    expect(store.getState().activity.length).toBe(activityBefore)
    expect(result.summary).toContain('0 of 1')
  })

  it('refuses an empty or malformed batch', async () => {
    expect(expectFail(await run([])).error.code).toBe('invalid_input')
    expect(expectFail(await run('add M31')).error.code).toBe('invalid_input')
    const badOp = expectOk(await run([{ op: 'teleport' }]))
    expect(badOp.data.results[0].ok).toBe(false)
    expect(badOp.data.results[0].reason).toContain('teleport')
  })
})

describe('modifyPlan robustness', () => {
  it('never throws and always answers with an ok flag, whatever the agent sends', async () => {
    const malformed: unknown[] = [null, 42, 'add', [], { operations: null }, { operations: {} }, { operations: [null] }, { operations: [{ op: 42 }] }, { operations: [{ op: 'add', target: null }] }, { operations: [{ op: 'reorder', item_ids: 'a,b' }] }, { operations: [{ op: 'move', item_id: 'x', start_utc: 'soon' }] }]
    for (const bad of malformed) {
      const result = (await modifyPlanTool.execute(bad as Record<string, unknown>)) as Result
      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) expect(typeof result.error.code).toBe('string')
    }
  })
})
