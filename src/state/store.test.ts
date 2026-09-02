import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_LIMIT,
  DEFAULT_FILTERS,
  HUMAN_ACTIONS_LIMIT,
  INITIAL_VIEW,
  ROQUE_DE_LOS_MUCHACHOS,
  UNDO_TTL_MS,
  createInitialState,
  observingNightIn,
  planIntervals,
  resetStore,
  store,
} from './store'
import type { PlanItem, Proposal } from './types'

const s = () => store.getState()

function planItem(id: string, startUtc: string, endUtc: string, extra: Partial<PlanItem> = {}): PlanItem {
  return { id, targetId: id, targetName: id, startUtc, endUtc, source: 'agent', ...extra }
}

/** Adds a three item agent proposal to the store and returns it. */
function addThreeItemProposal(replaceExisting = false): Proposal {
  return s().addProposal({
    items: [
      planItem('a', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z'),
      planItem('b', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z'),
      planItem('c', '2026-09-03T00:00:00Z', '2026-09-03T00:45:00Z'),
    ],
    unscheduled: [{ targetId: 'M7', name: 'Ptolemy Cluster', reason: 'below minimum altitude' }],
    replaceExisting,
    origin: 'agent',
    rationale: 'darkest hours first',
  })
}

beforeEach(() => {
  resetStore()
})

describe('initial state', () => {
  it('starts at Roque de los Muchachos with the whole sky dome and night mode on', () => {
    expect(s().site).toEqual(ROQUE_DE_LOS_MUCHACHOS)
    expect(ROQUE_DE_LOS_MUCHACHOS.id).toBe('roque')
    expect(ROQUE_DE_LOS_MUCHACHOS.timeZone).toBe('Atlantic/Canary')
    expect(s().view).toEqual({ centerAltDeg: 90, centerAzDeg: 0, fovDeg: 186, animate: false })
    expect(s().view).toEqual(INITIAL_VIEW)
    expect(s().nightMode).toBe(true)
    expect(s().filters).toEqual(DEFAULT_FILTERS)
    expect(s().plan).toEqual([])
    expect(s().proposals).toEqual([])
    expect(s().activity).toEqual([])
    expect(s().humanActions).toEqual([])
    expect(s().undo).toBeNull()
    expect(s().pendingConfirmation).toBeNull()
    expect(s().importBanner).toBeNull()
    expect(s().selectedId).toBeNull()
    expect(s().webmcp).toEqual({ status: 'pending', toolCount: 0, toolNames: [] })
  })

  it('opens on the observing night in the site time zone with a valid UTC instant', () => {
    const night = observingNightIn('Atlantic/Canary')
    expect(s().nightOf).toBe(night)
    expect(s().nightOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isFinite(Date.parse(s().timeUtc))).toBe(true)
    expect(s().timeUtc.endsWith('Z')).toBe(true)
  })

  it('at 01:00 local the night in progress is still the previous date', () => {
    // 2026-09-13T00:00Z is 01:00 Canary: the middle of the night that started on
    // the 12th, so opening on the 13th would answer about the wrong night.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
      expect(observingNightIn('Atlantic/Canary')).toBe('2026-09-12')
      expect(createInitialState().nightOf).toBe('2026-09-12')

      // 22:00 Canary on the 12th is the same night, before midnight this time.
      vi.setSystemTime(new Date('2026-09-12T21:00:00Z'))
      expect(observingNightIn('Atlantic/Canary')).toBe('2026-09-12')
      expect(createInitialState().nightOf).toBe('2026-09-12')

      // Noon is the boundary: from 12:00 local the night ahead is the new date.
      vi.setSystemTime(new Date('2026-09-13T11:30:00Z'))
      expect(observingNightIn('Atlantic/Canary')).toBe('2026-09-13')
      // A site without a zone reads the boundary in UTC.
      expect(observingNightIn(null, new Date('2026-09-13T01:00:00Z'))).toBe('2026-09-12')
    } finally {
      vi.useRealTimers()
    }
  })

  it('createInitialState returns a fresh, unshared snapshot', () => {
    const a = createInitialState()
    const b = createInitialState()
    a.plan.push(planItem('x', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z'))
    expect(b.plan).toHaveLength(0)
  })
})

describe('site, night and time', () => {
  it('setSite keeps the selected night and logs with attribution', () => {
    const before = s().nightOf
    s().setSite(
      { id: null, name: 'Mauna Kea', latitude: 19.8207, longitude: -155.4681, elevationM: 4205, timeZone: 'Pacific/Honolulu' },
      'human',
    )
    expect(s().site.name).toBe('Mauna Kea')
    expect(s().nightOf).toBe(before)
    expect(s().activity[0]).toMatchObject({ source: 'human', action: 'set_site', detail: 'Mauna Kea', status: 'ok' })
    expect(s().humanActions[0]).toMatchObject({ kind: 'set_site', detail: 'Mauna Kea' })
  })

  it('agent actions never enter the human action ring buffer', () => {
    s().setNightOf('2026-09-12', 'agent')
    expect(s().nightOf).toBe('2026-09-12')
    expect(s().activity[0]).toMatchObject({ source: 'agent', action: 'set_night', detail: '2026-09-12' })
    expect(s().humanActions).toHaveLength(0)
  })

  it('setNightOf by a human records a set_night human action', () => {
    s().setNightOf('2026-09-12', 'human')
    expect(s().humanActions[0]).toMatchObject({ kind: 'set_night', detail: '2026-09-12' })
  })

  it('setTime silent (slider drag) changes the time without logging anything', () => {
    s().setTime('2026-09-02T23:30:00Z', 'human', { silent: true })
    expect(s().timeUtc).toBe('2026-09-02T23:30:00Z')
    expect(s().activity).toHaveLength(0)
    expect(s().humanActions).toHaveLength(0)

    s().setTime('2026-09-03T00:30:00Z', 'human')
    expect(s().activity[0]).toMatchObject({ action: 'set_time', detail: '2026-09-03T00:30:00Z' })
    expect(s().humanActions[0]).toMatchObject({ kind: 'set_time' })
  })
})

describe('sky view and selection', () => {
  it('setView with only a field of view is a zoom, anything else is a drag', () => {
    s().setView({ fovDeg: 60 }, 'human')
    expect(s().view.fovDeg).toBe(60)
    expect(s().humanActions[0].kind).toBe('zoom_map')

    s().setView({ centerAltDeg: 45, centerAzDeg: 180 }, 'human')
    expect(s().humanActions[0].kind).toBe('drag_map')

    s().setView({ centerAzDeg: 90, fovDeg: 30 }, 'human')
    expect(s().humanActions[0].kind).toBe('drag_map')
  })

  it('merges the patch and resets animate unless the caller asks for it', () => {
    s().setView({ centerAltDeg: 30, centerAzDeg: 180, fovDeg: 40, animate: true }, 'agent')
    expect(s().view).toEqual({ centerAltDeg: 30, centerAzDeg: 180, fovDeg: 40, animate: true })
    s().setView({ fovDeg: 20 }, 'agent')
    expect(s().view).toEqual({ centerAltDeg: 30, centerAzDeg: 180, fovDeg: 20, animate: false })
  })

  it('setView silent keeps the log clean during a drag', () => {
    s().setView({ centerAzDeg: 10 }, 'human', { silent: true })
    expect(s().view.centerAzDeg).toBe(10)
    expect(s().activity).toHaveLength(0)
    expect(s().humanActions).toHaveLength(0)
  })

  it('select, highlights and favorites', () => {
    s().select('M31', 'human')
    expect(s().selectedId).toBe('M31')
    expect(s().humanActions[0]).toMatchObject({ kind: 'tap_object', detail: 'M31' })

    s().setHighlights(['M13', 'M92'], 'agent')
    expect(s().highlightedIds).toEqual(['M13', 'M92'])
    expect(s().activity[0]).toMatchObject({ source: 'agent', action: 'set_highlights' })

    s().toggleFavorite('M13', 'human')
    expect(s().favoriteIds).toEqual(['M13'])
    s().toggleFavorite('M13', 'human')
    expect(s().favoriteIds).toEqual([])
    expect(s().humanActions.filter((a) => a.kind === 'toggle_favorite')).toHaveLength(2)
  })

  it('setFilters merges a patch onto the defaults', () => {
    s().setFilters({ minAltDeg: 20, maxMag: 9 }, 'agent')
    expect(s().filters).toEqual({ minAltDeg: 20, types: null, maxMag: 9, minMoonSepDeg: 30 })
    expect(s().activity[0].action).toBe('set_filters')
  })
})

describe('proposals', () => {
  it('addProposal stamps id, createdAt, pending status and empty decisions', () => {
    const p = addThreeItemProposal()
    expect(p.id).toMatch(/[0-9a-f-]{8,}/)
    expect(Number.isFinite(Date.parse(p.createdAt))).toBe(true)
    expect(p.status).toBe('pending')
    expect(p.decisions).toEqual({})
    expect(p.origin).toBe('agent')
    expect(p.unscheduled).toHaveLength(1)
    expect(s().proposals[0].id).toBe(p.id)
    expect(s().plan).toHaveLength(0)
  })

  it('rejecting an item stores the reason and commit skips it', () => {
    const p = addThreeItemProposal()
    s().decideProposalItem(p.id, 'b', 'rejected', 'too low over the caldera', 'human')
    s().decideProposalItem(p.id, 'a', 'accepted', undefined, 'human')

    const decisions = s().proposals[0].decisions
    expect(decisions['b']).toMatchObject({ decision: 'rejected', reason: 'too low over the caldera' })
    expect(Number.isFinite(Date.parse(decisions['b'].at))).toBe(true)
    expect(s().humanActions.map((a) => a.kind)).toEqual(['accept_item', 'reject_item'])

    const res = s().commitProposal(p.id, { onlyAccepted: false }, 'human')
    expect(res).not.toBeNull()
    expect(res!.applied.map((i) => i.id)).toEqual(['a', 'c'])
    expect(res!.skipped.map((i) => i.id)).toEqual(['b'])
    expect(s().plan.map((i) => i.id)).toEqual(['a', 'c'])
    expect(s().proposals[0].status).toBe('committed')
  })

  it('onlyAccepted applies nothing the human did not explicitly accept', () => {
    const p = addThreeItemProposal()
    s().decideProposalItem(p.id, 'c', 'accepted', undefined, 'human')
    const res = s().commitProposal(p.id, { onlyAccepted: true }, 'agent')
    expect(res!.applied.map((i) => i.id)).toEqual(['c'])
    expect(res!.skipped.map((i) => i.id)).toEqual(['a', 'b'])
    expect(s().plan.map((i) => i.id)).toEqual(['c'])
  })

  it('replaceExisting swaps the whole plan, otherwise items merge sorted by start', () => {
    s().setPlan([planItem('old', '2026-09-02T21:00:00Z', '2026-09-02T21:30:00Z')], 'human', 'manual')
    const merge = addThreeItemProposal(false)
    s().commitProposal(merge.id, { onlyAccepted: false }, 'agent')
    expect(s().plan.map((i) => i.id)).toEqual(['old', 'a', 'b', 'c'])

    const replace = addThreeItemProposal(true)
    s().commitProposal(replace.id, { onlyAccepted: false }, 'agent')
    expect(s().plan.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('logs the state change, not the tool name, so a tool call is not logged twice', () => {
    const p = addThreeItemProposal()
    s().commitProposal(p.id, { onlyAccepted: false }, 'agent')
    expect(s().activity[0]).toMatchObject({
      source: 'agent',
      action: 'plan_committed',
      detail: '3 applied, 0 skipped',
    })
    expect(s().activity.map((entry) => entry.action)).not.toContain('commit_proposal')

    s().clearPlan('agent')
    expect(s().activity[0].action).toBe('plan_cleared')
    expect(s().activity.map((entry) => entry.action)).not.toContain('clear_plan')
  })

  it('committing twice is idempotent and does not duplicate plan items', () => {
    const p = addThreeItemProposal()
    const first = s().commitProposal(p.id, { onlyAccepted: false }, 'agent')
    const second = s().commitProposal(p.id, { onlyAccepted: false }, 'agent')
    expect(second!.applied.map((i) => i.id)).toEqual(first!.applied.map((i) => i.id))
    expect(s().plan).toHaveLength(3)
  })

  it('decisions on a committed proposal are ignored', () => {
    const p = addThreeItemProposal()
    s().commitProposal(p.id, { onlyAccepted: false }, 'agent')
    const activityBefore = s().activity.length
    s().decideProposalItem(p.id, 'a', 'rejected', 'changed my mind', 'human')
    expect(s().proposals[0].decisions).toEqual({})
    expect(s().activity).toHaveLength(activityBefore)
    expect(s().plan).toHaveLength(3)
  })

  it('unknown proposal or item ids are no-ops', () => {
    const p = addThreeItemProposal()
    expect(s().commitProposal('nope', { onlyAccepted: false }, 'agent')).toBeNull()
    s().decideProposalItem('nope', 'a', 'accepted', undefined, 'human')
    s().decideProposalItem(p.id, 'zzz', 'accepted', undefined, 'human')
    expect(s().proposals[0].decisions).toEqual({})
  })

  it('dismissProposal marks it dismissed and leaves the plan alone', () => {
    const p = addThreeItemProposal()
    s().dismissProposal(p.id, 'human')
    expect(s().proposals[0].status).toBe('dismissed')
    expect(s().plan).toHaveLength(0)
    expect(s().activity[0].action).toBe('dismiss_proposal')
  })
})

describe('plan editing, clear and undo', () => {
  it('setPlan sorts by start time and logs the given detail', () => {
    s().setPlan(
      [
        planItem('late', '2026-09-03T01:00:00Z', '2026-09-03T01:45:00Z'),
        planItem('early', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z'),
        planItem('mid', '2026-09-02T23:30:00Z', '2026-09-03T00:15:00Z'),
      ],
      'human',
      'reordered 3 items',
    )
    expect(s().plan.map((i) => i.id)).toEqual(['early', 'mid', 'late'])
    expect(s().activity[0]).toMatchObject({ action: 'edit_plan', detail: 'reordered 3 items' })
    expect(s().humanActions[0].kind).toBe('edit_plan')
  })

  it('clearPlan returns a token that restores the plan within the TTL', () => {
    s().setPlan([planItem('a', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')], 'agent', 'seed')
    const token = s().clearPlan('human')
    expect(typeof token).toBe('string')
    expect(s().plan).toHaveLength(0)
    expect(s().undo).not.toBeNull()
    const ttl = Date.parse(s().undo!.expiresAt) - Date.now()
    expect(ttl).toBeGreaterThan(UNDO_TTL_MS - 5000)
    expect(ttl).toBeLessThanOrEqual(UNDO_TTL_MS)
    expect(s().activity[0].action).toBe('plan_cleared')
    expect(s().humanActions[0].kind).toBe('clear_plan')

    expect(s().undoClear(token)).toBe(true)
    expect(s().plan.map((i) => i.id)).toEqual(['a'])
    expect(s().undo).toBeNull()
  })

  it('undo refuses unknown, reused and expired tokens', () => {
    s().setPlan([planItem('a', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')], 'agent', 'seed')
    const token = s().clearPlan('agent')
    expect(s().undoClear('not-a-token')).toBe(false)
    expect(s().plan).toHaveLength(0)
    expect(s().undoClear(token)).toBe(true)
    expect(s().undoClear(token)).toBe(false)

    const second = s().clearPlan('agent')
    store.setState({ undo: { ...s().undo!, expiresAt: new Date(Date.now() - 1000).toISOString() } })
    expect(s().undoClear(second)).toBe(false)
    expect(s().plan).toHaveLength(0)
    expect(s().undo).toBeNull()
  })

  it('clearing an already empty plan keeps the live undo instead of destroying it', () => {
    s().setPlan([planItem('a', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')], 'agent', 'seed')
    const first = s().clearPlan('agent')
    const second = s().clearPlan('agent')

    expect(second).toBe(first)
    expect(s().undo!.plan.map((i) => i.id)).toEqual(['a'])
    expect(s().undoClear(first)).toBe(true)
    expect(s().plan.map((i) => i.id)).toEqual(['a'])
  })

  it('an expired undo is replaced by the empty clear that follows it', () => {
    s().setPlan([planItem('a', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')], 'agent', 'seed')
    const first = s().clearPlan('agent')
    store.setState({ undo: { ...s().undo!, expiresAt: new Date(Date.now() - 1000).toISOString() } })
    const second = s().clearPlan('agent')
    expect(second).not.toBe(first)
    expect(s().undo!.plan).toEqual([])
  })

  it('clearPlan dismisses a pending clear_plan confirmation', () => {
    s().setPendingConfirmation({ tool: 'clear_plan', message: 'Confirm in the Plan panel.', at: new Date().toISOString() })
    s().clearPlan('agent')
    expect(s().pendingConfirmation).toBeNull()
  })

  it('planIntervals maps the plan to sorted occupied intervals', () => {
    const intervals = planIntervals([
      planItem('b', '2026-09-03T00:00:00Z', '2026-09-03T00:45:00Z'),
      planItem('a', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z'),
    ])
    expect(intervals).toEqual([
      { startUtc: '2026-09-02T22:00:00Z', endUtc: '2026-09-02T22:45:00Z' },
      { startUtc: '2026-09-03T00:00:00Z', endUtc: '2026-09-03T00:45:00Z' },
    ])
  })
})

describe('activity log', () => {
  it('begin/end flips the status and stores duration and result', () => {
    const id = s().beginActivity('agent', 'get_night_ephemeris', '{"date":"2026-09-02"}')
    expect(s().activity[0]).toMatchObject({ id, status: 'running', source: 'agent' })
    expect(s().activity[0].durationMs).toBeUndefined()

    s().endActivity(id, 'ok', 'Astronomical darkness runs 21:39 to 06:35 local.', 42)
    expect(s().activity[0]).toMatchObject({ id, status: 'ok', durationMs: 42 })
    expect(s().activity[0].result).toContain('Astronomical darkness')
  })

  it('endActivity truncates long results and ignores unknown ids', () => {
    const id = s().beginActivity('agent', 'rank_nights', '{}')
    s().endActivity(id, 'error', 'x'.repeat(400), 7)
    expect(s().activity[0].result!.length).toBeLessThanOrEqual(160)
    expect(s().activity[0].status).toBe('error')
    expect(() => s().endActivity('missing-id', 'ok', 'nothing', 1)).not.toThrow()
  })

  it('is newest first and capped', () => {
    for (let i = 0; i < ACTIVITY_LIMIT + 5; i++) s().logActivity('agent', 'ping', `n${i}`)
    expect(s().activity).toHaveLength(ACTIVITY_LIMIT)
    expect(s().activity[0].detail).toBe(`n${ACTIVITY_LIMIT + 4}`)
    expect(s().activity[1].detail).toBe(`n${ACTIVITY_LIMIT + 3}`)
    expect(new Set(s().activity.map((e) => e.id)).size).toBe(ACTIVITY_LIMIT)
  })
})

describe('human action ring buffer', () => {
  it('keeps the newest 20 with their kinds', () => {
    for (let i = 0; i < HUMAN_ACTIONS_LIMIT + 5; i++) s().recordHumanAction('drag_map', `d${i}`)
    expect(s().humanActions).toHaveLength(HUMAN_ACTIONS_LIMIT)
    expect(s().humanActions[0].detail).toBe(`d${HUMAN_ACTIONS_LIMIT + 4}`)
    expect(s().humanActions.every((a) => a.kind === 'drag_map')).toBe(true)
    expect(Number.isFinite(Date.parse(s().humanActions[0].at))).toBe(true)
  })
})

describe('edge cases', () => {
  it('addProposal gives an id to any item that arrived without one', () => {
    const p = s().addProposal({
      items: [{ id: '', targetId: 'M31', targetName: 'Andromeda Galaxy', startUtc: '2026-09-02T22:00:00Z', endUtc: '2026-09-02T22:45:00Z', source: 'agent' }],
      unscheduled: [],
      replaceExisting: false,
      origin: 'import',
    })
    expect(p.items[0].id).not.toBe('')
    expect(p.items[0].id.length).toBeGreaterThan(8)
  })

  it('truncates very long details instead of flooding the log', () => {
    s().logActivity('agent', 'propose_plan', 'M31 '.repeat(200))
    expect(s().activity[0].detail.length).toBeLessThanOrEqual(160)
    expect(s().activity[0].detail.endsWith('...')).toBe(true)
  })

  it('deselecting logs a readable detail', () => {
    s().select(null, 'human')
    expect(s().selectedId).toBeNull()
    expect(s().activity[0]).toMatchObject({ action: 'select_object', detail: 'none' })
  })

  it('undoClear logs only when a source is given', () => {
    s().setPlan([planItem('a', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z')], 'agent', 'seed')
    const silent = s().clearPlan('agent')
    const before = s().activity.length
    expect(s().undoClear(silent)).toBe(true)
    expect(s().activity).toHaveLength(before)

    const loud = s().clearPlan('agent')
    expect(s().undoClear(loud, 'human')).toBe(true)
    expect(s().activity[0]).toMatchObject({ source: 'human', action: 'undo_clear' })
  })

  it('accepts a custom site with an unknown time zone', () => {
    s().setSite({ id: null, name: '0.000, 0.000', latitude: 0, longitude: 0, elevationM: 0, timeZone: null }, 'agent')
    expect(s().site.timeZone).toBeNull()
    expect(s().activity[0].action).toBe('set_site')
  })
})

describe('chrome: night mode, WebMCP status, banners', () => {
  it('toggleNightMode flips and logs', () => {
    s().toggleNightMode('human')
    expect(s().nightMode).toBe(false)
    expect(s().activity[0]).toMatchObject({ action: 'toggle_night_mode', detail: 'off' })
    expect(s().humanActions[0].kind).toBe('toggle_night_mode')
    s().toggleNightMode('agent')
    expect(s().nightMode).toBe(true)
  })

  it('setWebMCPStatus derives the count from the tool names', () => {
    s().setWebMCPStatus('registered', ['get_night_ephemeris', 'point_sky_map'])
    expect(s().webmcp).toEqual({
      status: 'registered',
      toolCount: 2,
      toolNames: ['get_night_ephemeris', 'point_sky_map'],
    })
    s().setWebMCPStatus('unsupported', [])
    expect(s().webmcp).toEqual({ status: 'unsupported', toolCount: 0, toolNames: [] })
  })

  it('holds the pending confirmation and the import banner', () => {
    s().setPendingConfirmation({ tool: 'clear_plan', message: 'Confirm to delete 3 items.', at: '2026-09-02T22:00:00Z' })
    expect(s().pendingConfirmation!.tool).toBe('clear_plan')
    s().setPendingConfirmation(null)
    expect(s().pendingConfirmation).toBeNull()

    s().setImportBanner({ proposalId: 'p1', observableCount: 3, totalCount: 5, from: 'a friend in Madrid' })
    expect(s().importBanner).toMatchObject({ observableCount: 3, totalCount: 5 })
    s().setImportBanner(null)
    expect(s().importBanner).toBeNull()
  })
})
