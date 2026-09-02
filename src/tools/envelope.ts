/**
 * The shape every Roque Nights tool returns, and the wrapper that guarantees it.
 *
 * One envelope for all 15 tools:
 *  - `summary` is one quotable sentence the agent can read out loud;
 *  - `data` holds the numbers behind that sentence so a human can verify them;
 *  - `rejected` says what was left out and WHY (the most useful field of all);
 *  - `caveats` is where the page admits what it does not know;
 *  - `site` and `as_of` make any answer reproducible.
 *
 * A tool never throws and never rejects: `defineTool` converts an unexpected
 * exception into `internal_error` and a cancellation into `aborted`, so an agent
 * always gets a structured answer instead of a broken turn.
 */

import { localStamp, roundTo } from '../astro/time'
import type { Site } from '../state/types'

/** The observing site as the agent sees it: snake_case, elevation and zone explicit. */
export interface SiteRef {
  id: string | null
  name: string
  latitude: number
  longitude: number
  elevation_m: number
  time_zone: string | null
}

/** An instant in UTC plus, when the zone is known, the site local wall clock. */
export interface Stamp {
  utc: string | null
  /** 'YYYY-MM-DD HH:mm' in the site zone, null when no IANA zone is known. */
  local: string | null
}

/** Something the tool deliberately left out, with the reason it did. */
export interface RejectedItem {
  id: string
  name: string
  reason: string
}

export type ToolErrorCode =
  | 'invalid_date'
  | 'invalid_site'
  | 'invalid_time_zone'
  | 'invalid_input'
  | 'unknown_target'
  | 'unknown_proposal'
  | 'unknown_item'
  | 'confirmation_required'
  | 'nothing_to_undo'
  | 'empty_plan'
  | 'plan_stale'
  | 'network_error'
  | 'aborted'
  | 'internal_error'

export interface ToolOk<T> {
  ok: true
  summary: string
  data: T
  rejected: RejectedItem[]
  caveats: string[]
  site: SiteRef
  as_of: string
  /** Tools registered by this call; agents do not re-read the tool list unless told. */
  tools_added?: string[]
  tools_removed?: string[]
}

export interface ToolError {
  ok: false
  error: { code: ToolErrorCode; message: string; hint?: string }
  as_of: string
}

export type ToolResult<T> = ToolOk<T> | ToolError

/** Longest `summary` excerpt kept in the activity log. */
export const EXCERPT_LIMIT = 160

export function siteRef(site: Site): SiteRef {
  return {
    id: site.id,
    name: site.name,
    latitude: roundTo(site.latitude, 5),
    longitude: roundTo(site.longitude, 5),
    elevation_m: site.elevationM,
    time_zone: site.timeZone,
  }
}

export function stamp(isoUtc: string | null, timeZone: string | null): Stamp {
  return { utc: isoUtc, local: localStamp(isoUtc, timeZone) }
}

export function ok<T>(
  summary: string,
  data: T,
  site: Site,
  extra?: {
    rejected?: RejectedItem[]
    caveats?: string[]
    tools_added?: string[]
    tools_removed?: string[]
  },
): ToolOk<T> {
  const result: ToolOk<T> = {
    ok: true,
    summary,
    data,
    rejected: extra?.rejected ?? [],
    caveats: extra?.caveats ?? [],
    site: siteRef(site),
    as_of: new Date().toISOString(),
  }
  if (extra?.tools_added && extra.tools_added.length > 0) result.tools_added = extra.tools_added
  if (extra?.tools_removed && extra.tools_removed.length > 0) {
    result.tools_removed = extra.tools_removed
  }
  return result
}

export function fail(code: ToolErrorCode, message: string, hint?: string): ToolError {
  return {
    ok: false,
    error: hint === undefined ? { code, message } : { code, message, hint },
    as_of: new Date().toISOString(),
  }
}

/** Narrow a `ToolResult` (or anything a helper returns) to the error branch. */
export function isToolError(value: unknown): value is ToolError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { ok?: unknown; error?: unknown }
  return candidate.ok === false && typeof candidate.error === 'object' && candidate.error !== null
}

/** One line, at most `max` characters, ellipsis when cut. Used by the activity log. */
export function excerpt(text: string, max: number = EXCERPT_LIMIT): string {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * The arguments an engine actually delivered, as an object, or the error to
 * return instead.
 *
 * Spec PR #246 (Aug 2026) turned `executeTool`'s second argument from a JSON
 * string into an object, and engines in the wild still do one or the other, so
 * a tool that quietly replaced a string with `{}` would answer a question the
 * agent never asked. A JSON object string is parsed; anything else that is not
 * an object is refused out loud.
 */
function coerceInput(input: unknown, toolName: string): Record<string, unknown> | ToolError {
  if (input === undefined || input === null) return {}
  let value: unknown = input
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') return {}
    try {
      value = JSON.parse(text)
    } catch {
      return fail(
        'invalid_input',
        `${toolName} was called with a string of arguments that is not valid JSON.`,
        'Pass the arguments as a JSON object, for example { "date": "2026-09-12" }.',
      )
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(
      'invalid_input',
      `${toolName} expects a JSON object of arguments, got ${Array.isArray(value) ? 'an array' : typeof value}.`,
      'Pass the arguments as a JSON object, for example { "date": "2026-09-12" }.',
    )
  }
  return value as Record<string, unknown>
}

export interface ToolSpec<T> {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: ModelContextToolAnnotations
  run: (
    input: Record<string, unknown>,
    options: { signal?: AbortSignal },
  ) => Promise<ToolResult<T>> | ToolResult<T>
}

/**
 * Build the WebMCP declaration from a `run` that returns the envelope.
 *
 * The returned `execute` ALWAYS resolves. A thrown cancellation becomes
 * `aborted`; anything else becomes `internal_error` with the message attached,
 * because an agent can act on a structured error and cannot act on a rejection.
 * Arguments delivered as a JSON string are parsed, and arguments that are
 * neither an object nor a JSON object string come back as `invalid_input`
 * rather than being silently dropped.
 */
export function defineTool<T>(def: ToolSpec<T>): ModelContextToolDefinition {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: def.annotations,
    execute: async (input, options) => {
      try {
        const safeInput = coerceInput(input, def.name)
        if (isToolError(safeInput)) return safeInput
        return await def.run(safeInput, { signal: options?.signal })
      } catch (error) {
        if (isAbortError(error)) {
          return fail('aborted', `${def.name} was cancelled before it finished.`)
        }
        return fail(
          'internal_error',
          `${def.name} failed unexpectedly: ${describe(error)}`,
          'This is a bug in the page, not in your request. Retry once with the same input; if it fails again, try a different tool.',
        )
      }
    },
  }
}
