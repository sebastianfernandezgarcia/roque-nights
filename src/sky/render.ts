/**
 * Painting the dome.
 *
 * One function, `renderSky`, turns a built `Scene` into a frame. It owns no
 * state and does no astronomy: give it the same scene twice and you get the same
 * pixels twice. The order below is the order light reaches an observer's eye,
 * from the glow of the sky itself up to the instrument marks laid over it, and
 * it is deliberate: the horizon mask goes on AFTER the stars, so the sky fades
 * into the ground instead of being cut out of it.
 *
 * Everything is drawn in CSS pixels; the device pixel ratio is applied once as a
 * transform at the top.
 */

import { MAX_FOV } from '../astro/sky'
import { starIdForName } from './scene'
import type { Scene, SceneObject, SceneStar } from './scene'

const TAU = Math.PI * 2

// Control room palette. Same values as the Tailwind theme in src/index.css.
const ABYSS = '#05060A'
const AMBER = '#FFB454'
const SIGNAL = '#FF5C4D'
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

export interface RenderStyle {
  /** Red light mode. It tints the instrument marks, never the sky itself. */
  nightMode: boolean
  /** Device pixel ratio the canvas backing store was sized with (cap it at 2). */
  dpr: number
  selectedId: string | null
  /** Objects the agent asked to highlight. */
  highlightedIds: Set<string>
  favoriteIds: Set<string>
  /** Target id to its 1-based position in the committed plan. */
  planIds: Map<string, number>
  /** Targets of a pending (ghost) proposal. */
  proposedIds: Set<string>
  showConstellationNames: boolean
  showLabels: boolean
  /** 0 to 1: the agent's "look here" ripple. Nothing is drawn at 1. */
  reticlePulse: number
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * The colour of the sky at the zenith and at the horizon for a given solar
 * altitude: astronomical night, the three twilights, and full day.
 */
const SKY_STOPS: { alt: number; zenith: string; horizon: string }[] = [
  { alt: -18, zenith: '#05060a', horizon: '#0a0d16' },
  { alt: -12, zenith: '#0b1020', horizon: '#1b2440' },
  { alt: -6, zenith: '#16203c', horizon: '#3a3f5c' },
  { alt: 0, zenith: '#2b4a7a', horizon: '#a8683c' },
  { alt: 6, zenith: '#6e8bb8', horizon: '#a8bcd8' },
]

export interface SkyPalette {
  zenith: [number, number, number]
  horizon: [number, number, number]
}

export function skyPalette(sunAltDeg: number): SkyPalette {
  const alt = Number.isFinite(sunAltDeg) ? sunAltDeg : -90
  const first = SKY_STOPS[0]
  const last = SKY_STOPS[SKY_STOPS.length - 1]
  if (alt <= first.alt) return { zenith: hexToRgb(first.zenith), horizon: hexToRgb(first.horizon) }
  if (alt >= last.alt) return { zenith: hexToRgb(last.zenith), horizon: hexToRgb(last.horizon) }
  for (let i = 1; i < SKY_STOPS.length; i++) {
    const b = SKY_STOPS[i]
    if (alt <= b.alt) {
      const a = SKY_STOPS[i - 1]
      const t = (alt - a.alt) / (b.alt - a.alt)
      return {
        zenith: mix(hexToRgb(a.zenith), hexToRgb(b.zenith), t),
        horizon: mix(hexToRgb(a.horizon), hexToRgb(b.horizon), t),
      }
    }
  }
  return { zenith: hexToRgb(last.zenith), horizon: hexToRgb(last.horizon) }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** The horizon as a closed path, or null when too little of it projected. */
function horizonPath(scene: Scene): Path2D | null {
  if (scene.horizon.length < 3) return null
  const path = new Path2D()
  path.moveTo(scene.horizon[0].x, scene.horizon[0].y)
  for (let i = 1; i < scene.horizon.length; i++) path.lineTo(scene.horizon[i].x, scene.horizon[i].y)
  path.closePath()
  return path
}

/**
 * True when the sky is the region inside the projected horizon. It is the region
 * outside once the view centre drops below the horizon.
 */
function skyIsInside(scene: Scene): boolean {
  return scene.frame.center.z >= 0
}

function clipToSky(ctx: CanvasRenderingContext2D, scene: Scene, path: Path2D): void {
  if (skyIsInside(scene)) {
    ctx.clip(path, 'nonzero')
    return
  }
  const outside = new Path2D()
  outside.rect(0, 0, scene.width, scene.height)
  outside.addPath(path)
  ctx.clip(outside, 'evenodd')
}

/** Field of view of the scene, recovered from the projection scale. */
export function sceneFovDeg(scene: Scene): number {
  const radius = Math.min(scene.width, scene.height) / 2
  const fov = (4 * Math.atan(radius / (2 * scene.frame.scale)) * 180) / Math.PI
  return Number.isFinite(fov) ? clamp(fov, 0.1, MAX_FOV) : MAX_FOV
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** Where the zenith lands on screen, for the dome gradient. */
function projectZenith(scene: Scene): { x: number; y: number } {
  const { center, up, right, scale } = scene.frame
  const cosTheta = center.z
  if (cosTheta < -0.999) return { x: scene.width / 2, y: scene.height / 2 }
  const k = (2 * scale) / (1 + cosTheta)
  const limit = Math.hypot(scene.width, scene.height)
  return {
    x: clamp(scene.width / 2 + k * right.z, -limit, scene.width + limit),
    y: clamp(scene.height / 2 - k * up.z, -limit, scene.height + limit),
  }
}

function drawSky(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { width, height } = scene
  const palette = skyPalette(scene.sunAltDeg)
  ctx.fillStyle = rgba(palette.horizon, 1)
  ctx.fillRect(0, 0, width, height)

  // The gradient is anchored on the zenith, so the dome reads as a dome however
  // the view is turned.
  const zenith = projectZenith(scene)
  const cx = zenith.x
  const cy = zenith.y
  const radius = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(width - cx, cy),
    Math.hypot(cx, height - cy),
    Math.hypot(width - cx, height - cy),
  )
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  gradient.addColorStop(0, rgba(palette.zenith, 1))
  gradient.addColorStop(0.55, rgba(mix(palette.zenith, palette.horizon, 0.45), 1))
  gradient.addColorStop(1, rgba(palette.horizon, 1))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

/**
 * The Sun's glow spilling over the horizon during twilight. Nothing is drawn once
 * the Sun is deeper than 18 degrees down: that is what astronomical night means.
 */
function drawTwilightGlow(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const sun = scene.objects.find((o) => o.kind === 'sun')
  if (!sun) return
  if (scene.sunAltDeg <= -18) return
  const strength = scene.sunAltDeg >= 0 ? 1 : (18 + scene.sunAltDeg) / 18
  const radius = Math.min(scene.width, scene.height) * (0.35 + 0.25 * strength)
  const gradient = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, radius)
  gradient.addColorStop(0, `rgba(255, 176, 96, ${0.42 * strength})`)
  gradient.addColorStop(0.45, `rgba(255, 128, 64, ${0.16 * strength})`)
  gradient.addColorStop(1, 'rgba(255, 110, 60, 0)')
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, scene.width, scene.height)
  ctx.restore()
}

function drawMilkyWay(ctx: CanvasRenderingContext2D, scene: Scene, horizon: Path2D | null): void {
  ctx.save()
  if (horizon) clipToSky(ctx, scene, horizon)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineJoin = 'round'
  // The catalog gives five nested contours; drawn crisp they read as a contour
  // map, not as a galaxy. The two wide strokes below are what turn them back
  // into light. A canvas `filter: blur()` over the whole layer did the same job
  // twice and cost more than every other layer of the frame put together.
  for (const level of scene.milkyWay) {
    const path = new Path2D()
    let drew = false
    for (const polygon of level.polygons) {
      let started = false
      for (const point of polygon) {
        if (!point) {
          started = false
          continue
        }
        if (!started) {
          path.moveTo(point.x, point.y)
          started = true
        } else {
          path.lineTo(point.x, point.y)
        }
        drew = true
      }
      path.closePath()
    }
    if (!drew) continue
    const alpha = 0.024 * level.level
    ctx.fillStyle = `rgba(198, 206, 240, ${alpha})`
    ctx.fill(path)
    // Two wide, fainter strokes feather the contour. A real blur filter would
    // cost more than the whole frame; two strokes of the same path cost nothing
    // and the band stops looking like a map of an island.
    ctx.strokeStyle = `rgba(198, 206, 240, ${alpha * 0.45})`
    ctx.lineWidth = 6
    ctx.stroke(path)
    ctx.strokeStyle = `rgba(198, 206, 240, ${alpha * 0.22})`
    ctx.lineWidth = 16
    ctx.stroke(path)
  }
  ctx.restore()
}

function drawConstellations(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const path = new Path2D()
  // A segment longer than the canvas means the two ends are on opposite sides of
  // the projection: never join them.
  const maxSegment = Math.max(scene.width, scene.height) * 1.5
  for (const constellation of scene.constellations) {
    for (const line of constellation.lines) {
      let previous: { x: number; y: number } | null = null
      for (const point of line.points) {
        if (!point) {
          previous = null
          continue
        }
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < maxSegment) {
          path.lineTo(point.x, point.y)
        } else {
          path.moveTo(point.x, point.y)
        }
        previous = point
      }
    }
  }
  ctx.strokeStyle = 'rgba(255, 180, 84, 0.18)'
  ctx.lineWidth = 1
  ctx.stroke(path)
}

