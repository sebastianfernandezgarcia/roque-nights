import { describe, expect, it } from 'vitest'

import type { PlanItem } from '../state/types'
import { blockLabel, blockLabelPlacement } from './PlanTimeline'

const WIDTH = 664
/** The column the accept/reject buttons own, mirrored from the component. */
const ACTIONS = 46

function item(over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'i1',
    targetId: 'M39',
    targetName: 'NGC 7092',
    startUtc: '2026-09-03T00:41:00Z',
    endUtc: '2026-09-03T01:11:00Z',
    note: undefined,
    source: 'agent',
    ...over,
  }
}

describe('blockLabel', () => {
  it('leads with the catalog id, the way the dome labels the same object', () => {
    expect(blockLabel(item(), 'Atlantic/Canary', false)).toContain('M39')
  })

  it('marks a ghost block with a question mark', () => {
    expect(blockLabel(item(), 'Atlantic/Canary', true).startsWith('? ')).toBe(true)
  })

  it('never grows past the column, however long the common name is', () => {
    const long = blockLabel(
      item({ targetId: 'M13', targetName: 'Great Hercules Cluster of Stars' }),
      'Atlantic/Canary',
      true,
    )
    expect(long.length).toBeLessThanOrEqual(22)
    expect(long).toContain('M13')
  })
})

describe('blockLabelPlacement', () => {
  const LABEL = 'M39 NGC 7092 00:41' // 18 characters, ~108 px

  it('writes inside a block that is wide enough to hold the text', () => {
    const placement = blockLabelPlacement(100, 300, WIDTH, LABEL.length, ACTIONS)
    expect(placement).toEqual({ x: 104, anchor: 'start' })
  })

  it('puts a narrow block label on the LEFT, where the buttons are not', () => {
    // A 30 minute block in this column is about 13 px wide.
    const placement = blockLabelPlacement(400, 413, WIDTH, LABEL.length, ACTIONS)
    expect(placement.anchor).toBe('end')
    expect(placement.x).toBe(396)
  })

  it('never overlaps the action column of a ghost row', () => {
    const buttonsLeft = WIDTH - ACTIONS
    for (let x0 = 0; x0 < WIDTH - 13; x0 += 7) {
      const placement = blockLabelPlacement(x0, x0 + 13, WIDTH, LABEL.length, ACTIONS)
      const textPx = LABEL.length * 6
      const right = placement.anchor === 'end' ? placement.x : placement.x + textPx
      expect(right, `label right edge at x0=${x0}`).toBeLessThanOrEqual(buttonsLeft)
    }
  })

  it('falls to the right of a block pinned against the left edge', () => {
    const placement = blockLabelPlacement(0, 13, WIDTH, LABEL.length, ACTIONS)
    expect(placement).toEqual({ x: 17, anchor: 'start' })
  })

  it('stays on the canvas when there is no room anywhere', () => {
    const placement = blockLabelPlacement(4, 17, 120, LABEL.length, ACTIONS)
    expect(placement.x).toBeGreaterThanOrEqual(2)
  })
})
