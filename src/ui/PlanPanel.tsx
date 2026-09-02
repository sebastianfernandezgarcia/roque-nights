/**
 * The plan: the timeline, the blocks, the agent's pending proposals and the
 * export paths out of the browser.
 */

import { useEffect, useState } from 'react'

import { store, useRoqueStore } from '../state/store'
import { ExportActions } from './ExportActions'
import { fmtHours, fmtTimeRange, plural, zoneLabel } from './format'
import { PlanTimeline } from './PlanTimeline'
import { ProposalCard } from './ProposalCard'

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'
const BUTTON =
  'rounded-sm border border-panel-edge px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-faint hover:border-ember/50 hover:text-ember'

export function PlanPanel() {
  const site = useRoqueStore((s) => s.site)
  const plan = useRoqueStore((s) => s.plan)
  const proposals = useRoqueStore((s) => s.proposals)
  const undo = useRoqueStore((s) => s.undo)
  const setPlan = useRoqueStore((s) => s.setPlan)
  const clearPlan = useRoqueStore((s) => s.clearPlan)
  const undoClear = useRoqueStore((s) => s.undoClear)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const tz = site.timeZone
  const totalHours = plan.reduce((sum, item) => {
    const ms = Date.parse(item.endUtc) - Date.parse(item.startUtc)
    return sum + (Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : 0)
  }, 0)
  const pending = proposals.filter((p) => p.status === 'pending')

  // The undo token expires. Reading the clock during render would leave a dead
  // button on screen until something else re-rendered the panel, so the record
  // is dropped when it actually runs out.
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(
      () => store.setState({ undo: null }),
      Math.max(0, Date.parse(undo.expiresAt) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [undo])
  const undoValid = undo !== null

  return (
    <section className="rounded-sm border border-panel-edge bg-panel p-3 font-mono">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={LABEL}>
          Plan · {plan.length} {plural(plan.length, 'item')} · {fmtHours(totalHours)}
        </h2>
        <div className="flex items-center gap-1">
          {undoValid && (
            <button
              type="button"
              className={`${BUTTON} border-ember/50 text-ember`}
              onClick={() => undoClear(undo.token, 'human')}
            >
              Undo clear ({undo.plan.length})
            </button>
          )}
          {confirmingClear ? (
            <>
              <button
                type="button"
                className={`${BUTTON} border-signal/60 text-signal`}
                onClick={() => {
                  clearPlan('human')
                  setConfirmingClear(false)
                }}
              >
                Confirm clear
              </button>
              <button type="button" className={BUTTON} onClick={() => setConfirmingClear(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className={BUTTON}
              disabled={plan.length === 0}
              onClick={() => setConfirmingClear(true)}
            >
              Clear plan
            </button>
          )}
        </div>
      </div>

      <PlanTimeline />

      {plan.length > 0 && (
        <ol className="mt-3 space-y-1 text-xs">
          {plan.map((item, index) => (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline gap-2 rounded-sm border border-panel-edge px-2 py-1"
            >
              <span className="w-4 text-faint tabular-nums">{index + 1}</span>
              <span className="text-faint tabular-nums">
                {fmtTimeRange(item.startUtc, item.endUtc, tz)}
              </span>
              {/* The id first, the way the dome and the Inspector label it:
                  "NGC 7092" in the plan and "M39" on the sky was the same
                  object under two names. */}
              <span className="flex-1 text-ember">
                {item.targetId} <span className="text-[#e6e9f0]">{item.targetName}</span>
              </span>
              <span
                className={`rounded-sm px-1 text-[10px] tracking-[0.2em] uppercase ${
                  item.source === 'agent' ? 'bg-signal/15 text-signal' : 'bg-ember/15 text-ember'
                }`}
              >
                {item.source}
              </span>
              <button
                type="button"
                className="text-faint hover:text-signal"
                aria-label={`Remove ${item.targetName}`}
                onClick={() =>
                  setPlan(
                    plan.filter((other) => other.id !== item.id),
                    'human',
                    `remove ${item.targetId}`,
                  )
                }
              >
                ×
              </button>
              {item.note && (
                <p className="w-full text-[11px] text-faint">{item.note}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {plan.length > 0 && (
        <p className="mt-1 text-[11px] text-faint">Times in {zoneLabel(tz)}.</p>
      )}

      {pending.length > 0 && (
        <div className="mt-3 space-y-2">
          {pending.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </div>
      )}

      <div className="mt-3 border-t border-panel-edge pt-2">
        <ExportActions />
      </div>
    </section>
  )
}
