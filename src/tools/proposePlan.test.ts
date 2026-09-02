import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetStore, store } from '../state/store'
import type { PlanItem } from '../state/types'
import type { ToolError, ToolOk } from './envelope'
import { proposePlanTool } from './proposePlan'
import type { ProposePlanData } from './proposePlan'

const NIGHT_OF = '2026-09-02'
const AT = '2026-09-02T23:00:00Z'

const ajv = new Ajv({ allErrors: true, strict: false })

type Result = ToolOk<ProposePlanData> | ToolError

async function run(input: Record<string, unknown>): Promise<Result> {
  return (await proposePlanTool.execute(input)) as Result
}

function expectOk(result: Result): ToolOk<ProposePlanData> {
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
    source: 'human',
  }
}

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: NIGHT_OF, timeUtc: AT })
})

describe('propose_plan declaration', () => {
  it('is the ghost plan tool, not a destructive one', () => {
    expect(proposePlanTool.name).toBe('propose_plan')
    expect(proposePlanTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(proposePlanTool.description.startsWith('Use this to propose an observing plan')).toBe(
      true,
    )
  })

  it('says which night it plans and how to plan another one', () => {
    // "plan me Saturday" must not silently schedule the night the app is on.
    expect(proposePlanTool.description).toContain('NO date and NO site argument')
    expect(proposePlanTool.description).toContain('set_observing_time')
    const schema = proposePlanTool.inputSchema as {
      properties: { targets: { description: string } }
    }
    expect(schema.properties.targets.description).toContain('currently selected in the app')
    expect(schema.properties.targets.description).not.toContain('tonight')
  })

  it('has an input schema Ajv compiles that pins the target list', () => {
    const validate = ajv.compile(proposePlanTool.inputSchema as object)
    expect(validate({ targets: [{ target: 'M31' }] })).toBe(true)
    expect(
      validate({
        targets: [{ target: 'M31', duration_minutes: 60, note: 'wide field' }],
        rationale: 'darkest hours first',
        replace_existing: true,
        min_altitude_deg: 35,
      }),
    ).toBe(true)
    expect(validate({})).toBe(false)
    expect(validate({ targets: [] })).toBe(false)
    expect(validate({ targets: [{ target: 'M31', colour: 'red' }] })).toBe(false)
    expect(validate({ targets: [{ duration_minutes: 45 }] })).toBe(false)
    expect(validate({ targets: [{ target: 'M31' }], min_altitude_deg: 90 })).toBe(false)
  })
})

describe('propose_plan', () => {
  it('creates a pending ghost proposal without touching the committed plan', async () => {
    const result = expectOk(
      await run({
        targets: [{ target: 'M31' }, { target: 'M13' }, { target: 'Saturn' }],
        rationale: 'three classics while the Moon is low',
      }),
    )

    const proposals = store.getState().proposals
    expect(store.getState().plan).toEqual([])
    expect(proposals).toHaveLength(1)
    expect(proposals[0].id).toBe(result.data.proposal_id)
    expect(proposals[0].status).toBe('pending')
    expect(proposals[0].origin).toBe('agent')
    expect(proposals[0].rationale).toBe('three classics while the Moon is low')
    expect(proposals[0].items.every((item) => item.source === 'agent')).toBe(true)

    expect(result.data.items).toHaveLength(3)
    expect(result.data.items.map((item) => item.target_id).sort()).toEqual([
      'M13',
      'M31',
      'saturn',
    ])
    for (const item of result.data.items) {
      expect(item.start.utc).toBeTruthy()
      expect(item.start.local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
      expect(item.minutes).toBe(45)
      expect(item.peak_altitude_deg).toBeGreaterThan(30)
    }
    expect(result.data.how_to_apply).toContain('commit_proposal')
    expect(result.tools_added).toEqual(['commit_proposal'])
    expect(result.summary).toContain('Proposed 3')
    expect(result.summary).toContain('M31')
  })

  it('schedules every block inside astronomical darkness', async () => {
    const result = expectOk(await run({ targets: [{ target: 'M31' }, { target: 'M13' }] }))
    const darkStart = Date.parse('2026-09-02T20:52:50.668Z')
    const darkEnd = Date.parse('2026-09-03T05:29:36.161Z')

    for (const item of result.data.items) {
      expect(Date.parse(item.start.utc as string)).toBeGreaterThanOrEqual(darkStart)
      expect(Date.parse(item.end.utc as string)).toBeLessThanOrEqual(darkEnd)
    }
  })

  it('honours a per target duration and note', async () => {
    const result = expectOk(
      await run({ targets: [{ target: 'M31', duration_minutes: 90, note: 'two panels' }] }),
    )
    expect(result.data.items[0].minutes).toBe(90)
    expect(result.data.items[0].note).toContain('two panels')
  })

  it('keeps unknown targets as rejected instead of failing', async () => {
    const result = expectOk(
      await run({ targets: [{ target: 'M31' }, { target: 'Planet Vulcan' }] }),
    )
    expect(result.data.items).toHaveLength(1)
    expect(result.rejected).toEqual([
      { id: 'Planet Vulcan', name: 'Planet Vulcan', reason: 'unknown target' },
    ])
    expect(result.summary).toContain('Planet Vulcan')
  })

  it('fails only when nothing in the list is a target', async () => {
    const error = expectFail(await run({ targets: [{ target: 'Vulcan' }, { target: 'Krypton' }] }))
    expect(error.error.code).toBe('unknown_target')
    expect(store.getState().proposals).toEqual([])
  })

  it('reports what it could not fit and why', async () => {
    const result = expectOk(await run({ targets: [{ target: 'M31' }, { target: 'M7' }] }))
    expect(result.data.unscheduled).toHaveLength(1)
    expect(result.data.unscheduled[0].target_id).toBe('M7')
    expect(result.data.unscheduled[0].reason).toContain('altitude')
    expect(result.rejected.some((item) => item.id === 'M7')).toBe(true)
    expect(result.summary).toContain('M7')
  })

  it('takes the altitude floor from the app filters and honours an explicit one', async () => {
    const strict = expectOk(await run({ targets: [{ target: 'M7' }] }))
    expect(strict.data.items).toHaveLength(0)
    expect(strict.data.min_altitude_deg).toBe(30)

    const relaxed = expectOk(await run({ targets: [{ target: 'M7' }], min_altitude_deg: 10 }))
    expect(relaxed.data.min_altitude_deg).toBe(10)
    expect(relaxed.data.items).toHaveLength(1)
  })

  it('avoids the time the committed plan already occupies', async () => {
    store
      .getState()
      .setPlan([planItem('M27', '2026-09-03T02:00:00Z', '2026-09-03T04:00:00Z')], 'human', 'busy')

    const result = expectOk(await run({ targets: [{ target: 'M31', duration_minutes: 60 }] }))
    const start = Date.parse(result.data.items[0].start.utc as string)
    const end = Date.parse(result.data.items[0].end.utc as string)

    expect(result.data.replace_existing).toBe(false)
    expect(start >= Date.parse('2026-09-03T04:00:00Z') || end <= Date.parse('2026-09-03T02:00:00Z')).toBe(
      true,
    )
  })

  it('ignores the committed plan when replace_existing is set', async () => {
    store
      .getState()
      .setPlan([planItem('M27', '2026-09-03T02:00:00Z', '2026-09-03T04:00:00Z')], 'human', 'busy')

    const result = expectOk(
      await run({ targets: [{ target: 'M31', duration_minutes: 60 }], replace_existing: true }),
    )
    expect(result.data.replace_existing).toBe(true)
    expect(store.getState().proposals[0].replaceExisting).toBe(true)
    expect(store.getState().plan).toHaveLength(1)
  })

  it('only announces commit_proposal the first time a proposal is pending', async () => {
    const first = expectOk(await run({ targets: [{ target: 'M31' }] }))
    const second = expectOk(await run({ targets: [{ target: 'M13' }] }))
    expect(first.tools_added).toEqual(['commit_proposal'])
    expect(second.tools_added).toBeUndefined()
  })

  it('refuses a targets list that is not a list', async () => {
    expect(expectFail(await run({ targets: 'M31' })).error.code).toBe('invalid_input')
    expect(expectFail(await run({ targets: [] })).error.code).toBe('invalid_input')
  })

  it('says when nothing at all can be scheduled and creates no proposal', async () => {
    const result = expectOk(await run({ targets: [{ target: 'M7' }] }))
    expect(result.data.proposal_id).toBeNull()
    expect(store.getState().proposals).toEqual([])
    expect(result.caveats.join(' ')).toContain('No proposal')
    expect(result.tools_added).toBeUndefined()
  })
})

describe('proposePlan robustness', () => {
  it('never throws and always answers with an ok flag, whatever the agent sends', async () => {
    const malformed: unknown[] = [null, 42, [], { targets: null }, { targets: {} }, { targets: [null] }, { targets: [{ target: 42 }] }, { targets: ['M31'] }, { targets: [{ target: 'M31', duration_minutes: 'long' }] }, { targets: [{ target: 'M31' }], min_altitude_deg: 'high' }]
    for (const bad of malformed) {
      const result = (await proposePlanTool.execute(bad as Record<string, unknown>)) as Result
      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) expect(typeof result.error.code).toBe('string')
    }
  })
})
