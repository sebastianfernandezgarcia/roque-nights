/**
 * A plan built for another sky.
 *
 * Times only mean something at one place on one night, so the moment the person
 * or the agent moves the app somewhere else the committed plan is quietly wrong:
 * 22:40 at the Roque is not 22:40 on Mauna Kea, and half the targets may never
 * rise there at all. The store notices (`planStaleness`); this banner says it in
 * words and offers the only two honest answers, rebuild it or keep it on purpose.
 *
 * Exports refuse to run while this is on screen (see ExportActions): a shared
 * plan that lies about its own times is worse than no plan.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { revalidatePlan, type RevalidationResult } from '../plan/revalidate'
import type { PlanContext } from '../state/store'
import { planStaleness, store, useRoqueStore } from '../state/store'

const BUTTON =
  'rounded-sm border border-panel-edge px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-faint hover:border-ember/50 hover:text-ember'
const PRIMARY =
  'rounded-sm border border-ember/60 bg-ember/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-ember hover:bg-ember/20'

/** How long the outcome of a revalidation stays on screen. */
export const RESULT_VISIBLE_MS = 8000

/** How many dropped targets are named before the line is cut short. */
export const NAMED_DROPS = 2

/** The sentence the person reads when the sky under the plan has changed. */
export function staleMessage(builtFor: PlanContext, siteName: string, nightOf: string): string {
  return (
    `This plan was built for a different sky: ${builtFor.siteName}, night of ${builtFor.nightOf}. ` +
    `Its times may be wrong for ${siteName}, night of ${nightOf}.`
  )
}

/** 'M7' for a catalog object, 'Saturn' for everything else. */
export function dropLabel(drop: { targetId: string; name: string }): string {
  if (/^(m|ngc|ic)\s?\d+$/i.test(drop.targetId)) return drop.targetId
  return drop.name || drop.targetId
}

/** '2 kept, 1 moved, 1 dropped: M7 never rises here'. Pure. */
export function summarizeRevalidation(result: RevalidationResult): string {
  const counts = `${result.kept.length} kept, ${result.moved.length} moved, ${result.dropped.length} dropped`
  if (result.dropped.length === 0) return counts
  const named = result.dropped
    .slice(0, NAMED_DROPS)
    .map((drop) => `${dropLabel(drop)} ${drop.reason}`)
    .join('; ')
  const rest = result.dropped.length - NAMED_DROPS
  return `${counts}: ${named}${rest > 0 ? `, and ${rest} more` : ''}`
}

export function StalePlanBanner() {
  const stale = useRoqueStore((s) => planStaleness(s).stale)
  const builtFor = useRoqueStore((s) => s.planContext)
  const site = useRoqueStore((s) => s.site)
  const nightOf = useRoqueStore((s) => s.nightOf)
  const logActivity = useRoqueStore((s) => s.logActivity)

  const [result, setResult] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const showFor = useCallback((text: string) => {
    setResult(text)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setResult(null), RESULT_VISIBLE_MS)
  }, [])

  const revalidate = useCallback(() => {
    showFor(summarizeRevalidation(revalidatePlan('human')))
  }, [showFor])

  const keepAnyway = useCallback(() => {
    store.getState().acknowledgePlanContext()
    logActivity('human', 'plan_kept', 'kept plan built for another sky')
  }, [logActivity])

  // Revalidating clears the staleness, and the banner would vanish with the very
  // answer the person asked for. It stays until the outcome has been read.
  if (!stale || !builtFor) {
    if (result === null) return null
    return (
      <section className="rounded-sm border border-ember/40 bg-ember/10 p-3 font-mono text-xs text-ember">
        <p className="text-[11px] tracking-[0.2em] uppercase">Plan revalidated</p>
        <p className="mt-1">{result}</p>
      </section>
    )
  }

  return (
    <section className="rounded-sm border border-signal/50 bg-signal/10 p-3 font-mono text-xs text-signal">
      <p className="text-[11px] tracking-[0.2em] uppercase">Plan out of date</p>
      <p className="mt-1 leading-relaxed">{staleMessage(builtFor, site.name, nightOf)}</p>

      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} onClick={revalidate}>
          Revalidate plan
        </button>
        <button type="button" className={BUTTON} onClick={keepAnyway}>
          Keep anyway
        </button>
      </div>

      {result !== null && <p className="mt-2 text-[11px] text-ember">{result}</p>}
    </section>
  )
}