/**
 * Constellation names, LAST in the label queue.
 *
 * They are context, not data: an object the agent pointed at, a plan stop or a
 * Messier id must never lose its name to the word CYGNUS. Sharing the placer
 * with `drawObjects` and running after it is what makes that a rule rather than
 * a hope, so a colliding name is simply dropped.
 */
function drawConstellationNames(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  style: RenderStyle,
  fovDeg: number,
  place: LabelPlacer,
): void {
  if (!style.showConstellationNames || fovDeg > 120) return
  ctx.fillStyle = 'rgba(255, 180, 84, 0.35)'
  ctx.font = `10px ${MONO}`
  for (const constellation of scene.constellations) {
    const label = constellation.label
    if (!label) continue
    const text = constellation.name.toUpperCase()
    // The placer works from the left edge of the text; these are centred.
    place(text, label.x - ctx.measureText(text).width / 2, label.y, false)
  }
}

/** Stars, batched by colour: one path and one fill for every colour on screen. */
function drawStars(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  style: RenderStyle,
  fovDeg: number,
): void {
  const batches = new Map<string, Path2D>()
  const bright: SceneStar[] = []
  for (const star of scene.stars) {
    let path = batches.get(star.color)
    if (!path) {
      path = new Path2D()
      batches.set(star.color, path)
    }
    if (star.r < 0.8) {
      const size = star.r * 2
      path.rect(star.x - star.r, star.y - star.r, size, size)
    } else {
      path.moveTo(star.x + star.r, star.y)
      path.arc(star.x, star.y, star.r, 0, TAU)
    }
    if (star.mag <= 1.5) bright.push(star)
  }
  for (const [color, path] of batches) {
    ctx.fillStyle = color
    ctx.fill(path)
  }

  // The two dozen brightest stars carry a soft halo. It is what makes a canvas
  // read as a sky rather than as a scatter plot.
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const star of bright) {
    const radius = star.r * 3.2
    const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, radius)
    const rgb = hexToRgb(star.color)
    glow.addColorStop(0, rgba(rgb, 0.28))
    glow.addColorStop(0.4, rgba(rgb, 0.1))
    glow.addColorStop(1, rgba(rgb, 0))
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(star.x, star.y, radius, 0, TAU)
    ctx.fill()
  }
  ctx.restore()

  if (!style.showLabels) return
  const magLimit = fovDeg <= 30 ? 6 : fovDeg <= 90 ? 2 : -99
  if (magLimit < -90) return
  ctx.fillStyle = 'rgba(214, 221, 236, 0.55)'
  ctx.font = `10px ${MONO}`
  for (const star of scene.stars) {
    if (star.name === '' || star.mag > magLimit) continue
    ctx.fillText(star.name, star.x + star.r + 4, star.y - star.r - 3)
  }
}

