import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { ROQUE_DE_LOS_MUCHACHOS, resetStore, store } from '../state/store'
import type { PlanItem, Site } from '../state/types'
import type { ToolError, ToolOk } from './envelope'
import { getCurrentPlanTool } from './getCurrentPlan'
import type { GetCurrentPlanData } from './getCurrentPlan'

const NIGHT_OF = '2026-09-02'
const AT = '2026-09-02T23:00:00Z'

const MAUNA_KEA: Site = {
  id: 'mauna-kea',
  name: 'Mauna Kea, Hawaii',
  latitude: 19.8207,
  longitude: -155.4681,
  elevationM: 4205,
  timeZone: 'Pacific/Honolulu',
}

const ajv = new Ajv({ allErrors: true, strict: false })

type Result = ToolOk<GetCurrentPlanData> | ToolError

async function run(input: Record<string, unknown> = {}): Promise<Result> {
  return (await getCurrentPlanTool.execute(input)) as Result
}

function expectOk(result: Result): ToolOk<GetCurrentPlanData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
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
    source: 'agent',
    ...extra,
  }
}

function setPlan(items: PlanItem[]): void {
  store.getState().setPlan(items, 'human', 'test plan')
}

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: NIGHT_OF, timeUtc: AT })
})

describe('get_current_plan declaration', () => {
  it('is read-only and named as the plan says', () => {
    expect(getCurrentPlanTool.name).toBe('get_current_plan')
    expect(getCurrentPlanTool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(getCurrentPlanTool.description.startsWith('Use this to read the committed')).toBe(true)
  })

  it('takes no arguments at all', () => {
    const validate = ajv.compile(getCurrentPlanTool.inputSchema as object)
    expect(validate({})).toBe(true)
    expect(validate({ night: '2026-09-02' })).toBe(false)
  })
})

describe('get_current_plan', () => {
  it('says so when the plan is empty', async () => {
    const result = expectOk(await run())
    expect(result.data.items).toEqual([])
    expect(result.data.total_minutes).toBe(0)
    expect(result.summary).toBe('The plan is empty.')
    expect(result.data.night_of).toBe(NIGHT_OF)
    expect(result.data.darkness.start.utc).toBe('2026-09-02T20:52:50.668Z')
  })

  it('reports a healthy block with altitudes, airmass and Moon separation', async () => {
    setPlan([
      planItem('M31', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z', {
        note: 'the classic',
        source: 'human',
      }),
    ])
    const result = expectOk(await run())
    const item = result.data.items[0]

    expect(item).toMatchObject({
      item_id: 'item-M31',
      target_id: 'M31',
      // The plan item keeps the name it was created with, not a catalog lookup.
      name: 'M31',
      type: 'galaxy',
      minutes: 45,
      note: 'the classic',
      source: 'human',
      warnings: [],
    })
    expect(item.start).toEqual({ utc: '2026-09-02T23:00:00Z', local: '2026-09-03 00:00' })
    expect(item.altitude_start_deg).toBeCloseTo(38.95, 1)
    expect(item.altitude_end_deg).toBeGreaterThan(item.altitude_start_deg as number)
    expect(item.peak_altitude_deg).toBeGreaterThanOrEqual(item.altitude_end_deg as number)
    expect(item.airmass_mid).toBeGreaterThan(1)
    expect(item.moon_separation_deg).toBeGreaterThan(0)
    expect(result.data.total_minutes).toBe(45)
    expect(result.summary).toContain('1 item')
    expect(result.summary).toContain('2026-09-02')
  })

  it('warns about a block that starts before astronomical darkness', async () => {
    setPlan([planItem('M31', '2026-09-02T19:30:00Z', '2026-09-02T21:30:00Z')])
    const warnings = expectOk(await run()).data.items[0].warnings
    expect(warnings.join(' | ')).toContain('astronomical darkness')
  })

  it('warns about a block entirely outside astronomical darkness', async () => {
    setPlan([planItem('M13', '2026-09-02T18:00:00Z', '2026-09-02T18:45:00Z')])
    const warnings = expectOk(await run()).data.items[0].warnings
    expect(warnings.join(' | ')).toContain('outside astronomical darkness')
  })

  it('warns when the target is under the minimum altitude during the block', async () => {
    setPlan([planItem('M7', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z')])
    const result = expectOk(await run())
    const warnings = result.data.items[0].warnings

    expect(warnings.join(' | ')).toContain('30')
    expect(warnings.join(' | ').toLowerCase()).toContain('altitude')
    expect(result.summary.toLowerCase()).toContain('warning')
  })

  it('warns about overlapping blocks on both sides', async () => {
    setPlan([
      planItem('M31', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z'),
      planItem('M13', '2026-09-02T23:30:00Z', '2026-09-03T00:15:00Z'),
    ])
    const items = expectOk(await run()).data.items
    expect(items[0].warnings.join(' ')).toContain('overlaps M13')
    expect(items[1].warnings.join(' ')).toContain('overlaps M31')
  })

  it('reports an unknown target instead of crashing', async () => {
    setPlan([planItem('NGC-nonsense', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z')])
    const item = expectOk(await run()).data.items[0]
    expect(item.altitude_start_deg).toBeNull()
    expect(item.warnings.join(' ')).toContain('not in the catalog')
  })

  it('counts pending proposals and orders items by start time', async () => {
    setPlan([
      planItem('M13', '2026-09-02T23:30:00Z', '2026-09-03T00:15:00Z'),
      planItem('M31', '2026-09-02T22:15:00Z', '2026-09-02T23:00:00Z'),
    ])
    store.getState().addProposal({
      items: [planItem('M27', '2026-09-03T01:00:00Z', '2026-09-03T01:45:00Z')],
      unscheduled: [],
      replaceExisting: false,
      origin: 'agent',
    })

    const result = expectOk(await run())
    expect(result.data.items.map((i) => i.target_id)).toEqual(['M31', 'M13'])
    expect(result.data.proposals_pending).toBe(1)
    expect(result.data.total_minutes).toBe(90)
  })

  it('reports the magnitude and the transit of every item', async () => {
    setPlan([
      planItem('M31', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z'),
      planItem('saturn', '2026-09-03T02:00:00Z', '2026-09-03T02:45:00Z'),
    ])
    const items = expectOk(await run()).data.items
    const m31 = items.find((item) => item.target_id === 'M31')!
    const saturn = items.find((item) => item.target_id === 'saturn')!

    // A catalog object carries the catalog magnitude, unchanged.
    expect(m31.magnitude).toBeCloseTo(3.4, 1)
    // A planet has no fixed magnitude: it is computed for this block.
    expect(saturn.magnitude).not.toBeNull()
    expect(saturn.magnitude).toBeGreaterThan(-2)
    expect(saturn.magnitude).toBeLessThan(3)

    // Transit is measured over the whole night, so it can fall outside the block.
    expect(m31.transit.utc).toMatch(/^2026-09-0[23]T/)
    expect(m31.transit.local).toMatch(/^2026-09-0[23] \d{2}:\d{2}$/)
    expect(m31.transit_altitude_deg).toBeGreaterThan(60)
    expect(saturn.transit.utc).not.toBeNull()
    expect(saturn.transit_altitude_deg).toBeGreaterThan(0)
  })

  it('leaves magnitude and transit null for a target it does not know', async () => {
    setPlan([planItem('comet-2026-x1', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z')])
    const item = expectOk(await run()).data.items[0]
    expect(item.magnitude).toBeNull()
    expect(item.transit).toEqual({ utc: null, local: null })
    expect(item.transit_altitude_deg).toBeNull()
  })

  it('says in a caveat that the plan was built for another sky', async () => {
    setPlan([planItem('M31', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z')])
    store.getState().setSite(MAUNA_KEA, 'agent')

    const result = expectOk(await run())
    expect(result.caveats.join(' ')).toContain(
      `The plan was built for ${ROQUE_DE_LOS_MUCHACHOS.name}, night of ${NIGHT_OF}`,
    )
    expect(result.caveats.join(' ')).toContain(`the app now shows ${MAUNA_KEA.name}`)
    // Still a full answer: the caveat explains the times, it does not hide them.
    expect(result.data.items).toHaveLength(1)
  })

  it('says nothing about staleness while the app still shows the same sky', async () => {
    setPlan([planItem('M31', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z')])
    expect(expectOk(await run()).caveats).toEqual([])
  })

  it('changes nothing', async () => {
    setPlan([planItem('M31', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z')])
    const before = JSON.stringify(store.getState().plan)
    const activity = store.getState().activity.length
    await run()
    expect(JSON.stringify(store.getState().plan)).toBe(before)
    expect(store.getState().activity.length).toBe(activity)
  })
})

describe('getCurrentPlan robustness', () => {
  it('never throws and always answers with an ok flag, whatever the agent sends', async () => {
    const malformed: unknown[] = [null, 42, 'plan', [], { unexpected: true }]
    for (const bad of malformed) {
      const result = (await getCurrentPlanTool.execute(bad as Record<string, unknown>)) as Result
      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) expect(typeof result.error.code).toBe('string')
    }
  })
})
