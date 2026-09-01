/**
 * Moving the dome with purpose.
 *
 * When the agent calls `point_sky_map`, the human has to SEE the sky swing round.
 * That is the whole point of the product, so the easing lives in its own module
 * with an injectable clock and is tested frame by frame.
 */

import { useEffect, useRef, useState } from 'react'

import { clampView, easeInOutCubic, interpolateView } from '../astro/sky'
import type { SkyView } from '../astro/sky'
import type { SkyViewState } from '../state/types'

/** Default swing, long enough to read as a move and short enough not to annoy. */
export const DEFAULT_ANIMATION_MS = 1200

/** The bits of the environment the animator needs, so tests can hand it a fake. */
export interface AnimatorClock {
  now(): number
  requestFrame(callback: (time: number) => void): number
  cancelFrame(handle: number): void
}

export interface ViewAnimator {
  animateTo(from: SkyView, to: SkyView, durationMs: number): void
  cancel(): void
}

const FALLBACK_FRAME_MS = 16

/** requestAnimationFrame when there is a browser, a 16 ms timer when there is not. */
export function defaultClock(): AnimatorClock {
  const raf = typeof globalThis.requestAnimationFrame === 'function'
  return {
    now: () =>
      typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now(),
    requestFrame: (callback) =>
      raf
        ? globalThis.requestAnimationFrame(callback)
        : (setTimeout(() => callback(Date.now()), FALLBACK_FRAME_MS) as unknown as number),
    cancelFrame: (handle) => {
      if (raf) globalThis.cancelAnimationFrame(handle)
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
    },
  }
}

/**
 * Eases a view towards a target with `easeInOutCubic`, one frame at a time, and
 * lands on the target exactly. A new target replaces whatever was in flight.
 */
export function createViewAnimator(
  onFrame: (view: SkyView) => void,
  clock: AnimatorClock = defaultClock(),
): ViewAnimator {
  let handle: number | null = null

  const cancel = (): void => {
    if (handle !== null) {
      clock.cancelFrame(handle)
      handle = null
    }
  }

  return {
    cancel,
    animateTo(from, to, durationMs) {
      cancel()
      const target = clampView(to)
      if (!(durationMs > 0)) {
        onFrame(target)
        return
      }
      const origin = clampView(from)
      const startedAt = clock.now()
      const tick = (time: number): void => {
        const elapsed = (Number.isFinite(time) ? time : clock.now()) - startedAt
        const t = elapsed / durationMs
        if (t >= 1) {
          handle = null
          onFrame(target)
          return
        }
        onFrame(interpolateView(origin, target, easeInOutCubic(t)))
        handle = clock.requestFrame(tick)
      }
      handle = clock.requestFrame(tick)
    },
  }
}

function viewKey(view: SkyViewState): string {
  return `${view.centerAltDeg}|${view.centerAzDeg}|${view.fovDeg}|${view.animate}`
}

/**
 * The view the canvas should draw right now.
 *
 * A view the store marks `animate` is eased over `durationMs`; anything else
 * snaps, so dragging stays glued to the pointer. Only the animation runs a
 * requestAnimationFrame loop: a still sky costs nothing.
 */
export function useAnimatedView(
  target: SkyViewState,
  durationMs: number = DEFAULT_ANIMATION_MS,
): SkyView {
  const [view, setView] = useState<SkyView>(() => clampView(target))
  const currentRef = useRef<SkyView>(view)
  const animatorRef = useRef<ViewAnimator | null>(null)
  const keyRef = useRef<string>(viewKey(target))

  // Created in an effect, not during render: effects run in declaration order,
  // so the animator exists before the target effect below can ask it to move.
  useEffect(() => {
    animatorRef.current = createViewAnimator((next) => {
      currentRef.current = next
      setView(next)
    })
    return () => {
      animatorRef.current?.cancel()
      animatorRef.current = null
    }
  }, [])

  useEffect(() => {
    const key = viewKey(target)
    if (key === keyRef.current) return
    keyRef.current = key
    const animator = animatorRef.current
    if (!animator) return
    const next = clampView(target)
    if (!target.animate) {
      animator.cancel()
      currentRef.current = next
      // Snapping here rather than deriving during render is deliberate: the
      // canvas must never paint a frame of the old view before the new one, and
      // the scene is memoised, so this extra pass costs one React render and no
      // repaint at all.
      // oxlint-disable-next-line react/set-state-in-effect
      setView(next)
      return
    }
    animator.animateTo(currentRef.current, next, durationMs)
  }, [target, durationMs])

  return view
}
