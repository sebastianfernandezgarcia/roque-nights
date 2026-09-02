import { describe, expect, it } from 'vitest'

import { ROQUE_DE_LOS_MUCHACHOS } from '../state/store'
import { buildSiteFromValues, valuesFromPayload } from './SiteForm'

const CURRENT = {
  siteId: 'roque',
  latitude: '28.7542',
  longitude: '-17.8851',
  elevationM: '2396',
  timeZone: 'Atlantic/Canary',
  name: ROQUE_DE_LOS_MUCHACHOS.name,
}

describe('valuesFromPayload site ids', () => {
  it('resolves an id the same forgiving way the tools do', () => {
    for (const id of ['mauna-kea', 'Mauna Kea', 'MAUNA-KEA', ' mauna-kea ']) {
      const { values, unknownSiteId } = valuesFromPayload({ site_id: id }, CURRENT)
      expect(unknownSiteId, id).toBeNull()
      expect(values.siteId, id).toBe('mauna-kea')
    }
  })

  it('reports an id that resolves to nothing instead of keeping the current site', () => {
    const { unknownSiteId, values } = valuesFromPayload({ site_id: 'Mars Base One' }, CURRENT)
    expect(unknownSiteId).toBe('Mars Base One')
    // The caller answers ok:false with this; it must never read as a change.
    expect(values.siteId).toBe('roque')
  })

  it('lets coordinates win over an unknown id rather than failing the call', () => {
    const { unknownSiteId, values } = valuesFromPayload(
      { site_id: 'somewhere', latitude: 40.4, longitude: -3.7 },
      CURRENT,
    )
    expect(unknownSiteId).toBeNull()
    expect(values.siteId).toBe('custom')
    expect(values.latitude).toBe('40.4')
  })

  it('treats the custom sentinel as coordinates, not as an unknown id', () => {
    const { unknownSiteId, values } = valuesFromPayload(
      { site_id: 'custom', latitude: '10', longitude: '20', time_zone: 'UTC' },
      CURRENT,
    )
    expect(unknownSiteId).toBeNull()
    expect(values.siteId).toBe('custom')
  })

  it('keeps the current values when the payload is empty', () => {
    const { values, unknownSiteId } = valuesFromPayload({}, CURRENT)
    expect(unknownSiteId).toBeNull()
    expect(values).toEqual(CURRENT)
  })
})

describe('valuesFromPayload read as the form DOM', () => {
  /** Exactly what payloadFromForm produces: every field, all strings. */
  const domPayload = {
    site_id: 'custom',
    latitude: '19.8207',
    longitude: '-155.4681',
    elevation_m: '4205',
    time_zone: 'Pacific/Honolulu',
    name: 'Mauna Kea summit',
  }

  it('applies what the form holds, which is what a bare submit must mean', () => {
    const { values } = valuesFromPayload(domPayload, CURRENT)
    const result = buildSiteFromValues(values)
    expect('site' in result).toBe(true)
    if (!('site' in result)) return
    expect(result.site.latitude).toBeCloseTo(19.8207, 6)
    expect(result.site.timeZone).toBe('Pacific/Honolulu')
    expect(result.site.name).toBe('Mauna Kea summit')
    // Not the site the app was already showing.
    expect(result.site.latitude).not.toBeCloseTo(ROQUE_DE_LOS_MUCHACHOS.latitude, 3)
  })

  it('round trips a catalog row picked in the select', () => {
    const { values, unknownSiteId } = valuesFromPayload(
      { ...domPayload, site_id: 'paranal' },
      CURRENT,
    )
    expect(unknownSiteId).toBeNull()
    const result = buildSiteFromValues(values)
    expect('site' in result && result.site.id).toBe('paranal')
  })
})
