import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetStore, store } from '../state/store'
import type { PlanItem } from '../state/types'
import { describeCurrentViewTool } from './describeCurrentView'
import type { ToolError, ToolOk } from './envelope'
import type { DescribeCurrentViewData } from './describeCurrentView'

const NIGHT_OF = '2026-09-02'
const AT = '2026-09-02T23:00:00Z'

const ajv = new Ajv({ allErrors: true, strict: false })

type Result = ToolOk<DescribeCurrentViewData> | ToolError

async function run(input: Record<string, unknown> = {}): Promise<Result> {
  return (await describeCurrentViewTool.execute(input)) as Result
}

function expectOk(result: Result): ToolOk<DescribeCurrentViewData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
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

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: NIGHT_OF, timeUtc: AT })
})

describe('describe_current_view declaration', () => {
  it('is read-only and named as the plan says', () => {
    expect(describeCurrentViewTool.name).toBe('describe_current_view')
    expect(describeCurrentViewTool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(
      describeCurrentViewTool.description.startsWith('Use this to see what the person sees BEFORE'),
    ).toBe(true)
  })

  it('names the set_observing_site tool and its declarative twin for changing the site', () => {
    expect(describeCurrentViewTool.description).toContain('set_observing_site')
    expect(describeCurrentViewTool.description).toContain('call the tool set_observing_site')
    expect(describeCurrentViewTool.description).toContain('set_observing_site_form')
  })

  it('has an input schema Ajv compiles that refuses unknown properties', () => {
    const validate = ajv.compile(describeCurrentViewTool.inputSchema as object)
    expect(validate({})).toBe(true)
    expect(validate({ include_visible_objects: false, max_visible_objects: 5 })).toBe(true)
    expect(validate({ max_visible_objects: 0 })).toBe(false)
    expect(validate({ max_visible_objects: 61 })).toBe(false)
    expect(validate({ max_visible_objects: 5.5 })).toBe(false)
    expect(validate({ what: 'ever' })).toBe(false)
  })
})

describe('describe_current_view', () => {
  it('reports the site, the night, the slider and the whole sky view', async () => {
    const result = expectOk(await run())

    expect(result.data.night_of).toBe(NIGHT_OF)
    expect(result.data.time).toEqual({ utc: AT, local: '2026-09-03 00:00' })
    expect(result.data.darkness_status).toBe('ok')
    expect(result.data.view).toEqual({ center_alt_deg: 90, center_az_deg: 0, fov_deg: 186 })
    expect(result.data.site.name).toBe('Roque de los Muchachos, La Palma')
    expect(result.data.night_mode).toBe(true)
    expect(result.summary).toContain('whole sky')
    expect(result.summary).toContain('2026-09-02')
  })

  it('changes nothing at all', async () => {
    const before = JSON.stringify({
      view: store.getState().view,
      timeUtc: store.getState().timeUtc,
      plan: store.getState().plan,
      activity: store.getState().activity,
      selectedId: store.getState().selectedId,
    })
    await run()
    const after = JSON.stringify({
      view: store.getState().view,
      timeUtc: store.getState().timeUtc,
      plan: store.getState().plan,
      activity: store.getState().activity,
      selectedId: store.getState().selectedId,
    })
    expect(after).toBe(before)
  })

  it('lists the catalog objects above the horizon with their positions', async () => {
    const result = expectOk(await run({ max_visible_objects: 60 }))
    const m31 = result.data.visible_objects.find((o) => o.id === 'M31')

    expect(result.data.visible_objects.length).toBeGreaterThan(5)
    expect(result.data.visible_objects.every((o) => o.altitude_deg > 0)).toBe(true)
    expect(m31).toBeTruthy()
    expect(m31?.altitude_deg).toBeCloseTo(38.95, 1)
    expect(m31?.direction).toBe('ENE')
    expect(m31?.type).toBe('galaxy')
    // The whole sky dome has everything above the horizon inside the field of view.
    expect(m31?.in_field_of_view).toBe(true)
  })

  it('honours max_visible_objects and reports the full count', async () => {
    const all = expectOk(await run({ max_visible_objects: 60 }))
    const few = expectOk(await run({ max_visible_objects: 3 }))

    expect(few.data.visible_objects).toHaveLength(3)
    expect(few.data.visible_object_count).toBe(all.data.visible_object_count)
    expect(few.caveats.join(' ')).toContain('3')
  })

  it('can skip the object scan', async () => {
    const result = expectOk(await run({ include_visible_objects: false }))
    expect(result.data.visible_objects).toEqual([])
    expect(result.data.visible_object_count).toBeGreaterThan(0)
  })

  it('marks what is inside a narrow field of view', async () => {
    store.getState().setView({ centerAltDeg: 38.95, centerAzDeg: 58.22, fovDeg: 20 }, 'human')
    const result = expectOk(await run({ max_visible_objects: 60 }))
    const inside = result.data.visible_objects.filter((o) => o.in_field_of_view)

    expect(inside.some((o) => o.id === 'M31')).toBe(true)
    expect(inside.length).toBeLessThan(result.data.visible_object_count)
    // In-field objects are listed first.
    expect(result.data.visible_objects.slice(0, inside.length).every((o) => o.in_field_of_view)).toBe(
      true,
    )
    expect(result.summary).toContain('fov 20')
  })

  it('reports the selection, the favorites and the agent highlights', async () => {
    store.getState().select('M31', 'human')
    store.getState().toggleFavorite('M13', 'human')
    store.getState().setHighlights(['saturn'], 'agent')

    const result = expectOk(await run({ max_visible_objects: 60 }))

    expect(result.data.selected).toMatchObject({ id: 'M31', name: 'Andromeda' })
    expect(result.data.favorites).toEqual([{ id: 'M13', name: 'Great Hercules Cluster' }])
    expect(result.data.highlighted).toEqual([{ id: 'saturn', name: 'Saturn' }])

    const m31 = result.data.visible_objects.find((o) => o.id === 'M31')
    const m13 = result.data.visible_objects.find((o) => o.id === 'M13')
    expect(m31?.is_selected).toBe(true)
    expect(m13?.is_favorite).toBe(true)
    expect(result.summary).toContain('selected M31')
    expect(result.summary).toContain('favorites')
  })

  it('summarises the committed plan and flags the objects in it', async () => {
    store
      .getState()
      .setPlan(
        [
          planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z'),
          planItem('M13', '2026-09-02T21:00:00Z', '2026-09-02T21:45:00Z'),
        ],
        'human',
        'two items',
      )

    const result = expectOk(await run({ max_visible_objects: 60 }))

    expect(result.data.plan.items).toBe(2)
    expect(result.data.plan.targets).toEqual(['M13', 'M31'])
    expect(result.data.plan.first_start.utc).toBe('2026-09-02T21:00:00Z')
    expect(result.data.plan.last_end.utc).toBe('2026-09-02T22:45:00Z')
    expect(result.data.visible_objects.find((o) => o.id === 'M31')?.in_plan).toBe(true)
    expect(result.summary).toContain('plan has 2 items')
  })

  it('reports pending proposals with the decisions the person made and their reasons', async () => {
    const proposal = store.getState().addProposal({
      items: [
        planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z'),
        planItem('M7', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z'),
      ],
      unscheduled: [],
      replaceExisting: false,
      origin: 'agent',
      rationale: 'darkest hours first',
    })
    store.getState().decideProposalItem(proposal.id, 'item-M31', 'accepted', undefined, 'human')
    store.getState().decideProposalItem(proposal.id, 'item-M7', 'rejected', 'too low', 'human')

    const result = expectOk(await run({ include_visible_objects: false }))
    const reported = result.data.proposals[0]

    expect(reported.id).toBe(proposal.id)
    expect(reported.status).toBe('pending')
    expect(reported.items).toBe(2)
    expect(reported.decisions).toEqual([
      { item_id: 'item-M31', target: 'M31', decision: 'accepted', reason: null },
      { item_id: 'item-M7', target: 'M7', decision: 'rejected', reason: 'too low' },
    ])
    expect(result.summary).toContain('1 proposal pending')
    expect(result.summary).toContain('too low')
  })

  it('returns the ring buffer of human actions with the last one in the summary', async () => {
    store.getState().select('M13', 'human')
    store.getState().recordHumanAction('drag_map', 'alt 40° az 120°')

    const result = expectOk(await run({ include_visible_objects: false }))

    expect(result.data.recent_human_actions).toHaveLength(2)
    expect(result.data.recent_human_actions[0]).toMatchObject({
      kind: 'drag_map',
      detail: 'alt 40° az 120°',
    })
    expect(result.data.recent_human_actions[0].seconds_ago).toBeGreaterThanOrEqual(0)
    expect(result.summary).toContain('Last action:')
    expect(result.summary).toContain('dragged the map')
  })

  it('reports the active filters', async () => {
    store.getState().setFilters({ minAltDeg: 25, maxMag: 9 }, 'human')
    const result = expectOk(await run({ include_visible_objects: false }))
    expect(result.data.filters).toEqual({
      min_altitude_deg: 25,
      types: null,
      max_magnitude: 9,
      min_moon_separation_deg: 30,
    })
  })
})

describe('describeCurrentView robustness', () => {
  it('never throws and always answers with an ok flag, whatever the agent sends', async () => {
    const malformed: unknown[] = [null, 42, 'view', [], { max_visible_objects: -3 }, { max_visible_objects: 'all' }, { include_visible_objects: 'no' }]
    for (const bad of malformed) {
      const result = (await describeCurrentViewTool.execute(bad as Record<string, unknown>)) as Result
      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) expect(typeof result.error.code).toBe('string')
    }
  })
})
