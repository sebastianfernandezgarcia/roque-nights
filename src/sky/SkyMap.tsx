/**
 * The dome: the piece of this product a human actually looks at.
 *
 * A single canvas driven by the same store the agent writes to. When the agent
 * calls `point_sky_map`, `view.animate` goes true here and the sky swings round
 * under a red reticle; when the human drags, the store learns about it and the
 * agent can read it back through `describe_current_view`. Neither side has a
 * private copy of anything.
 *
 * Rendering is demand driven: a frame is painted when an input changes, and the
 * only requestAnimationFrame loops that ever run are the view animation and the
 * 900 ms reticle pulse.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { DOME_VIEW, clampView } from '../astro/sky'
import type { SkyView, ViewFrame } from '../astro/sky'
import { compassDirection } from '../astro/targets'
import { formatInZone } from '../astro/time'
import { store, useRoqueStore } from '../state/store'
import { useAnimatedView } from './animate'
import { dragToView, hitTest, wheelToFov } from './interaction'
import type { Hit } from './interaction'
import { renderSky } from './render'
import { buildScene } from './scene'

/** Retina is worth it; anything past 2x costs fill rate and buys nothing. */
const MAX_DPR = 2
/** Movement under this is a tap, not a drag. */
const DRAG_THRESHOLD_PX = 4
const LONG_PRESS_MS = 500
const FAVORITE_PULSE_MS = 400
const RETICLE_MS = 900
/** One activity entry per burst of wheel notches, not one per notch. */
const ZOOM_LOG_MS = 400
const MAX_STAR_MAG = 6

interface DragState {
  pointerId: number
  x: number
  y: number
  view: SkyView
  frame: ViewFrame
  width: number
  height: number
  moved: boolean
  handled: boolean
}

interface HoverState {
  x: number
  y: number
  label: string
}

function round(value: number): number {
  return Math.round(value)
}

function describeView(view: SkyView): string {
  return `alt ${round(view.centerAltDeg)}° az ${round(view.centerAzDeg)}° fov ${round(view.fovDeg)}°`
}

