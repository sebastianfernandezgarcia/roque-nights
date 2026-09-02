import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetStore, store } from '../state/store'
import { pointSkyMapTool } from './pointSkyMap'
import type { ToolError, ToolOk } from './envelope'

const NIGHT_OF = '2026-09-02'
const AT = '2026-09-02T23:00:00Z'

const ajv = new Ajv({ allErrors: true, strict: false })

interface PointData {
  view: { center_alt_deg: number; center_az_deg: number; fov_deg: number }
  time: { utc: string | null; local: string | null }
  target: {
    id: string
    name: string
    type: string
    altitude_deg: number
    azimuth_deg: number
    direction: string
    above_horizon: boolean
    airmass: number | null
    next_rise: { utc: string | null; local: string | null } | null
  } | null
  highlighted: string[]
}

type Result = ToolOk<PointData> | ToolError

async function run(input: Record<string, unknown>): Promise<Result> {
  return (await pointSkyMapTool.execute(input)) as Result
}

function expectOk(result: Result): ToolOk<PointData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

function expectFail(result: Result): ToolError {
  if (result.ok) throw new Error(`expected a failure, got "${result.summary}"`)
  return result
}

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: NIGHT_OF, timeUtc: AT })
})

describe('point_sky_map declaration', () => {
  it('is the tool T13 registers, with the plan annotations', () => {
    expect(pointSkyMapTool.name).toBe('point_sky_map')
    // destructiveHint is spelled out: in the MCP annotation contract it
    // defaults to true whenever readOnlyHint is false, and this tool only
    // moves the view.
    expect(pointSkyMapTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(pointSkyMapTool.description.startsWith('Use this to move the shared sky map')).toBe(true)
  })

  it('says what an empty call does and which arguments a target overrides', () => {
    const schema = pointSkyMapTool.inputSchema as {
      properties: { altitude_deg: { description: string }; azimuth_deg: { description: string } }
    }
    expect(schema.properties.altitude_deg.description).toContain('Ignored when target is given')
    expect(schema.properties.azimuth_deg.description).toContain('Ignored when target is given')
    expect(pointSkyMapTool.description).toContain('Pass at least one of target')
    expect(pointSkyMapTool.description).toContain('invalid_input')
  })

  it('has an input schema Ajv compiles that refuses unknown properties', () => {
    const validate = ajv.compile(pointSkyMapTool.inputSchema as object)
    expect(validate({ target: 'M31', fov_deg: 40 })).toBe(true)
    expect(validate({ altitude_deg: 45, azimuth_deg: 180 })).toBe(true)
    expect(validate({ highlight: ['M13', 'Saturn'], reset: true })).toBe(true)
    expect(validate({ nonsense: 1 })).toBe(false)
    expect(validate({ fov_deg: 400 })).toBe(false)
    expect(validate({ altitude_deg: -90 })).toBe(false)
  })
})

describe('point_sky_map', () => {
  it('centers the shared map on a target, animates and selects it', async () => {
    const result = expectOk(await run({ target: 'M31' }))
    const view = store.getState().view

    expect(view.animate).toBe(true)
    expect(view.fovDeg).toBe(40)
    expect(view.centerAltDeg).toBeCloseTo(38.95, 1)
    expect(view.centerAzDeg).toBeCloseTo(58.22, 1)
    expect(store.getState().selectedId).toBe('M31')

    expect(result.data.target).toMatchObject({
      id: 'M31',
      direction: 'ENE',
      above_horizon: true,
    })
    expect(result.data.target?.altitude_deg).toBeCloseTo(38.95, 1)
    expect(result.data.target?.airmass).toBeCloseTo(1.59, 1)
    expect(result.data.view.fov_deg).toBe(40)
    expect(result.data.time.utc).toBe(AT)
    expect(result.data.time.local).toBe('2026-09-03 00:00')
    expect(result.summary).toContain('M31')
    expect(result.summary).toContain('ENE')
    expect(result.caveats).toEqual([])
  })

  it('records the move in the activity log as an agent action', async () => {
    await run({ target: 'M31' })
    const actions = store.getState().activity.map((entry) => `${entry.source}:${entry.action}`)
    expect(actions).toContain('agent:set_view')
    expect(actions).toContain('agent:select_object')
    // The agent never fills the human ring buffer describe_current_view reads.
    expect(store.getState().humanActions).toEqual([])
  })

  it('accepts an explicit altitude and azimuth without touching the selection', async () => {
    store.getState().select('M13', 'human')
    const result = expectOk(await run({ altitude_deg: 45, azimuth_deg: 180, fov_deg: 60 }))

    expect(store.getState().view).toMatchObject({
      centerAltDeg: 45,
      centerAzDeg: 180,
      fovDeg: 60,
      animate: true,
    })
    expect(store.getState().selectedId).toBe('M13')
    expect(result.data.target).toBeNull()
    expect(result.summary).toContain('180')
  })

  it('lets the target win over an explicit altitude and azimuth', async () => {
    expectOk(await run({ target: 'M31', altitude_deg: 10, azimuth_deg: 200 }))
    expect(store.getState().view.centerAltDeg).toBeCloseTo(38.95, 1)
  })

  it('refuses an unknown target and suggests real ones', async () => {
    const error = expectFail(await run({ target: 'Andromeda Nebulla' }))
    expect(error.error.code).toBe('unknown_target')
    expect(error.error.hint).toBeTruthy()
    expect(error.error.hint).toContain('M31')
    expect(store.getState().view.animate).toBe(false)
  })

  it('still centers a target below the horizon and says when it rises', async () => {
    const result = expectOk(await run({ target: 'M42' }))

    // clampView keeps the dome usable: -30 degrees is as low as the map goes.
    expect(store.getState().view.centerAltDeg).toBe(-30)
    expect(result.data.target?.above_horizon).toBe(false)
    expect(result.data.target?.airmass).toBeNull()
    expect(result.caveats).toHaveLength(1)
    expect(result.caveats[0]).toContain('below the horizon')
    expect(result.caveats[0]).toContain('rises at')
    expect(result.data.target?.next_rise?.utc?.slice(0, 13)).toBe('2026-09-03T02')
    expect(result.summary).toContain('below the horizon')
  })

  it('finds the next rise even when the target set earlier in the same night', async () => {
    // Jupiter is up when the 24 h window opens and sets long before 23:00 UTC.
    const result = expectOk(await run({ target: 'Jupiter' }))
    expect(result.data.target?.above_horizon).toBe(false)
    const rise = result.data.target?.next_rise?.utc
    expect(rise).toBeTruthy()
    expect(Date.parse(rise as string)).toBeGreaterThan(Date.parse(AT))
  })

  it('replaces the agent highlights and reports unknown ones as rejected', async () => {
    const result = expectOk(await run({ target: 'M31', highlight: ['M13', 'Saturn', 'Xanadu'] }))

    // The centred target joins the list the caller passed: the reticle pulse is
    // over before the dome stops moving, so the ring is what is left pointing
    // at the object.
    expect(store.getState().highlightedIds).toEqual(['M13', 'saturn', 'M31'])
    expect(result.data.highlighted).toEqual(['M13', 'saturn', 'M31'])
    expect(result.rejected).toEqual([{ id: 'Xanadu', name: 'Xanadu', reason: 'unknown target' }])
  })

  it('highlights the target it centred on so the agent mark outlives the reticle', async () => {
    store.getState().setHighlights([], 'agent')
    const result = expectOk(await run({ target: 'M13' }))

    expect(store.getState().highlightedIds).toEqual(['M13'])
    expect(result.data.highlighted).toEqual(['M13'])

    // Pointing somewhere else keeps the earlier mark rather than wiping it.
    expectOk(await run({ target: 'M31' }))
    expect(store.getState().highlightedIds).toEqual(['M13', 'M31'])

    // And it is not added twice.
    expectOk(await run({ target: 'M31', fov_deg: 20 }))
    expect(store.getState().highlightedIds).toEqual(['M13', 'M31'])
  })

  it('leaves the highlights alone when it only moves the view', async () => {
    store.getState().setHighlights(['M13'], 'agent')
    expectOk(await run({ fov_deg: 60 }))
    expect(store.getState().highlightedIds).toEqual(['M13'])
  })

  it('clears the highlights with an empty array', async () => {
    store.getState().setHighlights(['M13'], 'agent')
    const result = expectOk(await run({ highlight: [] }))
    expect(store.getState().highlightedIds).toEqual([])
    expect(result.data.highlighted).toEqual([])
  })

  it('refuses target together with reset:true, with the corrected call', async () => {
    const error = expectFail(await run({ target: 'M31', reset: true }))
    expect(error.error.code).toBe('invalid_input')
    expect(error.error.message).toBe('Pass either target or reset:true, not both.')
    expect(error.error.hint).toBe('Example: { "target": "M31", "fov_deg": 40 }')
    // Refused means refused: the map did not move.
    expect(store.getState().view.fovDeg).toBe(186)
  })

  it('refuses half a direction, whichever half it is', async () => {
    for (const half of [{ altitude_deg: 45 }, { azimuth_deg: 180 }]) {
      const error = expectFail(await run(half))
      expect(error.error.code).toBe('invalid_input')
      expect(error.error.message).toBe('Pass altitude_deg and azimuth_deg together.')
      expect(error.error.hint).toBe(
        'Example: { "altitude_deg": 45, "azimuth_deg": 180, "fov_deg": 60 }',
      )
    }
  })

  it('resets to the whole sky dome', async () => {
    store.getState().setView({ centerAltDeg: 10, centerAzDeg: 90, fovDeg: 12 }, 'human')
    const result = expectOk(await run({ reset: true }))
    expect(store.getState().view).toMatchObject({
      centerAltDeg: 90,
      centerAzDeg: 0,
      fovDeg: 186,
      animate: true,
    })
    expect(result.summary).toContain('whole sky')
  })

  it('clamps a field of view outside the dome range instead of failing', async () => {
    const result = expectOk(await run({ target: 'M31', fov_deg: 1000 }))
    expect(result.data.view.fov_deg).toBe(186)
  })

  it('refuses a call that asks for nothing', async () => {
    const error = expectFail(await run({}))
    expect(error.error.code).toBe('invalid_input')
  })

  it('refuses a non numeric altitude', async () => {
    const error = expectFail(await run({ altitude_deg: 'high' }))
    expect(error.error.code).toBe('invalid_input')
  })

  it('never changes the plan or registers tools', async () => {
    const result = expectOk(await run({ target: 'M31' }))
    expect(store.getState().plan).toEqual([])
    expect(result.tools_added).toBeUndefined()
    expect(result.tools_removed).toBeUndefined()
  })
})

describe('pointSkyMap robustness', () => {
  it('never throws and always answers with an ok flag, whatever the agent sends', async () => {
    const malformed: unknown[] = [null, 42, 'M31', [], { target: 42 }, { target: '' }, { highlight: 'M13' }, { highlight: [null] }, { fov_deg: Number.NaN }, { altitude_deg: {} }, { reset: 'yes' }]
    for (const bad of malformed) {
      const result = (await pointSkyMapTool.execute(bad as Record<string, unknown>)) as Result
      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) expect(typeof result.error.code).toBe('string')
    }
  })
})
