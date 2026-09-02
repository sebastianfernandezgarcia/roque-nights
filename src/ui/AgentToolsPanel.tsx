/**
 * What the agent can actually do here, in human words.
 *
 * The WebMCP badge in the header says "15 tools" and a judge has no way to know
 * what those are. This panel lists them in the order they are registered, one
 * plain phrase each, and lights the row up when the agent calls it: the tool
 * catalogue and the activity log are the same story told twice, once as a
 * capability and once as an event.
 *
 * The contextual tools (the plan tools, the commit tool) are listed dimmed while
 * they do not exist, with the condition that brings them to life. That is the
 * honest way to show `toolchange`: the list really is a function of the session.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { ActivityEntry } from '../state/store'
import { useRoqueStore } from '../state/store'
import { WEBMCP_ENABLE_HINT } from './onboardingState'

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'

/** How long a row stays lit after its tool was called. Matches .agent-flash-row. */
export const FLASH_MS = 1200

/**
 * One phrase per tool, written for someone who has never read the schema. The
 * order is the order of docs/PLAN.md, which is also the registration order.
 */
export const TOOL_PHRASES: Record<string, string> = {
  get_night_ephemeris: "Read tonight's darkness and Moon",
  find_observable_targets: 'Find what is worth observing',
  rank_nights: 'Rank the next nights',
  point_sky_map: 'Point the sky map',
  set_observing_time: 'Move the time slider',
  describe_current_view: 'See what you are looking at',
  propose_plan: 'Propose a plan for your review',
  commit_proposal: 'Apply the plan you accepted',
  modify_plan: 'Edit the plan',
  get_current_plan: 'Read the plan',
  clear_plan: 'Clear the plan (asks you first)',
  export_plan: 'Export or share the plan',
  import_plan: 'Import and revalidate a shared plan',
  compare_dark_sky_sites: 'Compare dark-sky sites and weather',
  set_observing_site: 'Move the app to another site',
}

/** Every tool this page can ever register, in the numbering of docs/PLAN.md. */
export const TOOL_ORDER: string[] = Object.keys(TOOL_PHRASES)

/** Why a tool is missing right now. Only the contextual ones have an answer. */
export const CONTEXTUAL_HINTS: Record<string, string> = {
  get_current_plan: 'appears when there is a plan',
  modify_plan: 'appears when there is a plan',
  export_plan: 'appears when there is a plan',
  commit_proposal: 'appears when a proposal is pending',
}

export interface ToolRow {
  name: string
  phrase: string
  registered: boolean
  /** The condition that would register it, for the dimmed rows. */
  hint: string | null
}

/**
 * The rows to draw: what is registered right now, in the order the engine has
 * it, then everything else dimmed. Pure, so the list can be tested without a
 * browser that has WebMCP at all.
 */
export function buildToolRows(toolNames: readonly string[]): ToolRow[] {
  const registered = new Set(toolNames)
  const rows: ToolRow[] = toolNames.map((name) => ({
    name,
    phrase: TOOL_PHRASES[name] ?? name.replace(/_/g, ' '),
    registered: true,
    hint: null,
  }))
  for (const name of TOOL_ORDER) {
    if (registered.has(name)) continue
    rows.push({
      name,
      phrase: TOOL_PHRASES[name],
      registered: false,
      hint: CONTEXTUAL_HINTS[name] ?? null,
    })
  }
  return rows
}

const STATUS_GLYPH: Record<string, string> = { running: '●', ok: '✓', error: '✗' }

/** The most recent agent call per tool, from the newest-first activity log. */
function latestAgentCalls(activity: readonly ActivityEntry[]): Map<string, ActivityEntry> {
  const latest = new Map<string, ActivityEntry>()
  for (const entry of activity) {
    if (entry.source !== 'agent') continue
    if (!latest.has(entry.action)) latest.set(entry.action, entry)
  }
  return latest
}

export function AgentToolsPanel() {
  const activity = useRoqueStore((s) => s.activity)
  const status = useRoqueStore((s) => s.webmcp.status)
  const toolNames = useRoqueStore((s) => s.webmcp.toolNames)

  const rows = useMemo(() => buildToolRows(toolNames), [toolNames])
  const calls = useMemo(() => latestAgentCalls(activity), [activity])

  // A row flashes when a NEW agent entry lands on it. The nonce is part of the
  // element key, so a second call to the same tool restarts the animation
  // instead of being swallowed by the still-running one.
  const [flashes, setFlashes] = useState<Record<string, number>>({})
  const seen = useRef(new Map<string, string>())
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  // Calls that were already in the log when this panel mounted are history, not
  // news: they set the glyph, they do not set off the animation.
  const mounted = useRef(false)

  useEffect(() => {
    const replaying = !mounted.current
    mounted.current = true
    for (const [name, entry] of calls) {
      if (seen.current.get(name) === entry.id) continue
      seen.current.set(name, entry.id)
      if (replaying) continue
      setFlashes((prev) => ({ ...prev, [name]: (prev[name] ?? 0) + 1 }))
      const timer = setTimeout(() => {
        setFlashes((prev) => {
          if (!(name in prev)) return prev
          const next = { ...prev }
          delete next[name]
          return next
        })
      }, FLASH_MS)
      timers.current.push(timer)
    }
  }, [calls])

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current = []
    },
    [],
  )

  const off = status === 'unsupported'

  return (
    <section className="rounded-sm border border-panel-edge bg-panel p-3 font-mono">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={LABEL}>Agent tools · WebMCP</h2>
        {off ? (
          <span className="text-[11px] tracking-[0.2em] text-signal uppercase">WebMCP off</span>
        ) : (
          <span className="text-[11px] text-faint tabular-nums">
            {toolNames.length} registered
          </span>
        )}
      </div>

      <p className="mb-2 text-[11px] leading-relaxed text-faint">
        Your AI agent can call these on this page. A row lights up when it does.
      </p>

      {off && <p className="mb-2 text-[11px] leading-relaxed text-signal">{WEBMCP_ENABLE_HINT}</p>}

      <ul className="space-y-0.5">
        {rows.map((row) => {
          const call = calls.get(row.name)
          const nonce = flashes[row.name] ?? 0
          return (
            <li
              key={`${row.name}#${nonce}`}
              className={`flex flex-wrap items-baseline gap-x-2 rounded-sm border border-panel-edge px-2 py-1 leading-tight ${
                nonce > 0 ? 'agent-flash-row' : ''
              } ${row.registered ? '' : 'opacity-45'}`}
            >
              <span className={`text-[11px] ${row.registered ? 'text-ember' : 'text-faint'}`}>
                {row.name}
              </span>
              {/* No truncation: the phrase is the whole point of the panel, so a
                  long one wraps under its own name instead of being cut. */}
              <span className="min-w-0 flex-1 text-[11px] text-faint">{row.phrase}</span>
              {call && (
                <span
                  title={`${call.status}${call.result ? `: ${call.result}` : ''}`}
                  className={
                    call.status === 'error'
                      ? 'text-signal'
                      : call.status === 'running'
                        ? 'animate-pulse text-ember'
                        : 'text-ember'
                  }
                >
                  {STATUS_GLYPH[call.status] ?? '?'}
                </span>
              )}
              {row.hint && !row.registered && (
                <span className="w-full text-[10px] text-faint/80">{row.hint}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
