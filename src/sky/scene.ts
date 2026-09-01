/**
 * The scene builder: sky catalogs plus one instant plus one view, turned into
 * flat lists of pixels.
 *
 * Everything here is pure and runs in node, so the whole geometry of the dome is
 * testable without a canvas. `render.ts` only knows how to paint what this file
 * hands it, and `interaction.ts` only knows how to hit test it. The astronomy
 * lives in `src/astro/*`: this module never invents a coordinate transform of its
 * own, it calls the same helpers the tools quote their numbers from.
 *
 * The catalogs never move, so their unit vectors, colours and base radii are
 * expanded once into flat typed arrays on first use. A frame then costs one
 * rotation matrix plus about 11 700 multiply-adds, which is what keeps a drag at
 * 60 fps with 5044 stars on screen.
 */

import { Body, Equator, Horizon, Illumination } from 'astronomy-engine'
import type { Observer, RotationMatrix } from 'astronomy-engine'

import { MOON, PLANETS } from '../astro/catalog'
import { makeObserver, sunAltitudeDeg } from '../astro/night'
import { MAX_FOV, MIN_FOV, clampView, horizontalRotation, makeFrame } from '../astro/sky'
import type { SiteCoords, SkyView, ViewFrame } from '../astro/sky'
import { apparentMagnitude, targetAltAz } from '../astro/targets'
import { bvToColor } from '../astro/sky'
import { CONSTELLATIONS, MESSIER, MILKY_WAY, STAR_TUPLES } from '../data'
import type { TargetType } from '../state/types'

const DEG = Math.PI / 180
/** Beyond this angle from the view centre a point does not project at all. */
const MIN_COS = Math.cos(179 * DEG)
/** Stars and objects are kept this far outside the canvas so labels near the edge survive. */
const STAR_MARGIN_PX = 20
const OBJECT_MARGIN_PX = 40
/** Stars this far below the horizon are dropped: the horizon mask would swallow them. */
const STAR_MIN_ALT_DEG = -2
/** Solar system bodies stay in the scene a little below the horizon so they do not pop. */
const BODY_MIN_ALT_DEG = -5

export interface SceneInput {
  site: SiteCoords
  /** ISO instant in UTC. */
  timeUtc: string
  view: SkyView
  /** Canvas size in CSS pixels. */
  width: number
  height: number
  /** Faintest star to project. The vendored catalog stops at magnitude 6. */
  maxStarMag: number
}

export interface SceneStar {
  x: number
  y: number
  r: number
  color: string
  /** Proper name, or '' for the anonymous majority. */
  name: string
  mag: number
}

export interface SceneObject {
  id: string
  name: string
  kind: 'messier' | 'planet' | 'moon' | 'sun'
  type: TargetType | 'sun'
  x: number
  y: number
  r: number
  altDeg: number
  azDeg: number
  mag: number | null
  extra?: { illuminationPct?: number; phaseAngleDeg?: number }
}

/** A run of projected points; `null` breaks the line where the sphere folds over. */
export interface ScenePolyline {
  points: ({ x: number; y: number } | null)[]
}

export interface SceneConstellation {
  id: string
  name: string
  lines: ScenePolyline[]
  label: { x: number; y: number } | null
}

export interface SceneMilkyWay {
  /** 1 (faintest contour) to 5 (brightest core). */
  level: number
  polygons: ({ x: number; y: number } | null)[][]
}

export type CardinalLabel = 'N' | 'E' | 'S' | 'W' | 'NE' | 'SE' | 'SW' | 'NW'

export interface SceneCardinal {
  label: CardinalLabel
  x: number
  y: number
  visible: boolean
}

