/**
 * The observing catalog: everything a human or an agent can point at.
 *
 * One flat list of `Target`s built from the vendored Messier catalog, the seven
 * major planets, the Moon and the naked eye stars, plus a forgiving resolver so
 * "M 31", "m31" and "Andromeda Galaxy" all land on the same object. The Sun is
 * deliberately absent: it is never an observing target.
 *
 * Pure and headless: no store, no DOM, no astronomy computation happens here.
 * Positions live in `targets.ts`.
 */

import { Body } from 'astronomy-engine'

import { MESSIER, STARS } from '../data'
import type { MessierRecord } from '../data'
import type { TargetType } from '../state/types'

export interface Target {
  /** Stable id: 'M31' | 'jupiter' | 'moon' | 'star:vega'. */
  id: string
  /** Display name: 'Andromeda' | 'Jupiter' | 'Moon' | 'Vega'. */
  name: string
  type: TargetType
  /** 'fixed' = catalog RA/Dec, 'body' = solar system body computed per instant. */
  kind: 'fixed' | 'body'
  /** J2000 right ascension in degrees [0, 360). Fixed targets only. */
  ra?: number
  /** J2000 declination in degrees [-90, 90]. Fixed targets only. */
  dec?: number
  /** astronomy-engine body. Bodies only. */
  body?: Body
  /** Visual magnitude, null when the catalog has none (planets vary too much). */
  mag: number | null
  /** Largest apparent dimension in arcminutes, null when unknown. */
  sizeArcmin: number | null
  /** 3-letter IAU constellation abbreviation, null for solar system bodies. */
  con: string | null
  /** Lowercase strings that resolve to this target. */
  aliases: string[]
}

/** Wraps a right ascension into [0, 360) degrees. Non-finite input gives 0. */
export function normalizeRA(raDeg: number): number {
  if (!Number.isFinite(raDeg)) return 0
  return ((raDeg % 360) + 360) % 360
}

/** Faintest star kept as a pointable target. Roughly the naked eye bright list. */
const BRIGHT_STAR_MAG_LIMIT = 1.6

/** Human readable type labels, also used as search keywords. */
const TYPE_LABEL: Record<TargetType, string> = {
  galaxy: 'galaxy',
  open_cluster: 'open cluster',
  globular_cluster: 'globular cluster',
  planetary_nebula: 'planetary nebula',
  diffuse_nebula: 'diffuse nebula',
  supernova_remnant: 'supernova remnant',
  other: 'deep sky object',
  planet: 'planet',
  moon: 'moon',
  star: 'star',
}

export function targetTypeLabel(type: TargetType): string {
  return TYPE_LABEL[type] ?? 'object'
}

/**
 * Lookup key: lowercase, every run of non-alphanumeric characters collapsed to a
 * single space, trimmed. "Ptolemy´s Cluster" and "ptolemy's cluster" agree.
 */
function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Same as `normalizeKey` but without spaces, so 'm 31' and 'm31' agree. */
function compactKey(value: string): string {
  return normalizeKey(value).replace(/ /g, '')
}

/** 'Rigil Kentaurus' -> 'rigil-kentaurus'. */
function slug(name: string): string {
  return normalizeKey(name).replace(/ /g, '-')
}

/** Words that already say what kind of object this is. */
const TYPE_WORD: Partial<Record<TargetType, string>> = {
  galaxy: 'galaxy',
  open_cluster: 'cluster',
  globular_cluster: 'cluster',
  planetary_nebula: 'nebula',
  diffuse_nebula: 'nebula',
  supernova_remnant: 'nebula',
}

function messierAliases(record: MessierRecord): string[] {
  const number = record.id.slice(1)
  const aliases = new Set<string>([
    record.id.toLowerCase(), // 'm31'
    `m ${number}`, // 'm 31'
    `messier ${number}`,
  ])
  const name = record.name.trim()
  if (name) {
    aliases.add(name.toLowerCase())
    const ngc = /^(ngc|ic)\s*(\d+)$/i.exec(name)
    if (ngc) {
      aliases.add(`${ngc[1].toLowerCase()} ${ngc[2]}`)
    } else {
      // 'Andromeda' -> 'andromeda galaxy'. Only for real proper names.
      const word = TYPE_WORD[record.type]
      if (word && !normalizeKey(name).split(' ').includes(word)) {
        aliases.add(`${name.toLowerCase()} ${word}`)
      }
    }
  }
  return [...aliases]
}

function messierTarget(record: MessierRecord): Target {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    kind: 'fixed',
    ra: normalizeRA(record.ra),
    dec: record.dec,
    mag: record.mag,
    sizeArcmin: record.sizeArcmin,
    con: record.con,
    aliases: messierAliases(record),
  }
}

/** The 110 Messier objects as pointable targets, in catalog order M1..M110. */
export const MESSIER_TARGETS: Target[] = MESSIER.map(messierTarget)

