import { describe, expect, it } from 'vitest'

import { getTarget } from './catalog'
import { computeNightEphemeris } from './night'
import type { Interval, SiteCoords } from './night'
import { scheduleTargets } from './schedule'

const ROQUE: SiteCoords = {
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}

const night = computeNightEphemeris('2026-09-02', ROQUE)
const darkStart = Date.parse(night.darkness.startUtc!)
const darkEnd = Date.parse(night.darkness.endUtc!)

function minutesOf(block: { startUtc: string; endUtc: string }): number {
  return (Date.parse(block.endUtc) - Date.parse(block.startUtc)) / 60_000
}

function overlaps(a: Interval, b: Interval): boolean {
  return Date.parse(a.startUtc) < Date.parse(b.endUtc) && Date.parse(b.startUtc) < Date.parse(a.endUtc)
}

describe('scheduleTargets', () => {
  it('schedules non-overlapping blocks inside darkness', () => {
    const res = scheduleTargets(
      [
        { target: getTarget('M31')!, durationMinutes: 45 },
        { target: getTarget('M13')!, durationMinutes: 45 },
        { target: getTarget('M45')!, durationMinutes: 45 },
      ],
      night,
      ROQUE,
      { minAltDeg: 30, occupied: [] },
    )
    expect(res.blocks.length + res.unscheduled.length).toBe(3)
    const sorted = [...res.blocks].sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    for (let i = 1; i < sorted.length; i++) {
      expect(Date.parse(sorted[i].startUtc)).toBeGreaterThanOrEqual(Date.parse(sorted[i - 1].endUtc))
    }
    for (const b of res.blocks) {
      expect(Date.parse(b.startUtc)).toBeGreaterThanOrEqual(darkStart)
      expect(Date.parse(b.endUtc)).toBeLessThanOrEqual(darkEnd)
    }
  })

  it('places every block at its requested length when the night has room', () => {
    const res = scheduleTargets(
      [
        { target: getTarget('M31')!, durationMinutes: 40 },
        { target: getTarget('M13')!, durationMinutes: 40 },
      ],
      night,
      ROQUE,
      { minAltDeg: 30, occupied: [] },
    )
    expect(res.blocks).toHaveLength(2)
    for (const b of res.blocks) expect(minutesOf(b)).toBe(40)
  })

  it('returns blocks in chronological order with the target and its peak altitude', () => {
    const res = scheduleTargets(
      [
        { target: getTarget('M45')!, durationMinutes: 30 },
        { target: getTarget('M13')!, durationMinutes: 30 },
        { target: getTarget('M31')!, durationMinutes: 30 },
      ],
      night,
      ROQUE,
      { minAltDeg: 30, occupied: [] },
    )
    for (let i = 1; i < res.blocks.length; i++) {
      expect(res.blocks[i].startUtc >= res.blocks[i - 1].endUtc).toBe(true)
    }
    for (const b of res.blocks) {
      expect(b.target.id).toBeTruthy()
      expect(b.peakAltDeg).toBeGreaterThanOrEqual(30)
    }
  })

  it('never overlaps intervals that are already occupied', () => {
    const occupied: Interval[] = [
      {
        startUtc: new Date(darkStart).toISOString(),
        endUtc: new Date(darkStart + 3 * 3_600_000).toISOString(),
      },
    ]
    const res = scheduleTargets(
      [
        { target: getTarget('M13')!, durationMinutes: 45 },
        { target: getTarget('M31')!, durationMinutes: 45 },
      ],
      night,
      ROQUE,
      { minAltDeg: 30, occupied },
    )
    for (const b of res.blocks) {
      expect(overlaps(b, occupied[0])).toBe(false)
      expect(Date.parse(b.endUtc)).toBeLessThanOrEqual(darkEnd)
    }
  })

  it('shortens a block to the window and says so in the note', () => {
    const interval: Interval = {
      startUtc: new Date(darkStart).toISOString(),
      endUtc: new Date(darkStart + 25 * 60_000).toISOString(),
    }
    const res = scheduleTargets(
      [{ target: getTarget('M13')!, durationMinutes: 90 }],
      night,
      ROQUE,
      { minAltDeg: 25, occupied: [], interval },
    )
    expect(res.blocks).toHaveLength(1)
    expect(minutesOf(res.blocks[0])).toBeLessThanOrEqual(25)
    expect(minutesOf(res.blocks[0])).toBeGreaterThanOrEqual(10)
    expect(res.blocks[0].note).toContain('shortened to window')
  })

  it('keeps the caller note and appends its own', () => {
    const interval: Interval = {
      startUtc: new Date(darkStart).toISOString(),
      endUtc: new Date(darkStart + 25 * 60_000).toISOString(),
    }
    const res = scheduleTargets(
      [{ target: getTarget('M13')!, durationMinutes: 90, note: 'globular warm-up' }],
      night,
      ROQUE,
      { minAltDeg: 25, occupied: [], interval },
    )
    expect(res.blocks[0].note).toBe('globular warm-up; shortened to window')
  })

  it('never emits a block shorter than 10 minutes', () => {
    const interval: Interval = {
      startUtc: new Date(darkStart).toISOString(),
      endUtc: new Date(darkStart + 6 * 60_000).toISOString(),
    }
    const res = scheduleTargets(
      [{ target: getTarget('M13')!, durationMinutes: 45 }],
      night,
      ROQUE,
      { minAltDeg: 25, occupied: [], interval },
    )
    expect(res.blocks).toHaveLength(0)
    expect(res.unscheduled).toHaveLength(1)
    expect(res.unscheduled[0].targetId).toBe('M13')
    expect(res.unscheduled[0].reason.length).toBeGreaterThan(5)
  })

  it('reports the visibility reason for targets it cannot place', () => {
    const res = scheduleTargets(
      [
        { target: getTarget('star:acrux')!, durationMinutes: 45 },
        { target: getTarget('M31')!, durationMinutes: 45 },
      ],
      night,
      ROQUE,
      { minAltDeg: 30, occupied: [] },
    )
    expect(res.blocks.map((b) => b.target.id)).toEqual(['M31'])
    expect(res.unscheduled).toEqual([
      {
        targetId: 'star:acrux',
        name: 'Acrux',
        reason: 'never rises above the horizon at this latitude',
      },
    ])
  })

  it('reports a conflict when the night is already full', () => {
    const occupied: Interval[] = [
      {
        startUtc: new Date(darkStart).toISOString(),
        endUtc: new Date(darkEnd).toISOString(),
      },
    ]
    const res = scheduleTargets(
      [{ target: getTarget('M31')!, durationMinutes: 45 }],
      night,
      ROQUE,
      { minAltDeg: 30, occupied },
    )
    expect(res.blocks).toHaveLength(0)
    expect(res.unscheduled[0].reason).toMatch(/no free/i)
  })

  it('handles an empty request list', () => {
    const res = scheduleTargets([], night, ROQUE, { minAltDeg: 30, occupied: [] })
    expect(res).toEqual({ blocks: [], unscheduled: [] })
  })

  it('packs six targets without overlapping and stays inside darkness', () => {
    const ids = ['M31', 'M13', 'M45', 'M27', 'M57', 'M11']
    const res = scheduleTargets(
      ids.map((id) => ({ target: getTarget(id)!, durationMinutes: 40 })),
      night,
      ROQUE,
      { minAltDeg: 25, occupied: [] },
    )
    expect(res.blocks.length + res.unscheduled.length).toBe(6)
    const sorted = [...res.blocks].sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    for (let i = 1; i < sorted.length; i++) {
      expect(overlaps(sorted[i], sorted[i - 1])).toBe(false)
    }
    for (const b of res.blocks) {
      expect(Date.parse(b.startUtc)).toBeGreaterThanOrEqual(darkStart)
      expect(Date.parse(b.endUtc)).toBeLessThanOrEqual(darkEnd)
      expect(minutesOf(b)).toBeGreaterThanOrEqual(10)
    }
  })
})