export interface Scene {
  frame: ViewFrame
  /** Geometric altitude of the Sun: drives the twilight gradient. */
  sunAltDeg: number
  /** The horizon as 360 projected points, one per degree of azimuth. */
  horizon: { x: number; y: number }[]
  cardinals: SceneCardinal[]
  milkyWay: SceneMilkyWay[]
  constellations: SceneConstellation[]
  stars: SceneStar[]
  objects: SceneObject[]
  /** Always true: everything below the horizon is dimmed, never cut away. */
  belowHorizonMask: boolean
  /** Canvas size the scene was projected for, in CSS pixels. */
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Catalog geometry, expanded once
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** J2000 RA/Dec in degrees into a unit vector, written into `out` at `offset`. */
function writeUnit(out: Float64Array, offset: number, raDeg: number, decDeg: number): void {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  const cosDec = Math.cos(dec)
  out[offset] = cosDec * Math.cos(ra)
  out[offset + 1] = cosDec * Math.sin(ra)
  out[offset + 2] = Math.sin(dec)
}

function unitsFromPairs(pairs: [number, number][]): Float64Array {
  const out = new Float64Array(pairs.length * 3)
  for (let i = 0; i < pairs.length; i++) writeUnit(out, i * 3, pairs[i][0], pairs[i][1])
  return out
}

/**
 * Star colours are quantised in steps of 0.1 in B-V. Twenty five colours instead
 * of five thousand is what lets the renderer batch a whole sky into a couple of
 * dozen fills, and no eye has ever told two neighbouring stops apart.
 */
const BV_STEP = 0.1
const colorCache = new Map<number, string>()

function quantizedColor(bv: number): string {
  const key = Math.round(clamp(Number.isFinite(bv) ? bv : 0.65, -0.4, 2) / BV_STEP)
  let color = colorCache.get(key)
  if (color === undefined) {
    color = bvToColor(key * BV_STEP)
    colorCache.set(key, color)
  }
  return color
}

interface StarGeometry {
  xyz: Float64Array
  color: string[]
  /** `starRadiusPx` without the zoom factor, precomputed. */
  baseR: Float64Array
  mag: Float64Array
  name: string[]
  count: number
}

let starGeometry: StarGeometry | null = null

function stars(): StarGeometry {
  if (starGeometry) return starGeometry
  const count = STAR_TUPLES.length
  const xyz = new Float64Array(count * 3)
  const color: string[] = new Array<string>(count)
  const baseR = new Float64Array(count)
  const mag = new Float64Array(count)
  const name: string[] = new Array<string>(count)
  for (let i = 0; i < count; i++) {
    const [ra, dec, m, bv, starName] = STAR_TUPLES[i]
    writeUnit(xyz, i * 3, ra, dec)
    color[i] = quantizedColor(bv)
    baseR[i] = clamp(3.4 - 0.6 * m, 0.35, 5.5)
    mag[i] = m
    name[i] = starName
  }
  starGeometry = { xyz, color, baseR, mag, name, count }
  return starGeometry
}

interface ConstellationGeometry {
  id: string
  name: string
  lines: Float64Array[]
  label: Float64Array
}

let constellationGeometry: ConstellationGeometry[] | null = null

function constellations(): ConstellationGeometry[] {
  if (constellationGeometry) return constellationGeometry
  constellationGeometry = CONSTELLATIONS.map((c) => ({
    id: c.id,
    name: c.name,
    lines: c.lines.map(unitsFromPairs),
    label: unitsFromPairs([[c.labelRa, c.labelDec]]),
  }))
  return constellationGeometry
}

interface MilkyWayGeometry {
  level: number
  polygons: Float64Array[]
}

let milkyWayGeometry: MilkyWayGeometry[] | null = null

function milkyWay(): MilkyWayGeometry[] {
  if (milkyWayGeometry) return milkyWayGeometry
  milkyWayGeometry = MILKY_WAY.map((level, index) => ({
    level: Number.parseInt(level.id.replace(/[^0-9]/g, ''), 10) || index + 1,
    polygons: level.polygons.map(unitsFromPairs),
  })).sort((a, b) => a.level - b.level)
  return milkyWayGeometry
}

let messierGeometry: Float64Array | null = null

function messier(): Float64Array {
  if (messierGeometry) return messierGeometry
  const out = new Float64Array(MESSIER.length * 3)
  for (let i = 0; i < MESSIER.length; i++) writeUnit(out, i * 3, MESSIER[i].ra, MESSIER[i].dec)
  messierGeometry = out
  return messierGeometry
}

/**
 * The id a tapped star reports, identical to the ids of `src/astro/catalog.ts`
 * ('Rigil Kentaurus' -> 'star:rigil-kentaurus').
 */
export function starIdForName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ /g, '-')
  return `star:${slug}`
}

