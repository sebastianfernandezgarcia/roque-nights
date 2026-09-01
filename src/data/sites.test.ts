import { describe, expect, it } from 'vitest'

import { isValidTimeZone } from '../astro/time'
import {
  DARK_SKY_SITES,
  angularDistanceDeg,
  findSite,
  nearestSite,
  type DarkSkySite,
} from './sites'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const COUNTRY = /^[A-Z]{2}$/
const KINDS = new Set(['observatory', 'starlight_reserve', 'dark_sky_park'])

function byId(id: string): DarkSkySite {
  const site = DARK_SKY_SITES.find((s) => s.id === id)
  if (!site) throw new Error(`no catalog site with id "${id}"`)
  return site
}

describe('DARK_SKY_SITES', () => {
  it('carries at least 22 sites', () => {
    expect(DARK_SKY_SITES.length).toBeGreaterThanOrEqual(22)
  })

  it('has unique lowercase-kebab ids', () => {
    const ids = DARK_SKY_SITES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(KEBAB)
  })

  it('has a real IANA time zone on every site', () => {
    for (const site of DARK_SKY_SITES) {
      expect(isValidTimeZone(site.timeZone), `${site.id}: ${site.timeZone}`).toBe(true)
    }
  })

  it('has plausible coordinates, elevations, countries and kinds', () => {
    for (const site of DARK_SKY_SITES) {
      expect(site.name.length, site.id).toBeGreaterThan(2)
      expect(site.latitude, site.id).toBeGreaterThanOrEqual(-90)
      expect(site.latitude, site.id).toBeLessThanOrEqual(90)
      expect(site.longitude, site.id).toBeGreaterThanOrEqual(-180)
      expect(site.longitude, site.id).toBeLessThanOrEqual(180)
      expect(site.elevationM, site.id).toBeGreaterThanOrEqual(-430)
      expect(site.elevationM, site.id).toBeLessThanOrEqual(9000)
      expect(site.country, site.id).toMatch(COUNTRY)
      expect(KINDS.has(site.kind), `${site.id}: ${site.kind}`).toBe(true)
    }
  })

  it('uses every kind at least once', () => {
    const kinds = new Set(DARK_SKY_SITES.map((s) => s.kind))
    expect(kinds).toEqual(KINDS)
  })

  it('keeps the home site exactly as the app defaults to it', () => {
    expect(byId('roque')).toMatchObject({
      name: 'Roque de los Muchachos, La Palma',
      latitude: 28.7542,
      longitude: -17.8851,
      elevationM: 2396,
      timeZone: 'Atlantic/Canary',
      country: 'ES',
    })
  })

  it('holds the reference sites the plan names, with their zones', () => {
    expect(byId('mauna-kea')).toMatchObject({
      latitude: 19.8207,
      longitude: -155.4681,
      elevationM: 4205,
      timeZone: 'Pacific/Honolulu',
    })
    expect(byId('paranal').timeZone).toBe('America/Santiago')
    expect(byId('siding-spring').timeZone).toBe('Australia/Sydney')
    expect(byId('aoraki-mackenzie').timeZone).toBe('Pacific/Auckland')
    expect(byId('kitt-peak').timeZone).toBe('America/Phoenix')
  })

  it('spreads the catalog over both hemispheres', () => {
    expect(DARK_SKY_SITES.some((s) => s.latitude > 0)).toBe(true)
    expect(DARK_SKY_SITES.some((s) => s.latitude < 0)).toBe(true)
  })

  it('keeps every pair further apart than the 0.05 degree catalog-match radius', () => {
    for (let i = 0; i < DARK_SKY_SITES.length; i++) {
      for (let j = i + 1; j < DARK_SKY_SITES.length; j++) {
        const a = DARK_SKY_SITES[i]
        const b = DARK_SKY_SITES[j]
        const d = angularDistanceDeg(a.latitude, a.longitude, b.latitude, b.longitude)
        expect(d, `${a.id} vs ${b.id}`).toBeGreaterThan(0.05)
      }
    }
  })
})

describe('angularDistanceDeg', () => {
  it('is zero for the same point', () => {
    expect(angularDistanceDeg(28.7542, -17.8851, 28.7542, -17.8851)).toBe(0)
  })

  it('measures one degree of latitude as one degree', () => {
    expect(angularDistanceDeg(0, 0, 1, 0)).toBeCloseTo(1, 9)
  })

  it('crosses the antimeridian without going the long way round', () => {
    expect(angularDistanceDeg(0, 179.9, 0, -179.9)).toBeCloseTo(0.2, 6)
  })

  it('shrinks longitude separation with latitude', () => {
    expect(angularDistanceDeg(60, 0, 60, 1)).toBeCloseTo(0.5, 2)
  })
})

describe('nearestSite', () => {
  it('matches exact catalog coordinates with zero distance', () => {
    const hit = nearestSite(19.8207, -155.4681)
    expect(hit.site.id).toBe('mauna-kea')
    expect(hit.distanceDeg).toBeCloseTo(0, 9)
    expect(hit.distanceKm).toBeCloseTo(0, 6)
  })

  it('finds the site a few kilometres away', () => {
    const hit = nearestSite(28.76, -17.88)
    expect(hit.site.id).toBe('roque')
    expect(hit.distanceKm).toBeLessThan(5)
  })

  it('reports a large distance for the middle of the Atlantic', () => {
    const hit = nearestSite(0, 0)
    expect(hit.distanceDeg).toBeGreaterThan(1)
    expect(hit.distanceKm).toBeGreaterThan(500)
  })

  it('works in the southern hemisphere and near 180 degrees of longitude', () => {
    expect(nearestSite(-43.9856, 170.465).site.id).toBe('aoraki-mackenzie')
    expect(nearestSite(-31.28, 149.06).site.id).toBe('siding-spring')
  })

  it('converts degrees to kilometres consistently', () => {
    const hit = nearestSite(29.7542, -17.8851)
    expect(hit.site.id).toBe('roque')
    expect(hit.distanceDeg).toBeCloseTo(1, 6)
    expect(hit.distanceKm).toBeCloseTo(111.19, 1)
  })
})

describe('findSite', () => {
  it('finds by id, case-insensitively', () => {
    expect(findSite('roque')?.id).toBe('roque')
    expect(findSite('  ROQUE ')?.id).toBe('roque')
    expect(findSite('mauna-kea')?.id).toBe('mauna-kea')
  })

  it('finds by name, ignoring case and diacritics', () => {
    expect(findSite('Mauna Kea, Hawaii')?.id).toBe('mauna-kea')
    expect(findSite('mauna kea')?.id).toBe('mauna-kea')
    expect(findSite('haleakala')?.id).toBe('haleakala')
    expect(findSite('Cerro Pachon')?.id).toBe('cerro-pachon')
  })

  it('returns undefined for nonsense and for empty input', () => {
    expect(findSite('Death Star')).toBeUndefined()
    expect(findSite('')).toBeUndefined()
    expect(findSite('   ')).toBeUndefined()
  })
})
