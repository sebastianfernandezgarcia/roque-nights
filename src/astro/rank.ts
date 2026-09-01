/**
 * Ranking a range of nights by how much dark, Moon free sky they actually offer.
 *
 * The number that matters to an observer is `usableHours`: the part of the
 * astronomical darkness window with either no Moon above the horizon or a Moon too
 * faint to wash the sky out (see `computeNightEphemeris`). Ten usable hours is as
 * good as a night gets outside the poles, so the score is simply ten points per
 * usable hour, capped at 100. It is coarse on purpose: an agent reading it should
 * talk about hours, and the hours travel with the score.
 *
 * Pure and headless: no store, no DOM, no network. Every instant is UTC.
 */

import { getNight } from './cache'
import type { DarknessStatus, NightEphemeris, SiteCoords } from './night'

/** Points awarded per usable dark hour, before the cap at 100. */
export const POINTS_PER_USABLE_HOUR = 10
export const MAX_SCORE = 100
/** Hours below this are noise from the 10 minute sampling of the darkness window. */
const HOUR_EPSILON = 0.05

export interface NightScore {
  /** Calendar date the night starts on, YYYY-MM-DD (local noon to local noon). */
  nightOf: string
  /** round(min(100, 10 * usableHours)); 0 when the night has no astronomical darkness. */
  score: number
  /** Hours of astronomical darkness, null when there is none. */
  darkHours: number | null
  /** Hours of that darkness with the Moon below the horizon, null when there is none. */
  moonFreeHours: number | null
  /** Moon free hours plus any dark hours under a Moon too faint to matter. */
  usableHours: number | null
  /** Moon illumination at the start of the night, percent. */
  moonIlluminationPct: number
  darknessStatus: DarknessStatus
  /** One quotable sentence, e.g. '8.9 usable dark hours (Moon 4%, below the horizon all night)'. */
  explanation: string
}

/**
 * Score one already computed night. Exported so the tools can reuse the exact wording
 * for a single night without ranking a range.
 */
export function scoreNight(night: NightEphemeris): NightScore {
  const { darkness, moon } = night
  const usableHours = darkness.usableHours
  const score =
    usableHours === null
      ? 0
      : Math.round(Math.min(MAX_SCORE, POINTS_PER_USABLE_HOUR * usableHours))

  return {
    nightOf: night.nightOf,
    score,
    darkHours: darkness.hours,
    moonFreeHours: darkness.moonFreeHours,
    usableHours,
    moonIlluminationPct: moon.illuminationPct,
    darknessStatus: darkness.status,
    explanation: buildExplanation(night),
  }
}

/**
 * Scores each date and returns them best first, ties broken by the earlier date.
 *
 * `dates` are YYYY-MM-DD nights (use `isoDateRange`); the caller is responsible for
 * keeping the range sane, this function will happily score whatever it is given.
 * When `signal` is provided it is checked before every night, so a long range can be
 * cut short by the agent's turn ending: it then throws a DOMException named
 * 'AbortError', the same shape `fetch` uses.
 */
export function rankNights(
  dates: string[],
  site: SiteCoords,
  signal?: AbortSignal,
): NightScore[] {
  const scored: NightScore[] = []
  for (const nightOf of dates) {
    if (signal?.aborted) {
      throw new DOMException(
        `rankNights aborted after ${scored.length} of ${dates.length} nights`,
        'AbortError',
      )
    }
    scored.push(scoreNight(getNight(nightOf, site)))
  }
  // Best first; nights that score the same are listed with the earlier date first,
  // so an agent reading the top of the list gets the soonest of the equally good nights.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.nightOf < b.nightOf ? -1 : a.nightOf > b.nightOf ? 1 : 0
  })
  return scored
}

/** Where the Moon sits during the darkness window, in the words a planner would use. */
function moonClause(night: NightEphemeris): string {
  const darkHours = night.darkness.hours ?? 0
  const moonFreeHours = night.darkness.moonFreeHours ?? 0
  const usableHours = night.darkness.usableHours ?? 0
  const moonUpHours = Math.max(0, darkHours - moonFreeHours)

  let where: string
  if (moonUpHours <= HOUR_EPSILON) {
    where = 'below the horizon all night'
  } else if (moonFreeHours <= HOUR_EPSILON) {
    where = 'above the horizon all night'
  } else {
    where = `above the horizon for ${moonUpHours.toFixed(1)} of the ${darkHours.toFixed(1)} dark hours`
  }

  // The night ephemeris counts dark time under a very faint Moon as usable; say so,
  // otherwise the hours look inconsistent with a Moon that is up.
  const faintMoonCounted = usableHours > moonFreeHours + HOUR_EPSILON
  return faintMoonCounted ? `${where} but faint enough to ignore` : where
}

function buildExplanation(night: NightEphemeris): string {
  if (night.darkness.status === 'no_astronomical_darkness') {
    return '0 usable hours: no astronomical darkness'
  }
  const usableHours = (night.darkness.usableHours ?? 0).toFixed(1)
  const moon = `Moon ${night.moon.illuminationPct}%, ${moonClause(night)}`
  if (night.darkness.status === 'continuous_darkness') {
    return `${usableHours} usable hours of continuous darkness (${moon})`
  }
  return `${usableHours} usable dark hours (${moon})`
}
