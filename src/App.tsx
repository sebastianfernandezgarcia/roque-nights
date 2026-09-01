/**
 * The control room.
 *
 * One screen, two columns: the dome on the left because it is the thing a human
 * actually looks at, and the instrument stack on the right. Everything below is
 * a view of `src/state/store.ts`, which is also what the WebMCP tools write to,
 * so an agent moving the sky and a human dragging it are the same event.
 *
 * Sized for the browser window inside ChatGPT desktop (~1100x750): two columns
 * from 960 px up, one column with a square dome below that.
 */

import { useEffect } from 'react'

import { SkyMap } from './sky/SkyMap'
import { store } from './state/store'
import { importPlanTool, type ImportPlanData } from './tools/importPlan'
import type { ToolResult } from './tools/envelope'
import { PLAN_HASH_PREFIX } from './plan/shareUrl'
import { ActivityLog } from './ui/ActivityLog'
import { AgentHarness } from './ui/AgentHarness'
import { ConfirmBanner } from './ui/ConfirmBanner'
import { Header } from './ui/Header'
import { ImportBanner } from './ui/ImportBanner'
import { Inspector } from './ui/Inspector'
import { NightStrip } from './ui/NightStrip'
import { PlanPanel } from './ui/PlanPanel'
import { TimeSlider } from './ui/TimeSlider'

/**
 * A share link is imported once per page load. StrictMode runs effects twice in
 * development and the hash is cleared before the first await, but a module flag
 * makes the guarantee independent of that ordering.
 */
let sharedPlanConsumed = false

/**
 * Open a `#plan=...` link the way the agent's tool does, then show the human
 * where the plan came from. Same code path, same revalidation, same ghost
 * proposal: a shared link is not a second import implementation.
 */
async function importSharedPlan(href: string): Promise<void> {
  const state = store.getState()
  const activityId = state.beginActivity('human', 'import_plan', 'shared link')
  const startedAt = performance.now()
  const result = (await importPlanTool.execute(
    { source: href },
    {},
  )) as ToolResult<ImportPlanData>
  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10

  if (!result.ok) {
    store.getState().endActivity(activityId, 'error', result.error.message, durationMs)
    return
  }

  const { kept, dropped } = result.data.summary_counts
  store.getState().endActivity(activityId, 'ok', result.summary, durationMs)
  store.getState().setImportBanner({
    proposalId: result.data.proposal_id,
    observableCount: kept,
    totalCount: kept + dropped,
    from: result.data.original?.site.name ?? 'a shared link',
  })
}

export default function App() {
  useEffect(() => {
    if (sharedPlanConsumed) return
    if (!window.location.hash.startsWith(PLAN_HASH_PREFIX)) return
    sharedPlanConsumed = true
    const href = window.location.href
    // Drop the hash first: a reload must not import the same plan again.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    void importSharedPlan(href)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col bg-abyss text-[#e6e9f0] lg:h-dvh lg:overflow-hidden">
      <Header />

      <main className="grid grid-cols-1 gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-3 lg:min-h-0">
          <div className="relative aspect-square min-h-0 overflow-hidden rounded-sm border border-panel-edge bg-abyss lg:aspect-auto lg:flex-1">
            <SkyMap />
          </div>
          <TimeSlider />
        </section>

        <aside className="roque-scroll space-y-3 overflow-x-hidden lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <ImportBanner />
          <ConfirmBanner />
          <NightStrip />
          <Inspector />
          <PlanPanel />
          <ActivityLog />
          <AgentHarness />
        </aside>
      </main>
    </div>
  )
}
