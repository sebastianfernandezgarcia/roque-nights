import { describe, expect, it } from 'vitest'

import type { Site } from '../state/types'
import type { ToolError } from './envelope'
import {
  CATALOG_MATCH_DEG,
  LOCAL_TIMES_OMITTED_CAVEAT,
  TIME_ZONE_INFERENCE_DEG,
  inferredTimeZoneCaveat,
  resolveNightOf,
  resolveSite,
} from './resolveSite'

const ROQUE: Site = {
  id: 'roque',
  name: 'Roque de los Muchachos, La Palma',
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}

function asError(result: unknown): ToolError {
  const r = result as ToolError
  expect(r.ok).toBe(false)
  return r
}

function asSite(result: ReturnType<typeof resolveSite>): { site: Site; caveats: string[] } {
  if ('ok' in result) throw new Error(`expected a site, got ${JSON.stringify(result)}`)
  return result
}

describe('resolveSite: no input', () => {
  it('falls back to the current site without caveats', () => {
    for (const input of [undefined, null, {}]) {
      const r = asSite(resolveSite(input, ROQUE))
      expect(r.site).toEqual(ROQUE)
      expect(r.caveats).toEqual([])
    }
  })
})

describe('resolveSite: catalog coordinates', () => {
  it('adopts the catalog identity and infers the zone for Mauna Kea', () => {
    const r = asSite(resolveSite({ latitude: 19.8207, longitude: -155.4681 }, ROQUE))
    expect(r.site.timeZone).toBe('Pacific/Honolulu')
    expect(r.site.id).toBe('mauna-kea')
    expect(r.site.name).toContain('Mauna Kea')
    expect(r.site.elevationM).toBe(4205)
    expect(r.site.latitude).toBe(19.8207)
    expect(r.site.longitude).toBe(-155.4681)
    expect(r.caveats).toEqual([inferredTimeZoneCaveat(r.site.name, 'Pacific/Honolulu')])
  })

  it('lets an explicit name, elevation and zone win over the catalog', () => {
    const r = asSite(
      resolveSite(
        {
          latitude: 19.8207,
          longitude: -155.4681,
          elevation_m: 4100,
          name: 'Subaru dome',
          time_zone: 'UTC',
        },
        ROQUE,
      ),
    )
    expect(r.site).toEqual({
      id: 'mauna-kea',
      name: 'Subaru dome',
      latitude: 19.8207,
      longitude: -155.4681,
      elevationM: 4100,
      timeZone: 'UTC',
    })
    expect(r.caveats).toEqual([])
  })
})

describe('resolveSite: custom coordinates', () => {
  it('infers only the zone for a point within one degree of a catalog site', () => {
    const r = asSite(resolveSite({ latitude: 19.5, longitude: -155.2 }, ROQUE))
    expect(r.site.timeZone).toBe('Pacific/Honolulu')
    expect(r.site.id).toBeNull()
    expect(r.site.name).toBe('19.500, -155.200')
    expect(r.site.elevationM).toBe(0)
    expect(r.caveats).toHaveLength(1)
    expect(r.caveats[0]).toContain('Time zone inferred from nearby site')
  })

  it('omits local times when no catalog site is near', () => {
    const r = asSite(resolveSite({ latitude: 0, longitude: 0 }, ROQUE))
    expect(r.site.timeZone).toBeNull()
    expect(r.site.id).toBeNull()
    expect(r.site.name).toBe('0.000, 0.000')
    expect(r.site.elevationM).toBe(0)
    expect(r.caveats).toEqual([LOCAL_TIMES_OMITTED_CAVEAT])
    expect(LOCAL_TIMES_OMITTED_CAVEAT).toContain('site.time_zone')
  })

  it('takes an explicit zone anywhere on Earth, with no caveat', () => {
    const r = asSite(
      resolveSite({ latitude: 0, longitude: 0, time_zone: 'Africa/Accra', name: 'Null Island' }, ROQUE),
    )
    expect(r.site).toEqual({
      id: null,
      name: 'Null Island',
      latitude: 0,
      longitude: 0,
      elevationM: 0,
      timeZone: 'Africa/Accra',
    })
    expect(r.caveats).toEqual([])
  })

  it('keeps the caller elevation for a custom point', () => {
    const r = asSite(resolveSite({ latitude: -33.4, longitude: 18.4, elevation_m: 25 }, ROQUE))
    expect(r.site.elevationM).toBe(25)
  })

  it('exposes the two match radii it uses', () => {
    expect(CATALOG_MATCH_DEG).toBe(0.05)
    expect(TIME_ZONE_INFERENCE_DEG).toBe(1)
  })
})

