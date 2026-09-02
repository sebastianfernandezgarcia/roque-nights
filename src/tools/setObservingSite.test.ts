import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { ROQUE_DE_LOS_MUCHACHOS, resetStore, store } from '../state/store'
import type { PlanItem } from '../state/types'
import type { ToolError, ToolOk } from './envelope'
import { setObservingSiteTool, type SetObservingSiteData } from './setObservingSite'

const ajv = new Ajv({ allErrors: true, strict: false })

type Result = ToolOk<SetObservingSiteData> | ToolError

async function run(input: Record<string, unknown> = {}): Promise<Result> {
  return (await setObservingSiteTool.execute(input)) as Result
}

function expectOk(result: Result): ToolOk<SetObservingSiteData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

function expectFail(result: Result): ToolError {
  if (result.ok) throw new Error(`expected a failure, got "${result.summary}"`)
  return result
}

const PLAN: PlanItem[] = [
  {
    id: 'a',
    targetId: 'M31',
    targetName: 'Andromeda',
    startUtc: '2026-09-12T22:00:00.000Z',
    endUtc: '2026-09-12T22:45:00.000Z',
    source: 'agent',
  },
]

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: '2026-09-12' })
})

describe('set_observing_site declaration', () => {
  it('is the imperative twin of the declarative form', () => {
    expect(setObservingSiteTool.name).toBe('set_observing_site')
    expect(setObservingSiteTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(
      setObservingSiteTool.description.startsWith(
        'Use this to move the whole app to another observing site',
      ),
    ).toBe(true)
  })

  it('tells the agent that read-only tools take a one-off site instead', () => {
    expect(setObservingSiteTool.description).toContain('WITHOUT moving the app')
  })

  it('accepts the site fields plus the site_id alias, and nothing else', () => {
    const schema = setObservingSiteTool.inputSchema as Record<string, unknown>
    const properties = schema.properties as Record<string, unknown>
    expect(Object.keys(properties).sort()).toEqual(
      ['elevation_m', 'id', 'latitude', 'longitude', 'name', 'site_id', 'time_zone'].sort(),
    )
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toBeUndefined()

    const validate = ajv.compile(schema)
    expect(validate({ site_id: 'mauna-kea' })).toBe(true)
    expect(validate({ latitude: 19.82, longitude: -155.47, time_zone: 'Pacific/Honolulu' })).toBe(
      true,
    )
    expect(validate({ site: 'mauna-kea' })).toBe(false)
  })
})

describe('set_observing_site', () => {
  it('moves the app to a catalog site, with its elevation and zone', async () => {
    const result = expectOk(await run({ site_id: 'mauna-kea' }))

    expect(store.getState().site.id).toBe('mauna-kea')
    expect(result.data.site.elevation_m).toBe(4205)
    expect(result.data.site.time_zone).toBe('Pacific/Honolulu')
    expect(result.data.night_of).toBe('2026-09-12')
    expect(result.summary).toContain('Mauna Kea')
    expect(result.site.name).toBe('Mauna Kea, Hawaii')
    // The change is attributed, so the person sees who moved the page.
    expect(store.getState().activity[0]).toMatchObject({ source: 'agent', action: 'set_site' })
  })

  it('takes id as an alias of site_id, and is idempotent', async () => {
    expectOk(await run({ id: 'paranal' }))
    const again = expectOk(await run({ id: 'paranal' }))
    expect(store.getState().site.id).toBe('paranal')
    expect(again.data.plan_stale).toBe(false)
  })

  it('accepts coordinates and refuses to invent a time zone', async () => {
    const result = expectOk(await run({ latitude: 0, longitude: 0, name: 'Null Island' }))
    expect(store.getState().site.timeZone).toBeNull()
    expect(result.data.site.time_zone).toBeNull()
    expect(result.caveats.join(' ')).toContain('UTC only')
  })

  it('refuses an unknown id without moving the app', async () => {
    const error = expectFail(await run({ site_id: 'Mars Base One' }))
    expect(error.error.code).toBe('invalid_site')
    expect(error.error.hint).toContain('mauna-kea')
    expect(store.getState().site).toEqual(ROQUE_DE_LOS_MUCHACHOS)
  })

  it('refuses one coordinate without the other, and an empty call', async () => {
    expect(expectFail(await run({ latitude: 40.4 })).error.code).toBe('invalid_site')
    expect(expectFail(await run({})).error.message).toContain('Nothing to set')
    expect(store.getState().site).toEqual(ROQUE_DE_LOS_MUCHACHOS)
  })

  it('marks a committed plan stale and says what the person now sees', async () => {
    store.getState().setPlan(PLAN, 'human', 'test plan')
    expect(store.getState().planContext?.siteName).toBe(ROQUE_DE_LOS_MUCHACHOS.name)

    const result = expectOk(await run({ site_id: 'mauna-kea' }))

    expect(result.data.plan_stale).toBe(true)
    expect(result.data.plan_stale_reason).toBe('site')
    expect(result.data.plan_built_for).toEqual({
      site_name: ROQUE_DE_LOS_MUCHACHOS.name,
      night_of: '2026-09-12',
    })
    expect(result.data.plan_items).toBe(1)
    expect(result.summary).toContain('marked stale')
    expect(result.caveats.join(' ')).toContain('Revalidate plan')
    expect(result.caveats.join(' ')).toContain('plan_stale')
    // The plan is not deleted, only flagged.
    expect(store.getState().plan).toHaveLength(1)
  })

  it('reports no staleness when there is no plan to be stale', async () => {
    const result = expectOk(await run({ site_id: 'mauna-kea' }))
    expect(result.data.plan_stale).toBe(false)
    expect(result.data.plan_built_for).toBeNull()
    expect(result.caveats).toEqual([])
  })
})
