/**
 * The agent's console, for humans.
 *
 * Not every judge will have a WebMCP browser at hand, and not every demo goes
 * through ChatGPT. This panel calls the very same tool objects the agent calls:
 * through `document.modelContext.executeTool` when the browser has it (the real
 * path, activity log included), and through the tool's own `execute` when it
 * does not. Either way the result shown here is the result an agent would get.
 *
 * It also carries the five playbook prompts, because the fastest way to see
 * what this page is for is to paste one of them into an agent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { addDays } from '../astro/time'
import type { RoqueData } from '../state/store'
import { useRoqueStore } from '../state/store'
import { APP_TOOLS, currentToolNames, getModelContext } from '../webmcp/registerTools'
import { truncate } from './format'

// ---------------------------------------------------------------------------
// Samples and prompts
// ---------------------------------------------------------------------------

/**
 * One realistic call per tool, so the harness is never a blank textarea.
 * Every sample validates against its own inputSchema (see the test), and none
 * of them carries a destructive flag: `clear_plan` is offered without
 * `confirm`, which is exactly the confirmation handshake the tool documents.
 */
export const SAMPLE_INPUTS: Record<string, Record<string, unknown>> = {
  get_night_ephemeris: { date: '2026-09-12' },
  find_observable_targets: { limit: 5, min_altitude_deg: 30 },
  rank_nights: { from_date: '2026-09-05', to_date: '2026-09-20', limit: 3 },
  point_sky_map: { target: 'M31', fov_deg: 40 },
  set_observing_time: { time: 'midnight' },
  describe_current_view: { max_visible_objects: 8 },
  propose_plan: {
    targets: [{ target: 'M31' }, { target: 'M13' }, { target: 'Saturn' }],
    rationale: 'Two showpieces while the Moon is down, then Saturn near transit.',
  },
  commit_proposal: { proposal_id: 'paste the proposal_id returned by propose_plan' },
  modify_plan: { operations: [{ op: 'remove', target: 'M13' }] },
  get_current_plan: {},
  clear_plan: {},
  export_plan: { format: 'json' },
  import_plan: { source: 'M31, M45, M7' },
  compare_dark_sky_sites: { limit: 3, include_weather: false },
}

/** The five prompts of the README, copyable straight into an agent. */
export const AGENT_PLAYBOOK: string[] = [
  'Plan me tonight from the Roque: darkness, Moon and the 5 best targets, then propose a plan.',
  'Point the sky map at Saturn and tell me when it culminates.',
  'Which night between Sep 5 and Sep 20 is best here? Set the app to it.',
  'What am I looking at right now? Add my favorites to the plan.',
  'Compare tonight at Mauna Kea, Paranal and here, weather included.',
]

/** How long a Copy button stays in its confirmed state. */
export const COPIED_FEEDBACK_MS = 1500

/** How far ahead the rank_nights sample looks, in days. */
const RANK_SPAN_DAYS = 14

/** The part of the store the samples read: the live night and the live proposals. */
export type HarnessState = Pick<RoqueData, 'nightOf' | 'proposals'>

/**
 * The sample for one tool, pinned to what the app is actually showing: the
 * selected night and, for `commit_proposal`, the proposal that is really
 * pending. A sample that cannot work is worse than no sample at all.
 */
export function sampleInputFor(name: string, state: HarnessState): Record<string, unknown> {
  const sample = SAMPLE_INPUTS[name]
  if (!sample) return {}
  const input: Record<string, unknown> = structuredClone(sample)

  if (name === 'get_night_ephemeris') input.date = state.nightOf
  if (name === 'rank_nights') {
    input.from_date = state.nightOf
    input.to_date = addDays(state.nightOf, RANK_SPAN_DAYS)
  }
  if (name === 'commit_proposal') {
    const pending = state.proposals.find((proposal) => proposal.status === 'pending')
    if (pending) input.proposal_id = pending.id
  }
  return input
}

/** The same sample, pretty printed for the textarea. */
export function sampleInputText(name: string, state: HarnessState): string {
  const input = sampleInputFor(name, state)
  return Object.keys(input).length === 0 ? '{}' : JSON.stringify(input, null, 2)
}

// ---------------------------------------------------------------------------
// Running a tool
// ---------------------------------------------------------------------------

export type ParsedInput = { input: Record<string, unknown> } | { error: string }

