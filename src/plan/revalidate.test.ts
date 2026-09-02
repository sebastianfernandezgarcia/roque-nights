import { beforeEach, describe, expect, it } from 'vitest'

import { getNight } from '../astro/cache'
import { getTarget } from '../astro/catalog'
import { scheduleTargets } from '../astro/schedule'
import { DARK_SKY_SITES } from '../data/sites'
import { ROQUE_DE_LOS_MUCHACHOS, planStaleness, resetStore, store } from '../state/store'
import type { PlanItem, Site } from '../state/types'
import { MOVED_TOLERANCE_MS, UNKNOWN_TARGET_REASON, revalidatePlan } from './revalidate'

const NIGHT = '2026-09-13'
const s = () => store.getState()

function site(id: string): Site {
  const found = DARK_SKY_SITES.find((entry) => entry.id === id)
  if (!found) throw new Error(`no dark sky site with id ${id}`)
  return found
}

const MAUNA_KEA = site('mauna-kea')
const PARANAL = site('paranal')

/** The real thing: three targets scheduled by the scheduler for the Roque. */
function seedRoquePlan(): PlanItem[] {
  s().setNightOf(NIGHT, 'human')
  const night = getNight(NIGHT, ROQUE_DE_LOS_MUCHACHOS)
  const requests = ['M31', 'M45', 'saturn'].map((ref) => ({
    target: getTarget(ref)!,
    durationMinutes: 45,
  }))
  const { blocks } = scheduleTargets(requests, night, ROQUE_DE_LOS_MUCHACHOS, {
    minAltDeg: s().filters.minAltDeg,
    occupied: [],
    interval: null,
  })
  const items: PlanItem[] = blocks.map((block, index) => ({
    id: `seed-${index}`,
    targetId: block.target.id,
    targetName: block.target.name,
    startUtc: block.startUtc,
    endUtc: block.endUtc,
    note: `note for ${block.target.id}`,
    source: 'agent' as const,
  }))
  s().setPlan(items, 'agent', 'seeded for the Roque')
  return items
}

function item(targetId: string, targetName: string, startUtc: string, endUtc: string): PlanItem {
  return { id: `hand-${targetId}`, targetId, targetName, startUtc, endUtc, source: 'human' }
}

beforeEach(() => {
  resetStore()
})

