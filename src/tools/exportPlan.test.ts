import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { parseObservingPlanV1 } from '../plan/serialize'
import { decodePlanFromHash } from '../plan/shareUrl'
import { resetStore, store } from '../state/store'
import type { PlanItem } from '../state/types'
import type { ToolError, ToolOk } from './envelope'
import { exportPlanTool, type ExportPlanData } from './exportPlan'

const PLAN: PlanItem[] = [
  {
    id: 'a',
    targetId: 'M31',
    targetName: 'Andromeda',
    startUtc: '2026-09-12T22:00:00.000Z',
    endUtc: '2026-09-12T22:45:00.000Z',
    source: 'agent',
    note: 'wide field, low power',
  },
  {
    id: 'b',
    targetId: 'M13',
    targetName: 'Great Hercules Cluster',
    startUtc: '2026-09-12T21:00:00.000Z',
    endUtc: '2026-09-12T21:40:00.000Z',
    source: 'human',
  },
]

async function run(input: Record<string, unknown> = {}) {
  return (await exportPlanTool.execute(input)) as ToolOk<ExportPlanData> | ToolError
}

function asOk(result: ToolOk<ExportPlanData> | ToolError): ToolOk<ExportPlanData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

function asFail(result: ToolOk<ExportPlanData> | ToolError): ToolError {
  if (result.ok) throw new Error(`expected an error, got: ${result.summary}`)
  return result
}

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: '2026-09-12', plan: PLAN })
})

describe('export_plan declaration', () => {
  it('is a read only, idempotent tool with a name an agent can guess', () => {
    expect(exportPlanTool.name).toBe('export_plan')
    expect(exportPlanTool.annotations?.readOnlyHint).toBe(true)
    expect(exportPlanTool.annotations?.idempotentHint).toBe(true)
    expect(exportPlanTool.annotations?.openWorldHint).toBe(false)
  })

  it('tells the agent when to use it and what comes back', () => {
    expect(exportPlanTool.description).toContain('Use this')
    expect(exportPlanTool.description).toContain('observing-plan.v1')
    expect(exportPlanTool.description).toContain('share URL')
    expect(exportPlanTool.description).not.toMatch(/—/)
  })

  it('has an input schema Ajv accepts and that closes the door on typos', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(exportPlanTool.inputSchema ?? {})
    expect(exportPlanTool.inputSchema?.additionalProperties).toBe(false)
    expect(validate({})).toBe(true)
    expect(validate({ format: 'ics', include_share_url: false, author: 'Sebastian' })).toBe(true)
    expect(validate({ format: 'pdf' })).toBe(false)
    expect(validate({ formats: 'json' })).toBe(false)
    expect(validate({ author: 'x'.repeat(81) })).toBe(false)
  })
})

describe('export_plan', () => {
  it('refuses an empty plan with a code the agent can branch on', async () => {
    store.setState({ plan: [] })
    const error = asFail(await run())
    expect(error.error.code).toBe('empty_plan')
    expect(error.error.hint).toBeTruthy()
  })

  it('exports the open JSON document by default', async () => {
    const result = asOk(await run())
    expect(result.data.format).toBe('json')
    expect(result.data.item_count).toBe(2)
    expect(result.data.filename).toBe('roque-nights-plan-2026-09-12.json')

    const parsed = parseObservingPlanV1(result.data.content)
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.plan.version).toBe(1)
    expect(parsed.plan.night_of).toBe('2026-09-12')
    expect(parsed.plan.site.name).toBe('Roque de los Muchachos, La Palma')
    expect(parsed.plan.items.map((i) => i.target_id)).toEqual(['M13', 'M31'])
    // Darkness travels with the document so an importer can compare windows.
    expect(parsed.plan.darkness.start_utc).toMatch(/^2026-09-12T20:/)
    expect(parsed.plan.darkness.end_utc).toMatch(/^2026-09-13T0/)
  })

  it('returns a share URL that decodes back into the same plan', async () => {
    const result = asOk(await run())
    expect(result.data.share_url).toContain('#plan=')
    const back = decodePlanFromHash(result.data.share_url ?? '')
    expect(back?.items).toHaveLength(2)
    expect(back?.site.latitude).toBeCloseTo(28.7542, 4)
  })

  it('omits the share URL when the caller does not want one', async () => {
    const result = asOk(await run({ include_share_url: false }))
    expect(result.data.share_url).toBeNull()
  })

  it('exports a calendar with one event per item', async () => {
    const result = asOk(await run({ format: 'ics' }))
    expect(result.data.filename).toBe('roque-nights-plan-2026-09-12.ics')
    expect(result.data.content).toContain('BEGIN:VCALENDAR')
    expect(result.data.content.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2)
    expect(result.data.content).toContain('DTSTART:20260912T220000Z')
  })

  it('exports a CSV with a header and one row per item', async () => {
    const result = asOk(await run({ format: 'csv' }))
    expect(result.data.filename).toBe('roque-nights-plan-2026-09-12.csv')
    const rows = result.data.content.split('\n')
    expect(rows[0]).toBe('target_id,name,start_utc,end_utc,start_local,end_local,note,source')
    expect(rows).toHaveLength(3)
  })

  it('signs the document when an author is given', async () => {
    const result = asOk(await run({ author: 'Sebastian' }))
    expect(JSON.parse(result.data.content).author).toBe('Sebastian')
    expect(result.summary).toContain('Sebastian')
  })

  it('says in one sentence what was exported', async () => {
    const result = asOk(await run({ format: 'csv' }))
    expect(result.summary).toContain('2 items')
    expect(result.summary).toContain('2026-09-12')
    expect(result.summary).toContain('CSV')
    expect(result.site.name).toBe('Roque de los Muchachos, La Palma')
    expect(Date.parse(result.as_of)).not.toBeNaN()
  })

  it('rejects a format it does not know instead of guessing', async () => {
    const error = asFail(await run({ format: 'pdf' }))
    expect(error.error.code).toBe('invalid_input')
    expect(error.error.message).toContain('pdf')
  })

  it('warns when the site has no time zone, because the CSV local columns stay blank', async () => {
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
    const result = asOk(await run({ format: 'csv' }))
    expect(result.caveats.join(' ')).toMatch(/time zone/i)
  })

  it('never throws, whatever the agent sends', async () => {
    for (const input of [
      {},
      { format: 42 },
      { include_share_url: 'yes' },
      { author: null },
      { unexpected: true },
    ]) {
      const result = await run(input as Record<string, unknown>)
      expect(typeof result.ok).toBe('boolean')
      expect(Date.parse(result.as_of)).not.toBeNaN()
    }
  })
})