/** Read the textarea. Blank means no arguments; anything else must be an object. */
export function parseToolInput(text: string): ParsedInput {
  const trimmed = (text ?? '').trim()
  if (trimmed === '') return { input: {} }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch (error) {
    return { error: `That is not valid JSON: ${(error as Error).message}` }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'Tool arguments must be a JSON object, for example {"date": "2026-09-12"}.' }
  }
  return { input: value as Record<string, unknown> }
}

export type ToolCallVia =
  | 'webmcp'
  | 'webmcp-json-string'
  /** No `document.modelContext` at all: this browser cannot host an agent. */
  | 'direct'
  /** WebMCP is here, but the tool is not in `getTools()` at this moment. */
  | 'direct-unregistered'
  /** WebMCP is here and the tool is registered, and the engine still refused. */
  | 'direct-refused'

export interface ToolCallOutcome {
  via: ToolCallVia
  value?: unknown
  error?: string
}

export const VIA_LABEL: Record<ToolCallVia, string> = {
  webmcp: 'via document.modelContext.executeTool',
  'webmcp-json-string': 'via document.modelContext.executeTool (JSON string variant)',
  direct: 'called directly: this browser has no WebMCP',
  'direct-unregistered':
    'called directly: WebMCP is live here but this tool is not registered right now',
  'direct-refused': 'called directly: WebMCP is live and the tool is registered, but the engine refused the call',
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Is this rejection a complaint about the SHAPE of the arguments?
 *
 * Spec PR #246 (August 2026) turned `executeTool`'s second argument from a JSON
 * string into an object, so one retry with the other dialect is worth it. Any
 * other rejection may well have arrived after the tool body already ran, and
 * retrying it would run a mutating tool twice.
 */
export function isArgumentShapeError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  const message = error instanceof Error ? error.message : String(error)
  return /string|argument|parameter|type|serializ|parse|json/i.test(message)
}

/** Engines return either the value or its JSON text; both must read the same. */
function coerce(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * Run a tool the way an agent would.
 *
 * The engine hands out its OWN tool handles, so the handle is looked up through
 * `getTools()`; a literal `{ name }` is not one, and passing it makes a real
 * WebMCP browser look like a browser without WebMCP. Only when the engine has
 * no handle for this tool, or refuses the call, does the harness fall back to
 * the tool object itself, and it says which of those happened.
 *
 * Never rejects: a thrown tool comes back as `error`.
 */
export async function runToolCall(
  tool: ModelContextToolDefinition,
  input: Record<string, unknown>,
  mc: ModelContext | undefined = getModelContext(),
): Promise<ToolCallOutcome> {
  const usable = Boolean(mc && typeof mc.executeTool === 'function')
  let ref: RegisteredModelContextTool | null = null
  if (usable && typeof mc?.getTools === 'function') {
    try {
      const registered = await mc.getTools()
      ref = registered.find((entry) => entry.name === tool.name) ?? null
    } catch {
      ref = null
    }
  }

  if (mc && ref) {
    try {
      return { via: 'webmcp', value: coerce(await mc.executeTool(ref, input)) }
    } catch (first) {
      // Only a complaint about the argument SHAPE earns a second attempt: any
      // other rejection may have arrived AFTER the tool body already ran, and
      // `clear_plan` must not run twice because a turn timed out.
      if (!isArgumentShapeError(first)) {
        return { via: 'direct-refused', error: describeError(first) }
      }
    }
    try {
      const asText = JSON.stringify(input) as unknown as Record<string, unknown>
      return { via: 'webmcp-json-string', value: coerce(await mc.executeTool(ref, asText)) }
    } catch {
      // Both dialects rejected the arguments before the tool body: safe to run
      // the very same tool object here so the panel still shows a result.
    }
  }

  const via: ToolCallVia = ref ? 'direct-refused' : usable ? 'direct-unregistered' : 'direct'
  try {
    return { via, value: coerce(await tool.execute(input)) }
  } catch (error) {
    return { via, error: describeError(error) }
  }
}

/** The one-sentence summary of a tool result, when it has one. */
function resultSummary(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.summary === 'string') return record.summary
  const error = record.error
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return null
}

