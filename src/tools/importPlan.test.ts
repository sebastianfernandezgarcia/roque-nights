import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { toObservingPlanV1, type ObservingPlanV1 } from '../plan/serialize'
import { encodePlanToHash } from '../plan/shareUrl'
import { DEFAULT_FILTERS, resetStore, store } from '../state/store'
import type { PlanItem, Site } from '../state/types'
import type { ToolError, ToolOk } from './envelope'
import { exportPlanTool, type ExportPlanData } from './exportPlan'
import { importPlanTool, type ImportPlanData } from './importPlan'

const MADRID: Site = {
  id: null,
  name: 'Madrid, Retiro',
  latitude: 40.4168,
  longitude: -3.7038,
  elevationM: 650,
  timeZone: 'Europe/Madrid',
}

/** Madrid darkness on 2026-09-12 runs 20:01:53Z to 04:20:27Z. */
const MADRID_ITEMS: PlanItem[] = [
  {
    id: '1',
    targetId: 'M13',
    targetName: 'Great Hercules Cluster',
    startUtc: '2026-09-12T20:30:00.000Z',
    endUtc: '2026-09-12T21:15:00.000Z',
    source: 'human',
  },
  {
    id: '2',
    targetId: 'M31',
    targetName: 'Andromeda',
    startUtc: '2026-09-12T22:00:00.000Z',
    endUtc: '2026-09-12T22:45:00.000Z',
    source: 'human',
    note: 'from a friend in Madrid',
  },
  {
    id: '3',
    targetId: 'M7',
    targetName: "Ptolemy's Cluster",
    startUtc: '2026-09-12T23:00:00.000Z',
    endUtc: '2026-09-12T23:45:00.000Z',
    source: 'human',
  },
]

function madridPlan(items: PlanItem[] = MADRID_ITEMS): ObservingPlanV1 {
  return toObservingPlanV1(
    { site: MADRID, nightOf: '2026-09-12', plan: items },
    { startUtc: '2026-09-12T20:01:53.796Z', endUtc: '2026-09-13T04:20:27.973Z' },
    'A friend in Madrid',
  )
}

async function run(input: Record<string, unknown>) {
  return (await importPlanTool.execute(input)) as ToolOk<ImportPlanData> | ToolError
}

function asOk(result: ToolOk<ImportPlanData> | ToolError): ToolOk<ImportPlanData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

function asFail(result: ToolOk<ImportPlanData> | ToolError): ToolError {
  if (result.ok) throw new Error(`expected an error, got: ${result.summary}`)
  return result
}

/** Roque darkness on 2026-09-12 runs 20:39:43Z to 05:35:53Z. */
const ROQUE_DARK_START = Date.parse('2026-09-12T20:39:43.722Z')
const ROQUE_DARK_END = Date.parse('2026-09-13T05:35:53.066Z')

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: '2026-09-12' })
})

describe('import_plan declaration', () => {
  it('is a writing tool: it creates a ghost proposal from another observer plan', () => {
    expect(importPlanTool.name).toBe('import_plan')
    expect(importPlanTool.annotations?.readOnlyHint).toBe(false)
    expect(importPlanTool.annotations?.idempotentHint).toBe(false)
    // It only creates a ghost proposal, so it must say it is not destructive:
    // that hint defaults to true whenever readOnlyHint is false.
    expect(importPlanTool.annotations?.destructiveHint).toBe(false)
  })

  it('tells the agent what it accepts and that nothing is committed', () => {
    expect(importPlanTool.description).toContain('Use this')
    expect(importPlanTool.description).toContain('REVALIDATE')
    expect(importPlanTool.description).toContain('commit_proposal')
    expect(importPlanTool.description).not.toMatch(/—/)
  })

  it('has an input schema Ajv accepts, with source required and no stray keys', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(importPlanTool.inputSchema ?? {})
    expect(importPlanTool.inputSchema?.additionalProperties).toBe(false)
    expect(validate({ source: 'M31, M13' })).toBe(true)
    expect(validate({ source: 'M31', min_altitude_deg: 45, keep_original_times: true })).toBe(true)
    expect(validate({})).toBe(false)
    expect(validate({ source: '' })).toBe(false)
    expect(validate({ source: 'M31', min_altitude_deg: 90 })).toBe(false)
    expect(validate({ source: 'M31', altitude: 45 })).toBe(false)
  })
})

