/**
 * Tool 3: pick the best ASTRONOMICAL night, do not iterate over the range.
 *
 * The first external agent we tested asked for "the best nights in September" and
 * had no way to get one except calling the single-night tool fifteen times. This
 * tool exists so that never happens again, and its description says so in the first
 * sentence, because that is the sentence a model reads when it is choosing.
 *
 * Scoring is USABLE dark hours: astronomical darkness while the Moon is down or too
 * thin to matter (see src/astro/rank.ts). A long night under a full Moon is not a
 * good night, and a score that ignored the Moon would quietly lie about that.
 *
 * "Astronomical" is the honest half of the claim and the tool says so everywhere:
 * this ranks darkness and Moon, and knows nothing whatsoever about the weather.
 * The clouds live in `compare_dark_sky_sites`, which asks Open-Meteo.
 */

import type { DarknessStatus } from '../astro/night'
import { rankNights, type NightScore } from '../astro/rank'
import { isoDateRange, parseIsoDate } from '../astro/time'
import { store } from '../state/store'
import type { Site } from '../state/types'
import {
  defineTool,
  fail,
  isToolError,
  ok,
  type ToolError,
  type ToolResult,
} from './envelope'
import { DATE_HINT, resolveSite } from './resolveSite'
import { DATE_SCHEMA, SITE_SCHEMA } from './schemas'

/** Same ceiling as `isoDateRange`: two months of nights is already a long answer. */
export const MAX_NIGHTS = 62
export const DEFAULT_NIGHT_LIMIT = 10

export interface RankedNight {
  night_of: string
  score: number
  dark_hours: number | null
  moon_free_hours: number | null
  usable_hours: number | null
  moon_illumination_pct: number
  darkness_status: DarknessStatus
  explanation: string
}

export interface RankNightsData {
  from_date: string
  to_date: string
  nights_evaluated: number
  /** The best nights, up to `limit`, best first. */
  best: RankedNight[]
  /** Every night in the range with its score, so nothing is hidden by the limit. */
  all_scores: { night_of: string; score: number }[]
}

export const RANK_NIGHTS_DESCRIPTION =
  'Use this to find the BEST ASTRONOMICAL NIGHT in a date range instead of calling get_night_ephemeris in a loop. Scores every night in the range (inclusive, up to 62 nights) by USABLE dark hours: astronomical darkness while the Moon is below the horizon or thinner than 15% illuminated. Astronomy only: darkness and Moon. It does not know the weather; for cloud cover use compare_dark_sky_sites. Returns nights sorted best-first with score (0-100), dark hours, Moon-free hours, Moon illumination and a one-line explanation. Honours cancellation. Read-only: it does not move the app. To put the app on the night you picked, call set_observing_time with { "date": <the night_of you chose> }. from_date and to_date are both required and both name the EVENING a night starts; a two-night range is fine when the person is only choosing between, say, Friday and Saturday ({ "from_date": "2026-09-04", "to_date": "2026-09-05" }).'

function toRanked(score: NightScore): RankedNight {
  return {
    night_of: score.nightOf,
    score: score.score,
    dark_hours: score.darkHours,
    moon_free_hours: score.moonFreeHours,
    usable_hours: score.usableHours,
    moon_illumination_pct: score.moonIlluminationPct,
    darkness_status: score.darknessStatus,
    explanation: score.explanation,
  }
}

/** A required date argument: present, a string, and a real calendar day. */
function readRequiredDate(value: unknown, field: string): string | ToolError {
  if (value === undefined || value === null || value === '') {
    return fail(
      'invalid_input',
      `${field} is required: rank_nights needs both from_date and to_date.`,
      'Example: { "from_date": "2026-09-01", "to_date": "2026-09-14" }.',
    )
  }
  if (typeof value !== 'string' || !parseIsoDate(value)) {
    return fail('invalid_date', `"${String(value)}" is not a valid calendar date.`, DATE_HINT)
  }
  return value
}

