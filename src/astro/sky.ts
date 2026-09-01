import { MakeTime, Observer, Rotation_EQJ_HOR } from 'astronomy-engine'
import type { RotationMatrix } from 'astronomy-engine'

/**
 * Stereographic "dome" projection for the sky map.
 *
 * Everything here is pure and headless: no canvas, no React, no store. The
 * renderer feeds it a view plus a canvas size and gets pixel coordinates back.
 *
 * Vector convention used across the whole app: x = East, y = North, z = Up.
 * astronomy-engine's HOR frame is different (x = North, y = West, z = Zenith),
 * so `eqjToHorizontalVec` converts with { x: -v.y, y: v.x, z: v.z }.
 */

/**
 * Local copy of the shared `AltAz` shape (also declared in src/astro/targets.ts).
 * Kept structurally identical so the two can be used interchangeably.
 */
export interface AltAz {
  /** Altitude above the horizon in degrees, [-90, 90]. */
  altDeg: number
  /** Azimuth in degrees clockwise from north, [0, 360). */
  azDeg: number
}

/**
 * Local copy of the observer coordinates shape (also declared in src/state/types.ts
 * as part of `Site`). Structurally identical so either can be passed in.
 */
export interface SiteCoords {
  /** Decimal degrees, north positive. */
  latitude: number
  /** Decimal degrees, EAST positive. */
  longitude: number
  elevationM: number
  /** IANA zone, or null when unknown. Not used by the projection. */
  timeZone: string | null
}

export interface SkyView {
  centerAltDeg: number
  centerAzDeg: number
  fovDeg: number
}

/** Whole sky: zenith centered, horizon just inside the inscribed circle. */
export const DOME_VIEW: SkyView = { centerAltDeg: 90, centerAzDeg: 0, fovDeg: 186 }
export const MIN_FOV = 4
export const MAX_FOV = 186

/** Unit direction in the local horizontal frame: x = East, y = North, z = Up. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Frame of reference for one view in one canvas. */
export interface ViewFrame {
  /** Direction the view looks at. */
  center: Vec3
  /** Screen "up" (toward the zenith; toward North when centered on the zenith). */
  up: Vec3
  /** Screen "right" = center x up, which puts EAST on the LEFT. */
  right: Vec3
  /** Pixel scale of the stereographic projection. */
  scale: number
}

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
/** Points farther than this from the view center do not project. */
const MAX_ANGLE_DEG = 179
const MIN_COS = Math.cos(MAX_ANGLE_DEG * DEG)
/** Above this altitude the "toward the zenith" up vector degenerates. */
const ZENITH_LOCK_DEG = 89.999

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