describe('import_plan from a share URL', () => {
  it('revalidates another observer plan for this sky and drops what does not work', async () => {
    const url = `https://roque-nights.netlify.app/${encodePlanToHash(madridPlan())}`
    const result = asOk(await run({ source: url }))

    expect(result.data.summary_counts).toEqual({ kept: 2, dropped: 1 })
    expect(result.data.kept.map((k) => k.target_id).sort()).toEqual(['M13', 'M31'])
    expect(result.data.dropped).toHaveLength(1)
    expect(result.data.dropped[0].target_id).toBe('M7')
    expect(result.data.dropped[0].reason).toMatch(/below minimum altitude/)
    // The envelope repeats the drops: that is the field a judge reads first.
    expect(result.rejected.map((r) => r.id)).toEqual(['M7'])
  })

  it('reports where the plan came from', async () => {
    const result = asOk(await run({ source: encodePlanToHash(madridPlan()) }))
    expect(result.data.original).not.toBeNull()
    expect(result.data.original?.site.name).toBe('Madrid, Retiro')
    expect(result.data.original?.site.latitude).toBeCloseTo(40.4168, 4)
    expect(result.data.original?.night_of).toBe('2026-09-12')
    expect(result.data.original?.item_count).toBe(3)
  })

  it('reschedules every kept item inside the local darkness window', async () => {
    const result = asOk(await run({ source: encodePlanToHash(madridPlan()) }))
    for (const item of result.data.kept) {
      const start = Date.parse(item.new.start.utc ?? '')
      const end = Date.parse(item.new.end.utc ?? '')
      expect(start).toBeGreaterThanOrEqual(ROQUE_DARK_START)
      expect(end).toBeLessThanOrEqual(ROQUE_DARK_END)
      expect(end).toBeGreaterThan(start)
      expect(item.new.start.local).toMatch(/^2026-09-1[23] \d{2}:\d{2}$/)
    }
  })

  it('explains every move with a reason a human can argue with', async () => {
    const result = asOk(await run({ source: encodePlanToHash(madridPlan()) }))
    const m31 = result.data.kept.find((k) => k.target_id === 'M31')
    const m13 = result.data.kept.find((k) => k.target_id === 'M13')
    expect(m31?.original).toEqual({
      start: '2026-09-12T22:00:00.000Z',
      end: '2026-09-12T22:45:00.000Z',
    })
    expect(m31?.changed).toBe(true)
    expect(m31?.why).toBe('culminates later here')
    // M13 started before this site had astronomical darkness.
    expect(m13?.why).toBe('moved into local darkness window')
  })

  it('creates a pending ghost proposal instead of touching the plan', async () => {
    const result = asOk(await run({ source: encodePlanToHash(madridPlan()) }))
    const state = store.getState()
    expect(state.plan).toEqual([])
    expect(state.proposals).toHaveLength(1)
    const proposal = state.proposals[0]
    expect(proposal.id).toBe(result.data.proposal_id)
    expect(proposal.status).toBe('pending')
    expect(proposal.origin).toBe('import')
    expect(proposal.rationale).toBe('Imported from Madrid, Retiro')
    expect(proposal.replaceExisting).toBe(false)
    expect(proposal.items).toHaveLength(2)
    expect(proposal.items.every((i) => i.source === 'agent')).toBe(true)
    expect(proposal.items.every((i) => typeof i.id === 'string' && i.id.length > 0)).toBe(true)
    expect(proposal.unscheduled.map((u) => u.targetId)).toEqual(['M7'])
    expect(result.tools_added).toEqual(['commit_proposal'])
    // The banner is the app's decision, not the tool's.
    expect(state.importBanner).toBeNull()
  })

  it('keeps the note the other observer wrote', async () => {
    asOk(await run({ source: encodePlanToHash(madridPlan()) }))
    const item = store.getState().proposals[0].items.find((i) => i.targetId === 'M31')
    expect(item?.note).toContain('from a friend in Madrid')
  })

  it('says in one sentence what happened, with the sites and the counts', async () => {
    const result = asOk(await run({ source: encodePlanToHash(madridPlan()) }))
    expect(result.summary).toContain('Madrid')
    expect(result.summary).toContain('Roque de los Muchachos')
    expect(result.summary).toContain('M7')
    expect(result.summary).toContain('commit_proposal')
    expect(result.caveats.join(' ')).toContain('Madrid')
  })
})

