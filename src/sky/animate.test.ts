import { describe, expect, it } from 'vitest'

import { DOME_VIEW, easeInOutCubic, interpolateView } from '../astro/sky'
import type { SkyView } from '../astro/sky'
import { DEFAULT_ANIMATION_MS, RETICLE_MS, createViewAnimator, reticlePhase } from './animate'
import type { AnimatorClock } from './animate'

/** A clock the test drives by hand: no timers, no requestAnimationFrame, no flakiness. */
function fakeClock(): { clock: AnimatorClock; advance(ms: number): void; pending(): number } {
  let now = 0
  let nextHandle = 1
  const queue = new Map<number, (time: number) => void>()
  return {
    clock: {
      now: () => now,
      requestFrame(callback) {
        const handle = nextHandle++
        queue.set(handle, callback)
        return handle
      },
      cancelFrame(handle) {
        queue.delete(handle)
      },
    },
    advance(ms) {
      now += ms
      const due = [...queue.entries()]
      queue.clear()
      for (const [, callback] of due) callback(now)
    },
    pending: () => queue.size,
  }
}

const FROM: SkyView = { centerAltDeg: 90, centerAzDeg: 350, fovDeg: 186 }
const TO: SkyView = { centerAltDeg: 40, centerAzDeg: 20, fovDeg: 30 }

describe('createViewAnimator', () => {
  it('eases to the target and lands on it exactly', () => {
    const { clock, advance } = fakeClock()
    const frames: SkyView[] = []
    const animator = createViewAnimator((v) => frames.push(v), clock)

    animator.animateTo(FROM, TO, 1200)
    for (let i = 0; i < 12; i++) advance(100)

    expect(frames.length).toBeGreaterThan(5)
    const last = frames[frames.length - 1]
    expect(last).toEqual(TO)
  })

  it('follows easeInOutCubic and moves monotonically the short way round', () => {
    const { clock, advance } = fakeClock()
    const frames: SkyView[] = []
    const animator = createViewAnimator((v) => frames.push(v), clock)

    animator.animateTo(FROM, TO, 1000)
    for (let i = 0; i < 10; i++) advance(100)

    const halfway = frames[4] // t = 0.5, easeInOutCubic(0.5) = 0.5
    expect(halfway).toEqual(interpolateView(FROM, TO, easeInOutCubic(0.5)))

    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].fovDeg).toBeLessThanOrEqual(frames[i - 1].fovDeg)
      expect(frames[i].centerAltDeg).toBeLessThanOrEqual(frames[i - 1].centerAltDeg)
    }
    // 350 -> 20 goes forward through 0, never backwards through 180.
    const azimuths = frames.map((f) => (f.centerAzDeg >= 180 ? f.centerAzDeg - 360 : f.centerAzDeg))
    for (let i = 1; i < azimuths.length; i++) {
      expect(azimuths[i]).toBeGreaterThanOrEqual(azimuths[i - 1])
    }
  })

  it('stops asking for frames once it arrives', () => {
    const { clock, advance, pending } = fakeClock()
    const animator = createViewAnimator(() => {}, clock)
    animator.animateTo(FROM, TO, 300)
    advance(100)
    expect(pending()).toBe(1)
    advance(400)
    expect(pending()).toBe(0)
  })

  it('cancels cleanly', () => {
    const { clock, advance, pending } = fakeClock()
    const frames: SkyView[] = []
    const animator = createViewAnimator((v) => frames.push(v), clock)

    animator.animateTo(FROM, TO, 1000)
    advance(100)
    const seen = frames.length
    animator.cancel()
    advance(1000)

    expect(frames).toHaveLength(seen)
    expect(pending()).toBe(0)
  })

  it('jumps straight to the target when there is no time to animate', () => {
    const { clock, pending } = fakeClock()
    const frames: SkyView[] = []
    const animator = createViewAnimator((v) => frames.push(v), clock)

    animator.animateTo(FROM, TO, 0)

    expect(frames).toEqual([TO])
    expect(pending()).toBe(0)
  })

  it('a new target replaces the one in flight', () => {
    const { clock, advance } = fakeClock()
    const frames: SkyView[] = []
    const animator = createViewAnimator((v) => frames.push(v), clock)

    animator.animateTo(FROM, TO, 1000)
    advance(200)
    animator.animateTo(frames[frames.length - 1], DOME_VIEW, 400)
    for (let i = 0; i < 6; i++) advance(100)

    expect(frames[frames.length - 1]).toEqual(DOME_VIEW)
  })

  it('clamps whatever it is handed', () => {
    const { clock } = fakeClock()
    const frames: SkyView[] = []
    const animator = createViewAnimator((v) => frames.push(v), clock)
    animator.animateTo(FROM, { centerAltDeg: 120, centerAzDeg: 400, fovDeg: 900 }, 0)
    expect(frames[0]).toEqual({ centerAltDeg: 90, centerAzDeg: 40, fovDeg: 186 })
  })
})

describe('reticlePhase', () => {
  it('draws nothing while the dome is still swinging', () => {
    // 1 is what drawReticle treats as "finished": no ring, no crosshair.
    expect(reticlePhase(0)).toBe(1)
    expect(reticlePhase(600)).toBe(1)
    expect(reticlePhase(DEFAULT_ANIMATION_MS - 1)).toBe(1)
  })

  it('starts exactly when the swing lands, on the final centre', () => {
    expect(reticlePhase(DEFAULT_ANIMATION_MS)).toBe(0)
    expect(reticlePhase(DEFAULT_ANIMATION_MS + RETICLE_MS / 2)).toBeCloseTo(0.5, 6)
  })

  it('finishes one pulse after the swing, and stays finished', () => {
    expect(reticlePhase(DEFAULT_ANIMATION_MS + RETICLE_MS)).toBe(1)
    expect(reticlePhase(DEFAULT_ANIMATION_MS + RETICLE_MS * 4)).toBe(1)
  })

  it('survives a clock that hands it nonsense', () => {
    expect(reticlePhase(Number.NaN)).toBe(1)
  })
})
