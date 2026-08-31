import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { getObservingConditionsTool } from './getObservingConditions'

interface ToolResult {
  ok: boolean
  summary: string
  data: {
    darknessStartUtc: string
    darknessEndUtc: string
    darkHours: number
    moonriseUtc: string
    moonIlluminationPct: number
    moonFreeDarkHours: number
    localTimes: { timeZone: string; darknessStart: string }
  }
  site: { name: string; latitude: number }
  as_of: string
}

describe('get_observing_conditions', () => {
  it('has a valid JSON Schema as inputSchema', () => {
    const ajv = new Ajv({ strict: false })
    // compile() throws if the schema itself is malformed
    expect(() => ajv.compile(getObservingConditionsTool.inputSchema!)).not.toThrow()
  })

  it('rejects unknown input properties via additionalProperties:false', () => {
    const ajv = new Ajv({ strict: false })
    const validate = ajv.compile(getObservingConditionsTool.inputSchema!)
    expect(validate({ date: '2026-09-02' })).toBe(true)
    expect(validate({ nonsense: 42 })).toBe(false)
    expect(validate({ date: 'not-a-date' })).toBe(false)
    expect(validate({ latitude: 200 })).toBe(false)
  })

  it('matches golden ephemeris values for the night of 2026-09-02 at the Roque', async () => {
    const result = (await getObservingConditionsTool.execute({ date: '2026-09-02' }, {})) as ToolResult
    expect(result.ok).toBe(true)
    // Golden values independently verified (astronomy-engine + design review)
    expect(result.data.darknessStartUtc).toMatch(/^2026-09-02T20:52:5/)
    expect(result.data.darknessEndUtc).toMatch(/^2026-09-03T05:29:3/)
    expect(result.data.darkHours).toBeCloseTo(8.61, 1)
    expect(result.data.moonriseUtc).toMatch(/^2026-09-02T22:43:3/)
    expect(result.data.moonIlluminationPct).toBe(66)
    // Moon rises ~2h after darkness starts → some but not all dark hours are Moon-free
    expect(result.data.moonFreeDarkHours).toBeGreaterThan(1)
    expect(result.data.moonFreeDarkHours).toBeLessThan(result.data.darkHours)
    // Times must be quoted in the site's local zone too
    expect(result.data.localTimes.timeZone).toBe('Atlantic/Canary')
    expect(result.data.localTimes.darknessStart).toBe('21:52')
    expect(result.summary).toContain('2026-09-02')
  })

  it('accepts explicit coordinates (Madrid) and still resolves a darkness window', async () => {
    const result = (await getObservingConditionsTool.execute(
      { date: '2026-09-02', latitude: 40.4168, longitude: -3.7038 },
      {},
    )) as ToolResult
    expect(result.ok).toBe(true)
    expect(result.site.latitude).toBe(40.4168)
    expect(result.data.darknessStartUtc).toMatch(/^2026-09-02T/)
    // Madrid is further north and east: darkness starts earlier in UTC than at the Roque
    expect(Date.parse(result.data.darknessStartUtc)).toBeLessThan(Date.parse('2026-09-02T20:52:50Z'))
  })
})
