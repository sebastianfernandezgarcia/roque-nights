/**
 * Tool 12: `export_plan`.
 *
 * The plan leaves the page in three shapes: the open `observing-plan.v1`
 * document (site, night and darkness included, so another observer can
 * revalidate it), a calendar, and a spreadsheet. Plus a share URL that carries
 * the whole plan in its fragment, which is what makes `import_plan` on someone
 * else's machine possible without a single server.
 */

import { getNight } from '../astro/cache'
import { toCsv, toIcs, toObservingPlanV1, type ObservingPlanV1 } from '../plan/serialize'
import { SHARE_URL_WARN_LENGTH, buildShareUrl } from '../plan/shareUrl'
import { store } from '../state/store'
import { defineTool, fail, ok, type ToolResult } from './envelope'
import { PLAN_STALE_HINT, planStaleMessage } from './planStale'

export type ExportFormat = 'json' | 'ics' | 'csv'

export interface ExportPlanData {
  format: ExportFormat
  /** The document itself, ready to save or to paste. */
  content: string
  filename: string
  /** URL of this app carrying the whole plan, or null when not requested. */
  share_url: string | null
  item_count: number
}

const FORMATS: ExportFormat[] = ['json', 'ics', 'csv']
const MAX_AUTHOR_LENGTH = 80

const FORMAT_LABEL: Record<ExportFormat, string> = {
  json: 'JSON',
  ics: 'ICS',
  csv: 'CSV',
}

const EXPORT_HINT =
  'Add something to the plan first with propose_plan and commit_proposal, or with modify_plan.'

function render(format: ExportFormat, plan: ObservingPlanV1): string {
  if (format === 'ics') return toIcs(plan)
  if (format === 'csv') return toCsv(plan)
  return JSON.stringify(plan, null, 2)
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null) return 'null'
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (typeof value === 'object') return 'an object'
  return String(value)
}

function run(input: Record<string, unknown>): ToolResult<ExportPlanData> {
  const state = store.getState()

  const rawFormat = input.format
  let format: ExportFormat = 'json'
  if (rawFormat !== undefined && rawFormat !== null) {
    if (typeof rawFormat !== 'string' || !FORMATS.includes(rawFormat as ExportFormat)) {
      return fail(
        'invalid_input',
        `format must be one of json, ics or csv, got ${describeValue(rawFormat)}.`,
        'Use "json" for the open observing-plan.v1 document, "ics" for a calendar, "csv" for a spreadsheet.',
      )
    }
    format = rawFormat as ExportFormat
  }

  const rawShare = input.include_share_url
  if (rawShare !== undefined && rawShare !== null && typeof rawShare !== 'boolean') {
    return fail(
      'invalid_input',
      `include_share_url must be true or false, got ${describeValue(rawShare)}.`,
    )
  }
  const includeShareUrl = rawShare === undefined || rawShare === null ? true : rawShare

  const rawAuthor = input.author
  if (rawAuthor !== undefined && rawAuthor !== null && typeof rawAuthor !== 'string') {
    return fail('invalid_input', `author must be a string, got ${describeValue(rawAuthor)}.`)
  }
  if (typeof rawAuthor === 'string' && rawAuthor.length > MAX_AUTHOR_LENGTH) {
    return fail(
      'invalid_input',
      `author must be at most ${MAX_AUTHOR_LENGTH} characters, got ${rawAuthor.length}.`,
    )
  }
  const author = typeof rawAuthor === 'string' && rawAuthor.trim() !== '' ? rawAuthor.trim() : undefined

  if (state.plan.length === 0) {
    return fail('empty_plan', 'The plan is empty, so there is nothing to export.', EXPORT_HINT)
  }

  // A plan scheduled for another sky exports as a document full of times that
  // are quietly wrong, which is worse than no document at all: every block in it
  // was placed against a darkness window and a set of altitudes that no longer
  // apply. The person decides, not the agent and not the exporter.
  const staleMessage = planStaleMessage(state)
  if (staleMessage) return fail('plan_stale', staleMessage, PLAN_STALE_HINT)

  const caveats: string[] = []
  let darkness: { startUtc: string | null; endUtc: string | null } = { startUtc: null, endUtc: null }
  try {
    const night = getNight(state.nightOf, state.site)
    darkness = { startUtc: night.darkness.startUtc, endUtc: night.darkness.endUtc }
    if (night.darkness.status !== 'ok') {
      caveats.push(
        `This night has no ordinary darkness window at this site (${night.darkness.status.replace(/_/g, ' ')}), so the document carries null darkness.`,
      )
    }
  } catch {
    caveats.push(
      `Darkness could not be computed for ${state.nightOf}; the document carries null darkness.`,
    )
  }

  const plan = toObservingPlanV1(state, darkness, author)
  const content = render(format, plan)
  // The same name the Plan panel's download buttons use (src/ui/ExportActions.tsx),
  // so a file saved by the agent and one saved by the person do not collide.
  const filename = `roque-nights-plan-${state.nightOf}.${format}`
  const shareUrl = includeShareUrl ? buildShareUrl(plan) : null

  if (state.site.timeZone === null) {
    caveats.push(
      'This site has no IANA time zone, so every time in the document is UTC and the CSV local columns are blank.',
    )
  }
  if (shareUrl && shareUrl.length > SHARE_URL_WARN_LENGTH) {
    caveats.push(
      `The share URL is ${shareUrl.length} characters long; some chat clients cut links past about ${SHARE_URL_WARN_LENGTH}. Export the JSON document instead if the link arrives broken.`,
    )
  }

  const count = plan.items.length
  const signature = author ? `, signed by ${author}` : ''
  const share = shareUrl
    ? ' The share URL carries the whole plan: anyone who opens it can revalidate it for their own site.'
    : ''
  const summary =
    `Exported ${count} item${count === 1 ? '' : 's'} of the plan for the night of ${plan.night_of} at ${plan.site.name} as ${FORMAT_LABEL[format]} (${filename})${signature}.${share}`

  return ok<ExportPlanData>(
    summary,
    { format, content, filename, share_url: shareUrl, item_count: count },
    state.site,
    { caveats },
  )
}

export const exportPlanTool = defineTool<ExportPlanData>({
  name: 'export_plan',
  title: 'Export the plan as JSON, calendar or CSV',
  description:
    'Use this to export the committed plan as a portable document: "json" (the open observing-plan.v1 schema published at /schemas/observing-plan.v1.json; includes site, night and darkness so another observer can import and revalidate it for their own sky), "ics" (calendar events in UTC) or "csv". Also returns a share URL of this app that carries the whole plan; anyone opening it gets the plan revalidated for their site. The person can download the same files from the Plan panel. If the app has moved to another site or another night since the plan was committed, this refuses with plan_stale instead of exporting times that are no longer true: the person has to click Revalidate plan or Keep anyway first.',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: FORMATS,
        default: 'json',
        description:
          'json = the open observing-plan.v1 document (best for sharing with another observer or another agent), ics = calendar events in UTC, csv = one row per plan item.',
      },
      include_share_url: {
        type: 'boolean',
        default: true,
        description:
          'Return a URL of this app with the whole plan encoded in its fragment. Nothing is uploaded anywhere: the plan travels inside the link.',
      },
      author: {
        type: 'string',
        maxLength: MAX_AUTHOR_LENGTH,
        description: 'Optional name to sign the document with, for example the observer name.',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run,
})