function readLimit(value: unknown): number | ToolError {
  if (value === undefined || value === null) return DEFAULT_NIGHT_LIMIT
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail('invalid_input', `limit must be a whole number, got ${String(value)}.`)
  }
  if (value < 1 || value > MAX_NIGHTS) {
    return fail('invalid_input', `limit must be between 1 and ${MAX_NIGHTS}, got ${value}.`)
  }
  return value
}

function hours(value: number | null): string {
  return value === null ? '0' : value.toFixed(1)
}

function nightClause(night: RankedNight): string {
  if (night.darkness_status === 'no_astronomical_darkness') {
    return `${night.night_of} (score 0, no astronomical darkness)`
  }
  return (
    `${night.night_of} (score ${night.score}, ${hours(night.usable_hours)} usable dark hours, ` +
    `Moon ${night.moon_illumination_pct}%)`
  )
}

function buildSummary(data: RankNightsData, site: Site): string {
  if (data.best.length === 0) {
    return `No nights to rank between ${data.from_date} and ${data.to_date} at ${site.name}.`
  }
  const shown = data.best.slice(0, 3)
  const [first, ...rest] = shown.map(nightClause)
  const tail = rest.length > 0 ? `, then ${rest.join(', ')}` : ''
  return (
    `Best astronomical night of ${data.nights_evaluated} (${data.from_date} to ${data.to_date}) ` +
    `at ${site.name}: ${first}${tail}.`
  )
}

export const rankNightsTool = defineTool<RankNightsData>({
  name: 'rank_nights',
  title: 'Best astronomical night in a date range',
  description: RANK_NIGHTS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      from_date: {
        ...DATE_SCHEMA,
        description: 'First evening of the range, YYYY-MM-DD (inclusive).',
      },
      to_date: {
        ...DATE_SCHEMA,
        description: `Last evening of the range, YYYY-MM-DD (inclusive). At most ${MAX_NIGHTS} nights from from_date.`,
      },
      site: SITE_SCHEMA,
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_NIGHTS,
        default: DEFAULT_NIGHT_LIMIT,
        description: 'How many of the best nights to return in full detail.',
      },
    },
    required: ['from_date', 'to_date'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  run: (input, options): ToolResult<RankNightsData> => {
    const state = store.getState()

    const resolved = resolveSite(input.site, state.site)
    if (isToolError(resolved)) return resolved

    const fromDate = readRequiredDate(input.from_date, 'from_date')
    if (isToolError(fromDate)) return fromDate
    const toDate = readRequiredDate(input.to_date, 'to_date')
    if (isToolError(toDate)) return toDate
    const limit = readLimit(input.limit)
    if (isToolError(limit)) return limit

    let dates: string[]
    try {
      dates = isoDateRange(fromDate, toDate, MAX_NIGHTS)
    } catch (error) {
      return fail(
        'invalid_input',
        error instanceof Error ? error.message.replace(/^isoDateRange: /, '') : String(error),
        `Ask for at most ${MAX_NIGHTS} nights, with to_date on or after from_date.`,
      )
    }

    let scores: NightScore[]
    try {
      scores = rankNights(dates, resolved.site, options.signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return fail(
          'aborted',
          `rank_nights was cancelled while scoring ${dates.length} nights.`,
          'Ask again with a shorter range if the wait was the problem.',
        )
      }
      throw error
    }

    const data: RankNightsData = {
      from_date: fromDate,
      to_date: toDate,
      nights_evaluated: scores.length,
      best: scores.slice(0, limit).map(toRanked),
      all_scores: [...scores]
        .sort((a, b) => a.nightOf.localeCompare(b.nightOf))
        .map((s) => ({ night_of: s.nightOf, score: s.score })),
    }

    return ok(buildSummary(data, resolved.site), data, resolved.site, {
      caveats: resolved.caveats,
    })
  },
})