/** One glyph per class of object, the way a paper atlas does it. */
function drawMessierGlyph(
  ctx: CanvasRenderingContext2D,
  object: SceneObject,
  alpha: number,
): void {
  const { x, y, r } = object
  ctx.strokeStyle = `rgba(255, 180, 84, ${alpha})`
  ctx.lineWidth = 1.2
  ctx.beginPath()
  switch (object.type) {
    case 'galaxy':
      ctx.ellipse(x, y, r, r * 0.52, -0.5, 0, TAU)
      ctx.stroke()
      break
    case 'open_cluster':
      ctx.setLineDash([2, 3])
      ctx.arc(x, y, r, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      break
    case 'globular_cluster':
      ctx.arc(x, y, r, 0, TAU)
      ctx.moveTo(x - r, y)
      ctx.lineTo(x + r, y)
      ctx.moveTo(x, y - r)
      ctx.lineTo(x, y + r)
      ctx.stroke()
      break
    case 'planetary_nebula':
      ctx.arc(x, y, r * 0.7, 0, TAU)
      ctx.moveTo(x - r - 2, y)
      ctx.lineTo(x - r * 0.7, y)
      ctx.moveTo(x + r * 0.7, y)
      ctx.lineTo(x + r + 2, y)
      ctx.moveTo(x, y - r - 2)
      ctx.lineTo(x, y - r * 0.7)
      ctx.moveTo(x, y + r * 0.7)
      ctx.lineTo(x, y + r + 2)
      ctx.stroke()
      break
    case 'diffuse_nebula':
      ctx.rect(x - r, y - r, r * 2, r * 2)
      ctx.stroke()
      break
    case 'supernova_remnant':
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r, y)
      ctx.closePath()
      ctx.stroke()
      break
    default:
      ctx.arc(x, y, r * 0.6, 0, TAU)
      ctx.stroke()
  }
}

