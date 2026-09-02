import { describe, expect, it } from 'vitest'

import {
  COPY_PROMPT,
  ONBOARDING_STORAGE_KEY,
  TOUR_STEPS,
  WEBMCP_ENABLE_HINT,
  WEBMCP_READY_NOTE,
  clampStep,
  markOnboardingSeen,
  onboardingSeen,
  promptNote,
  shouldAutoOpenTour,
  shouldAutoOpenTourFor,
} from './onboardingState'

/** A localStorage that works. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

/** A localStorage in a private window: every call throws. */
function hostileStorage(): Storage {
  const boom = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  }
  return {
    get length(): number {
      return boom()
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  }
}

describe('the tour copy', () => {
  it('is four steps', () => {
    expect(TOUR_STEPS).toHaveLength(4)
    expect(TOUR_STEPS.map((step) => step.id)).toEqual(['what', 'ask', 'favorites', 'plan'])
  })

  it('opens on what this page is and why an agent matters here', () => {
    expect(TOUR_STEPS[0].title).toBe('Plan a night under the stars with your agent.')
    expect(TOUR_STEPS[0].body).toBe(
      'This page exposes WebMCP tools an AI agent can call while you both look at the same sky.',
    )
  })

  it('carries the copyable prompt on step 2 and nowhere else', () => {
    expect(TOUR_STEPS[1].prompt).toBe(COPY_PROMPT)
    expect(COPY_PROMPT).toBe(
      'Plan me a 3-hour observing night for the best night in the next two weeks, avoiding the Moon.',
    )
    expect(TOUR_STEPS.filter((step) => step.prompt !== undefined)).toHaveLength(1)
  })

  it('ends on favorites and on the ghost plan', () => {
    expect(TOUR_STEPS[2].title).toBe('Tap any object, then press Favorite (or double-click it) to mark it. Your agent can see it.')
    expect(TOUR_STEPS[3].title).toBe(
      'Review the ghost plan your agent proposes, adjust it together, then export.',
    )
  })

  it('never uses an em dash: this page speaks in plain sentences', () => {
    const everything = [...TOUR_STEPS.flatMap((s) => [s.title, s.body, s.prompt]), WEBMCP_ENABLE_HINT, WEBMCP_READY_NOTE]
    for (const text of everything) {
      if (text) expect(text).not.toMatch(/[—–]/)
    }
  })
})

describe('promptNote', () => {
  it('tells an agentless browser how to become one', () => {
    expect(promptNote('unsupported')).toBe(WEBMCP_ENABLE_HINT)
    expect(WEBMCP_ENABLE_HINT).toContain('chrome://flags/#enable-webmcp-testing')
    expect(WEBMCP_ENABLE_HINT).toContain('ChatGPT desktop app')
  })

  it('says the tools are already there when they are', () => {
    expect(promptNote('registered')).toBe('This browser already exposes the tools: ask your agent now.')
  })

  it('says nothing while registration is still being decided', () => {
    expect(promptNote('pending')).toBeNull()
  })
})

describe('clampStep', () => {
  it('keeps the index inside the tour', () => {
    expect(clampStep(-3)).toBe(0)
    expect(clampStep(0)).toBe(0)
    expect(clampStep(3)).toBe(3)
    expect(clampStep(9)).toBe(3)
    expect(clampStep(Number.NaN)).toBe(0)
  })
})

describe('the seen flag', () => {
  it('auto-opens when nothing is stored and never again after a dismissal', () => {
    const storage = fakeStorage()
    expect(shouldAutoOpenTour(storage)).toBe(true)
    markOnboardingSeen(storage)
    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).not.toBeNull()
    expect(onboardingSeen(storage)).toBe(true)
    expect(shouldAutoOpenTour(storage)).toBe(false)
  })

  it('survives a private window where every localStorage call throws', () => {
    const storage = hostileStorage()
    expect(() => markOnboardingSeen(storage)).not.toThrow()
    expect(onboardingSeen(storage)).toBe(false)
    expect(shouldAutoOpenTour(storage)).toBe(true)
  })

  it('survives a browser with no storage at all', () => {
    expect(onboardingSeen(null)).toBe(false)
    expect(shouldAutoOpenTour(null)).toBe(true)
    expect(() => markOnboardingSeen(null)).not.toThrow()
  })
})

describe('shouldAutoOpenTourFor', () => {
  it('opens on a plain first visit', () => {
    expect(shouldAutoOpenTourFor('', fakeStorage())).toBe(true)
    expect(shouldAutoOpenTourFor('#anything', fakeStorage())).toBe(true)
  })

  it('stays out of the way when the link carries a plan to import', () => {
    expect(shouldAutoOpenTourFor('#plan=eyJ2ZXJzaW9uIjoxfQ', fakeStorage())).toBe(false)
  })

  it('still respects a dismissal', () => {
    const storage = fakeStorage()
    markOnboardingSeen(storage)
    expect(shouldAutoOpenTourFor('', storage)).toBe(false)
  })
})