describe('resolveSite: catalog site by name', () => {
  it('accepts a bare catalog name or id and says what it resolved', () => {
    const r = asSite(resolveSite({ name: 'Mauna Kea' }, ROQUE))
    expect(r.site.id).toBe('mauna-kea')
    expect(r.site.timeZone).toBe('Pacific/Honolulu')
    expect(r.site.latitude).toBe(19.8207)
    expect(r.caveats[0]).toContain('Resolved "Mauna Kea"')
    expect(asSite(resolveSite({ id: 'paranal' }, ROQUE)).site.id).toBe('paranal')
  })

  it('carries no catalog-only fields into the site', () => {
    const r = asSite(resolveSite({ name: 'paranal' }, ROQUE))
    expect(Object.keys(r.site).sort()).toEqual([
      'elevationM',
      'id',
      'latitude',
      'longitude',
      'name',
      'timeZone',
    ])
  })

  it('refuses a name it cannot place', () => {
    const e = asError(resolveSite({ name: 'my backyard' }, ROQUE))
    expect(e.error.code).toBe('invalid_site')
    expect(e.error.message).toContain('my backyard')
  })
})

describe('resolveSite: rejections', () => {
  it('needs the coordinate pair complete', () => {
    expect(asError(resolveSite({ latitude: 10 }, ROQUE)).error.code).toBe('invalid_site')
    expect(asError(resolveSite({ longitude: 10 }, ROQUE)).error.code).toBe('invalid_site')
    const e = asError(resolveSite({ latitude: 10 }, ROQUE))
    expect(e.error.message).toContain('longitude')
    expect(e.error.hint).toBeTruthy()
    expect(typeof e.as_of).toBe('string')
  })

  it('rejects coordinates that are not finite numbers in range', () => {
    const bad: unknown[] = [
      { latitude: 'north', longitude: 0 },
      { latitude: 0, longitude: '0' },
      { latitude: Number.NaN, longitude: 0 },
      { latitude: 0, longitude: Number.POSITIVE_INFINITY },
      { latitude: 91, longitude: 0 },
      { latitude: -91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: 0, longitude: -181 },
      { latitude: null, longitude: null },
    ]
    for (const input of bad) {
      expect(asError(resolveSite(input, ROQUE)).error.code, JSON.stringify(input)).toBe(
        'invalid_site',
      )
    }
  })

  it('rejects a site that is not an object', () => {
    for (const input of ['28.7,-17.9', 42, true, [28.7, -17.9]]) {
      expect(asError(resolveSite(input, ROQUE)).error.code).toBe('invalid_site')
    }
  })

  it('rejects an out-of-range or non-numeric elevation', () => {
    expect(
      asError(resolveSite({ latitude: 0, longitude: 0, elevation_m: 20000 }, ROQUE)).error.code,
    ).toBe('invalid_site')
    expect(
      asError(resolveSite({ latitude: 0, longitude: 0, elevation_m: 'high' }, ROQUE)).error.code,
    ).toBe('invalid_site')
  })

  it('rejects a name that is not a short string', () => {
    expect(
      asError(resolveSite({ latitude: 0, longitude: 0, name: 'x'.repeat(81) }, ROQUE)).error.code,
    ).toBe('invalid_site')
    expect(asError(resolveSite({ latitude: 0, longitude: 0, name: 7 }, ROQUE)).error.code).toBe(
      'invalid_site',
    )
    const blank = asSite(resolveSite({ latitude: 0, longitude: 0, name: '   ' }, ROQUE))
    expect(blank.site.name).toBe('0.000, 0.000')
  })

  it('never invents a time zone', () => {
    const e = asError(
      resolveSite({ latitude: 10, longitude: 20, time_zone: 'Mars/Olympus' }, ROQUE),
    )
    expect(e.error.code).toBe('invalid_time_zone')
    expect(e.error.hint).toContain('Pacific/Honolulu')
    const e2 = asError(resolveSite({ latitude: 10, longitude: 20, time_zone: 5 }, ROQUE))
    expect(e2.error.code).toBe('invalid_time_zone')
  })
})

describe('resolveNightOf', () => {
  it('falls back when nothing is passed', () => {
    expect(resolveNightOf(undefined, '2026-09-02')).toBe('2026-09-02')
    expect(resolveNightOf(null, '2026-09-02')).toBe('2026-09-02')
  })

  it('accepts a real calendar date', () => {
    expect(resolveNightOf('2026-09-12', '2026-09-02')).toBe('2026-09-12')
    expect(resolveNightOf('2028-02-29', '2026-09-02')).toBe('2028-02-29')
  })

  it('rejects dates that only look valid', () => {
    for (const input of ['2026-13-99', '2026-02-30', '2026-9-2', '2026-09-02T00:00Z', 20260902, '']) {
      const e = asError(resolveNightOf(input, '2026-09-02'))
      expect(e.error.code, String(input)).toBe('invalid_date')
      expect(e.error.hint).toContain('YYYY-MM-DD')
    }
  })

  it('quotes the offending value in the message', () => {
    const e = asError(resolveNightOf('2026-13-99', '2026-09-02'))
    expect(e.error.message).toContain('2026-13-99')
  })
})