export function SkyMap() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const site = useRoqueStore((s) => s.site)
  const timeUtc = useRoqueStore((s) => s.timeUtc)
  const view = useRoqueStore((s) => s.view)
  const selectedId = useRoqueStore((s) => s.selectedId)
  const highlighted = useRoqueStore((s) => s.highlightedIds)
  const favorites = useRoqueStore((s) => s.favoriteIds)
  const plan = useRoqueStore((s) => s.plan)
  const proposals = useRoqueStore((s) => s.proposals)
  const nightMode = useRoqueStore((s) => s.nightMode)

  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 })
  const [hover, setHover] = useState<HoverState | null>(null)
  const [reticlePulse, setReticlePulse] = useState(1)
  const [favoritePulse, setFavoritePulse] = useState<{ x: number; y: number; at: number } | null>(
    null,
  )

  const animatedView = useAnimatedView(view)

  // --- canvas size ---------------------------------------------------------
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const dpr = Math.min(MAX_DPR, globalThis.devicePixelRatio || 1)
      setSize((current) =>
        current.width === rect.width && current.height === rect.height && current.dpr === dpr
          ? current
          : { width: rect.width, height: rect.height, dpr },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // --- the scene -----------------------------------------------------------
  const scene = useMemo(() => {
    if (size.width < 2 || size.height < 2) return null
    return buildScene({
      site,
      timeUtc,
      view: animatedView,
      width: size.width,
      height: size.height,
      maxStarMag: MAX_STAR_MAG,
    })
  }, [site, timeUtc, animatedView, size.width, size.height])

  // The pointer handlers read the newest scene through a ref so they never close
  // over a stale frame.
  const sceneRef = useRef(scene)
  useEffect(() => {
    sceneRef.current = scene
  }, [scene])

  const highlightedIds = useMemo(() => new Set(highlighted), [highlighted])
  const favoriteIds = useMemo(() => new Set(favorites), [favorites])
  const planIds = useMemo(
    () => new Map(plan.map((item, index) => [item.targetId, index + 1] as const)),
    [plan],
  )
  const proposedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const proposal of proposals) {
      if (proposal.status !== 'pending') continue
      for (const item of proposal.items) {
        if (proposal.decisions[item.id]?.decision === 'rejected') continue
        if (!planIds.has(item.targetId)) ids.add(item.targetId)
      }
    }
    return ids
  }, [proposals, planIds])

  // --- painting ------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene) return
    const width = Math.round(scene.width * size.dpr)
    const height = Math.round(scene.height * size.dpr)
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    renderSky(ctx, scene, {
      nightMode,
      dpr: size.dpr,
      selectedId,
      highlightedIds,
      favoriteIds,
      planIds,
      proposedIds,
      showConstellationNames: true,
      showLabels: true,
      reticlePulse,
    })
  }, [
    scene,
    size.dpr,
    nightMode,
    selectedId,
    highlightedIds,
    favoriteIds,
    planIds,
    proposedIds,
    reticlePulse,
  ])

  // --- the agent's ripple --------------------------------------------------
  const wasAnimating = useRef(view.animate)
  useEffect(() => {
    const started = view.animate && !wasAnimating.current
    wasAnimating.current = view.animate
    if (!started) return
    // Only the agent gets a reticle: when the human presses "whole sky" they
    // already know where they are looking.
    if (store.getState().activity[0]?.source === 'human') return
    let raf = 0
    const startedAt = performance.now()
    const tick = () => {
      const t = (performance.now() - startedAt) / RETICLE_MS
      if (t >= 1) {
        setReticlePulse(1)
        return
      }
      setReticlePulse(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [view.animate])

  // --- the human's hands ---------------------------------------------------
  const dragRef = useRef<DragState | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastZoomLogRef = useRef(0)

  const cancelLongPress = () => {
    if (longPressRef.current !== null) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  const pointAt = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const hitAt = (x: number, y: number): Hit | null => {
    const current = sceneRef.current
    return current ? hitTest(current, x, y) : null
  }

  const toggleFavoriteAt = (x: number, y: number): boolean => {
    const hit = hitAt(x, y)
    if (!hit) return false
    store.getState().toggleFavorite(hit.id, 'human')
    setFavoritePulse({ x, y, at: Date.now() })
    return true
  }

  useEffect(() => {
    if (!favoritePulse) return
    const timer = setTimeout(() => setFavoritePulse(null), FAVORITE_PULSE_MS)
    return () => clearTimeout(timer)
  }, [favoritePulse])

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const current = sceneRef.current
    if (!current) return
    const point = pointAt(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
      view: clampView(animatedView),
      frame: current.frame,
      width: current.width,
      height: current.height,
      moved: false,
      handled: false,
    }
    cancelLongPress()
    longPressRef.current = setTimeout(() => {
      longPressRef.current = null
      const drag = dragRef.current
      if (!drag || drag.moved) return
      if (toggleFavoriteAt(drag.x, drag.y)) drag.handled = true
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointAt(event)
    const drag = dragRef.current

    if (!drag) {
      const hit = hitAt(point.x, point.y)
      if (!hit) {
        if (hover) setHover(null)
        return
      }
      const current = sceneRef.current
      const object = current?.objects.find((o) => o.id === hit.id)
      const suffix = object
        ? ` · alt ${round(object.altDeg)}° · az ${round(object.azDeg)}° (${compassDirection(object.azDeg)})`
        : ''
      setHover({ x: point.x, y: point.y, label: `${hit.name}${suffix}` })
      return
    }

    if (drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.hypot(point.x - drag.x, point.y - drag.y) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    cancelLongPress()
    if (hover) setHover(null)
    const next = dragToView(drag, point, drag.frame, drag.width, drag.height)
    // Silent: a drag is one gesture, not sixty entries in the activity log.
    store.getState().setView(next, 'human', { silent: true })
  }

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    cancelLongPress()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!drag || drag.handled) return

    const state = store.getState()
    if (drag.moved) {
      const detail = describeView(store.getState().view)
      state.recordHumanAction('drag_map', detail)
      state.logActivity('human', 'drag_map', detail)
      return
    }
    const point = pointAt(event)
    const hit = hitAt(point.x, point.y)
    state.select(hit ? hit.id : null, 'human')
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const point = pointAt(event)
    toggleFavoriteAt(point.x, point.y)
  }

  // Wheel has to be a manual listener: React attaches it passively, and a
  // passive listener cannot stop the page from scrolling underneath the dome.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const state = store.getState()
      const fovDeg = wheelToFov(state.view.fovDeg, event.deltaY)
      if (fovDeg === state.view.fovDeg) return
      state.setView({ fovDeg }, 'human', { silent: true })
      const now = Date.now()
      if (now - lastZoomLogRef.current > ZOOM_LOG_MS) {
        lastZoomLogRef.current = now
        state.recordHumanAction('zoom_map', `fov ${round(fovDeg)}°`)
        state.logActivity('human', 'zoom_map', `fov ${round(fovDeg)}°`)
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => cancelLongPress, [])

  // --- overlays ------------------------------------------------------------
  const zone = site.timeZone
  const utcLabel = formatInZone(timeUtc, 'UTC')
  const localLabel = zone ? formatInZone(timeUtc, zone) : null
  const moon = scene?.objects.find((o) => o.kind === 'moon')
  const moonIllumination = moon ? Math.round(moon.extra?.illuminationPct ?? 0) : null
  const offZenith =
    Math.abs(view.centerAltDeg - DOME_VIEW.centerAltDeg) > 1 ||
    Math.abs(view.fovDeg - DOME_VIEW.fovDeg) > 1

  const resetView = () => {
    store.getState().setView(
      {
        centerAltDeg: DOME_VIEW.centerAltDeg,
        centerAzDeg: DOME_VIEW.centerAzDeg,
        fovDeg: DOME_VIEW.fovDeg,
        animate: true,
      },
      'human',
    )
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-abyss">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
        aria-label="Interactive sky dome"
        role="img"
      />

      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 font-mono text-[11px] text-faint">
        <span className="rounded-xs border border-panel-edge bg-panel/70 px-2 py-1">
          FOV {round(animatedView.fovDeg)}°
          {localLabel ? ` · ${localLabel} local` : ''} · {utcLabel} UTC
        </span>
        {offZenith ? (
          <button
            type="button"
            onClick={resetView}
            className="pointer-events-auto rounded-xs border border-panel-edge bg-panel/70 px-2 py-1 text-ember hover:border-ember/60"
          >
            ⟲ Whole sky
          </button>
        ) : null}
      </div>

      {moonIllumination !== null ? (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-xs border border-panel-edge bg-panel/70 px-2 py-1 font-mono text-[11px] text-faint">
          ☾ {moonIllumination}%
        </div>
      ) : null}

      {hover ? (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-xs border border-panel-edge bg-panel/90 px-2 py-1 font-mono text-[11px] text-ember"
          style={{
            left: Math.min(hover.x + 14, Math.max(0, size.width - 220)),
            top: Math.max(4, hover.y - 30),
          }}
        >
          {hover.label}
        </div>
      ) : null}

      {favoritePulse ? (
        <div
          className="pointer-events-none absolute h-8 w-8 animate-ping rounded-full border border-ember"
          style={{ left: favoritePulse.x - 16, top: favoritePulse.y - 16 }}
        />
      ) : null}
    </div>
  )
}
