import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { getNight } from '../astro/cache'
import { ROQUE_DE_LOS_MUCHACHOS, resetStore, store } from '../state/store'
import type { Site } from '../state/types'
import type { ToolError, ToolOk } from './envelope'
import { setObservingTimeTool } from './setObservingTime'

const NIGHT_OF = '2026-09-02'
const AT = '2026-09-02T23:00:00Z'

const ajv = new Ajv({ allErrors: true, strict: false })

interface TimeData {
  time: { utc: string | null; local: string | null }
  night_of: string
  sun_altitude_deg: number
  moon_altitude_deg: number
  is_astronomical_darkness: boolean
}

type Result = ToolOk<TimeData> | ToolError

async function run(input: Record<string, unknown>): Promise<Result> {
  return (await setObservingTimeTool.execute(input)) as Result
}

function expectOk(result: Result): ToolOk<TimeData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

function expectFail(result: Result): ToolError {
  if (result.ok) throw new Error(`expected a failure, got "${result.summary}"`)
  return result
}

const NORTH_CAPE: Site = {
  id: null,
  name: 'North Cape',
  latitude: 71.17,
  longitude: 25.78,
  elevationM: 300,
  timeZone: 'Europe/Oslo',
}

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: NIGHT_OF, timeUtc: AT })
})

describe('set_observing_time declaration', () => {
  it('is idempotent and named as the plan says', () => {
    expect(setObservingTimeTool.name).toBe('set_observing_time')
    expect(setObservingTimeTool.annotations).toEqual({
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(setObservingTimeTool.description.startsWith('Use this to move the time slider')).toBe(
      true,
    )
  })

  it('has an input schema Ajv compiles that needs time or date and refuses extras', () => {
    const validate = ajv.compile(setObservingTimeTool.inputSchema as object)
    expect(validate({ time: 'midnight' })).toBe(true)
    expect(validate({ date: '2026-09-12' })).toBe(true)
    expect(validate({ time: '2026-09-12T22:30:00Z', date: '2026-09-12' })).toBe(true)
    expect(validate({})).toBe(false)
    expect(validate({ time: 'now', extra: 1 })).toBe(false)
    expect(validate({ date: '12/09/2026' })).toBe(false)
  })
})

describe('set_observing_time', () => {
  it('moves the slider to a keyword of the selected night', async () => {
    const night = getNight(NIGHT_OF, ROQUE_DE_LOS_MUCHACHOS)
    const result = expectOk(await run({ time: 'darkness_start' }))

    expect(store.getState().timeUtc).toBe(night.darkness.startUtc)
    expect(result.data.time.utc).toBe(night.darkness.startUtc)
    expect(result.data.night_of).toBe(NIGHT_OF)
    expect(result.data.sun_altitude_deg).toBeCloseTo(-18, 1)
    expect(result.data.is_astronomical_darkness).toBe(true)
    expect(result.summary).toContain('2026-09-02')
  })

  it('puts midnight in the middle of astronomical darkness', async () => {
    const night = getNight(NIGHT_OF, ROQUE_DE_LOS_MUCHACHOS)
    const result = expectOk(await run({ time: 'midnight' }))
    const at = Date.parse(result.data.time.utc as string)

    expect(at).toBeGreaterThan(Date.parse(night.darkness.startUtc as string))
    expect(at).toBeLessThan(Date.parse(night.darkness.endUtc as string))
    expect(result.data.time.utc?.slice(11, 16)).toBe('01:11')
  })

  it('accepts an explicit UTC instant and reports the sky at it', async () => {
    const result = expectOk(await run({ time: '2026-09-02T21:30:00Z' }))
    expect(store.getState().timeUtc).toBe('2026-09-02T21:30:00.000Z')
    expect(result.data.time.local).toBe('2026-09-02 22:30')
    expect(result.data.is_astronomical_darkness).toBe(true)
    expect(result.data.moon_altitude_deg).toBeLessThan(0)
    expect(result.caveats).toEqual([])
  })

  it('assumes UTC for an instant with no zone and says so', async () => {
    const result = expectOk(await run({ time: '2026-09-02T21:30:00' }))
    expect(store.getState().timeUtc).toBe('2026-09-02T21:30:00.000Z')
    expect(result.caveats.join(' ')).toContain('UTC')
  })

  it('is idempotent', async () => {
    const first = expectOk(await run({ time: 'darkness_start' }))
    const second = expectOk(await run({ time: 'darkness_start' }))
    expect(second.data.time.utc).toBe(first.data.time.utc)
    expect(second.data.night_of).toBe(first.data.night_of)
  })

  it('changes the selected night and keeps the slider inside it', async () => {
    const result = expectOk(await run({ date: '2026-09-12' }))
    const night = getNight('2026-09-12', ROQUE_DE_LOS_MUCHACHOS)

    expect(store.getState().nightOf).toBe('2026-09-12')
    expect(result.data.night_of).toBe('2026-09-12')
    const at = Date.parse(result.data.time.utc as string)
    expect(at).toBeGreaterThanOrEqual(Date.parse(night.windowStartUtc))
    expect(at).toBeLessThanOrEqual(Date.parse(night.windowEndUtc))
    expect(result.caveats.join(' ')).toContain('slider')
  })

  it('applies a date and a time together', async () => {
    const result = expectOk(await run({ date: '2026-09-12', time: '2026-09-12T23:15:00Z' }))
    expect(store.getState().nightOf).toBe('2026-09-12')
    expect(store.getState().timeUtc).toBe('2026-09-12T23:15:00.000Z')
    expect(result.caveats).toEqual([])
  })

  it('refuses an impossible calendar date without touching the app', async () => {
    const error = expectFail(await run({ date: '2026-13-99' }))
    expect(error.error.code).toBe('invalid_date')
    expect(store.getState().nightOf).toBe(NIGHT_OF)
  })

  it('refuses a time it cannot read', async () => {
    const error = expectFail(await run({ time: 'tea time' }))
    expect(error.error.code).toBe('invalid_input')
    expect(error.error.message).toContain('tea time')
    expect(store.getState().timeUtc).toBe(AT)
  })

  it('refuses a call with neither time nor date', async () => {
    expect(expectFail(await run({})).error.code).toBe('invalid_input')
  })

  it('says when a keyword does not happen on that night at that latitude', async () => {
    store.setState({ site: NORTH_CAPE })
    const error = expectFail(await run({ time: 'sunset', date: '2026-06-21' }))

    expect(error.error.code).toBe('invalid_input')
    expect(error.error.message).toContain('sunset')
    expect(error.error.message).toContain('2026-06-21')
    // Nothing moved: a refused call leaves the app exactly as it was.
    expect(store.getState().nightOf).toBe(NIGHT_OF)
    expect(store.getState().timeUtc).toBe(AT)
  })

  it('logs the move as an agent action', async () => {
    await run({ time: 'midnight' })
    const actions = store.getState().activity.map((entry) => `${entry.source}:${entry.action}`)
    expect(actions).toContain('agent:set_time')
    expect(store.getState().humanActions).toEqual([])
  })
})

describe('setObservingTime robustness', () => {
  it('never throws and always answers with an ok flag, whatever the agent sends', async () => {
    const malformed: unknown[] = [null, 42, 'midnight', [], { time: 42 }, { time: '' }, { time: '2026-13-99T99:99:99Z' }, { date: 7 }, { date: '2026-02-30' }, { time: null, date: null }]
    for (const bad of malformed) {
      const result = (await setObservingTimeTool.execute(bad as Record<string, unknown>)) as Result
      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) expect(typeof result.error.code).toBe('string')
    }
  })
})
