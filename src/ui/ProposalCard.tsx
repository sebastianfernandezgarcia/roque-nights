/**
 * A ghost plan waiting for a human.
 *
 * The agent proposes; the human accepts or rejects item by item, and the reason
 * for a rejection goes back into the store where the agent can read it and
 * renegotiate.
 */

import { useState } from 'react'

import { useRoqueStore } from '../state/store'
import type { Proposal } from '../state/types'
import { fmtLocal, fmtTimeRange, plural, zoneLabel } from './format'

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'
const BUTTON =
  'rounded-sm border border-panel-edge px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-faint hover:border-ember/50 hover:text-ember'

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const site = useRoqueStore((s) => s.site)
  const decideProposalItem = useRoqueStore((s) => s.decideProposalItem)
  const commitProposal = useRoqueStore((s) => s.commitProposal)
  const dismissProposal = useRoqueStore((s) => s.dismissProposal)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const tz = site.timeZone
  const accepted = proposal.items.filter(
    (item) => proposal.decisions[item.id]?.decision === 'accepted',
  ).length
  const rejected = proposal.items.filter(
    (item) => proposal.decisions[item.id]?.decision === 'rejected',
  ).length

  const reject = (itemId: string) => {
    decideProposalItem(proposal.id, itemId, 'rejected', reason.trim() || undefined, 'human')
    setRejectingId(null)
    setReason('')
  }

  return (
    <section className="rounded-sm border border-ember/40 bg-abyss/60 p-2 font-mono">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={LABEL}>
          {proposal.origin === 'import' ? 'Imported plan' : 'Proposed by agent'} ·{' '}
          {proposal.items.length} {plural(proposal.items.length, 'item')}
        </h3>
        <span className="text-[11px] text-faint tabular-nums">
          {fmtLocal(proposal.createdAt, tz)} {zoneLabel(tz)}
        </span>
      </div>

      {proposal.rationale && <p className="mt-1 text-xs text-[#e6e9f0]">{proposal.rationale}</p>}
      {proposal.replaceExisting && (
        <p className="mt-1 text-[11px] text-signal">
          Committing this proposal replaces the current plan.
        </p>
      )}

      <ul className="mt-2 space-y-1 text-xs">
        {proposal.items.map((item) => {
          const decision = proposal.decisions[item.id]
          return (
            <li key={item.id} className="rounded-sm border border-panel-edge px-2 py-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ember">{item.targetName}</span>
                <span className="text-faint tabular-nums">
                  {fmtTimeRange(item.startUtc, item.endUtc, tz)}
                </span>
              </div>
              {item.note && <p className="text-[11px] text-faint">{item.note}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className={`${BUTTON} ${
                    decision?.decision === 'accepted' ? 'border-ember/60 text-ember' : ''
                  }`}
                  onClick={() =>
                    decideProposalItem(proposal.id, item.id, 'accepted', undefined, 'human')
                  }
                >
                  ✓ Accept
                </button>
                <button
                  type="button"
                  className={`${BUTTON} ${
                    decision?.decision === 'rejected' ? 'border-signal/60 text-signal' : ''
                  }`}
                  onClick={() => {
                    setReason('')
                    setRejectingId(item.id)
                  }}
                >
                  ✗ Reject
                </button>
                {decision?.decision === 'rejected' && decision.reason && (
                  <span className="text-[11px] text-signal">Reason: {decision.reason}</span>
                )}
              </div>
              {rejectingId === item.id && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <input
                    autoFocus
                    type="text"
                    value={reason}
                    placeholder="Why? The agent reads this."
                    className="min-w-40 flex-1 rounded-sm border border-panel-edge bg-abyss px-2 py-1 text-xs text-[#e6e9f0] outline-none focus:border-signal/60"
                    onChange={(event) => setReason(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRejectingId(null)
                      if (event.key === 'Enter') reject(item.id)
                    }}
                  />
                  <button type="button" className={BUTTON} onClick={() => reject(item.id)}>
                    Save
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {proposal.unscheduled.length > 0 && (
        <div className="mt-2">
          <p className={LABEL}>Not scheduled</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-faint">
            {proposal.unscheduled.map((entry) => (
              <li key={entry.targetId}>
                {entry.name}: {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            for (const item of proposal.items) {
              if (proposal.decisions[item.id]) continue
              decideProposalItem(proposal.id, item.id, 'accepted', undefined, 'human')
            }
          }}
        >
          Accept all
        </button>
        <button
          type="button"
          className={`${BUTTON} border-ember/50 text-ember`}
          onClick={() => commitProposal(proposal.id, { onlyAccepted: true }, 'human')}
        >
          Commit accepted
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => dismissProposal(proposal.id, 'human')}
        >
          Dismiss
        </button>
        <span className="text-[11px] text-faint">
          {accepted} accepted · {rejected} rejected
        </span>
      </div>
    </section>
  )
}
