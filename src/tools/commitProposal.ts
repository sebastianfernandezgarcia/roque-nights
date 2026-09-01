/**
 * Tool 8: commit_proposal.
 *
 * The other half of the ghost plan. The agent proposes, the person decides in
 * the Plan panel, and this applies what survived: accepted and undecided items
 * go into the plan, rejected ones come back with the person's own words so the
 * agent can renegotiate instead of guessing.
 *
 * Idempotent on purpose: an agent that retries after a dropped connection must
 * not duplicate a night.
 */

import { store } from '../state/store'
import type { PlanItem, Proposal, ProposalDecision } from '../state/types'
import { toolsDelta } from './contextualNames'
import type { ToolResult } from './envelope'
import { defineTool, fail, ok } from './envelope'
import { planItemView } from './getCurrentPlan'
import type { PlanItemView } from './getCurrentPlan'

export interface SkippedItem {
  item_id: string
  target_id: string
  name: string
  decision: ProposalDecision | null
  reason: string | null
}

export interface CommitProposalData {
  proposal_id: string
  applied: PlanItemView[]
  skipped: SkippedItem[]
  plan_size: number
  status: Proposal['status']
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    proposal_id: {
      type: 'string',
      minLength: 1,
      maxLength: 80,
      description: 'The proposal_id returned by propose_plan or import_plan.',
    },
    only_accepted: {
      type: 'boolean',
      default: false,
      description:
        'True to apply only the items the person explicitly accepted; undecided items are skipped too.',
    },
  },
  required: ['proposal_id'],
  additionalProperties: false,
} as const

function clock(item: PlanItemView): string {
  const start = item.start.local ? item.start.local.slice(11) : (item.start.utc ?? '').slice(11, 16)
  const end = item.end.local ? item.end.local.slice(11) : (item.end.utc ?? '').slice(11, 16)
  return `${item.target_id} ${start}-${end}`
}

function split(
  proposal: Proposal,
  onlyAccepted: boolean,
): { applied: PlanItem[]; skipped: PlanItem[] } {
  const applied: PlanItem[] = []
  const skipped: PlanItem[] = []
  for (const item of proposal.items) {
    const decision = proposal.decisions[item.id]?.decision
    const keep = onlyAccepted ? decision === 'accepted' : decision !== 'rejected'
    ;(keep ? applied : skipped).push(item)
  }
  return { applied, skipped }
}

function run(input: Record<string, unknown>): ToolResult<CommitProposalData> {
  const state = store.getState()
  const site = state.site

  const proposalId = input.proposal_id
  if (typeof proposalId !== 'string' || proposalId.trim() === '') {
    return fail(
      'invalid_input',
      'proposal_id is required: pass the id propose_plan or import_plan returned.',
    )
  }

  const proposal = state.proposals.find((candidate) => candidate.id === proposalId)
  if (!proposal) {
    const pending = state.proposals.filter((candidate) => candidate.status === 'pending')
    return fail(
      'unknown_proposal',
      `No proposal with id "${proposalId}" exists in this session.`,
      pending.length > 0
        ? `Pending proposals: ${pending.map((candidate) => candidate.id).join(', ')}.`
        : 'There is no pending proposal; create one with propose_plan or import_plan.',
    )
  }
  if (proposal.status === 'dismissed') {
    return fail(
      'invalid_input',
      `Proposal ${proposal.id} was dismissed by the person, so it will not be applied.`,
      'Call propose_plan again, ideally addressing why it was dismissed.',
    )
  }

  const onlyAccepted = input.only_accepted === true
  const alreadyCommitted = proposal.status === 'committed'

  const before = store.getState()
  let applied: PlanItem[]
  let skipped: PlanItem[]
  if (alreadyCommitted) {
    // Nothing to do: recompute the same answer instead of merging the items twice.
    ;({ applied, skipped } = split(proposal, onlyAccepted))
  } else {
    const result = before.commitProposal(proposal.id, { onlyAccepted }, 'agent')
    if (!result) {
      return fail('unknown_proposal', `Proposal ${proposal.id} disappeared before it was applied.`)
    }
    applied = result.applied
    skipped = result.skipped
  }
  const after = store.getState()

  const appliedViews = applied.map((item) => planItemView(item, site.timeZone))
  const skippedViews: SkippedItem[] = skipped.map((item) => {
    const decision = proposal.decisions[item.id]
    return {
      item_id: item.id,
      target_id: item.targetId,
      name: item.targetName,
      decision: decision?.decision ?? null,
      reason: decision?.reason ?? null,
    }
  })

  const caveats: string[] = []
  if (alreadyCommitted) {
    caveats.push(
      `Proposal ${proposal.id} was already committed; nothing changed. The plan currently has ${after.plan.length} item(s).`,
    )
  }
  if (skippedViews.length > 0) {
    caveats.push(
      'Skipped items are still in the proposal: propose new times for them if the person wants them back.',
    )
  }

  const rejectedClause = skippedViews
    .filter((item) => item.decision === 'rejected')
    .map((item) => `${item.target_id}${item.reason ? ` ("${item.reason}")` : ''}`)
  const undecidedCount = skippedViews.filter((item) => item.decision === null).length

  const head = alreadyCommitted
    ? `Proposal ${proposal.id} was already applied`
    : `Applied ${appliedViews.length} of ${proposal.items.length} proposed item${proposal.items.length === 1 ? '' : 's'} to the plan for the night of ${after.nightOf}`
  const list = appliedViews.length > 0 ? `: ${appliedViews.map(clock).join(', ')}` : ''
  const skippedClause =
    rejectedClause.length > 0
      ? ` Skipped ${rejectedClause.join(', ')} because the person rejected ${rejectedClause.length === 1 ? 'it' : 'them'}.`
      : ''
  const undecidedClause =
    onlyAccepted && undecidedCount > 0
      ? ` ${undecidedCount} undecided item${undecidedCount === 1 ? '' : 's'} were left out because only_accepted was set.`
      : ''

  const summary = `${head}${list}.${skippedClause}${undecidedClause} The plan now has ${after.plan.length} item${after.plan.length === 1 ? '' : 's'}.`

  return ok(
    summary,
    {
      proposal_id: proposal.id,
      applied: appliedViews,
      skipped: skippedViews,
      plan_size: after.plan.length,
      status: 'committed',
    },
    site,
    { caveats, ...toolsDelta(before, after) },
  )
}

export const commitProposalTool: ModelContextToolDefinition = defineTool<CommitProposalData>({
  name: 'commit_proposal',
  title: 'Apply a reviewed proposal',
  description: `Use this to apply a proposal created with propose_plan or import_plan, after the person has had a chance to review it in the Plan panel. Items the person rejected are skipped and returned with their reasons so you can renegotiate; accepted and undecided items are applied. Pass only_accepted:true to apply nothing the person did not explicitly accept. Idempotent: committing twice returns the same result.`,
  inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run,
})