function prettyJson(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function isFailure(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'
const BUTTON =
  'rounded-sm border border-panel-edge px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-faint hover:border-ember/50 hover:text-ember disabled:cursor-not-allowed disabled:opacity-40'
const FIELD =
  'w-full rounded-sm border border-panel-edge bg-abyss px-2 py-1 font-mono text-xs text-ember outline-none focus:border-ember/60'

export function AgentHarness() {
  const nightOf = useRoqueStore((s) => s.nightOf)
  const plan = useRoqueStore((s) => s.plan)
  const proposals = useRoqueStore((s) => s.proposals)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState(APP_TOOLS[0]?.name ?? '')
  const [text, setText] = useState(() => sampleInputText(APP_TOOLS[0]?.name ?? '', { nightOf, proposals }))
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ToolCallOutcome | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState<number | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  // The harness sits at the bottom of a scrolling column: opening it grows the
  // column by ~600 px below the fold, so nothing appears to happen. Bring it up.
  useEffect(() => {
    if (!open) return
    sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [open])

  const registered = useMemo(
    () => new Set(currentToolNames({ plan, proposals })),
    [plan, proposals],
  )
  const tool = useMemo(() => APP_TOOLS.find((t) => t.name === name) ?? APP_TOOLS[0], [name])

  const selectTool = useCallback(
    (next: string) => {
      setName(next)
      setText(sampleInputText(next, { nightOf, proposals }))
      setOutcome(null)
    },
    [nightOf, proposals],
  )

  const run = useCallback(async () => {
    if (!tool) return
    const parsed = parseToolInput(text)
    if ('error' in parsed) {
      setOutcome({ via: 'direct', error: parsed.error })
      return
    }
    setBusy(true)
    setOutcome(null)
    const result = await runToolCall(tool, parsed.input)
    setBusy(false)
    setOutcome(result)
  }, [text, tool])

  const copyPrompt = useCallback(async (index: number) => {
    try {
      await navigator.clipboard?.writeText(AGENT_PLAYBOOK[index])
    } catch {
      return
    }
    setCopiedPrompt(index)
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedPrompt(null), COPIED_FEEDBACK_MS)
  }, [])

  const summary = outcome?.error ?? resultSummary(outcome?.value)
  const failed = Boolean(outcome?.error) || isFailure(outcome?.value)

  return (
    <section ref={sectionRef} className="rounded-sm border border-panel-edge bg-panel p-3 font-mono">
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <h2 className={LABEL}>Agent harness · manual tool calls</h2>
        <span className="text-[11px] text-faint">
          {registered.size}/{APP_TOOLS.length} live {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-faint">
            Runs a tool exactly as an agent would: through the browser when WebMCP is available,
            otherwise straight against the tool. A dot marks the tools registered right now.
          </p>

          <select
            className={FIELD}
            value={name}
            aria-label="Tool to run"
            onChange={(event) => selectTool(event.target.value)}
          >
            {APP_TOOLS.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {registered.has(entry.name) ? '● ' : '○ '}
                {entry.name}
              </option>
            ))}
          </select>

          {tool && (
            <>
              <p className="text-[11px] text-faint">
                {registered.has(tool.name)
                  ? 'Registered now.'
                  : 'Not registered right now: contextual tools appear when a plan or a proposal exists. The harness can still call it.'}
              </p>
              <p className="text-xs text-[#e6e9f0]">{truncate(tool.description, 260)}</p>

              <textarea
                className={`${FIELD} h-24 resize-y`}
                spellCheck={false}
                aria-label={`Arguments for ${tool.name}`}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />

              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy}
                  onClick={() => {
                    void run()
                  }}
                >
                  {busy ? 'Running' : 'Run'}
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => setText(sampleInputText(tool.name, { nightOf, proposals }))}
                >
                  Reset input
                </button>
              </div>
            </>
          )}

          {outcome && (
            <div className="space-y-1">
              {summary && (
                <p className={`text-xs ${failed ? 'text-signal' : 'text-ember'}`}>{summary}</p>
              )}
              <p className="text-[11px] text-faint">{VIA_LABEL[outcome.via]}</p>
              {outcome.value !== undefined && (
                <pre className="max-h-64 overflow-auto rounded-sm border border-panel-edge bg-abyss p-2 text-[11px] whitespace-pre text-faint">
                  {prettyJson(outcome.value)}
                </pre>
              )}
            </div>
          )}

          <div className="border-t border-panel-edge pt-2">
            <h3 className={LABEL}>Agent playbook</h3>
            <ul className="mt-1 space-y-1">
              {AGENT_PLAYBOOK.map((prompt, index) => (
                <li key={prompt} className="flex items-start gap-2 text-xs">
                  <span className="flex-1 text-[#e6e9f0]">{prompt}</span>
                  <button
                    type="button"
                    className={`${BUTTON} shrink-0 ${copiedPrompt === index ? 'border-ember/60 text-ember' : ''}`}
                    onClick={() => {
                      void copyPrompt(index)
                    }}
                  >
                    {copiedPrompt === index ? 'Copied' : 'Copy'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
