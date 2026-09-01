/**
 * Turning pointer pixels back into sky.
 *
 * Pure functions over a built `Scene`: what is under the pointer, where a drag
 * leaves the view, how far a wheel notch zooms. `SkyMap.tsx` does the DOM part
 * (pointer capture, thresholds, timers) and nothing else.
 */

import {
  MAX_FOV,
  MIN_FOV,
  altAzToVec,
  makeFrame,
  project,
  unproject,
  vecToAltAz,
} from '../astro/sky'
import type { SkyView, Vec3, ViewFrame } from '../astro/sky'
import { starIdForName } from './scene'
import type { Scene, SceneObject } from './scene'

/** Default tap radius for objects, in CSS pixels. Stars use 4/7 of it. */
export const HIT_RADIUS_PX = 14
const STAR_HIT_RATIO = 4 / 7
/** One wheel notch (deltaY 100) changes the field of view by ~16 %. */
const ZOOM_RATE = 0.0015
/** Correction passes for a drag. Two are usually enough; the rest are free insurance. */
const MAX_DRAG_PASSES = 4
/** A pass that buys less than a twentieth of a pixel has converged. */
const DRAG_EPSILON_PX = 0.05

export interface Hit {
  id: string
  name: string
  kind: SceneObject['kind'] | 'star'
  distancePx: number
}

/**
 * Nearest thing to (x, y): deep sky objects, planets and the Moon inside
 * `maxPx` (or their own glyph, whichever is more forgiving), named stars inside
 * a tighter radius. The Sun is never a hit: it is drawn for orientation, it is
 * not an observing target.
 */
export function hitTest(scene: Scene, x: number, y: number, maxPx = HIT_RADIUS_PX): Hit | null {
  let best: Hit | null = null

  for (const object of scene.objects) {
    if (object.kind === 'sun') continue
    const distance = Math.hypot(object.x - x, object.y - y)
    // A big glyph is tappable anywhere on it, however wide it is drawn.
    if (distance > Math.max(maxPx, object.r + 4)) continue
    if (best === null || distance < best.distancePx) {
      best = { id: object.id, name: object.name, kind: object.kind, distancePx: distance }
    }
  }

  const starMax = maxPx * STAR_HIT_RATIO
  for (const star of scene.stars) {
    if (star.name === '') continue
    const distance = Math.hypot(star.x - x, star.y - y)
    if (distance > Math.max(starMax, star.r + 2)) continue
    if (best === null || distance < best.distancePx) {
      best = {
        id: starIdForName(star.name),
        name: star.name,
        kind: 'star',
        distancePx: distance,
      }
    }
  }

  return best
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * Rotates `v` by the rotation that takes `from` onto `to` (Rodrigues). Returns
 * null when the two are parallel or antiparallel, where no rotation is defined.
 */
function rotateBetween(v: Vec3, from: Vec3, to: Vec3): Vec3 | null {
  const axis = cross(from, to)
  const sin = Math.hypot(axis.x, axis.y, axis.z)
  if (sin < 1e-12) return null
  const cos = dot(from, to)
  const k = { x: axis.x / sin, y: axis.y / sin, z: axis.z / sin }
  const kv = cross(k, v)
  const kdv = dot(k, v) * (1 - cos)
  return {
    x: v.x * cos + kv.x * sin + k.x * kdv,
    y: v.y * cos + kv.y * sin + k.y * kdv,
    z: v.z * cos + kv.z * sin + k.z * kdv,
  }
}

function clampFov(fov: number): number {
  if (!Number.isFinite(fov)) return MAX_FOV
  return Math.min(MAX_FOV, Math.max(MIN_FOV, fov))
}

function clampDragged(view: SkyView): SkyView {
  return {
    centerAltDeg: Math.min(90, Math.max(-30, view.centerAltDeg)),
    centerAzDeg: ((view.centerAzDeg % 360) + 360) % 360,
    fovDeg: clampFov(view.fovDeg),
  }
}

/**
 * The view after dragging from `start` to `current`, with the sky stuck to the
 * pointer: the patch of sky grabbed at the start stays under the finger.
 *
 * The first pass is the honest rigid rotation, the one that takes the sky under
 * the pointer back to where it was grabbed. Because the dome is always drawn
 * upright (screen up points at the zenith) that rotation also changes the roll,
 * so the patch slides a few pixels; re-applying the correction converges on the
 * view where it really is under the pointer. Near the zenith no such view exists
 * (the zenith is always straight up from the centre), so a pass is kept only
 * when it measurably improves things and the rigid rotation stands otherwise.
 *
 * `frame` is the frame of `start.view`: a whole drag is measured from where it
 * began, so it never accumulates rounding.
 */
export function dragToView(
  start: { x: number; y: number; view: SkyView },
  current: { x: number; y: number },
  frame: ViewFrame,
  width: number,
  height: number,
): SkyView {
  const grabbedAltAz = unproject(start.x, start.y, frame, width, height)
  const startView = clampDragged(start.view)
  if (!grabbedAltAz) return startView
  const grabbed = altAzToVec(grabbedAltAz.altDeg, grabbedAltAz.azDeg)

  const step = (view: SkyView, viewFrame: ViewFrame): SkyView | null => {
    const under = unproject(current.x, current.y, viewFrame, width, height)
    if (!under) return null
    const center = altAzToVec(view.centerAltDeg, view.centerAzDeg)
    const rotated = rotateBetween(center, altAzToVec(under.altDeg, under.azDeg), grabbed)
    if (!rotated) return null
    const aa = vecToAltAz(rotated)
    return clampDragged({ centerAltDeg: aa.altDeg, centerAzDeg: aa.azDeg, fovDeg: view.fovDeg })
  }

  /** How far the grabbed patch ends up from the pointer, in pixels. */
  const residual = (view: SkyView): number => {
    const landed = project(grabbed, makeFrame(view, width, height), width, height)
    return landed ? Math.hypot(landed.x - current.x, landed.y - current.y) : Number.POSITIVE_INFINITY
  }

  let view = step(startView, frame)
  if (!view) return startView
  let best = residual(view)
  for (let pass = 1; pass < MAX_DRAG_PASSES; pass++) {
    if (best < DRAG_EPSILON_PX) break
    const candidate = step(view, makeFrame(view, width, height))
    if (!candidate) break
    const distance = residual(candidate)
    if (!(distance < best - DRAG_EPSILON_PX)) break
    view = candidate
    best = distance
  }
  return view
}

/**
 * Exponential zoom, so every wheel notch feels the same however far in you are.
 * Wheel up (negative deltaY) narrows the field; the result is always inside the
 * range the projection can draw.
 */
export function wheelToFov(fov: number, deltaY: number): number {
  const base = Number.isFinite(fov) ? fov : MAX_FOV
  const delta = Number.isFinite(deltaY) ? deltaY : 0
  return clampFov(base * Math.exp(delta * ZOOM_RATE))
}