describe('import_plan with keep_original_times', () => {
  it('keeps a block that already fits this night and moves the one that does not', async () => {
    const result = asOk(
      await run({ source: encodePlanToHash(madridPlan()), keep_original_times: true }),
    )
    const m31 = result.data.kept.find((k) => k.target_id === 'M31')
    expect(m31?.changed).toBe(false)
    expect(m31?.why).toBe('kept original time')
    expect(m31?.new.start.utc).toBe('2026-09-12T22:00:00.000Z')
    expect(m31?.new.end.utc).toBe('2026-09-12T22:45:00.000Z')

    const m13 = result.data.kept.find((k) => k.target_id === 'M13')
    expect(m13?.changed).toBe(true)
    expect(Date.parse(m13?.new.start.utc ?? '')).toBeGreaterThanOrEqual(ROQUE_DARK_START)
  })
})

describe('import_plan from a JSON document', () => {
  it('accepts the raw observing-plan.v1 text', async () => {
    const result = asOk(await run({ source: JSON.stringify(madridPlan()) }))
    expect(result.data.summary_counts.kept).toBe(2)
    expect(result.data.original?.site.name).toBe('Madrid, Retiro')
  })

  it('refuses a document it cannot read, with the reason', async () => {
    const error = asFail(await run({ source: '{"version":2,"items":[]}' }))
    expect(error.error.code).toBe('invalid_input')
    expect(error.error.message).toMatch(/version/i)
    expect(error.error.hint).toBeTruthy()
  })

  it('refuses a share URL whose payload is broken', async () => {
    const error = asFail(await run({ source: 'https://roque-nights.netlify.app/#plan=!!!!' }))
    expect(error.error.code).toBe('invalid_input')
    expect(error.error.message).toMatch(/share URL/i)
  })

  it('refuses a document with no items', async () => {
    const error = asFail(await run({ source: JSON.stringify(madridPlan([])) }))
    expect(error.error.code).toBe('invalid_input')
    expect(error.error.message).toMatch(/no items/i)
  })
})

describe('import_plan from a list of names', () => {
  it('splits on commas, newlines and semicolons, and ignores duplicates', async () => {
    const result = asOk(await run({ source: ' M31, M13\nM7; m31 ,,\n' }))
    expect(result.data.original).toBeNull()
    expect(result.data.summary_counts).toEqual({ kept: 2, dropped: 1 })
    expect(result.data.kept.map((k) => k.target_id).sort()).toEqual(['M13', 'M31'])
    expect(result.data.kept.every((k) => k.original === null)).toBe(true)
    expect(result.data.kept.every((k) => k.changed)).toBe(true)
    expect(store.getState().proposals[0].rationale).toBe('Imported from a plan')
  })

  it('resolves names as well as ids', async () => {
    const result = asOk(await run({ source: 'Andromeda Galaxy\nJupiter' }))
    const ids = [
      ...result.data.kept.map((k) => k.target_id),
      ...result.data.dropped.map((d) => d.target_id),
    ].sort()
    expect(ids).toEqual(['M31', 'jupiter'])
  })

  it('drops a name it cannot resolve and says so', async () => {
    const result = asOk(await run({ source: 'M31, Zorblax' }))
    expect(result.data.dropped.map((d) => d.name)).toContain('Zorblax')
    expect(result.data.dropped[0].reason).toMatch(/unknown target/i)
  })

  it('refuses an empty or blank source', async () => {
    for (const source of ['', '   ', ',,,', '\n\n']) {
      const error = asFail(await run({ source }))
      expect(error.error.code).toBe('invalid_input')
    }
  })
})