// ---------------------------------------------------------------------------
// Per instant caches
// ---------------------------------------------------------------------------

function siteKey(site: SiteCoords): string {
  return `${site.latitude}|${site.longitude}|${site.elevationM}`
}

let lastObserver: { key: string; observer: Observer } | null = null

function observerFor(site: SiteCoords): Observer {
  const key = siteKey(site)
  if (lastObserver && lastObserver.key === key) return lastObserver.observer
  const observer = makeObserver(site)
  lastObserver = { key, observer }
  return observer
}

let lastRotation: { key: string; rot: Float64Array } | null = null

/**
 * The EQJ to horizontal rotation, flattened into our frame (x = East, y = North,
 * z = Up) so the hot loops are nine multiply-adds and no property lookups.
 * astronomy-engine's HOR frame is x = North, y = West, z = Zenith.
 */
function horizonMatrix(date: Date, site: SiteCoords): Float64Array {
  const key = `${date.getTime()}|${siteKey(site)}`
  if (lastRotation && lastRotation.key === key) return lastRotation.rot
  const rot: RotationMatrix = horizontalRotation(date, site)
  const m = rot.rot
  const flat = new Float64Array([
    -m[0][1],
    -m[1][1],
    -m[2][1], // East = -West
    m[0][0],
    m[1][0],
    m[2][0], // North
    m[0][2],
    m[1][2],
    m[2][2], // Up = Zenith
  ])
  lastRotation = { key, rot: flat }
  return flat
}

interface BodySample {
  id: string
  name: string
  kind: 'planet' | 'moon' | 'sun'
  type: TargetType | 'sun'
  altDeg: number
  azDeg: number
  mag: number | null
  extra?: { illuminationPct?: number; phaseAngleDeg?: number }
}

interface BodiesSample {
  sunAltDeg: number
  bodies: BodySample[]
}

const bodiesCache = new Map<string, BodiesSample>()
const BODIES_CACHE_LIMIT = 32

/**
 * Sun, Moon and planets for one instant. Dragging the map does not move them, so
 * the whole solar system is computed once per time step and reused frame after
 * frame.
 */
function bodiesAt(date: Date, site: SiteCoords): BodiesSample {
  const key = `${date.getTime()}|${siteKey(site)}`
  const hit = bodiesCache.get(key)
  if (hit) return hit

  const observer = observerFor(site)
  const sunAltDeg = sunAltitudeDeg(date, observer)
  const sunEq = Equator(Body.Sun, date, observer, true, true)
  // No refraction argument: the geometric altitude, the same one `sunAltitudeDeg`
  // returns, so the twilight gradient and the Sun glyph never disagree.
  const sunHor = Horizon(date, observer, sunEq.ra, sunEq.dec)

  const bodies: BodySample[] = [
    {
      id: 'sun',
      name: 'Sun',
      kind: 'sun',
      type: 'sun',
      altDeg: sunAltDeg,
      azDeg: ((sunHor.azimuth % 360) + 360) % 360,
      mag: -26.7,
    },
  ]

  const moonPos = targetAltAz(MOON, date, site)
  const moonLight = Illumination(Body.Moon, date)
  bodies.push({
    id: MOON.id,
    name: MOON.name,
    kind: 'moon',
    type: 'moon',
    altDeg: moonPos.altDeg,
    azDeg: moonPos.azDeg,
    mag: moonLight.mag,
    extra: {
      illuminationPct: moonLight.phase_fraction * 100,
      phaseAngleDeg: moonLight.phase_angle,
    },
  })

  for (const planet of PLANETS) {
    const pos = targetAltAz(planet, date, site)
    bodies.push({
      id: planet.id,
      name: planet.name,
      kind: 'planet',
      type: 'planet',
      altDeg: pos.altDeg,
      azDeg: pos.azDeg,
      mag: apparentMagnitude(planet, date),
    })
  }

  const sample: BodiesSample = { sunAltDeg, bodies }
  bodiesCache.set(key, sample)
  while (bodiesCache.size > BODIES_CACHE_LIMIT) {
    const oldest = bodiesCache.keys().next().value
    if (oldest === undefined) break
    bodiesCache.delete(oldest)
  }
  return sample
}

