import { beforeEach, describe, expect, it } from 'vitest'

import { ROQUE_DE_LOS_MUCHACHOS, resetStore, store } from '../state/store'
import { applySitePayload, describeSite, resolveSitePayload } from './applySitePayload'

beforeEach(() => {
  resetStore()
})

describe('resolveSitePayload', () => {
  it('resolves a catalog id the same forgiving way the tools do', () => {
    for (const id of ['mauna-kea', 'Mauna Kea', 'MAUNA-KEA', ' mauna-kea ']) {
      const result = resolveSitePayload({ site_id: id })
      expect(result.ok, id).toBe(true)
      if (!result.ok) continue
      expect(result.site.id).toBe('mauna-kea')
      expect(result.site.timeZone).toBe('Pacific/Honolulu')
      expect(result.site.elevationM).toBe(4205)
    }
  })

  it('accepts id as an alias of site_id, and a bare catalog name', () => {
    const byId = resolveSitePayload({ id: 'paranal' })
    expect(byId.ok && byId.site.id).toBe('paranal')
    const byName = resolveSitePayload({ name: 'Mauna Kea' })
    expect(byName.ok && byName.site.id).toBe('mauna-kea')
  })

  it('refuses an id that resolves to nothing instead of keeping the current site', () => {
    const result = resolveSitePayload({ site_id: 'Mars Base One' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_site')
    expect(result.error.message).toContain('Mars Base One')
    expect(result.error.hint).toContain('mauna-kea')
  })

  it('lets coordinates win over an unknown id rather than failing the call', () => {
    const result = resolveSitePayload({ site_id: 'somewhere', latitude: 40.4, longitude: -3.7 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.site.latitude).toBeCloseTo(40.4, 6)
    expect(result.site.id).toBeNull()
  })

  it('reads the strings a form field produces as numbers', () => {
    const result = resolveSitePayload({
      site_id: 'custom',
      latitude: '19.8207',
      longitude: '-155.4681',
      elevation_m: '4205',
      time_zone: 'Pacific/Honolulu',
      name: 'Mauna Kea summit',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.site.latitude).toBeCloseTo(19.8207, 6)
    expect(result.site.elevationM).toBe(4205)
    expect(result.site.name).toBe('Mauna Kea summit')
  })

  it('never invents a time zone for far away coordinates', () => {
    const result = resolveSitePayload({ latitude: 0, longitude: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.site.timeZone).toBeNull()
    expect(result.caveats.join(' ')).toContain('Local times omitted')
  })

  it('refuses one coordinate without the other', () => {
    const result = resolveSitePayload({ latitude: 40.4 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_site')
    expect(result.error.message).toContain('longitude')
  })

  it('refuses an out of range coordinate and a zone this browser does not know', () => {
    const far = resolveSitePayload({ latitude: 100, longitude: 0 })
    expect(far.ok).toBe(false)
    if (!far.ok) expect(far.error.code).toBe('invalid_site')

    const zone = resolveSitePayload({ latitude: 28.7, longitude: -17.9, time_zone: 'Mars/Olympus' })
    expect(zone.ok).toBe(false)
    if (!zone.ok) expect(zone.error.code).toBe('invalid_time_zone')
  })

  it('refuses an empty payload instead of re-applying the current site', () => {
    const result = resolveSitePayload({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('Nothing to set')
  })
})

describe('applySitePayload', () => {
  it('moves the app and attributes the change to the caller', () => {
    const result = applySitePayload({ site_id: 'mauna-kea' }, 'agent')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const state = store.getState()
    expect(state.site.id).toBe('mauna-kea')
    expect(result.summary).toBe(describeSite(state.site))
    expect(result.summary).toContain('Mauna Kea')
    expect(state.activity[0]).toMatchObject({ source: 'agent', action: 'set_site' })
  })

  it('records a human submit as a human action', () => {
    applySitePayload({ site_id: 'teide' }, 'human')
    const state = store.getState()
    expect(state.site.id).toBe('teide')
    expect(state.humanActions[0]?.kind).toBe('set_site')
  })

  it('leaves the app exactly where it was when the payload is refused', () => {
    const result = applySitePayload({ site_id: 'Mars Base One' }, 'agent')
    expect(result.ok).toBe(false)
    expect(store.getState().site).toEqual(ROQUE_DE_LOS_MUCHACHOS)
    expect(store.getState().activity).toHaveLength(0)
  })
})