function normalize(v: Vec3): Vec3 {
  const len = length(v)
  if (!(len > 0)) return { x: 0, y: 0, z: 1 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

/** Normalizes a bearing into [0, 360). */
function normalizeAz(azDeg: number): number {
  return ((azDeg % 360) + 360) % 360
}

export function altAzToVec(altDeg: number, azDeg: number): Vec3 {
  const alt = altDeg * DEG
  const az = azDeg * DEG
  const cosAlt = Math.cos(alt)
  return { x: cosAlt * Math.sin(az), y: cosAlt * Math.cos(az), z: Math.sin(alt) }
}

export function vecToAltAz(v: Vec3): AltAz {
  const len = length(v)
  if (!(len > 0)) return { altDeg: 0, azDeg: 0 }
  const altDeg = Math.asin(clamp(v.z / len, -1, 1)) * RAD
  const azDeg = normalizeAz(Math.atan2(v.x, v.y) * RAD)
  return { altDeg, azDeg }
}

/** Angle between two directions in degrees, stable for both tiny and near-180 angles. */
export function angularDistanceDeg(a: Vec3, b: Vec3): number {
  const ua = normalize(a)
  const ub = normalize(b)
  const c = cross(ua, ub)
  return Math.atan2(length(c), dot(ua, ub)) * RAD
}

/**
 * Frame for a view in a canvas of w x h CSS px.
 * `up` points toward the zenith (toward North when the view is centered on the
 * zenith); `right` = center x up so EAST APPEARS ON THE LEFT, the way it does
 * when you lie down and look up. `scale` is chosen so that a point fov/2 away
 * from the center lands exactly on the inscribed circle.
 */
export function makeFrame(view: SkyView, width: number, height: number): ViewFrame {
  const v = clampView(view)
  const center = altAzToVec(v.centerAltDeg, v.centerAzDeg)
  const reference: Vec3 =
    v.centerAltDeg >= ZENITH_LOCK_DEG ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }
  const along = dot(reference, center)
  const up = normalize({
    x: reference.x - along * center.x,
    y: reference.y - along * center.y,
    z: reference.z - along * center.z,
  })
  const right = normalize(cross(center, up))
  const radiusPx = Math.min(width, height) / 2
  const scale = radiusPx / (2 * Math.tan((v.fovDeg / 4) * DEG))
  return { center, up, right, scale }
}

/**
 * Stereographic projection. Returns null when the point is more than 179
 * degrees from the center. x, y are CSS px from the top-left corner.
 */
export function project(
  v: Vec3,
  frame: ViewFrame,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const len = length(v)
  if (!(len > 0)) return null
  const px = v.x / len
  const py = v.y / len
  const pz = v.z / len
  const cosTheta = px * frame.center.x + py * frame.center.y + pz * frame.center.z
  if (cosTheta < MIN_COS) return null
  const k = (2 * frame.scale) / (1 + cosTheta)
  const alongRight = px * frame.right.x + py * frame.right.y + pz * frame.right.z
  const alongUp = px * frame.up.x + py * frame.up.y + pz * frame.up.z
  return { x: width / 2 + k * alongRight, y: height / 2 - k * alongUp }
}

/** Exact inverse of `project`. */
export function unproject(
  x: number,
  y: number,
  frame: ViewFrame,
  width: number,
  height: number,
): AltAz | null {
  const a = x - width / 2
  const b = height / 2 - y
  const s = 2 * frame.scale
  if (!(s > 0)) return null
  const rho2 = a * a + b * b
  const s2 = s * s
  const cosTheta = (s2 - rho2) / (s2 + rho2)
  if (cosTheta < MIN_COS) return null
  const f = (2 * s) / (s2 + rho2)
  const u = a * f
  const w = b * f
  return vecToAltAz({
    x: u * frame.right.x + w * frame.up.x + cosTheta * frame.center.x,
    y: u * frame.right.y + w * frame.up.y + cosTheta * frame.center.y,
    z: u * frame.right.z + w * frame.up.z + cosTheta * frame.center.z,
  })
}

/** Rotation from J2000 mean equator (EQJ) to the local horizontal frame. */
export function horizontalRotation(date: Date, site: SiteCoords): RotationMatrix {
  const observer = new Observer(site.latitude, site.longitude, site.elevationM)
  return Rotation_EQJ_HOR(MakeTime(date), observer)
}

/**
 * J2000 RA/Dec in degrees to a horizontal unit vector in our frame, using a
 * precomputed rotation. No refraction correction: this is a map, and the
 * difference stays under 0.03 degrees above the horizon.
 */
export function eqjToHorizontalVec(raDeg: number, decDeg: number, rot: RotationMatrix): Vec3 {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  const cosDec = Math.cos(dec)
  const ex = cosDec * Math.cos(ra)
  const ey = cosDec * Math.sin(ra)
  const ez = Math.sin(dec)
  const m = rot.rot
  // Same convention as astronomy-engine's RotateVector.
  const north = m[0][0] * ex + m[1][0] * ey + m[2][0] * ez
  const west = m[0][1] * ex + m[1][1] * ey + m[2][1] * ez
  const zenith = m[0][2] * ex + m[1][2] * ey + m[2][2] * ez
  // HOR is x = North, y = West, z = Zenith; ours is x = East, y = North, z = Up.
  return { x: -west, y: north, z: zenith }
}

/** Drawn radius of a star in CSS px, given its magnitude and the current fov. */
export function starRadiusPx(mag: number, fovDeg: number): number {
  const base = clamp(3.4 - 0.6 * mag, 0.35, 5.5)
  const fov = clamp(fovDeg, MIN_FOV, MAX_FOV)
  return Math.min(base * Math.sqrt(MAX_FOV / fov), 9)
}

const BV_STOPS: { bv: number; rgb: [number, number, number] }[] = [
  { bv: -0.4, rgb: [0x9d, 0xb4, 0xff] },
  { bv: 0, rgb: [0xca, 0xd8, 0xff] },
  { bv: 0.3, rgb: [0xf5, 0xf3, 0xff] },
  { bv: 0.6, rgb: [0xff, 0xf4, 0xe8] },
  { bv: 1, rgb: [0xff, 0xd9, 0xa8] },
  { bv: 1.5, rgb: [0xff, 0xbf, 0x78] },
  { bv: 2, rgb: [0xff, 0x9e, 0x5e] },
]

function hex2(n: number): string {
  return Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
}

/** Star color from the B-V index, linearly interpolated between fixed stops. */
export function bvToColor(bv: number): string {
  const stops = BV_STOPS
  if (!Number.isFinite(bv)) return '#f5f3ff'
  if (bv <= stops[0].bv) return rgbToHex(stops[0].rgb)
  const last = stops[stops.length - 1]
  if (bv >= last.bv) return rgbToHex(last.rgb)
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]
    if (bv <= b.bv) {
      const a = stops[i - 1]
      const t = (bv - a.bv) / (b.bv - a.bv)
      return rgbToHex([
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
      ])
    }
  }
  return rgbToHex(last.rgb)
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** Interpolates two views: shortest azimuth path, fov in log space. */
export function interpolateView(from: SkyView, to: SkyView, t: number): SkyView {
  if (t <= 0) return clampView(from)
  if (t >= 1) return clampView(to)
  const a = clampView(from)
  const b = clampView(to)
  const deltaAz = (((b.centerAzDeg - a.centerAzDeg + 540) % 360) - 180)
  return clampView({
    centerAltDeg: a.centerAltDeg + (b.centerAltDeg - a.centerAltDeg) * t,
    centerAzDeg: a.centerAzDeg + deltaAz * t,
    fovDeg: Math.exp(Math.log(a.fovDeg) + (Math.log(b.fovDeg) - Math.log(a.fovDeg)) * t),
  })
}

/** Keeps a view inside the ranges the renderer and the interaction code assume. */
export function clampView(view: SkyView): SkyView {
  const fov = Number.isFinite(view.fovDeg) ? clamp(view.fovDeg, MIN_FOV, MAX_FOV) : DOME_VIEW.fovDeg
  const alt = Number.isFinite(view.centerAltDeg) ? clamp(view.centerAltDeg, -30, 90) : 0
  const az = Number.isFinite(view.centerAzDeg) ? normalizeAz(view.centerAzDeg) : 0
  return { centerAltDeg: alt, centerAzDeg: az, fovDeg: fov }
}