/** Drops every per instant cache. Tests and site changes use it. */
export function clearSceneCaches(): void {
  bodiesCache.clear()
  lastRotation = null
  lastObserver = null
}

// ---------------------------------------------------------------------------
// Projection, inlined
// ---------------------------------------------------------------------------

/** Everything one frame needs to turn a unit vector into a pixel, in flat fields. */
interface Projector {
  cx: number
  cy: number
  cz: number
  ux: number
  uy: number
  uz: number
  rx: number
  ry: number
  rz: number
  twoScale: number
  halfW: number
  halfH: number
  /** Projected points farther than this from the canvas centre are pulled in. */
  maxRadius: number
}

function projectorFor(frame: ViewFrame, width: number, height: number): Projector {
  return {
    cx: frame.center.x,
    cy: frame.center.y,
    cz: frame.center.z,
    ux: frame.up.x,
    uy: frame.up.y,
    uz: frame.up.z,
    rx: frame.right.x,
    ry: frame.right.y,
    rz: frame.right.z,
    twoScale: 2 * frame.scale,
    halfW: width / 2,
    halfH: height / 2,
    maxRadius: 6 * Math.max(width, height),
  }
}

// Output of the projection, reused so the hot loops allocate nothing.
let outX = 0
let outY = 0

/** Projects a unit vector. Returns false when it is behind the projection pole. */
function projectUnit(p: Projector, x: number, y: number, z: number): boolean {
  const cosTheta = x * p.cx + y * p.cy + z * p.cz
  if (cosTheta < MIN_COS) return false
  const k = p.twoScale / (1 + cosTheta)
  outX = p.halfW + k * (x * p.rx + y * p.ry + z * p.rz)
  outY = p.halfH - k * (x * p.ux + y * p.uy + z * p.uz)
  return true
}

/**
 * Same projection, but points far below the horizon (where the stereographic
 * radius runs away to millions of pixels) are pulled back to a sane distance.
 * Only used for the bulk geometry that gets clipped to the horizon anyway, so
 * nothing visible moves; canvas paths just stay in a range it renders well.
 */
function projectUnitClamped(p: Projector, x: number, y: number, z: number): boolean {
  if (!projectUnit(p, x, y, z)) return false
  const dx = outX - p.halfW
  const dy = outY - p.halfH
  const radius = Math.hypot(dx, dy)
  if (radius > p.maxRadius) {
    const factor = p.maxRadius / radius
    outX = p.halfW + dx * factor
    outY = p.halfH + dy * factor
  }
  return true
}

function inBounds(x: number, y: number, width: number, height: number, margin: number): boolean {
  return x >= -margin && x <= width + margin && y >= -margin && y <= height + margin
}

// ---------------------------------------------------------------------------
// Object sizes
// ---------------------------------------------------------------------------

/** How much glyphs grow as the view narrows. Capped so a 4 degree field is usable. */
function glyphZoom(fovDeg: number): number {
  return clamp(Math.sqrt(MAX_FOV / clamp(fovDeg, MIN_FOV, MAX_FOV)), 1, 3)
}

function messierRadius(sizeArcmin: number | null, zoom: number): number {
  return clamp(3 + (sizeArcmin ?? 0) / 40, 3, 9) * zoom
}

function planetRadius(mag: number | null, zoom: number): number {
  const base = clamp(5.2 - 0.55 * (mag ?? 3), 3.5, 6)
  return base * clamp(zoom, 1, 2)
}

