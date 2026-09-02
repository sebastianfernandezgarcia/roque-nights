import { Ajv } from 'ajv'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetStore, store } from '../state/store'
import type { PlanItem, Proposal } from '../state/types'
import { commitProposalTool } from './commitProposal'
import type { CommitProposalData } from './commitProposal'
import type { ToolError, ToolOk } from './envelope'

const NIGHT_OF = '2026-09-02'
const AT = '2026-09-02T23:00:00Z'

const ajv = new Ajv({ allErrors: true, strict: false })

type Result = ToolOk<CommitProposalData> | ToolError

async function run(input: Record<string, unknown>): Promise<Result> {
  return (await commitProposalTool.execute(input)) as Result
}

function expectOk(result: Result): ToolOk<CommitProposalData> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result
}

function expectFail(result: Result): ToolError {
  if (result.ok) throw new Error(`expected a failure, got "${result.summary}"`)
  return result
}

function planItem(targetId: string, startUtc: string, endUtc: string): PlanItem {
  return {
    id: `item-${targetId}`,
    targetId,
    targetName: targetId,
    startUtc,
    endUtc,
    source: 'agent',
  }
}

function addProposal(replaceExisting = false): Proposal {
  return store.getState().addProposal({
    items: [
      planItem('M31', '2026-09-02T22:00:00Z', '2026-09-02T22:45:00Z'),
      planItem('M13', '2026-09-02T21:00:00Z', '2026-09-02T21:45:00Z'),
      planItem('M7', '2026-09-02T23:00:00Z', '2026-09-02T23:45:00Z'),
    ],
    unscheduled: [],
    replaceExisting,
    origin: 'agent',
    rationale: 'three classics',
  })
}

beforeEach(() => {
  resetStore()
  store.setState({ nightOf: NIGHT_OF, timeUtc: AT })
})

describe('commit_proposal declaration', () => {
  it('is idempotent and not destructive', () => {
    expect(commitProposalTool.name).toBe('commit_proposal')
    expect(commitProposalTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(commitProposalTool.description.startsWith('Use this to apply a proposal')).toBe(true)
  })

  it('has an input schema Ajv compiles that requires the proposal id', () => {
    const validate = ajv.compile(commitProposalTool.inputSchema as object)
    expect(validate({ proposal_id: 'abc' })).toBe(true)
    expect(validate({ proposal_id: 'abc', only_accepted: true })).toBe(true)
    expect(validate({})).toBe(false)
    expect(validate({ proposal_id: 'abc', force: true })).toBe(false)
  })
})

describe('commit_proposal', () => {
  it('applies every undecided item and announces the plan tools', async () => {
    const proposal = addProposal()
    const result = expectOk(await run({ proposal_id: proposal.id }))

    expect(store.getState().plan).toHaveLength(3)
    expect(store.getState().proposals[0].status).toBe('committed')
    expect(result.data.applied).toHaveLength(3)
    expect(result.data.skipped).toEqual([])
    expect(result.data.plan_size).toBe(3)
    // The plan tools appear and the commit tool goes away with the last pending proposal.
    expect(result.tools_added).toEqual([
      'get_current_plan',
      'modify_plan',
      'export_plan',
    ])
    expect(result.tools_removed).toEqual(['commit_proposal'])
    expect(result.summary).toContain('3')
    expect(result.summary).toContain('M31')
  })

  it('skips what the person rejected and hands back the reason', async () => {
    const proposal = addProposal()
    store.getState().decideProposalItem(proposal.id, 'item-M7', 'rejected', 'too low', 'human')

    const result = expectOk(await run({ proposal_id: proposal.id }))

    expect(store.getState().plan.map((item) => item.targetId).sort()).toEqual(['M13', 'M31'])
    expect(result.data.skipped).toEqual([
      {
        item_id: 'item-M7',
        target_id: 'M7',
        name: 'M7',
        decision: 'rejected',
        reason: 'too low',
      },
    ])
    expect(result.summary).toContain('too low')
  })

  it('applies only the accepted items when asked', async () => {
    const proposal = addProposal()
    store.getState().decideProposalItem(proposal.id, 'item-M31', 'accepted', undefined, 'human')

    const result = expectOk(await run({ proposal_id: proposal.id, only_accepted: true }))

    expect(store.getState().plan.map((item) => item.targetId)).toEqual(['M31'])
    expect(result.data.applied).toHaveLength(1)
    // Undecided items carry a null decision, never a missing key.
    expect(result.data.skipped.map((item) => item.decision)).toEqual([null, null])
    expect(result.data.skipped.map((item) => item.reason)).toEqual([null, null])
  })

  it('is idempotent: a second commit changes nothing and says so', async () => {
    const proposal = addProposal()
    const first = expectOk(await run({ proposal_id: proposal.id }))
    const planAfterFirst = JSON.stringify(store.getState().plan)

    const second = expectOk(await run({ proposal_id: proposal.id }))

    expect(JSON.stringify(store.getState().plan)).toBe(planAfterFirst)
    expect(second.data.applied.map((item) => item.item_id)).toEqual(
      first.data.applied.map((item) => item.item_id),
    )
    expect(second.caveats.join(' ')).toContain('already committed')
    expect(second.tools_added).toBeUndefined()
  })

  it('replaces the plan when the proposal was made that way', async () => {
    store
      .getState()
      .setPlan([planItem('M27', '2026-09-03T01:00:00Z', '2026-09-03T01:45:00Z')], 'human', 'old')
    const proposal = addProposal(true)

    expectOk(await run({ proposal_id: proposal.id }))

    expect(store.getState().plan.map((item) => item.targetId).sort()).toEqual([
      'M13',
      'M31',
      'M7',
    ])
  })

  it('refuses an unknown proposal id and lists the pending ones', async () => {
    const proposal = addProposal()
    const error = expectFail(await run({ proposal_id: 'nope' }))

    expect(error.error.code).toBe('unknown_proposal')
    expect(error.error.hint).toContain(proposal.id)
    expect(store.getState().plan).toEqual([])
  })

  it('refuses a proposal the person dismissed', async () => {
    const proposal = addProposal()
    store.getState().dismissProposal(proposal.id, 'human')

    const error = expectFail(await run({ proposal_id: proposal.id }))
    expect(error.error.code).toBe('invalid_input')
    expect(error.error.message).toContain('dismissed')
    expect(store.getState().plan).toEqual([])
  })

  it('refuses a missing proposal id', async () => {
    expect(expectFail(await run({})).error.code).toBe('invalid_input')
  })
})

describe('commitProposal robustness', () => {
  it('never throws and always answers with an ok flag, whatever the agent sends', async () => {
    const malformed: unknown[] = [null, 42, 'abc', [], { proposal_id: 42 }, { proposal_id: '' }, { proposal_id: 'ghost', only_accepted: 'yes' }]
    for (const bad of malformed) {
      const result = (await commitProposalTool.execute(bad as Record<string, unknown>)) as Result
      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) expect(typeof result.error.code).toBe('string')
    }
  })
})