const PLANET_COLORS: Record<string, string> = {
  mercury: '#c9c2b8',
  venus: '#fff1c9',
  mars: '#ff8f66',
  jupiter: '#f3d3a5',
  saturn: '#f0e0b5',
  uranus: '#a9e5e8',
  neptune: '#7fa4ff',
}

function drawPlanet(ctx: CanvasRenderingContext2D, object: SceneObject): void {
  const color = PLANET_COLORS[object.id] ?? '#e6e9f0'
  const rgb = hexToRgb(color)
  const glow = ctx.createRadialGradient(object.x, object.y, 0, object.x, object.y, object.r * 3.4)
  glow.addColorStop(0, rgba(rgb, 0.3))
  glow.addColorStop(1, rgba(rgb, 0))
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(object.x, object.y, object.r * 3.4, 0, TAU)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(object.x, object.y, object.r, 0, TAU)
  ctx.fill()

  // Venus and Jupiter are the two that visibly blaze to the naked eye.
  if (object.id === 'venus' || object.id === 'jupiter') {
    const spike = object.r * 3.6
    ctx.strokeStyle = rgba(rgb, 0.55)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(object.x - spike, object.y)
    ctx.lineTo(object.x + spike, object.y)
    ctx.moveTo(object.x, object.y - spike)
    ctx.lineTo(object.x, object.y + spike)
    ctx.stroke()
  }
}

/**
 * The Moon, drawn as the shape it actually is tonight: a disc for the dark limb,
 * the lit fraction bounded by a terminator ellipse, and a halo that grows with
 * the illumination because a gibbous Moon is what ruins a night of observing.
 */