const PLANET_BODIES: { body: Body; name: string }[] = [
  { body: Body.Mercury, name: 'Mercury' },
  { body: Body.Venus, name: 'Venus' },
  { body: Body.Mars, name: 'Mars' },
  { body: Body.Jupiter, name: 'Jupiter' },
  { body: Body.Saturn, name: 'Saturn' },
  { body: Body.Uranus, name: 'Uranus' },
  { body: Body.Neptune, name: 'Neptune' },
]

/**
 * The seven major planets. Magnitude is null on purpose: a planet's brightness
 * changes by whole magnitudes along its orbit, so a fixed number would lie.
 */
export const PLANETS: Target[] = PLANET_BODIES.map(({ body, name }) => ({
  id: name.toLowerCase(),
  name,
  type: 'planet' as TargetType,
  kind: 'body' as const,
  body,
  mag: null,
  sizeArcmin: null,
  con: null,
  aliases: [name.toLowerCase(), `planet ${name.toLowerCase()}`],
}))

export const MOON: Target = {
  id: 'moon',
  name: 'Moon',
  type: 'moon',
  kind: 'body',
  body: Body.Moon,
  mag: null,
  sizeArcmin: 31,
  con: null,
  aliases: ['moon', 'the moon', 'luna'],
}

/**
 * Named stars down to magnitude 1.6. They are the anchors a human uses to find
 * their way around the dome, so an agent must be able to point at them.
 */
export const BRIGHT_STARS: Target[] = STARS.filter(
  (star) => star.name !== '' && star.mag <= BRIGHT_STAR_MAG_LIMIT,
).map((star) => {
  const id = `star:${slug(star.name)}`
  return {
    id,
    name: star.name,
    type: 'star' as TargetType,
    kind: 'fixed' as const,
    ra: normalizeRA(star.ra),
    dec: star.dec,
    mag: star.mag,
    sizeArcmin: null,
    con: null,
    aliases: [star.name.toLowerCase(), id, `star ${star.name.toLowerCase()}`],
  }
})

/** Every pointable target. The Sun is not one of them. */
export const ALL_TARGETS: Target[] = [...MESSIER_TARGETS, ...PLANETS, MOON, ...BRIGHT_STARS]

export const TARGET_BY_ID: ReadonlyMap<string, Target> = new Map(ALL_TARGETS.map((t) => [t.id, t]))

/** Alias index. Both the spaced and the compact form of every key point here. */
const INDEX = new Map<string, Target>()
for (const target of ALL_TARGETS) {
  const keys = [target.id, target.name, ...target.aliases]
  for (const key of keys) {
    for (const form of [normalizeKey(key), compactKey(key)]) {
      if (form && !INDEX.has(form)) INDEX.set(form, target)
    }
  }
}

/** Resolve a target by id, name or alias. Case, space and punctuation insensitive. */
export function getTarget(idOrName: string): Target | undefined {
  if (typeof idOrName !== 'string') return undefined
  const spaced = normalizeKey(idOrName)
  if (!spaced) return undefined
  return INDEX.get(spaced) ?? INDEX.get(spaced.replace(/ /g, ''))
}

/** Everything a free text query is matched against, precomputed once. */
const HAYSTACK: string[] = ALL_TARGETS.map((t) =>
  normalizeKey(
    [t.id, t.name, ...t.aliases, targetTypeLabel(t.type), t.con ?? ''].join(' '),
  ),
)

/** Brighter first, unknown magnitudes last, catalog order as the final tie break. */
function brightnessRank(target: Target): number {
  return target.mag ?? 99
}

/**
 * Free text search over ids, names, aliases, type labels and constellations.
 * Exact matches first, then name prefixes, then substrings; ties by brightness.
 */
export function searchTargets(query: string, limit = 20): Target[] {
  const spaced = normalizeKey(typeof query === 'string' ? query : '')
  if (!spaced) return []
  const compact = spaced.replace(/ /g, '')
  const scored: { target: Target; rank: number; index: number }[] = []

  for (let i = 0; i < ALL_TARGETS.length; i++) {
    const target = ALL_TARGETS[i]
    const name = normalizeKey(target.name)
    const id = normalizeKey(target.id)
    let rank: number
    if (id === spaced || id.replace(/ /g, '') === compact || name === spaced) {
      rank = 0
    } else if (target.aliases.some((a) => normalizeKey(a) === spaced)) {
      rank = 1
    } else if (name.startsWith(spaced) || id.startsWith(spaced)) {
      rank = 2
    } else if (name.includes(spaced)) {
      rank = 3
    } else if (HAYSTACK[i].includes(spaced)) {
      rank = 4
    } else {
      continue
    }
    scored.push({ target, rank, index: i })
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      brightnessRank(a.target) - brightnessRank(b.target) ||
      a.index - b.index,
  )
  return scored.slice(0, Math.max(0, limit)).map((s) => s.target)
}
