import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_FILTERS, resetStore, store } from '../state/store'
import type { ToolError, ToolOk } from './envelope'
import {
  findObservableTargetsTool,
  type FindObservableTargetsData,
} from './findObservableTargets'

type Result = ToolOk<FindObservableTargetsData> | ToolError

async function call(input: Record<string, unknown> = {}): Promise<Result> {
  return (await findObservableTargetsTool.execute(input, {})) as Result
}

function expectOk(result: Result): ToolOk<FindObservableTargetsData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

async function expectError(input: Record<string, unknown>): Promise<ToolError> {
  const result = await call(input)
  if (result.ok) throw new Error('expected a refusal')
  return result
}

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: '2026-09-02', filters: { ...DEFAULT_FILTERS } })
})

describe('the declaration an agent reads', () => {
  it('is read-only, closed-world and idempotent', () => {
    expect(findObservableTargetsTool.name).toBe('find_observable_targets')
    expect(findObservableTargetsTool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    })
    expect(findObservableTargetsTool.description).toMatch(/REJECTED and why/)
    expect(findObservableTargetsTool.description).toContain(
      'Bright stars are included only when you ask for them',
    )
    expect(findObservableTargetsTool.description).toContain('data.filters_used')
  })

  it('promises no default for the filters it takes from the app', () => {
    const properties = (
      findObservableTargetsTool.inputSchema as {
        properties: Record<string, { default?: unknown; description: string }>
      }
    ).properties
    for (const field of ['min_altitude_deg', 'min_moon_separation_deg', 'max_magnitude', 'types']) {
      expect(properties[field].default).toBeUndefined()
      expect(properties[field].description).toMatch(/app/)
    }
    // The two that really are fixed still declare their default.
    expect(properties.min_window_minutes.default).toBe(45)
    expect(properties.limit.default).toBe(12)
  })

  it('has an input schema Ajv accepts and that closes the door on extra keys', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(findObservableTargetsTool.inputSchema!)
    expect(validate({})).toBe(true)
    expect(
      validate({
        date: '2026-09-02',
        site: { latitude: 28.7, longitude: -17.9 },
        min_altitude_deg: 30,
        types: ['galaxy', 'globular_cluster'],
        max_magnitude: 8,
        min_moon_separation_deg: 45,
        min_window_minutes: 60,
        limit: 5,
        query: 'nebula',
        ids: ['M31', 'Jupiter'],
      }),
    ).toBe(true)
    expect(validate({ types: ['comet'] })).toBe(false)
    expect(validate({ min_altitude_deg: 200 })).toBe(false)
    expect(validate({ limit: 0 })).toBe(false)
    expect(validate({ telescope: 'GTC' })).toBe(false)
  })
})

