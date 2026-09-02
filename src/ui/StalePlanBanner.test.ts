import { describe, expect, it } from 'vitest'

import type { RevalidationResult } from '../plan/revalidate'
import type { PlanItem } from '../state/types'
import { dropLabel, staleMessage, summarizeRevalidation } from './StalePlanBanner'

const KEPT: PlanItem = {
  id: 'a',
  targetId: 'M31',
  targetName: 'Andromeda Galaxy',
  startUtc: '2026-09-13T22:00:00Z',
  endUtc: '2026-09-13T22:45:00Z',
  note: undefined,
  source: 'agent',
}

function result(over: Partial<RevalidationResult> = {}): RevalidationResult {
  return { kept: [], moved: [], dropped: [], ...over }
}

describe('staleMessage', () => {
  it('names both skies: the one the plan was built for and the one on screen', () => {
    const message = staleMessage(
      { siteKey: '28.7542|-17.8851', siteName: 'Roque de los Muchachos, La Palma', nightOf: '2026-09-13' },
      'Mauna Kea, Hawaii',
      '2026-09-14',
    )
    expect(message).toBe(
      'This plan was built for a different sky: Roque de los Muchachos, La Palma, night of 2026-09-13. ' +
        'Its times may be wrong for Mauna Kea, Hawaii, night of 2026-09-14.',
    )
    expect(message).not.toMatch(/[—–]/)
  })
})

describe('dropLabel', () => {
  it('uses the catalog id for a catalog object', () => {
    expect(dropLabel({ targetId: 'M7', name: 'Ptolemy Cluster' })).toBe('M7')
    expect(dropLabel({ targetId: 'NGC 7092', name: 'M39' })).toBe('NGC 7092')
  })

  it('uses the common name for anything else', () => {
    expect(dropLabel({ targetId: 'saturn', name: 'Saturn' })).toBe('Saturn')
    expect(dropLabel({ targetId: 'star:vega', name: 'Vega' })).toBe('Vega')
  })

  it('falls back to the id when there is no name', () => {
    expect(dropLabel({ targetId: 'whatever', name: '' })).toBe('whatever')
  })
})

describe('summarizeRevalidation', () => {
  it('counts what happened and says why the dropped ones went', () => {
    expect(
      summarizeRevalidation(
        result({
          kept: [KEPT, { ...KEPT, id: 'b' }],
          moved: [{ targetId: 'M31', name: 'Andromeda Galaxy', from: 'x', to: 'y' }],
          dropped: [{ targetId: 'M7', name: 'Ptolemy Cluster', reason: 'never rises here' }],
        }),
      ),
    ).toBe('2 kept, 1 moved, 1 dropped: M7 never rises here')
  })

  it('says only the counts when nothing was dropped', () => {
    expect(summarizeRevalidation(result({ kept: [KEPT] }))).toBe('1 kept, 0 moved, 0 dropped')
  })

  it('names the first two casualties and counts the rest', () => {
    const dropped = ['M7', 'M8', 'M9', 'M10'].map((targetId) => ({
      targetId,
      name: targetId,
      reason: 'never rises here',
    }))
    expect(summarizeRevalidation(result({ dropped }))).toBe(
      '0 kept, 0 moved, 4 dropped: M7 never rises here; M8 never rises here, and 2 more',
    )
  })
})
