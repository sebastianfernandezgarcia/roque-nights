import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetStore, store } from '../state/store'
import type { ToolError, ToolOk } from './envelope'
import { rankNightsTool, type RankNightsData } from './rankNights'

type Result = ToolOk<RankNightsData> | ToolError

async function call(
  input: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<Result> {
  return (await rankNightsTool.execute(input, options)) as Result
}

function expectOk(result: Result): ToolOk<RankNightsData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

async function expectError(input: Record<string, unknown>): Promise<ToolError> {
  const result = await call(input)
  if (result.ok) throw new Error('expected a refusal')
  return result
}

const SEPTEMBER = { from_date: '2026-08-31', to_date: '2026-09-14' }

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: '2026-09-02' })
})

describe('the declaration an agent reads', () => {
  it('is read-only, closed-world and idempotent, and tells the agent not to loop', () => {
    expect(rankNightsTool.name).toBe('rank_nights')
    expect(rankNightsTool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    })
    expect(rankNightsTool.description).toMatch(/instead of calling get_night_ephemeris in a loop/)
    expect(rankNightsTool.description).toContain('BEST ASTRONOMICAL NIGHT')
    // Honesty about the half it does not know: the clouds live elsewhere.
    expect(rankNightsTool.description).toContain(
      'It does not know the weather; for cloud cover use compare_dark_sky_sites.',
    )
    expect(rankNightsTool.title).toContain('astronomical night')
    // The playbook prompt is "which night is best here? Set the app to it", so
    // the description has to say the tool does not do the second half.
    expect(rankNightsTool.description).toContain('Read-only: it does not move the app')
    expect(rankNightsTool.description).toContain('set_observing_time')
    expect(rankNightsTool.description).toMatch(/from_date and to_date are both required/)
  })

  it('has an input schema Ajv accepts, with both dates required', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(rankNightsTool.inputSchema!)
    expect(validate({ from_date: '2026-08-31', to_date: '2026-09-14' })).toBe(true)
    expect(validate({ from_date: '2026-08-31', to_date: '2026-09-14', limit: 5 })).toBe(true)
    expect(validate({ from_date: '2026-08-31' })).toBe(false)
    expect(validate({})).toBe(false)
    expect(validate({ ...SEPTEMBER, limit: 99 })).toBe(false)
    expect(validate({ ...SEPTEMBER, nights: 5 })).toBe(false)
  })
})

describe('ranking a fortnight at the Roque', () => {
  it('puts the dark-Moon nights on top and scores every night in the range', async () => {
    const result = expectOk(await call(SEPTEMBER))
    const { data } = result

    expect(data.from_date).toBe('2026-08-31')
    expect(data.to_date).toBe('2026-09-14')
    expect(data.nights_evaluated).toBe(15)
    expect(data.all_scores).toHaveLength(15)
    expect(data.best.length).toBe(10)

    const winner = data.best[0]
    expect(winner.night_of >= '2026-09-09' && winner.night_of <= '2026-09-14').toBe(true)
    expect(winner.usable_hours).toBeGreaterThan(6)
    expect(winner.darkness_status).toBe('ok')
    expect(winner.explanation.length).toBeGreaterThan(10)

    for (let i = 1; i < data.best.length; i++) {
      expect(data.best[i - 1].score).toBeGreaterThanOrEqual(data.best[i].score)
    }

    const augustEnd = data.all_scores.find((n) => n.night_of === '2026-08-31')!
    expect(augustEnd.score).toBeLessThan(winner.score)
    const fullMoonNight = data.best.find((n) => n.night_of === '2026-08-31')
    if (fullMoonNight) expect(fullMoonNight.moon_illumination_pct).toBeGreaterThan(80)
  }, 20_000)

  it('writes a summary with the winning dates and their numbers', async () => {
    const result = expectOk(await call({ ...SEPTEMBER, limit: 3 }))
    const winner = result.data.best[0]
    expect(result.summary).toContain('Best astronomical night of 15')
    expect(result.summary).toContain('2026-08-31 to 2026-09-14')
    expect(result.summary).toContain(winner.night_of)
    expect(result.summary).toContain(`score ${winner.score}`)
    expect(result.summary).toMatch(/usable dark hours/)
    expect(result.summary).toMatch(/Moon \d+%/)
  }, 20_000)

  it('honours limit without dropping nights from all_scores', async () => {
    const result = expectOk(await call({ ...SEPTEMBER, limit: 2 }))
    expect(result.data.best).toHaveLength(2)
    expect(result.data.all_scores).toHaveLength(15)
  }, 20_000)

  it('ranks a single night too', async () => {
    const result = expectOk(await call({ from_date: '2026-09-02', to_date: '2026-09-02' }))
    expect(result.data.nights_evaluated).toBe(1)
    expect(result.data.best[0].night_of).toBe('2026-09-02')
    expect(result.data.best[0].dark_hours).toBeCloseTo(8.61, 1)
  })

  it('works at a site the app is not looking at', async () => {
    const result = expectOk(
      await call({
        from_date: '2026-09-01',
        to_date: '2026-09-05',
        site: { latitude: 19.8207, longitude: -155.4681 },
      }),
    )
    expect(result.site.name).toContain('Mauna Kea')
    expect(result.caveats.join(' ')).toMatch(/inferred/i)
  }, 20_000)
})

describe('refusals', () => {
  it('needs both ends of the range', async () => {
    expect((await expectError({ from_date: '2026-09-01' })).error.code).toBe('invalid_input')
    expect((await expectError({ to_date: '2026-09-01' })).error.code).toBe('invalid_input')
    expect((await expectError({})).error.code).toBe('invalid_input')
  })

  it('rejects impossible dates', async () => {
    expect((await expectError({ from_date: '2026-13-99', to_date: '2026-09-14' })).error.code).toBe(
      'invalid_date',
    )
    expect((await expectError({ from_date: '2026-09-01', to_date: '2026-02-30' })).error.code).toBe(
      'invalid_date',
    )
  })

  it('rejects a backwards range and one longer than 62 nights', async () => {
    const backwards = await expectError({ from_date: '2026-09-14', to_date: '2026-08-31' })
    expect(backwards.error.code).toBe('invalid_input')
    expect(backwards.error.message).toMatch(/before/)

    const tooLong = await expectError({ from_date: '2026-01-01', to_date: '2026-12-31' })
    expect(tooLong.error.code).toBe('invalid_input')
    expect(tooLong.error.message).toMatch(/62/)
  })
})

describe('cancellation', () => {
  it('gives back a structured aborted error instead of throwing', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await call(SEPTEMBER, { signal: controller.signal })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('aborted')
    expect(result.error.message).toMatch(/cancel|abort/i)
  })
})