describe('a default night at the Roque', () => {
  it('returns scored candidates and every rejection with a reason', async () => {
    const result = expectOk(await call())
    const { data } = result

    expect(data.night_of).toBe('2026-09-02')
    expect(data.darkness.status).toBe('ok')
    expect(data.darkness.start.local).toBe('2026-09-02 21:52')
    expect(data.candidates.length).toBeGreaterThan(3)
    expect(data.candidates.length).toBeLessThanOrEqual(12)
    expect(data.candidates.map((c) => c.id)).toContain('M31')
    expect(data.targets_evaluated).toBe(data.observable_count + result.rejected.length)

    for (let i = 1; i < data.candidates.length; i++) {
      expect(data.candidates[i - 1].score).toBeGreaterThanOrEqual(data.candidates[i].score)
    }
    for (const rejection of result.rejected) {
      expect(rejection.reason.length).toBeGreaterThan(5)
      expect(rejection.name.length).toBeGreaterThan(0)
    }

    const m31 = data.candidates.find((c) => c.id === 'M31')!
    expect(m31.name).toMatch(/Andromeda/)
    expect(m31.type).toBe('galaxy')
    expect(m31.constellation).toBe('And')
    expect(m31.peak_altitude_deg).toBeGreaterThan(30)
    expect(m31.peak_airmass).toBeGreaterThan(0.9)
    expect(m31.peak_direction).toMatch(/^[NESW]/)
    expect(m31.window.minutes).toBeGreaterThanOrEqual(45)
    expect(m31.window.peak.local).toMatch(/^2026-09-0[23] \d\d:\d\d$/)
    expect(m31.transit.utc).not.toBeNull()
    expect(m31.moon_separation_deg).toBeGreaterThan(0)
  })

  it('writes a summary with the counts and the best targets in it', async () => {
    const result = expectOk(await call({ limit: 5 }))
    expect(result.summary).toContain('2026-09-02')
    expect(result.summary).toContain('Roque de los Muchachos')
    expect(result.summary).toContain('30°')
    expect(result.summary).toMatch(/^\d+ of \d+ targets are observable/)
    expect(result.summary).toMatch(/Rejected \d+/)
    expect(result.summary).toContain(result.data.candidates[0].name)
    expect(result.summary).toMatch(/peak \d+°, \d\d:\d\d local/)
  })

  it('honours the limit without lying about how many are observable', async () => {
    const wide = expectOk(await call({ limit: 40 }))
    const narrow = expectOk(await call({ limit: 3 }))
    expect(narrow.data.candidates).toHaveLength(3)
    expect(narrow.data.observable_count).toBe(wide.data.observable_count)
    expect(narrow.data.observable_count).toBeGreaterThan(3)
    expect(narrow.data.filters_used.limit).toBe(3)
  })

  it('scans the catalog fast enough for an agent turn', async () => {
    const started = performance.now()
    await call()
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('narrowing the search', () => {
  it('checks only the targets asked for and reports the ones it cannot name', async () => {
    const result = expectOk(await call({ ids: ['M31', 'Jupiter', 'Klingon Homeworld'] }))
    const ids = result.data.candidates.map((c) => c.id)
    for (const id of ids) expect(['M31', 'jupiter']).toContain(id)
    expect(result.data.targets_evaluated).toBe(3)
    const unknown = result.rejected.find((r) => r.id === 'Klingon Homeworld')
    expect(unknown?.reason).toBe('unknown target')
  })

  it('filters by type and says which targets the filter removed', async () => {
    const result = expectOk(await call({ types: ['globular_cluster'], limit: 40 }))
    for (const candidate of result.data.candidates) expect(candidate.type).toBe('globular_cluster')
    expect(result.rejected.some((r) => r.reason === 'type excluded by filter')).toBe(true)
    expect(result.data.filters_used.types).toEqual(['globular_cluster'])
  })

  it('raising the altitude floor leaves fewer targets standing', async () => {
    const low = expectOk(await call({ min_altitude_deg: 20, limit: 40 }))
    const high = expectOk(await call({ min_altitude_deg: 75, limit: 40 }))
    expect(high.data.observable_count).toBeLessThan(low.data.observable_count)
    expect(high.rejected.some((r) => /below minimum altitude/.test(r.reason))).toBe(true)
  })

  it('takes its defaults from the filters the human set in the app', async () => {
    store.setState({ filters: { ...DEFAULT_FILTERS, minAltDeg: 70, maxMag: 6 } })
    const result = expectOk(await call())
    expect(result.data.filters_used.min_altitude_deg).toBe(70)
    expect(result.data.filters_used.max_magnitude).toBe(6)
  })

  it('an explicit argument beats the app filter', async () => {
    store.setState({ filters: { ...DEFAULT_FILTERS, minAltDeg: 70 } })
    const result = expectOk(await call({ min_altitude_deg: 25 }))
    expect(result.data.filters_used.min_altitude_deg).toBe(25)
  })

  it('echoes the Moon separation the app is set to, without a schema default', async () => {
    store.setState({ filters: { ...DEFAULT_FILTERS, minMoonSepDeg: 55 } })
    const result = expectOk(await call())
    expect(result.data.filters_used.min_moon_separation_deg).toBe(55)
    expect(expectOk(await call({ min_moon_separation_deg: 10 })).data.filters_used
      .min_moon_separation_deg).toBe(10)
  })

  it('the magnitude limit reaches the planets, which carry no catalog magnitude', async () => {
    const result = expectOk(await call({ max_magnitude: 6, limit: 40 }))
    const ids = result.data.candidates.map((c) => c.id)
    expect(ids).not.toContain('neptune')
    expect(ids).not.toContain('uranus')
    expect(result.rejected.find((r) => r.id === 'neptune')?.reason).toMatch(
      /fainter than magnitude limit/,
    )
    for (const candidate of result.data.candidates) {
      expect(candidate.magnitude === null || candidate.magnitude <= 6).toBe(true)
    }

    // And a planet reports the brightness it actually has that night.
    const saturn = expectOk(await call({ ids: ['Saturn'] })).data.candidates[0]
    expect(saturn.id).toBe('saturn')
    expect(saturn.magnitude).not.toBeNull()
    expect(saturn.magnitude!).toBeLessThan(2)
  })

  it('keeps bright stars out of the default scan and says so', async () => {
    const byDefault = expectOk(await call({ limit: 40 }))
    expect(byDefault.data.candidates.some((c) => c.type === 'star')).toBe(false)
    expect(byDefault.caveats.join(' ')).toContain('Bright stars were not scanned')

    const asked = expectOk(await call({ types: ['star'], limit: 40 }))
    expect(asked.data.candidates.some((c) => c.type === 'star')).toBe(true)
    expect(asked.caveats.join(' ')).not.toContain('Bright stars were not scanned')

    const named = expectOk(await call({ ids: ['Vega'] }))
    expect(named.data.candidates.map((c) => c.id)).toEqual(['star:vega'])
  })
})

describe('a Moon soaked night', () => {
  it('warns that a bright Moon is up and quotes the usable hours', async () => {
    // 2026-09-26 at the Roque: full Moon above the horizon through the darkness.
    const result = expectOk(await call({ date: '2026-09-26', limit: 5 }))
    const caveat = result.caveats.find((c) => c.startsWith('The Moon is'))
    expect(caveat).toBeDefined()
    expect(caveat!).toMatch(/The Moon is \d+% lit and above the horizon for \d+% of the darkness/)
    expect(caveat!).toMatch(/leaving \d+\.\d h usable out of \d+\.\d h of darkness/)
    expect(result.data.candidates[0].moon_up_fraction).toBe(1)

    // A new Moon night says nothing about the Moon.
    const dark = expectOk(await call({ date: '2026-09-12', limit: 5 }))
    expect(dark.caveats.some((c) => c.startsWith('The Moon is'))).toBe(false)
    expect(dark.data.candidates[0].moon_up_fraction).toBe(0)
  })
})

describe('refusals', () => {
  it('rejects an altitude outside the schema range', async () => {
    expect((await expectError({ min_altitude_deg: 200 })).error.code).toBe('invalid_input')
    expect((await expectError({ min_altitude_deg: 'high' })).error.code).toBe('invalid_input')
  })

  it('rejects a bad limit, a bad window and a bad type', async () => {
    expect((await expectError({ limit: 0 })).error.code).toBe('invalid_input')
    expect((await expectError({ min_window_minutes: 5 })).error.code).toBe('invalid_input')
    expect((await expectError({ types: ['comet'] })).error.code).toBe('invalid_input')
    expect((await expectError({ ids: 'M31' })).error.code).toBe('invalid_input')
  })

  it('rejects an impossible date and half a coordinate pair', async () => {
    expect((await expectError({ date: '2026-02-30' })).error.code).toBe('invalid_date')
    expect((await expectError({ site: { longitude: 10 } })).error.code).toBe('invalid_site')
  })
})

describe('a night that is not dark', () => {
  it('rejects every target with the darkness reason instead of pretending', async () => {
    const result = expectOk(
      await call({
        date: '2026-06-21',
        site: { latitude: 69.6492, longitude: 18.9553, time_zone: 'Europe/Oslo' },
      }),
    )
    expect(result.data.candidates).toHaveLength(0)
    expect(result.data.observable_count).toBe(0)
    expect(result.rejected[0].reason).toMatch(/no astronomical darkness/)
    expect(result.summary).toMatch(/no astronomical darkness|No astronomical darkness/)
  })
})
