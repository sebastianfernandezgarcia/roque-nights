/**
 * The four-step tour, as data.
 *
 * The copy and the "have I seen this?" flag live here, apart from the modal, for
 * two reasons: the strings are product copy that a test can pin, and every
 * localStorage access has to survive a private window, where reading the store
 * throws instead of returning null. Nothing in this module touches React or the
 * DOM beyond that one guarded call.
 */

import { PLAN_HASH_PREFIX } from '../plan/shareUrl'
import type { WebMCPStatus } from '../state/store'

/** Bumped only if the tour changes enough that a returning human should see it again. */
export const ONBOARDING_STORAGE_KEY = 'roque-nights.onboarding.v1'

/** The prompt of step 2, the one sentence that makes an agent do everything at once. */
export const COPY_PROMPT =
  'Plan me a 3-hour observing night for the best night in the next two weeks, avoiding the Moon.'

/**
 * Shown wherever the page has to admit no agent can reach it. One sentence, one
 * source of truth: the tour and the agent tools panel print this same string.
 */
export const WEBMCP_ENABLE_HINT =
  'To let an agent use these tools, open this page in the ChatGPT desktop app with Site tools on, or in Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled.'

/** Shown instead of the hint when the tools are already registered. */
export const WEBMCP_READY_NOTE = 'This browser already exposes the tools: ask your agent now.'

export interface TourStep {
  /** Stable key for the step dots and for tests. */
  id: string
  title?: string
  body?: string
  /** Step 2 only: the copyable prompt. */
  prompt?: string
}

/** The tour. Four steps: what this is, what to say, what to touch, what comes back. */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'what',
    title: 'Plan a night under the stars with your agent.',
    body: 'This page exposes WebMCP tools an AI agent can call while you both look at the same sky.',
  },
  {
    id: 'ask',
    prompt: COPY_PROMPT,
  },
  {
    id: 'favorites',
    title: 'Tap any object to mark it as a favorite. Your agent can see it.',
  },
  {
    id: 'plan',
    title: 'Review the ghost plan your agent proposes, adjust it together, then export.',
  },
]

/**
 * The extra line under the prompt: how to get an agent in here, or the fact that
 * one is already here. Nothing while the registration is still being decided.
 */
export function promptNote(status: WebMCPStatus): string | null {
  if (status === 'unsupported') return WEBMCP_ENABLE_HINT
  if (status === 'registered') return WEBMCP_READY_NOTE
  return null
}

/** Keeps a step index inside the tour however it was reached. */
export function clampStep(index: number, total: number = TOUR_STEPS.length): number {
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), Math.max(0, total - 1))
}

/**
 * The browser store, or null when there is not one we are allowed to touch.
 * A private window throws on the property access itself, not on the read.
 */
function browserStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Whether this browser has already been shown the tour. A storage we cannot read
 * counts as "not yet": the tour is worth more than the memory of it.
 */
export function onboardingSeen(storage: Storage | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    return storage.getItem(ONBOARDING_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

/** The tour opens by itself only on a visit that has nothing stored. */
export function shouldAutoOpenTour(storage: Storage | null = browserStorage()): boolean {
  return !onboardingSeen(storage)
}

/**
 * Same question, asked of a whole visit. A link that carries a plan
 * (`#plan=...`) has already told this person what the page is for, and the
 * import banner underneath must not open behind a modal.
 */
export function shouldAutoOpenTourFor(
  hash: string,
  storage: Storage | null = browserStorage(),
): boolean {
  if (typeof hash === 'string' && hash.startsWith(PLAN_HASH_PREFIX)) return false
  return shouldAutoOpenTour(storage)
}

/** Remember the dismissal. Never throws: a full or blocked store is not an error here. */
export function markOnboardingSeen(storage: Storage | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, new Date().toISOString())
  } catch {
    // Private mode, quota, or a browser that blocks site data. The tour simply
    // opens again next time, which is a far smaller problem than a crash.
  }
}