function lunarRadius(zoom: number): number {
  return Math.max(9 * zoom, 6)
}

const CARDINALS: { label: CardinalLabel; azDeg: number }[] = [
  { label: 'N', azDeg: 0 },
  { label: 'NE', azDeg: 45 },
  { label: 'E', azDeg: 90 },
  { label: 'SE', azDeg: 135 },
  { label: 'S', azDeg: 180 },
  { label: 'SW', azDeg: 225 },
  { label: 'W', azDeg: 270 },
  { label: 'NW', azDeg: 315 },
]

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Projects the whole sky for one instant and one view. Roughly 11 700 points,
 * culled to the canvas with a small margin.
 */
export function buildScene(input: SceneInput): Scene {
  const width = Math.max(1, input.width)
  const height = Math.max(1, input.height)
  const view = clampView(input.view)
  const frame = makeFrame(view, width, height)
  const projector = projectorFor(frame, width, height)
  const date = new Date(input.timeUtc)
  const at = Number.isNaN(date.getTime()) ? new Date() : date
  const rot = horizonMatrix(at, input.site)
  const zoom = glyphZoom(view.fovDeg)

  // --- horizon and cardinals (in horizontal coordinates already) ---
  const horizon: { x: number; y: number }[] = []
  for (let az = 0; az < 360; az++) {
    const a = az * DEG
    if (projectUnitClamped(projector, Math.sin(a), Math.cos(a), 0)) {
      horizon.push({ x: outX, y: outY })
    }
  }

  const cardinals: SceneCardinal[] = CARDINALS.map(({ label, azDeg }) => {
    const a = azDeg * DEG
    const ok = projectUnit(projector, Math.sin(a), Math.cos(a), 0)
    return {
      label,
      x: ok ? outX : 0,
      y: ok ? outY : 0,
      visible: ok && inBounds(outX, outY, width, height, 0),
    }
  })

  // --- Milky Way ---
  const milkyWayScene: SceneMilkyWay[] = milkyWay().map((level) => ({
    level: level.level,
    polygons: level.polygons.map((poly) => {
      const points: ({ x: number; y: number } | null)[] = []
      for (let i = 0; i < poly.length; i += 3) {
        const ex = poly[i]
        const ey = poly[i + 1]
        const ez = poly[i + 2]
        const x = rot[0] * ex + rot[1] * ey + rot[2] * ez
        const y = rot[3] * ex + rot[4] * ey + rot[5] * ez
        const z = rot[6] * ex + rot[7] * ey + rot[8] * ez
        points.push(projectUnitClamped(projector, x, y, z) ? { x: outX, y: outY } : null)
      }
      return points
    }),
  }))

  // --- constellations ---
  const constellationScene: SceneConstellation[] = constellations().map((c) => {
    const lines: ScenePolyline[] = c.lines.map((line) => {
      const points: ({ x: number; y: number } | null)[] = []
      for (let i = 0; i < line.length; i += 3) {
        const ex = line[i]
        const ey = line[i + 1]
        const ez = line[i + 2]
        const x = rot[0] * ex + rot[1] * ey + rot[2] * ez
        const y = rot[3] * ex + rot[4] * ey + rot[5] * ez
        const z = rot[6] * ex + rot[7] * ey + rot[8] * ez
        points.push(projectUnitClamped(projector, x, y, z) ? { x: outX, y: outY } : null)
      }
      return { points }
    })
    const lx = rot[0] * c.label[0] + rot[1] * c.label[1] + rot[2] * c.label[2]
    const ly = rot[3] * c.label[0] + rot[4] * c.label[1] + rot[5] * c.label[2]
    const lz = rot[6] * c.label[0] + rot[7] * c.label[1] + rot[8] * c.label[2]
    const labelUp = lz > 0 && projectUnit(projector, lx, ly, lz)
    return {
      id: c.id,
      name: c.name,
      lines,
      label: labelUp && inBounds(outX, outY, width, height, 0) ? { x: outX, y: outY } : null,
    }
  })

  // --- stars ---
  const geometry = stars()
  const radiusFactor = Math.sqrt(MAX_FOV / clamp(view.fovDeg, MIN_FOV, MAX_FOV))
  const minZ = Math.sin(STAR_MIN_ALT_DEG * DEG)
  const maxMag = input.maxStarMag
  const starScene: SceneStar[] = []
  for (let i = 0; i < geometry.count; i++) {
    // The catalog is sorted brightest first, so the cut ends the loop.
    if (geometry.mag[i] > maxMag) break
    const o = i * 3
    const ex = geometry.xyz[o]
    const ey = geometry.xyz[o + 1]
    const ez = geometry.xyz[o + 2]
    const z = rot[6] * ex + rot[7] * ey + rot[8] * ez
    if (z < minZ) continue
    const x = rot[0] * ex + rot[1] * ey + rot[2] * ez
    const y = rot[3] * ex + rot[4] * ey + rot[5] * ez
    if (!projectUnit(projector, x, y, z)) continue
    if (!inBounds(outX, outY, width, height, STAR_MARGIN_PX)) continue
    starScene.push({
      x: outX,
      y: outY,
      r: Math.min(geometry.baseR[i] * radiusFactor, 9),
      color: geometry.color[i],
      name: geometry.name[i],
      mag: geometry.mag[i],
    })
  }

  // --- deep sky objects ---
  const messierXyz = messier()
  const objects: SceneObject[] = []
  for (let i = 0; i < MESSIER.length; i++) {
    const o = i * 3
    const ex = messierXyz[o]
    const ey = messierXyz[o + 1]
    const ez = messierXyz[o + 2]
    const z = rot[6] * ex + rot[7] * ey + rot[8] * ez
    if (z < 0) continue
    const x = rot[0] * ex + rot[1] * ey + rot[2] * ez
    const y = rot[3] * ex + rot[4] * ey + rot[5] * ez
    if (!projectUnit(projector, x, y, z)) continue
    if (!inBounds(outX, outY, width, height, OBJECT_MARGIN_PX)) continue
    const record = MESSIER[i]
    objects.push({
      id: record.id,
      name: record.name || record.id,
      kind: 'messier',
      type: record.type,
      x: outX,
      y: outY,
      r: messierRadius(record.sizeArcmin, zoom),
      altDeg: Math.asin(clamp(z, -1, 1)) / DEG,
      azDeg: ((Math.atan2(x, y) / DEG) % 360 + 360) % 360,
      mag: record.mag,
      extra: undefined,
    })
  }

  // --- Sun, Moon, planets ---
  const sample = bodiesAt(at, input.site)
  for (const body of sample.bodies) {
    const alt = body.altDeg * DEG
    const az = body.azDeg * DEG
    const cosAlt = Math.cos(alt)
    const x = cosAlt * Math.sin(az)
    const y = cosAlt * Math.cos(az)
    const z = Math.sin(alt)
    const isSun = body.kind === 'sun'
    // The Sun always stays in the scene, wherever it is: the Moon's terminator has
    // to face it even when the Sun itself is nowhere near the canvas.
    if (!isSun && body.altDeg < BODY_MIN_ALT_DEG) continue
    if (!(isSun ? projectUnitClamped(projector, x, y, z) : projectUnit(projector, x, y, z))) continue
    if (!isSun && !inBounds(outX, outY, width, height, OBJECT_MARGIN_PX)) continue
    objects.push({
      id: body.id,
      name: body.name,
      kind: body.kind,
      type: body.type,
      x: outX,
      y: outY,
      r:
        body.kind === 'planet'
          ? planetRadius(body.mag, zoom)
          : lunarRadius(zoom),
      altDeg: body.altDeg,
      azDeg: body.azDeg,
      mag: body.mag,
      extra: body.extra,
    })
  }

  return {
    frame,
    sunAltDeg: sample.sunAltDeg,
    horizon,
    cardinals,
    milkyWay: milkyWayScene,
    constellations: constellationScene,
    stars: starScene,
    objects,
    belowHorizonMask: true,
    width,
    height,
  }
}