describe('import_plan and the rest of the app', () => {
  it('uses the app minimum altitude by default', async () => {
    store.setState({ filters: { ...DEFAULT_FILTERS, minAltDeg: 70 } })
    const result = asOk(await run({ source: 'M31, M13' }))
    expect(result.data.kept.map((k) => k.target_id)).toEqual(['M31'])
    expect(result.data.dropped[0].reason).toMatch(/70°/)
  })

  it('honours an explicit minimum altitude', async () => {
    const result = asOk(await run({ source: 'M31, M13', min_altitude_deg: 70 }))
    expect(result.data.summary_counts).toEqual({ kept: 1, dropped: 1 })
    expect(result.data.dropped[0].target_id).toBe('M13')
  })

  it('refuses an impossible minimum altitude', async () => {
    const error = asFail(await run({ source: 'M31', min_altitude_deg: 200 }))
    expect(error.error.code).toBe('invalid_input')
    expect(error.error.message).toContain('min_altitude_deg')
  })

  it('never overlaps what the human already has in the plan', async () => {
    const busy: PlanItem = {
      id: 'busy',
      targetId: 'M45',
      targetName: 'Pleiades',
      startUtc: '2026-09-13T01:30:00.000Z',
      endUtc: '2026-09-13T03:30:00.000Z',
      source: 'human',
    }
    store.setState({ plan: [busy] })
    const result = asOk(await run({ source: 'M31' }))
    const kept = result.data.kept[0]
    const start = Date.parse(kept.new.start.utc ?? '')
    const end = Date.parse(kept.new.end.utc ?? '')
    const overlaps = start < Date.parse(busy.endUtc) && Date.parse(busy.startUtc) < end
    expect(overlaps).toBe(false)
    expect(store.getState().plan).toEqual([busy])
  })

  it('warns when the local site has no time zone', async () => {
    store.setState({
      site: {
        id: null,
        name: '19.826, -155.468',
        latitude: 19.8262,
        longitude: -155.4681,
        elevationM: 4205,
        timeZone: null,
      },
    })
    const result = asOk(await run({ source: 'M31' }))
    expect(result.caveats.join(' ')).toMatch(/time zone/i)
    expect(result.data.kept[0]?.new.start.local ?? null).toBeNull()
  })

  it('never throws, whatever the agent sends', async () => {
    for (const input of [
      {},
      { source: 42 },
      { source: null },
      { source: 'M31', keep_original_times: 'yes' },
      { source: '{"version":1,"items":"nope"}' },
    ]) {
      const result = await run(input as Record<string, unknown>)
      expect(typeof result.ok).toBe('boolean')
      expect(Date.parse(result.as_of)).not.toBeNaN()
    }
  })
})

describe('import_plan round trip and hard nights', () => {
  it('re-imports what export_plan wrote, unchanged, when the sky is the same', async () => {
    const plan: PlanItem[] = [
      {
        id: 'a',
        targetId: 'M13',
        targetName: 'Great Hercules Cluster',
        startUtc: '2026-09-12T21:00:00.000Z',
        endUtc: '2026-09-12T21:40:00.000Z',
        source: 'human',
      },
      {
        id: 'b',
        targetId: 'M31',
        targetName: 'Andromeda',
        startUtc: '2026-09-12T22:00:00.000Z',
        endUtc: '2026-09-12T22:45:00.000Z',
        source: 'human',
      },
    ]
    store.setState({ plan })
    const exported = (await exportPlanTool.execute({})) as ToolOk<ExportPlanData>
    expect(exported.ok).toBe(true)

    // The friend's machine: same site, same night, empty plan.
    store.setState({ plan: [] })
    const result = asOk(
      await run({ source: exported.data.share_url ?? '', keep_original_times: true }),
    )
    expect(result.data.summary_counts).toEqual({ kept: 2, dropped: 0 })
    expect(result.data.kept.every((k) => !k.changed && k.why === 'kept original time')).toBe(true)
    expect(result.data.kept.map((k) => k.new.start.utc)).toEqual([
      '2026-09-12T21:00:00.000Z',
      '2026-09-12T22:00:00.000Z',
    ])
  })

  it('drops everything, with the reason, on a night with no astronomical darkness', async () => {
    store.setState({
      nightOf: '2026-06-21',
      site: {
        id: null,
        name: 'Svalbard',
        latitude: 78.22,
        longitude: 15.65,
        elevationM: 20,
        timeZone: 'Arctic/Longyearbyen',
      },
    })
    const result = asOk(await run({ source: 'M31, M13' }))
    expect(result.data.summary_counts).toEqual({ kept: 0, dropped: 2 })
    expect(result.data.dropped[0].reason).toMatch(/darkness/i)
    expect(result.caveats.join(' ')).toMatch(/darkness/i)
    expect(store.getState().proposals[0].items).toHaveLength(0)
  })
})

describe('import_plan and the tool list', () => {
  it('says commit_proposal appeared, and does not repeat it when one was already pending', async () => {
    const first = asOk(await run({ source: 'M31' }))
    expect(first.tools_added).toEqual(['commit_proposal'])
    const second = asOk(await run({ source: 'M13' }))
    expect(second.tools_added).toBeUndefined()
    expect(store.getState().proposals).toHaveLength(2)
  })
})
