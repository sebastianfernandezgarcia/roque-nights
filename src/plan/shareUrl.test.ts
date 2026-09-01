import { describe, expect, it } from 'vitest'

import type { PlanItem, Site } from '../state/types'
import { toObservingPlanV1, type ObservingPlanV1 } from './serialize'
import {
  APP_ORIGIN,
  PLAN_HASH_PREFIX,
  buildShareUrl,
  decodePlanFromHash,
  encodePlanToHash,
} from './shareUrl'

const MADRID: Site = {
  id: null,
  name: 'Madrid, Retiro',
  latitude: 40.4168,
  longitude: -3.7038,
  elevationM: 650,
  timeZone: 'Europe/Madrid',
}

const PLAN: PlanItem[] = [
  {
    id: 'a',
    targetId: 'M31',
    targetName: 'Andromeda',
    startUtc: '2026-09-12T21:00:00.000Z',
    endUtc: '2026-09-12T21:45:00.000Z',
    source: 'human',
  },
]

function doc(overrides?: { site?: Site; author?: string; plan?: PlanItem[] }): ObservingPlanV1 {
  return toObservingPlanV1(
    { site: overrides?.site ?? MADRID, nightOf: '2026-09-12', plan: overrides?.plan ?? PLAN },
    { startUtc: '2026-09-12T20:01:53.796Z', endUtc: '2026-09-13T04:20:27.973Z' },
    overrides?.author,
  )
}

describe('encodePlanToHash', () => {
  it('produces a URL safe hash fragment', () => {
    const hash = encodePlanToHash(doc())
    expect(hash.startsWith(PLAN_HASH_PREFIX)).toBe(true)
    const payload = hash.slice(PLAN_HASH_PREFIX.length)
    expect(payload.length).toBeGreaterThan(0)
    // base64url only: no +, / or = to be mangled by a chat client or a shell.
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is stable for the same document', () => {
    const plan = doc()
    expect(encodePlanToHash(plan)).toBe(encodePlanToHash(plan))
  })
})

describe('decodePlanFromHash', () => {
  it('round trips a plan', () => {
    const plan = doc({ author: 'Sebastian' })
    expect(decodePlanFromHash(encodePlanToHash(plan))).toEqual(plan)
  })

  it('round trips names outside ASCII', () => {
    const plan = doc({
      site: { ...MADRID, name: 'Observatorio del Teide, Cañadas 28°' },
      plan: [{ ...PLAN[0], note: 'seeing ≈ 0.8″, muy buena' }],
    })
    const back = decodePlanFromHash(encodePlanToHash(plan))
    expect(back?.site.name).toBe('Observatorio del Teide, Cañadas 28°')
    expect(back?.items[0].note).toBe('seeing ≈ 0.8″, muy buena')
  })

  it('accepts a whole share URL, a bare fragment or the raw payload', () => {
    const plan = doc()
    const hash = encodePlanToHash(plan)
    const payload = hash.slice(PLAN_HASH_PREFIX.length)
    expect(decodePlanFromHash(`https://roque-nights.netlify.app/${hash}`)?.night_of).toBe('2026-09-12')
    expect(decodePlanFromHash(`https://example.test/some/path/${hash}&utm=x`)?.night_of).toBe(
      '2026-09-12',
    )
    expect(decodePlanFromHash(hash)?.night_of).toBe('2026-09-12')
    expect(decodePlanFromHash(payload)?.night_of).toBe('2026-09-12')
  })

  it('survives a percent encoded fragment', () => {
    const hash = encodePlanToHash(doc())
    const payload = hash.slice(PLAN_HASH_PREFIX.length)
    expect(decodePlanFromHash(`${PLAN_HASH_PREFIX}${encodeURIComponent(payload)}`)).not.toBeNull()
  })

  it('returns null for garbage instead of throwing', () => {
    const garbage = [
      '',
      '   ',
      '#',
      '#plan=',
      '#plan=!!!!',
      '#plan=%%%%',
      '#other=abc',
      'https://roque-nights.netlify.app/',
      'M31, M13, M42',
      '{"version":1}',
      `${PLAN_HASH_PREFIX}${btoa('not json at all')}`,
      `${PLAN_HASH_PREFIX}${btoa('{"version":2,"items":[]}')}`,
      `${PLAN_HASH_PREFIX}${btoa('[]')}`,
    ]
    for (const value of garbage) {
      expect(() => decodePlanFromHash(value), value).not.toThrow()
      expect(decodePlanFromHash(value), value).toBeNull()
    }
  })

  it('returns null for anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(decodePlanFromHash(value as unknown as string)).toBeNull()
    }
  })
})

describe('buildShareUrl', () => {
  it('hangs the plan off the given origin', () => {
    const url = buildShareUrl(doc(), 'https://example.test')
    expect(url.startsWith('https://example.test/#plan=')).toBe(true)
    expect(decodePlanFromHash(url)?.site.name).toBe('Madrid, Retiro')
  })

  it('does not double the slash when the origin has one', () => {
    expect(buildShareUrl(doc(), 'https://example.test/')).not.toContain('test//')
  })

  it('falls back to the published origin outside a browser', () => {
    expect(buildShareUrl(doc()).startsWith(`${APP_ORIGIN}/#plan=`)).toBe(true)
  })
})
