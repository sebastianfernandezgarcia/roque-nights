import { beforeEach, describe, expect, it } from 'vitest'

import { resetStore, store } from '../state/store'
import type { PlanItem } from '../state/types'
import {
  BASE_TOOL_NAMES,
  PLAN_TOOL_NAMES,
  PROPOSAL_TOOL_NAMES,
  contextualToolNames,
  currentToolNames,
  hasPendingProposal,
  hasPlan,
  toolsDelta,
} from './contextualNames'
import type { ContextualState } from './contextualNames'

function planItem(targetId: string): PlanItem {
  return {
    id: `item-${targetId}`,
    targetId,
    targetName: targetId,
    startUtc: '2026-09-02T22:00:00Z',
    endUtc: '2026-09-02T22:45:00Z',
    source: 'agent',
  }
}

const EMPTY: ContextualState = { plan: [], proposals: [] }
const WITH_PLAN: ContextualState = { plan: [planItem('M31')], proposals: [] }
const WITH_PROPOSAL: ContextualState = {
  plan: [],
  proposals: [
    {
      id: 'p1',
      createdAt: '2026-09-02T20:00:00Z',
      items: [planItem('M31')],
      unscheduled: [],
      replaceExisting: false,
      status: 'pending',
      decisions: {},
      origin: 'agent',
    },
  ],
}
const WITH_BOTH: ContextualState = { plan: WITH_PLAN.plan, proposals: WITH_PROPOSAL.proposals }

beforeEach(() => {
  resetStore()
})

describe('tool name tables', () => {
  it('adds up to the fourteen tools of the spec, with no repeats', () => {
    const all = [...BASE_TOOL_NAMES, ...PLAN_TOOL_NAMES, ...PROPOSAL_TOOL_NAMES]
    expect(all).toHaveLength(14)
    expect(new Set(all).size).toBe(14)
    expect(BASE_TOOL_NAMES).toHaveLength(9)
    expect(PLAN_TOOL_NAMES).toEqual([
      'get_current_plan',
      'modify_plan',
      'clear_plan',
      'export_plan',
    ])
    expect(PROPOSAL_TOOL_NAMES).toEqual(['commit_proposal'])
  })
})

describe('contextualToolNames', () => {
  it('registers nothing extra for a fresh app', () => {
    expect(hasPlan(EMPTY)).toBe(false)
    expect(hasPendingProposal(EMPTY)).toBe(false)
    expect(contextualToolNames(EMPTY)).toEqual([])
    expect(currentToolNames(EMPTY)).toHaveLength(9)
  })

  it('adds the plan tools while a plan exists', () => {
    expect(contextualToolNames(WITH_PLAN)).toEqual([...PLAN_TOOL_NAMES])
    expect(currentToolNames(WITH_PLAN)).toHaveLength(13)
  })

  it('adds commit_proposal while a proposal is pending', () => {
    expect(contextualToolNames(WITH_PROPOSAL)).toEqual(['commit_proposal'])
    expect(currentToolNames(WITH_PROPOSAL)).toHaveLength(10)
  })

  it('adds both when the app has a plan and a pending proposal', () => {
    expect(currentToolNames(WITH_BOTH)).toHaveLength(14)
  })

  it('ignores proposals that are no longer pending', () => {
    const committed: ContextualState = {
      plan: [],
      proposals: WITH_PROPOSAL.proposals.map((p) => ({ ...p, status: 'committed' as const })),
    }
    expect(contextualToolNames(committed)).toEqual([])
  })
})

describe('toolsDelta', () => {
  it('reports what a mutation registered and unregistered', () => {
    expect(toolsDelta(EMPTY, WITH_PLAN)).toEqual({
      tools_added: [...PLAN_TOOL_NAMES],
      tools_removed: [],
    })
    expect(toolsDelta(WITH_PLAN, EMPTY)).toEqual({
      tools_added: [],
      tools_removed: [...PLAN_TOOL_NAMES],
    })
    expect(toolsDelta(WITH_PROPOSAL, WITH_PLAN)).toEqual({
      tools_added: [...PLAN_TOOL_NAMES],
      tools_removed: ['commit_proposal'],
    })
  })

  it('says nothing changed when nothing changed', () => {
    expect(toolsDelta(WITH_BOTH, WITH_BOTH)).toEqual({ tools_added: [], tools_removed: [] })
  })

  it('works straight off the live store', () => {
    const before = store.getState()
    expect(contextualToolNames(before)).toEqual([])
    store.getState().setPlan([planItem('M31')], 'agent', 'one item')
    const after = store.getState()
    expect(toolsDelta(before, after).tools_added).toEqual([...PLAN_TOOL_NAMES])
  })
})
