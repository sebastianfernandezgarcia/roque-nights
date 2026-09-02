/**
 * The plan, out of the browser.
 *
 * Four ways out, all of them offline: the open `observing-plan.v1` document
 * (site, night and darkness included, so another observer can revalidate it),
 * a calendar, a spreadsheet, and a link that carries the whole plan in its
 * fragment. Nothing is uploaded anywhere, because there is no server to upload
 * it to; that is the point of the format.
 *
 * The human buttons build exactly the same documents as the `export_plan` tool:
 * one serializer (src/plan/serialize.ts), two callers.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { getNight } from '../astro/cache'
import { toCsv, toIcs, toObservingPlanV1, type ObservingPlanV1 } from '../plan/serialize'
import { buildShareUrl } from '../plan/shareUrl'
import type { RoqueState } from '../state/store'
import { planStaleness, useRoqueStore } from '../state/store'

export type ExportFormat = 'json' | 'ics' | 'csv'

/** The three documents this page can write. Same list as the export_plan tool. */
export const EXPORT_FORMATS: ExportFormat[] = ['json', 'ics', 'csv']

export const MIME_TYPES: Record<ExportFormat, string> = {
  json: 'application/json',
  ics: 'text/calendar;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
}

const FORMAT_LABEL: Record<ExportFormat, string> = { json: 'JSON', ics: 'ICS', csv: 'CSV' }

/** How long the Copy button stays in its confirmed state. */
export const COPIED_FEEDBACK_MS = 1500

/** The slice of the store an export needs. */
export type ExportableState = Pick<RoqueState, 'site' | 'nightOf' | 'plan'>

export interface DarknessWindow {
  startUtc: string | null
  endUtc: string | null
}

export interface ExportPayload {
  filename: string
  mimeType: string
  content: string
}

/**
 * `roque-nights-plan-2026-09-12.json`. The night is sanitized because a file
 * name is a path in the download folder, and the store is not the only thing
 * that can write `nightOf`.
 */
export function planFilename(format: ExportFormat, nightOf: string): string {
  const slug = String(nightOf ?? '')
    .replace(/[^0-9A-Za-z-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `roque-nights-plan${slug ? `-${slug}` : ''}.${format}`
}

function renderDocument(format: ExportFormat, plan: ObservingPlanV1): string {
  if (format === 'ics') return toIcs(plan)
  if (format === 'csv') return toCsv(plan)
  return JSON.stringify(plan, null, 2)
}

/** The document, its name and its MIME type, ready for a Blob. Pure. */
export function buildExportPayload(
  state: ExportableState,
  darkness: DarknessWindow,
  format: ExportFormat,
): ExportPayload {
  const plan = toObservingPlanV1(state, darkness, undefined)
  return {
    filename: planFilename(format, state.nightOf),
    mimeType: MIME_TYPES[format],
    content: renderDocument(format, plan),
  }
}

/** The whole plan inside a URL of this app. Pure. */
export function buildShareLink(state: ExportableState, darkness: DarknessWindow): string {
  return buildShareUrl(toObservingPlanV1(state, darkness, undefined))
}

/** The darkness window of the selected night, or nulls when it cannot be computed. */
function darknessFor(state: ExportableState): DarknessWindow {
  try {
    const night = getNight(state.nightOf, state.site)
    return { startUtc: night.darkness.startUtc, endUtc: night.darkness.endUtc }
  } catch {
    // A night the engine cannot resolve still exports: the document says null.
    return { startUtc: null, endUtc: null }
  }
}

/** Hand a document to the browser as a download and let go of the object URL. */
function downloadBlob(payload: ExportPayload): void {
  const url = URL.createObjectURL(new Blob([payload.content], { type: payload.mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = payload.filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Denied permission or an insecure context: fall through to the message.
  }
  return false
}

/** Shown while the plan belongs to another site or another night. */
export const STALE_EXPORT_NOTE = 'Revalidate or keep the plan before exporting.'

/** Shown while there is nothing in the plan. */
export const EMPTY_EXPORT_NOTE =
  'Nothing to export yet. Add a target to the plan, or ask your agent to propose one.'

/** Shown when the plan is exportable. */
export const READY_EXPORT_NOTE =
  'JSON is the open observing-plan.v1 document: another observer can import it and revalidate it for their own sky.'

export interface ExportGate {
  /** True while every export path is refused. */
  blocked: boolean
  note: string
  /** True when the note is a warning, not an explanation. */
  warning: boolean
}

/**
 * Whether the plan can leave the browser, and the one line that says why not.
 * A plan whose times were computed for another sky must not be shared as if
 * they were true here: revalidate it, or say out loud that you keep it anyway.
 */
export function exportGate(state: { empty: boolean; stale: boolean }): ExportGate {
  if (state.stale) return { blocked: true, note: STALE_EXPORT_NOTE, warning: true }
  if (state.empty) return { blocked: true, note: EMPTY_EXPORT_NOTE, warning: false }
  return { blocked: false, note: READY_EXPORT_NOTE, warning: false }
}

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'
const BUTTON =
  'rounded-sm border border-panel-edge px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-faint hover:border-ember/50 hover:text-ember disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-panel-edge disabled:hover:text-faint'

export function ExportActions() {
  const site = useRoqueStore((s) => s.site)
  const nightOf = useRoqueStore((s) => s.nightOf)
  const plan = useRoqueStore((s) => s.plan)
  const logActivity = useRoqueStore((s) => s.logActivity)
  const stale = useRoqueStore((s) => planStaleness(s).stale)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  const empty = plan.length === 0
  const gate = exportGate({ empty, stale })

  const download = useCallback(
    (format: ExportFormat) => {
      const state: ExportableState = { site, nightOf, plan }
      const payload = buildExportPayload(state, darknessFor(state), format)
      try {
        downloadBlob(payload)
      } catch {
        setMessage('This browser refused the download. Use export_plan to get the text instead.')
        return
      }
      setMessage(null)
      logActivity('human', 'export_plan', `${format} · ${payload.filename}`)
    },
    [logActivity, nightOf, plan, site],
  )

  const copyLink = useCallback(async () => {
    const state: ExportableState = { site, nightOf, plan }
    const url = buildShareLink(state, darknessFor(state))
    const done = await copyText(url)
    logActivity('human', 'export_plan', `share link · ${url.length} chars`)
    if (!done) {
      setMessage('The clipboard is not available here. The link is in the box below.')
      setCopied(false)
      return
    }
    setMessage(null)
    setCopied(true)
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }, [logActivity, nightOf, plan, site])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        <span className={`${LABEL} mr-1`}>Export</span>
        {EXPORT_FORMATS.map((format) => (
          <button
            key={format}
            type="button"
            className={BUTTON}
            disabled={gate.blocked}
            title={`Download roque-nights-plan-${nightOf}.${format}`}
            onClick={() => download(format)}
          >
            {FORMAT_LABEL[format]}
          </button>
        ))}
        <button
          type="button"
          className={copied ? `${BUTTON} border-ember/60 text-ember` : BUTTON}
          disabled={gate.blocked}
          title="A link that carries the whole plan in its fragment; nothing is uploaded"
          onClick={() => {
            void copyLink()
          }}
        >
          {copied ? 'Copied' : 'Copy share link'}
        </button>
      </div>

      <p className={`mt-1 text-[11px] ${gate.warning ? 'text-signal' : 'text-faint'}`}>
        {gate.note}
      </p>

      {message && <p className="mt-1 text-[11px] text-signal">{message}</p>}
    </div>
  )
}