function drawMoon(ctx: CanvasRenderingContext2D, object: SceneObject, sun: SceneObject | null): void {
  const r = object.r
  const illumination = clamp((object.extra?.illuminationPct ?? 50) / 100, 0, 1)

  const haloRadius = r * (2 + 4 * illumination)
  const halo = ctx.createRadialGradient(object.x, object.y, r * 0.6, object.x, object.y, haloRadius)
  halo.addColorStop(0, `rgba(244, 239, 230, ${0.25 * illumination})`)
  halo.addColorStop(0.5, `rgba(230, 232, 240, ${0.08 * illumination})`)
  halo.addColorStop(1, 'rgba(230, 232, 240, 0)')
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(object.x, object.y, haloRadius, 0, TAU)
  ctx.fill()
  ctx.restore()

  // Earthshine: the unlit limb is never truly black.
  ctx.fillStyle = 'rgba(74, 78, 92, 0.55)'
  ctx.beginPath()
  ctx.arc(object.x, object.y, r, 0, TAU)
  ctx.fill()

  const toSun = sun
    ? Math.atan2(sun.y - object.y, sun.x - object.x)
    : // With no Sun in the scene, light the Moon from the upper right.
      -Math.PI / 4
  ctx.save()
  ctx.translate(object.x, object.y)
  ctx.rotate(toSun)
  ctx.fillStyle = '#f4efe6'
  ctx.beginPath()
  // The lit limb faces the Sun; the terminator is the projection of a circle,
  // an ellipse whose semi axis is r*(1-2k) and which degenerates to a straight
  // line at half Moon.
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false)
  const terminator = r * (1 - 2 * illumination)
  ctx.ellipse(0, 0, Math.abs(terminator), r, 0, Math.PI / 2, -Math.PI / 2, terminator >= 0)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.strokeStyle = 'rgba(244, 239, 230, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(object.x, object.y, r, 0, TAU)
  ctx.stroke()
}

function drawSun(ctx: CanvasRenderingContext2D, object: SceneObject): void {
  const r = object.r
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const glow = ctx.createRadialGradient(object.x, object.y, 0, object.x, object.y, r * 6)
  glow.addColorStop(0, 'rgba(255, 226, 170, 0.75)')
  glow.addColorStop(0.35, 'rgba(255, 186, 110, 0.28)')
  glow.addColorStop(1, 'rgba(255, 170, 90, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(object.x, object.y, r * 6, 0, TAU)
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = '#fff3d6'
  ctx.beginPath()
  ctx.arc(object.x, object.y, r, 0, TAU)
  ctx.fill()
}

function labelFor(object: SceneObject): string {
  return object.kind === 'messier' ? object.id : object.name
}

const LABEL_LINE_H = 11

/**
 * A label placer that refuses to stack text on text, or to run off the canvas.
 *
 * M110, M31 and M32 sit inside one degree of each other: at a 40 degree field
 * their three labels land on the same pixels and read as noise. Whatever is
 * placed first wins, so callers place what matters (selected, planned, proposed)
 * before the rest.
 *
 * An object near the border wants its label past the edge, where the canvas
 * clips it to a fragment ("Ura" for Uranus, a half-height "M52"). A clipped
 * word reads as a bug, so the label is nudged back inside the frame the same
 * way the cardinal points are, and only then tested for collisions.
 */
type LabelPlacer = (text: string, x: number, y: number, force: boolean) => boolean

function labelPlacer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): LabelPlacer {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = []
  return (text: string, x: number, y: number, force: boolean): boolean => {
    const textWidth = ctx.measureText(text).width
    // A label wider than the canvas cannot be saved by moving it; drop it.
    if (textWidth + 6 > width) return false
    const drawX = clamp(x, 2, Math.max(2, width - textWidth - 2))
    const drawY = clamp(y, LABEL_LINE_H + 1, Math.max(LABEL_LINE_H + 1, height - 3))
    const box = {
      x0: drawX - 1,
      y0: drawY - LABEL_LINE_H,
      x1: drawX + textWidth + 1,
      y1: drawY + 3,
    }
    if (!force) {
      for (const other of placed) {
        const overlaps =
          box.x0 < other.x1 && box.x1 > other.x0 && box.y0 < other.y1 && box.y1 > other.y0
        if (overlaps) return false
      }
    }
    placed.push(box)
    ctx.fillText(text, drawX, drawY)
    return true
  }
}

