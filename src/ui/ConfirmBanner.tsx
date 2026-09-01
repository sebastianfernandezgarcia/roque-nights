/**
 * Non-blocking human-in-the-loop.
 *
 * A destructive tool never waits for a click inside its own turn: it returns
 * `confirmation_required` and leaves this banner behind for the human.
 */

import { useRoqueStore } from '../state/store'

export function ConfirmBanner() {
  const pending = useRoqueStore((s) => s.pendingConfirmation)
  const setPendingConfirmation = useRoqueStore((s) => s.setPendingConfirmation)
  const clearPlan = useRoqueStore((s) => s.clearPlan)
  if (!pending) return null

  const confirm = () => {
    if (pending.tool === 'clear_plan') clearPlan('human')
    setPendingConfirmation(null)
  }

  return (
    <section className="rounded-sm border border-signal/50 bg-signal/10 p-3 font-mono text-xs text-signal">
      <p className="text-[11px] uppercase tracking-[0.2em]">Confirmation requested</p>
      <p className="mt-1">{pending.message}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded-sm border border-signal/50 px-2 py-1 text-[11px] uppercase tracking-[0.2em] hover:bg-signal/20"
          onClick={confirm}
        >
          Confirm
        </button>
        <button
          type="button"
          className="rounded-sm border border-panel-edge px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-faint hover:text-ember"
          onClick={() => setPendingConfirmation(null)}
        >
          Dismiss
        </button>
      </div>
    </section>
  )
}