describe('revalidatePlan', () => {
  it('reschedules a Roque plan for Mauna Kea and clears the staleness', () => {
    const seeded = seedRoquePlan()
    expect(seeded).toHaveLength(3)

    s().setSite(MAUNA_KEA, 'human')
    expect(planStaleness(s())).toMatchObject({ stale: true, reason: 'site' })

    const result = revalidatePlan('human')

    const keptIds = result.kept.map((entry) => entry.targetId)
    expect(keptIds).toContain('M31')
    expect(keptIds).toContain('M45')
    expect(result.kept).toHaveLength(s().plan.length)
    expect(s().plan.map((entry) => entry.targetId)).toEqual(keptIds)

    // Every kept block sits inside the darkness of the NEW site.
    const night = getNight(NIGHT, MAUNA_KEA)
    const darkStart = Date.parse(night.darkness.startUtc!)
    const darkEnd = Date.parse(night.darkness.endUtc!)
    expect(darkEnd).toBeGreaterThan(darkStart)
    for (const entry of result.kept) {
      expect(Date.parse(entry.startUtc)).toBeGreaterThanOrEqual(darkStart)
      expect(Date.parse(entry.endUtc)).toBeLessThanOrEqual(darkEnd)
      expect(Date.parse(entry.endUtc)).toBeGreaterThan(Date.parse(entry.startUtc))
    }

    // Hawaii is nine time zones west of La Palma: nothing can stay where it was.
    expect(result.moved.length).toBeGreaterThan(0)
    for (const move of result.moved) {
      expect(Math.abs(Date.parse(move.to) - Date.parse(move.from))).toBeGreaterThan(
        MOVED_TOLERANCE_MS,
      )
    }

    expect(planStaleness(s()).stale).toBe(false)
    expect(s().planContext).toMatchObject({ siteName: MAUNA_KEA.name, nightOf: NIGHT })
  })

  it('keeps the id, the note and the source of every item it rescheduled', () => {
    const seeded = seedRoquePlan()
    s().setSite(MAUNA_KEA, 'human')
    const result = revalidatePlan('agent')

    for (const entry of result.kept) {
      const original = seeded.find((seed) => seed.targetId === entry.targetId)!
      expect(entry.id).toBe(original.id)
      expect(entry.note).toBe(original.note)
      expect(entry.source).toBe(original.source)
      expect(entry.targetName).toBe(original.targetName)
      // The duration the person asked for survives when the window allows it.
      expect(Date.parse(entry.endUtc) - Date.parse(entry.startUtc)).toBe(
        Date.parse(original.endUtc) - Date.parse(original.startUtc),
      )
    }
  })

  it('logs one edit_plan entry that names the site, the night and the counts', () => {
    seedRoquePlan()
    s().setSite(MAUNA_KEA, 'human')
    const result = revalidatePlan('human')

    const entry = s().activity[0]
    expect(entry).toMatchObject({ source: 'human', action: 'edit_plan' })
    expect(entry.detail).toContain(`revalidated for ${MAUNA_KEA.name}`)
    expect(entry.detail).toContain(`night of ${NIGHT}`)
    expect(entry.detail).toContain(`${result.kept.length} kept`)
    expect(entry.detail).toContain(`${result.dropped.length} dropped`)
  })

  it('drops a target that never rises at the new latitude, with the reason', () => {
    // Acrux, declination -63°: fine from the Atacama, never above the horizon
    // from 28.75°N. The plan is handed over as committed, then the site moves.
    const acrux = getTarget('Acrux')!
    expect(acrux.dec).toBeLessThan(-60)

    s().setNightOf(NIGHT, 'human')
    s().setSite(PARANAL, 'human')
    s().setPlan(
      [item(acrux.id, acrux.name, '2026-09-14T02:00:00.000Z', '2026-09-14T02:45:00.000Z')],
      'human',
      'seeded for Paranal',
    )

    s().setSite(ROQUE_DE_LOS_MUCHACHOS, 'human')
    expect(planStaleness(s()).stale).toBe(true)

    const result = revalidatePlan('human')

    expect(result.kept).toEqual([])
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]).toMatchObject({ targetId: acrux.id, name: acrux.name })
    expect(result.dropped[0].reason).toMatch(/never rises/i)
    expect(s().plan).toEqual([])
    expect(planStaleness(s()).stale).toBe(false)
  })

  it('drops an item whose target the catalog does not know', () => {
    seedRoquePlan()
    s().setPlan(
      [
        ...s().plan,
        item('NGC-does-not-exist', 'Something a friend invented', '2026-09-13T22:00:00.000Z', '2026-09-13T22:45:00.000Z'),
      ],
      'human',
      'a plan with a stranger in it',
    )

    const result = revalidatePlan('human')

    expect(result.dropped).toContainEqual({
      targetId: 'NGC-does-not-exist',
      name: 'Something a friend invented',
      reason: UNKNOWN_TARGET_REASON,
    })
    expect(result.kept.some((entry) => entry.targetId === 'NGC-does-not-exist')).toBe(false)
  })

  it('reschedules for a new night as well as for a new site', () => {
    seedRoquePlan()
    s().setNightOf('2026-10-13', 'human')
    expect(planStaleness(s())).toMatchObject({ stale: true, reason: 'night' })

    const result = revalidatePlan('agent')

    expect(result.kept.length).toBeGreaterThan(0)
    const night = getNight('2026-10-13', ROQUE_DE_LOS_MUCHACHOS)
    for (const entry of result.kept) {
      expect(Date.parse(entry.startUtc)).toBeGreaterThanOrEqual(Date.parse(night.darkness.startUtc!))
      expect(Date.parse(entry.endUtc)).toBeLessThanOrEqual(Date.parse(night.darkness.endUtc!))
    }
    expect(planStaleness(s()).stale).toBe(false)
  })

  it('leaves an empty plan alone: nothing written, nothing logged', () => {
    s().setNightOf(NIGHT, 'human')
    const before = s().activity.length

    expect(revalidatePlan('human')).toEqual({ kept: [], moved: [], dropped: [] })
    expect(s().activity).toHaveLength(before)
    expect(s().plan).toEqual([])
  })

  it('gives blocks that did not move no entry in moved', () => {
    seedRoquePlan()
    // Same site, same night: the scheduler must land on the same times.
    const result = revalidatePlan('human')
    expect(result.kept).toHaveLength(3)
    expect(result.moved).toEqual([])
    expect(result.dropped).toEqual([])
  })
})