function drawObjects(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  style: RenderStyle,
  fovDeg: number,
  place: LabelPlacer,
): void {
  const sun = scene.objects.find((o) => o.kind === 'sun') ?? null

  ctx.font = `10px ${MONO}`
  const isMarked = (object: SceneObject): boolean =>
    object.id === style.selectedId ||
    style.highlightedIds.has(object.id) ||
    style.planIds.has(object.id) ||
    style.proposedIds.has(object.id)

  // All 110 Messier glyphs at once is a crowd; on the whole dome they step back
  // and let the sky through, and they firm up as soon as the human zooms in.
  const glyphAlpha = fovDeg > 120 ? 0.5 : 0.85
  const messier = scene.objects.filter((object) => object.kind === 'messier')
  for (const object of messier) {
    drawMessierGlyph(ctx, object, isMarked(object) ? 0.95 : glyphAlpha)
  }

  if (style.showLabels) {
    // Marked objects first: the one the agent just pointed at must keep its name
    // even when three catalog neighbours want the same corner of the sky.
    for (const marked of [true, false]) {
      for (const object of messier) {
        if (isMarked(object) !== marked) continue
        if (!marked && fovDeg > 100) continue
        ctx.fillStyle = marked ? AMBER : 'rgba(255, 180, 84, 0.6)'
        place(labelFor(object), object.x + object.r + 4, object.y - object.r - 3, marked)
      }
    }
  }

  for (const object of scene.objects) {
    if (object.kind !== 'planet') continue
    drawPlanet(ctx, object)
    if (style.showLabels) {
      ctx.fillStyle = 'rgba(226, 232, 245, 0.8)'
      place(object.name, object.x + object.r + 5, object.y - object.r - 4, true)
    }
  }

  // The Sun's disc is only drawn when it is actually up; below the horizon it
  // exists in the scene solely to aim the Moon's terminator.
  if (sun && sun.altDeg > -0.5) drawSun(ctx, sun)

  for (const object of scene.objects) {
    if (object.kind !== 'moon') continue
    drawMoon(ctx, object, sun)
    if (style.showLabels) {
      const illumination = Math.round(object.extra?.illuminationPct ?? 0)
      ctx.fillStyle = 'rgba(244, 239, 230, 0.85)'
      place(`Moon ${illumination}%`, object.x + object.r + 6, object.y - object.r - 4, true)
    }
  }
}

const CARDINAL_OFFSET_PX = 13

function drawHorizon(ctx: CanvasRenderingContext2D, scene: Scene, path: Path2D | null): void {
  if (path) {
    const mask = new Path2D()
    if (skyIsInside(scene)) {
      mask.rect(0, 0, scene.width, scene.height)
      mask.addPath(path)
      ctx.fillStyle = 'rgba(5, 6, 10, 0.78)'
      ctx.fill(mask, 'evenodd')
    } else {
      ctx.fillStyle = 'rgba(5, 6, 10, 0.78)'
      ctx.fill(path, 'nonzero')
    }
    ctx.strokeStyle = '#2a3140'
    ctx.lineWidth = 1.5
    ctx.stroke(path)
  }

  const cx = scene.width / 2
  const cy = scene.height / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const cardinal of scene.cardinals) {
    if (!cardinal.visible) continue
    const main = cardinal.label.length === 1
    const dx = cardinal.x - cx
    const dy = cardinal.y - cy
    const distance = Math.hypot(dx, dy) || 1
    const x = clamp(cardinal.x + (dx / distance) * CARDINAL_OFFSET_PX, 10, scene.width - 10)
    const y = clamp(cardinal.y + (dy / distance) * CARDINAL_OFFSET_PX, 10, scene.height - 10)
    ctx.font = `${main ? 11 : 9}px ${MONO}`
    ctx.fillStyle = main ? 'rgba(138, 147, 166, 0.95)' : 'rgba(138, 147, 166, 0.5)'
    ctx.fillText(cardinal.label, x, y)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

// ---------------------------------------------------------------------------
// Instrument marks
// ---------------------------------------------------------------------------

interface Anchor {
  x: number
  y: number
  r: number
  name: string
}

/**
 * Where the ids the UI cares about (plan, proposal, selection, favourites,
 * agent highlights) landed on screen. Named stars are resolved only when some id
 * actually asks for one.
 */
function anchorsFor(scene: Scene, ids: Set<string>): Map<string, Anchor> {
  const found = new Map<string, Anchor>()
  if (ids.size === 0) return found
  for (const object of scene.objects) {
    if (object.kind === 'sun') continue
    if (ids.has(object.id)) {
      found.set(object.id, { x: object.x, y: object.y, r: object.r, name: object.name })
    }
  }
  let wantsStar = false
  for (const id of ids) {
    if (id.startsWith('star:') && !found.has(id)) {
      wantsStar = true
      break
    }
  }
  if (!wantsStar) return found
  for (const star of scene.stars) {
    if (star.name === '') continue
    const id = starIdForName(star.name)
    if (ids.has(id) && !found.has(id)) {
      found.set(id, { x: star.x, y: star.y, r: Math.max(star.r, 3), name: star.name })
    }
  }
  return found
}

/** The committed plan as a numbered, dashed route across the sky. */
function drawPlanRoute(
  ctx: CanvasRenderingContext2D,
  style: RenderStyle,
  anchors: Map<string, Anchor>,
): void {
  const stops = [...style.planIds.entries()]
    .map(([id, order]) => ({ order, anchor: anchors.get(id) }))
    .filter((stop): stop is { order: number; anchor: Anchor } => stop.anchor !== undefined)
    .sort((a, b) => a.order - b.order)
  if (stops.length === 0) return

  if (stops.length > 1) {
    ctx.save()
    ctx.setLineDash([4, 6])
    ctx.strokeStyle = 'rgba(255, 180, 84, 0.6)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(stops[0].anchor.x, stops[0].anchor.y)
    for (let i = 1; i < stops.length; i++) ctx.lineTo(stops[i].anchor.x, stops[i].anchor.y)
    ctx.stroke()
    ctx.restore()
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `9px ${MONO}`
  for (const stop of stops) {
    const badgeX = stop.anchor.x + stop.anchor.r + 8
    const badgeY = stop.anchor.y + stop.anchor.r + 8
    ctx.fillStyle = AMBER
    ctx.beginPath()
    ctx.arc(badgeX, badgeY, 7, 0, TAU)
    ctx.fill()
    ctx.fillStyle = ABYSS
    ctx.fillText(String(stop.order), badgeX, badgeY + 0.5)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Ghost items: dotted rings with a question mark, waiting for a human answer. */
function drawProposals(
  ctx: CanvasRenderingContext2D,
  style: RenderStyle,
  anchors: Map<string, Anchor>,
): void {
  if (style.proposedIds.size === 0) return
  ctx.save()
  ctx.setLineDash([2, 4])
  ctx.strokeStyle = 'rgba(255, 180, 84, 0.55)'
  ctx.lineWidth = 1.2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `9px ${MONO}`
  for (const id of style.proposedIds) {
    const anchor = anchors.get(id)
    if (!anchor) continue
    const radius = anchor.r + 7
    ctx.beginPath()
    ctx.arc(anchor.x, anchor.y, radius, 0, TAU)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255, 180, 84, 0.8)'
    ctx.fillText('?', anchor.x + radius + 5, anchor.y - radius)
  }
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function drawMarks(
  ctx: CanvasRenderingContext2D,
  style: RenderStyle,
  anchors: Map<string, Anchor>,
): void {
  // Favourites: a thin dashed amber ring, the human's own mark. It used to be a
  // 9 px glyph at the shoulder of the object, which was indistinguishable from
  // the name label beside it, and the agent reads this set through
  // describe_current_view, so the human has to be able to SEE what it will read.
  ctx.save()
  ctx.setLineDash([2, 3])
  ctx.strokeStyle = 'rgba(255, 180, 84, 0.75)'
  ctx.lineWidth = 1
  for (const id of style.favoriteIds) {
    const anchor = anchors.get(id)
    if (!anchor) continue
    // A floor on the radius: at the whole dome a Messier glyph is 2 px, and a
    // ring that small is the sparkle this replaced.
    ctx.beginPath()
    ctx.arc(anchor.x, anchor.y, Math.max(anchor.r + 5, 7.5), 0, TAU)
    ctx.stroke()
  }
  ctx.restore()

  // Agent highlight: a red ring with four ticks, the mark of the other operator.
  for (const id of style.highlightedIds) {
    const anchor = anchors.get(id)
    if (!anchor) continue
    const radius = anchor.r + 9
    ctx.strokeStyle = SIGNAL
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(anchor.x, anchor.y, radius, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      ctx.moveTo(anchor.x + cos * radius, anchor.y + sin * radius)
      ctx.lineTo(anchor.x + cos * (radius + 5), anchor.y + sin * (radius + 5))
    }
    ctx.stroke()
  }

  if (style.selectedId) {
    const anchor = anchors.get(style.selectedId)
    if (anchor) {
      ctx.strokeStyle = AMBER
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(anchor.x, anchor.y, anchor.r + 6, 0, TAU)
      ctx.stroke()
    }
  }
}

/** The ripple that says "the agent moved the map". */
function drawReticle(ctx: CanvasRenderingContext2D, scene: Scene, pulse: number): void {
  if (!(pulse >= 0) || pulse >= 1) return
  const cx = scene.width / 2
  const cy = scene.height / 2
  ctx.save()
  ctx.strokeStyle = SIGNAL
  ctx.lineWidth = 1.5
  for (const offset of [0, 0.25]) {
    const t = pulse - offset
    if (t < 0 || t >= 1) continue
    ctx.globalAlpha = (1 - t) * 0.9
    ctx.beginPath()
    ctx.arc(cx, cy, 20 + 60 * t, 0, TAU)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  // Crosshair at the point the agent asked for.
  ctx.globalAlpha = Math.max(0, 1 - pulse) * 0.8
  ctx.beginPath()
  ctx.moveTo(cx - 14, cy)
  ctx.lineTo(cx - 5, cy)
  ctx.moveTo(cx + 5, cy)
  ctx.lineTo(cx + 14, cy)
  ctx.moveTo(cx, cy - 14)
  ctx.lineTo(cx, cy - 5)
  ctx.moveTo(cx, cy + 5)
  ctx.lineTo(cx, cy + 14)
  ctx.stroke()
  ctx.restore()
}

/**
 * Red light over the instrument.
 *
 * Two passes, and they are deliberately different operations. The GROUND below
 * the horizon gets a warm fill LAID ON it: it is almost black, and a multiply
 * over black changes nothing, which is why the old 6 % wash was invisible. The
 * sky itself only gets the multiply, which cools nothing and shifts no star
 * colour perceptibly: the data must not change when the lights do.
 */
function drawRedLightWash(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  horizon: Path2D | null,
): void {
  ctx.save()
  if (horizon) {
    ctx.fillStyle = 'rgba(150, 40, 20, 0.16)'
    if (skyIsInside(scene)) {
      const ground = new Path2D()
      ground.rect(0, 0, scene.width, scene.height)
      ground.addPath(horizon)
      ctx.fill(ground, 'evenodd')
    } else {
      ctx.fill(horizon, 'nonzero')
    }
  }
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = 'rgba(255, 214, 190, 0.14)'
  ctx.fillRect(0, 0, scene.width, scene.height)
  ctx.restore()
}

/** A photographic vignette. Cheap, and it stops the corners from looking flat. */
function drawVignette(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const cx = scene.width / 2
  const cy = scene.height / 2
  const radius = Math.hypot(scene.width, scene.height) / 2
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.38)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, scene.width, scene.height)
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export function renderSky(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  style: RenderStyle,
): void {
  const dpr = Number.isFinite(style.dpr) && style.dpr > 0 ? style.dpr : 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, scene.width, scene.height)
  ctx.lineCap = 'round'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  const fovDeg = sceneFovDeg(scene)
  const horizon = horizonPath(scene)

  // One collision set for every label on the frame, filled in priority order:
  // objects first, constellation names last (see drawConstellationNames).
  ctx.font = `10px ${MONO}`
  const place = labelPlacer(ctx, scene.width, scene.height)

  drawSky(ctx, scene)
  drawTwilightGlow(ctx, scene)
  drawMilkyWay(ctx, scene, horizon)
  drawConstellations(ctx, scene)
  drawStars(ctx, scene, style, fovDeg)
  drawObjects(ctx, scene, style, fovDeg, place)
  drawConstellationNames(ctx, scene, style, fovDeg, place)
  drawHorizon(ctx, scene, horizon)
  drawVignette(ctx, scene)

  const wanted = new Set<string>([
    ...style.planIds.keys(),
    ...style.proposedIds,
    ...style.favoriteIds,
    ...style.highlightedIds,
  ])
  if (style.selectedId) wanted.add(style.selectedId)
  const anchors = anchorsFor(scene, wanted)

  drawPlanRoute(ctx, style, anchors)
  drawProposals(ctx, style, anchors)
  drawMarks(ctx, style, anchors)
  drawReticle(ctx, scene, style.reticlePulse)

  if (style.nightMode) drawRedLightWash(ctx, scene, horizon)
}
