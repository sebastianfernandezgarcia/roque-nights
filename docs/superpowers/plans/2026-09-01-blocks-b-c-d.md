# Roque Nights — Blocks B/C/D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this project the tasks are executed by parallel Opus subagents orchestrated by a Workflow; each task owns a disjoint set of files (see "File ownership"). Subagents NEVER `git commit`; the orchestrator commits per block.

**Goal:** Turn the one-tool spike into the full Roque Nights product: headless astronomy engine, the sky dome (canvas), collaborative Zustand store, the 14 WebMCP tools with rich verifiable returns, the plan timeline, and a layout that looks like an observatory control room in a ~1100×750 browser window.

**Architecture:** Pure, headless astronomy modules (`src/astro/*`, astronomy-engine, all UTC) are consumed by a vanilla Zustand store (`src/state/store.ts`) that is the single source of truth for humans (React UI) and agents (WebMCP tools in `src/tools/*`). Tools are thin wrappers over the same store actions the buttons call; every action carries `source: 'human' | 'agent'`. The sky map (`src/sky/*`) is a canvas 2D stereographic "dome" fed by a pure scene builder. Tools are registered at module level outside React (`src/webmcp/registerTools.ts`), with contextual tools registered/unregistered as the plan changes.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Tailwind 4, Zustand 5 (vanilla store + `useStore`), astronomy-engine 2.1, vitest 4, ajv (tests only), playwright-core (audit script). Node 20.

**Spec:** `docs/PLAN.md` (consolidated plan + addendum of 2026-09-01). Read it before any task.

## Global Constraints

- **Language of product, code comments, tool descriptions, README: English.** Docs for the human (this plan, PLAN.md) may be Spanish.
- **14 tools maximum**, exact names in this plan. No 15th tool. Plus ONE declarative form (`set_observing_site`).
- **All internal time is UTC** (`Date`, ISO strings ending in `Z`). Local rendering only through `formatInZone(iso, timeZone)` with an explicit IANA zone. Never `toLocaleString()` without `timeZone`. Never invent a time zone: if `site.timeZone === null`, local times are `null` and a caveat says so.
- **RA in the catalogs is in DEGREES [0,360)**; astronomy-engine `Horizon()` takes RA in **HOURS** (deg/15). Convert through `normalizeRA` / helpers only; fixed objects go through `Rotation_EQJ_HOR` (see Task 5) which takes vectors, not hours.
- **Tools never throw.** Every tool returns the envelope of Task 7 (`ok:true` or `ok:false` with `error.code`). The registration wrapper additionally catches unexpected exceptions → `internal_error`.
- **Rich returns everywhere:** `{ ok, summary (one quotable sentence), data, rejected[], caveats[], site, as_of }`. Rejected items always carry a `reason`.
- **Tool registration outside React** (StrictMode double-mount unregisters tools). Verify against `npm run build && npm run preview`, never only against the dev server.
- **Aesthetic:** background `#05060A`, panels `#101319`, panel edges `#1c2230`, amber `#FFB454` (ember), red `#FF5C4D` (signal), faint text `#8a93a6`, IBM Plex Mono for numbers. Tailwind theme tokens already exist in `src/index.css` (`bg-abyss`, `bg-panel`, `border-panel-edge`, `text-ember`, `text-signal`, `text-faint`, `font-mono`). Instrument density, no chat bubbles, no rounded-blob "AI app" look. No em dashes in UI copy.
- **Performance:** the sky canvas renders ≤ 16 ms per frame on an M4 with ~5000 stars (use `fillRect` for r < 0.8 px, batch by color, skip objects with `visible:false`). Re-render only when inputs change (time, view, size, selection sets, night mode) or during an animation.
- **Layout target:** ChatGPT desktop's built-in browser (~1100×750). Two columns ≥ 960 px (map + 380 px side column), single column below. The map is the protagonist.
- **No new runtime dependencies** without a reason written in the task. `nanoid` is NOT needed: ids come from `crypto.randomUUID()`.
- **Vitest:** run only your own tests (`npx vitest run <path>`); a full `tsc -b` may fail while other agents work, so typecheck with `npx tsc --noEmit -p tsconfig.app.json` and only act on errors in files you own.
- **Subagents do not commit.** Report what you changed.

---

## File ownership (disjoint per task)

| Task | Owns (create/modify) |
|---|---|
| T1 (done by separate workflow) | `scripts/vendor-catalogs.mjs`, `src/data/*.json`, `src/data/index.ts`, `src/data/catalog.test.ts`, `CREDITS.md` |
| T2 | `src/astro/time.ts`, `src/astro/time.test.ts` |
| T3 | `src/astro/night.ts`, `src/astro/night.test.ts`, `src/astro/cache.ts` |
| T4 | `src/astro/catalog.ts`, `src/astro/targets.ts`, `src/astro/schedule.ts`, `src/astro/*.test.ts` for those |
| T5 | `src/astro/rank.ts`, `src/astro/sky.ts`, tests |
| T6 | `src/state/store.ts`, `src/state/store.test.ts`, `src/state/types.ts` |
| T7 | `src/tools/envelope.ts`, `src/tools/resolveSite.ts`, `src/tools/schemas.ts`, `src/data/sites.ts`, tests |
| T8 | `src/tools/getNightEphemeris.ts`, `src/tools/findObservableTargets.ts`, `src/tools/rankNights.ts`, `src/tools/compareDarkSkySites.ts`, `src/weather/openMeteo.ts`, `src/weather/snapshot.json`, tests |
| T9 | `src/tools/pointSkyMap.ts`, `src/tools/setObservingTime.ts`, `src/tools/describeCurrentView.ts`, `src/tools/proposePlan.ts`, `src/tools/commitProposal.ts`, `src/tools/modifyPlan.ts`, `src/tools/getCurrentPlan.ts`, `src/tools/clearPlan.ts`, tests |
| T10 | `src/tools/exportPlan.ts`, `src/tools/importPlan.ts`, `src/plan/serialize.ts`, `src/plan/shareUrl.ts`, `public/schemas/observing-plan.v1.json`, tests |
| T11 | `src/sky/SkyMap.tsx`, `src/sky/scene.ts`, `src/sky/render.ts`, `src/sky/animate.ts`, `src/sky/interaction.ts`, `src/sky/*.test.ts` |
| T12 | `src/ui/*.tsx` (Header, NightStrip, TimeSlider, Inspector, PlanPanel, PlanTimeline, ActivityLog, AgentHarness, SiteForm, ProposalBanner, ImportBanner), `src/ui/*.test.tsx` |
| T13 | `src/webmcp/registerTools.ts`, `src/webmcp/contextual.ts`, `src/types/webmcp.d.ts` (extend only), `src/webmcp/*.test.ts` |
| T14 (integration, after all) | `src/App.tsx`, `src/main.tsx`, `src/index.css`, `index.html`, `scripts/audit-webmcp.mjs`, `README.md`, deletes `src/App.css`, `src/assets/*` |

The spike files `src/astro/conditions.ts`, `src/tools/getObservingConditions.ts(.test.ts)` are deleted in T14 once T3/T8 replace them. Until then they may fail to compile against the new store; that is expected.

---

## Shared vocabulary (used verbatim across tasks)

```ts
// src/state/types.ts  (owned by T6, but every task codes against these names)
export type ActorSource = 'human' | 'agent'

export interface Site {
  id: string | null          // id from src/data/sites.ts when it is a catalog site, else null
  name: string
  latitude: number           // decimal degrees, north positive
  longitude: number          // decimal degrees, EAST positive
  elevationM: number
  timeZone: string | null    // IANA zone; null = unknown (custom coordinates without a zone)
}

export type TargetType =
  | 'galaxy' | 'open_cluster' | 'globular_cluster' | 'planetary_nebula'
  | 'diffuse_nebula' | 'supernova_remnant' | 'other'   // Messier types (src/data)
  | 'planet' | 'moon' | 'star'

export interface PlanItem {
  id: string                 // crypto.randomUUID()
  targetId: string           // e.g. 'M31', 'jupiter', 'moon', 'star:vega'
  targetName: string
  startUtc: string           // ISO
  endUtc: string             // ISO
  note?: string
  source: ActorSource
  proposalId?: string
}

export type ProposalDecision = 'accepted' | 'rejected'
export interface Proposal {
  id: string
  createdAt: string
  rationale?: string
  items: PlanItem[]
  unscheduled: { targetId: string; name: string; reason: string }[]
  replaceExisting: boolean
  status: 'pending' | 'committed' | 'dismissed'
  decisions: Record<string, { decision: ProposalDecision; reason?: string; at: string }>  // keyed by item id
  origin: 'agent' | 'import'
}

export interface ActivityEntry {
  id: string
  at: string
  source: ActorSource
  action: string             // tool name or UI action ('set_night', 'tap_object', ...)
  detail: string             // compact input summary
  status: 'running' | 'ok' | 'error'
  durationMs?: number
  result?: string            // summary excerpt or error message (≤ 160 chars)
}

export type HumanActionKind =
  | 'drag_map' | 'zoom_map' | 'tap_object' | 'toggle_favorite' | 'set_time' | 'set_night'
  | 'set_site' | 'accept_item' | 'reject_item' | 'edit_plan' | 'clear_plan' | 'toggle_night_mode'
export interface HumanAction { at: string; kind: HumanActionKind; detail: string }

export interface SkyViewState { centerAltDeg: number; centerAzDeg: number; fovDeg: number; animate: boolean }
export interface Filters { minAltDeg: number; types: TargetType[] | null; maxMag: number | null; minMoonSepDeg: number }
```

Time stamps in tool outputs use ONE shape everywhere:

```ts
// src/tools/envelope.ts (T7)
export interface Stamp { utc: string | null; local: string | null }   // local = 'YYYY-MM-DD HH:mm' in site zone, null when unknown
```

---

### Task 1: Vendor the sky catalogs (already running in workflow `vendor-sky-catalogs`)

Produces `src/data/index.ts` exporting `STARS: StarRecord[]` (`{ra, dec, mag, bv, name, hip}`, RA in [0,360), sorted by mag asc), `CONSTELLATIONS: ConstellationRecord[]` (`{id, name, labelRa, labelDec, lines: [ra,dec][][]}`, split at RA wrap), `MESSIER: MessierRecord[]` (`{id, name, type: MessierType, ra, dec, mag, sizeArcmin, con}`, 110 objects), `MILKY_WAY: MilkyWayLevel[]` (`{id: 'ol1'..'ol5', polygons: [ra,dec][][]}`), plus `CREDITS.md`. Golden: M31 ra 10.685 dec 41.269.

---

### Task 2: `src/astro/time.ts` — dates, zones, formatting

**Files:** Create `src/astro/time.ts`, `src/astro/time.test.ts`.

**Interfaces — Produces:**

```ts
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000
export interface DateParts { year: number; month: number; day: number }
/** Strict YYYY-MM-DD: real calendar day, year 1900..2100. Returns null otherwise (never throws). */
export function parseIsoDate(value: unknown): DateParts | null
/** True when `tz` is a string accepted by Intl.DateTimeFormat as timeZone. */
export function isValidTimeZone(tz: unknown): tz is string
/** 'HH:mm' (default) or 'YYYY-MM-DD HH:mm' in the zone; '—' for null. */
export function formatInZone(isoUtc: string | null, timeZone: string, opts?: { withDate?: boolean }): string
/** Offset of `timeZone` from UTC at instant `at`, in minutes (Canary in September = +60). */
export function timeZoneOffsetMinutes(timeZone: string, at: Date): number
/** Today's calendar date in the zone (or UTC when timeZone is null). */
export function localDate(timeZone: string | null, from?: Date): string
/** 12:00 local on `nightOf`: exact via the zone when known, else solar noon from longitude (12:00Z - lon/15 h). */
export function localNoonUtc(nightOf: string, site: { longitude: number; timeZone: string | null }): Date
export function addDays(iso: string, days: number): string
/** Inclusive list of YYYY-MM-DD; throws RangeError if > maxDays (default 62) or to < from. */
export function isoDateRange(fromIso: string, toIso: string, maxDays?: number): string[]
/** Compact 'YYYY-MM-DD HH:mm' or 'HH:mm' or null; used by tools' Stamp. */
export function localStamp(isoUtc: string | null, timeZone: string | null): string | null
export function roundTo(n: number, decimals: number): number
```

**Tests (write first, in this order):**

```ts
import { describe, expect, it } from 'vitest'
import { parseIsoDate, isValidTimeZone, formatInZone, timeZoneOffsetMinutes, localNoonUtc, isoDateRange, localStamp, addDays } from './time'

describe('parseIsoDate', () => {
  it('accepts real calendar dates', () => expect(parseIsoDate('2026-09-02')).toEqual({ year: 2026, month: 9, day: 2 }))
  it('rejects impossible dates that pass a regex', () => {
    expect(parseIsoDate('2026-13-99')).toBeNull()
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('2026-9-2')).toBeNull()
    expect(parseIsoDate('2026-09-02T00:00')).toBeNull()
    expect(parseIsoDate(20260902)).toBeNull()
    expect(parseIsoDate('1800-01-01')).toBeNull()
  })
  it('accepts leap day', () => expect(parseIsoDate('2028-02-29')).not.toBeNull())
})
describe('time zones', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone('Atlantic/Canary')).toBe(true)
    expect(isValidTimeZone('Pacific/Honolulu')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone(42)).toBe(false)
  })
  it('formats in a zone', () => {
    expect(formatInZone('2026-09-02T20:52:50Z', 'Atlantic/Canary')).toBe('21:52')
    expect(formatInZone('2026-09-02T20:52:50Z', 'Atlantic/Canary', { withDate: true })).toBe('2026-09-02 21:52')
    expect(formatInZone(null, 'Atlantic/Canary')).toBe('—')
  })
  it('knows offsets', () => {
    expect(timeZoneOffsetMinutes('Atlantic/Canary', new Date('2026-09-02T12:00:00Z'))).toBe(60)
    expect(timeZoneOffsetMinutes('Pacific/Honolulu', new Date('2026-09-02T12:00:00Z'))).toBe(-600)
  })
  it('local noon uses the zone when known and longitude otherwise', () => {
    expect(localNoonUtc('2026-09-02', { longitude: -17.8851, timeZone: 'Atlantic/Canary' }).toISOString()).toBe('2026-09-02T11:00:00.000Z')
    // Mauna Kea, no zone: 12:00Z + 155.4681/15 h = 22:21:52Z (solar noon)
    const t = localNoonUtc('2026-09-02', { longitude: -155.4681, timeZone: null })
    expect(Math.abs(t.getTime() - Date.parse('2026-09-02T22:21:52Z'))).toBeLessThan(2000)
  })
  it('localStamp is null without a zone', () => {
    expect(localStamp('2026-09-02T20:52:50Z', null)).toBeNull()
    expect(localStamp('2026-09-02T20:52:50Z', 'Atlantic/Canary')).toBe('2026-09-02 21:52')
  })
})
describe('ranges', () => {
  it('builds inclusive ranges and caps them', () => {
    expect(isoDateRange('2026-08-31', '2026-09-02')).toEqual(['2026-08-31', '2026-09-01', '2026-09-02'])
    expect(() => isoDateRange('2026-01-01', '2026-12-31')).toThrow(RangeError)
    expect(() => isoDateRange('2026-09-02', '2026-09-01')).toThrow(RangeError)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
```

- [ ] Write the test file, run `npx vitest run src/astro/time.test.ts` → fails (module missing).
- [ ] Implement `time.ts`. `parseIsoDate`: regex `^(\d{4})-(\d{2})-(\d{2})$`, then `new Date(Date.UTC(y, m-1, d))` and compare `getUTCFullYear/Month/Date` back. `isValidTimeZone`: `try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }` plus `typeof tz === 'string'`. `timeZoneOffsetMinutes`: format with `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year, month, day, hour, minute, second })` → `formatToParts` → `Date.UTC(parts)` minus `at` in minutes. `localNoonUtc` with zone: take `Date.UTC(y,m,d,12)` then subtract the offset at that instant (iterate once more to handle DST edges).
- [ ] Run tests → pass. Report.

---

### Task 3: `src/astro/night.ts` — night ephemeris with explicit polar statuses

**Files:** Create `src/astro/night.ts`, `src/astro/night.test.ts`, `src/astro/cache.ts`.

**Interfaces — Consumes:** `localNoonUtc`, `roundTo` from T2. astronomy-engine: `Observer, Body, SearchRiseSet, SearchAltitude, Equator, Horizon, Illumination, MoonPhase`.

**Produces:**

```ts
export interface SiteCoords { latitude: number; longitude: number; elevationM: number; timeZone: string | null }
export type SunStatus = 'normal' | 'never_sets' | 'never_rises'
export type DarknessStatus = 'ok' | 'no_astronomical_darkness' | 'continuous_darkness'
export interface Interval { startUtc: string; endUtc: string }
export interface NightEphemeris {
  nightOf: string
  windowStartUtc: string        // local noon of nightOf
  windowEndUtc: string          // +24 h
  sun: {
    status: SunStatus
    sunsetUtc: string | null; sunriseUtc: string | null
    civilDuskUtc: string | null; nauticalDuskUtc: string | null; astronomicalDuskUtc: string | null
    astronomicalDawnUtc: string | null; nauticalDawnUtc: string | null; civilDawnUtc: string | null
  }
  darkness: {
    status: DarknessStatus
    startUtc: string | null; endUtc: string | null   // == astronomicalDusk/Dawn, or window bounds when continuous
    hours: number | null
    moonFreeHours: number | null
    moonFreeIntervals: Interval[]                   // darkness ∧ Moon below horizon
    usableHours: number | null                      // darkness ∧ (Moon down OR illumination ≤ 15 %)
  }
  moon: {
    illuminationPct: number; phaseName: string; phaseAngleDeg: number
    riseUtc: string | null; setUtc: string | null
    upDuringDarknessPct: number | null              // % of darkness minutes with Moon above horizon
    altitudeAtMidDarknessDeg: number | null
  }
  samples: { stepMinutes: number; startUtc: string; sunAltDeg: number[]; moonAltDeg: number[] }  // 10-min samples over the 24 h window (145 values)
  explanation: string   // one sentence a tool can quote, e.g. "No astronomical darkness at 69.65°N on 2026-06-21: the Sun never sets."
}
export function computeNightEphemeris(nightOf: string, site: SiteCoords): NightEphemeris
export function sunAltitudeDeg(date: Date, observer: Observer): number
export function moonAltitudeDeg(date: Date, observer: Observer): number
export function phaseName(phaseAngleDeg: number): string   // 8 names as in the spike
export function makeObserver(site: SiteCoords): Observer
export type TimeKeyword = 'now' | 'sunset' | 'darkness_start' | 'midnight' | 'darkness_end' | 'sunrise'
/** Resolve a keyword against a night; 'midnight' = middle of darkness (or of the window). null if the event does not exist. */
export function resolveTimeKeyword(keyword: TimeKeyword, night: NightEphemeris, now?: Date): string | null

// src/astro/cache.ts
/** Memoized computeNightEphemeris keyed by nightOf|lat|lon|elev (LRU of 64). */
export function getNight(nightOf: string, site: SiteCoords): NightEphemeris
```

**Algorithm notes.** Window = `[localNoonUtc, +24h]`. Sunset = `SearchRiseSet(Sun, obs, -1, start, 1)`, sunrise = first rise after sunset (or after start if no sunset). Twilights via `SearchAltitude(Sun, obs, ±1, from, 1, -6|-12|-18)`. `sun.status`: if no sunset and no sunrise in the window → `sunAltitudeDeg(start) > 0 ? 'never_sets' : 'never_rises'`. Darkness: dusk(-18, direction -1) from start and dawn(-18, +1) from dusk (or from start when no dusk). Status: dusk∧dawn → `ok`; neither and Sun altitude at start < -18 for the whole window (check samples) → `continuous_darkness` (start/end = window, hours 24); otherwise `no_astronomical_darkness`. Special: dawn found but no dusk (darkness already running at local noon, only at high latitude) → treat as `ok` with startUtc = windowStart and a note in `explanation`. Moon rise/set: `SearchRiseSet(Moon, obs, ±1, start, 1)`. Moon-free: sample the darkness interval every 10 min at slice midpoints (`moonAltitudeDeg < 0`) and coalesce consecutive Moon-free slices into `moonFreeIntervals`. Samples: 145 sun/moon altitudes at `start + i*10min`. Illumination/phase at mid-darkness (or window midpoint).

**Tests (golden; write first):**

```ts
const ROQUE = { latitude: 28.7542, longitude: -17.8851, elevationM: 2396, timeZone: 'Atlantic/Canary' }
it('golden night 2026-09-02 at the Roque', () => {
  const n = computeNightEphemeris('2026-09-02', ROQUE)
  expect(n.sun.status).toBe('normal'); expect(n.darkness.status).toBe('ok')
  expect(n.darkness.startUtc).toMatch(/^2026-09-02T20:52:5/)
  expect(n.darkness.endUtc).toMatch(/^2026-09-03T05:29:3/)
  expect(n.darkness.hours).toBeCloseTo(8.61, 1)
  expect(n.moon.riseUtc).toMatch(/^2026-09-02T22:43:3/)
  expect(n.moon.illuminationPct).toBe(66)
  expect(n.darkness.moonFreeHours).toBeGreaterThan(1); expect(n.darkness.moonFreeHours!).toBeLessThan(n.darkness.hours!)
  expect(n.darkness.moonFreeIntervals[0].startUtc).toBe(n.darkness.startUtc)  // Moon rises after dusk
  expect(n.samples.sunAltDeg).toHaveLength(145)
  expect(n.windowStartUtc).toBe('2026-09-02T11:00:00.000Z')
})
it('Tromsø midsummer: Sun never sets, no darkness', () => {
  const n = computeNightEphemeris('2026-06-21', { latitude: 69.6492, longitude: 18.9553, elevationM: 10, timeZone: 'Europe/Oslo' })
  expect(n.sun.status).toBe('never_sets'); expect(n.darkness.status).toBe('no_astronomical_darkness')
  expect(n.darkness.hours).toBeNull(); expect(n.explanation).toMatch(/never sets/)
})
it('London midsummer: Sun sets but never reaches -18°', () => {
  const n = computeNightEphemeris('2026-06-21', { latitude: 51.5074, longitude: -0.1278, elevationM: 10, timeZone: 'Europe/London' })
  expect(n.sun.status).toBe('normal'); expect(n.sun.sunsetUtc).not.toBeNull()
  expect(n.darkness.status).toBe('no_astronomical_darkness'); expect(n.sun.nauticalDuskUtc).not.toBeNull()
})
it('deep polar night: continuous darkness', () => {
  const n = computeNightEphemeris('2026-12-21', { latitude: 88, longitude: 0, elevationM: 0, timeZone: null })
  expect(n.sun.status).toBe('never_rises'); expect(n.darkness.status).toBe('continuous_darkness'); expect(n.darkness.hours).toBe(24)
})
it('resolves time keywords', () => {
  const n = computeNightEphemeris('2026-09-02', ROQUE)
  expect(resolveTimeKeyword('darkness_start', n)).toBe(n.darkness.startUtc)
  const mid = Date.parse(resolveTimeKeyword('midnight', n)!)
  expect(mid).toBeGreaterThan(Date.parse(n.darkness.startUtc!)); expect(mid).toBeLessThan(Date.parse(n.darkness.endUtc!))
})
it('cache returns the same object for the same key', () => { expect(getNight('2026-09-02', ROQUE)).toBe(getNight('2026-09-02', ROQUE)) })
```

- [ ] Tests first → fail; implement; pass. Keep `computeNightEphemeris` < 60 ms per call (measure in the test with `performance.now()`, assert < 250 ms to be safe on CI).

---

### Task 4: catalog, target positions, visibility, scheduling

**Files:** Create `src/astro/catalog.ts`, `src/astro/targets.ts`, `src/astro/schedule.ts` and their tests.

**Consumes:** `MESSIER, STARS` from `src/data` (T1), `NightEphemeris, Interval, makeObserver` from T3, `HOUR_MS` from T2.

**Produces:**

```ts
// catalog.ts
import { Body } from 'astronomy-engine'
export interface Target {
  id: string                   // 'M31' | 'jupiter' | 'moon' | 'star:vega'
  name: string                 // 'Andromeda Galaxy' | 'Jupiter' | 'Moon' | 'Vega'
  type: TargetType
  kind: 'fixed' | 'body'
  ra?: number; dec?: number    // J2000 degrees, fixed only
  body?: Body                  // astronomy-engine body, 'body' only
  mag: number | null; sizeArcmin: number | null; con: string | null
  aliases: string[]            // lowercase: ['m31', 'andromeda galaxy', 'ngc 224']
}
export function normalizeRA(raDeg: number): number   // ((ra % 360) + 360) % 360
export const PLANETS: Target[]          // Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune (type 'planet')
export const MOON: Target                // id 'moon', type 'moon'
export const BRIGHT_STARS: Target[]      // STARS with a proper name and mag ≤ 1.6, id 'star:<lowercase name>', type 'star'
export const ALL_TARGETS: Target[]       // MESSIER targets + PLANETS + MOON + BRIGHT_STARS
export function getTarget(idOrName: string): Target | undefined  // case/space-insensitive: 'M 31', 'm31', 'Andromeda Galaxy', 'Jupiter'
export function searchTargets(query: string, limit?: number): Target[]

// targets.ts
export interface AltAz { altDeg: number; azDeg: number }
export function targetAltAz(target: Target, date: Date, site: SiteCoords): AltAz   // fixed: Rotation_EQJ_HOR (see T5 sky.ts helpers — duplicate the 10 lines here; do not import sky.ts); bodies: Equator(body, date, obs, true, true) + Horizon(date, obs, ra, dec, 'normal')
export function targetRaDecOfDate(target: Target, date: Date, site: SiteCoords): { raDeg: number; decDeg: number }
export function moonSeparationDeg(target: Target, date: Date, site: SiteCoords): number   // angular distance via vectors (AngleBetween)
export function airmass(altDeg: number): number | null   // Kasten & Young 1989; null when altDeg <= 0
export function compassDirection(azDeg: number): string  // 'N','NNE',... 16 points
export interface VisibilityWindow { startUtc: string; endUtc: string; peakUtc: string; peakAltDeg: number; peakAzDeg: number; peakAirmass: number | null; moonSeparationDeg: number; moonUpFraction: number; minutes: number }
export interface TargetVisibility {
  target: Target; observable: boolean; reason: string | null   // reason when not observable
  window: VisibilityWindow | null                                 // altitude ≥ minAlt within the given interval
  transitUtc: string | null; transitAltDeg: number | null        // culmination within the 24 h window
  altNow?: AltAz                                                   // filled by callers that pass `at`
  score: number                                                   // 0..100
}
export interface VisibilityOptions { minAltDeg: number; interval: Interval | null; stepMinutes?: number; minMoonSepDeg?: number; minWindowMinutes?: number }
export function computeVisibility(target: Target, night: NightEphemeris, site: SiteCoords, opts: VisibilityOptions): TargetVisibility
export interface FindOptions { minAltDeg?: number; types?: TargetType[] | null; maxMag?: number | null; minMoonSepDeg?: number; minWindowMinutes?: number; limit?: number; query?: string | null; ids?: string[] | null; interval?: Interval | null }
export interface FindResult { candidates: TargetVisibility[]; rejected: { id: string; name: string; reason: string }[]; options: Required<FindOptions> }
export function findObservableTargets(night: NightEphemeris, site: SiteCoords, opts: FindOptions): FindResult

// schedule.ts
export interface ScheduleRequest { target: Target; durationMinutes: number; note?: string }
export interface ScheduledBlock { target: Target; startUtc: string; endUtc: string; peakAltDeg: number; note?: string }
export interface ScheduleResult { blocks: ScheduledBlock[]; unscheduled: { targetId: string; name: string; reason: string }[] }
/** Greedy: sort by window peak; place each block centered on its peak inside its window ∩ darkness (or the given interval), shifting to the nearest free slot; occupied = existing plan items. */
export function scheduleTargets(requests: ScheduleRequest[], night: NightEphemeris, site: SiteCoords, opts: { minAltDeg: number; occupied: Interval[]; interval?: Interval | null }): ScheduleResult
```

**Rules.** Default `minAltDeg` 30, `minMoonSepDeg` 30 (only enforced while the Moon is above the horizon at the window peak), `minWindowMinutes` 45, `stepMinutes` 10, `limit` 12. `interval` defaults to the darkness interval; when `night.darkness.status === 'no_astronomical_darkness'`, every fixed target is rejected with `reason: 'no astronomical darkness on this night'` unless the caller passes an explicit interval. Rejection reasons (exact strings, they are shown to users): `'below minimum altitude (peak 12° < 30°)'`, `'never rises above the horizon at this latitude'`, `'window too short (20 min < 45 min)'`, `'too close to the Moon (18° < 30°)'`, `'fainter than magnitude limit (9.5 > 8)'`, `'type excluded by filter'`, `'no astronomical darkness on this night'`. Score = `round(100 * (0.5*min(peakAlt/90,1) + 0.3*min(minutes/240,1) + 0.2*(moonUp ? min(moonSep/90,1) : 1)))`. The Moon itself as a target: observable when above `minAlt` during the interval regardless of Moon separation. Sun is never a target.

**Tests:**

```ts
const ROQUE = {...}; const night = computeNightEphemeris('2026-09-02', ROQUE)
it('normalizeRA wraps degrees', () => { expect(normalizeRA(-170)).toBe(190); expect(normalizeRA(370)).toBe(10); expect(normalizeRA(10.685)).toBeCloseTo(10.685) })
it('getTarget resolves ids and names', () => {
  expect(getTarget('m 31')?.id).toBe('M31'); expect(getTarget('Andromeda Galaxy')?.id).toBe('M31')
  expect(getTarget('Jupiter')?.kind).toBe('body'); expect(getTarget('vega')?.id).toBe('star:vega'); expect(getTarget('Klingon')).toBeUndefined()
})
it('M31 altitude golden (RA units trap)', () => {
  const a = targetAltAz(getTarget('M31')!, new Date('2026-09-03T01:00:00Z'), ROQUE)
  expect(a.altDeg).toBeGreaterThan(60.5); expect(a.altDeg).toBeLessThan(62.5)   // spike golden 61.6° (J2000-as-of-date); rotation gives ~61.4
  const b = targetAltAz(getTarget('M31')!, new Date('2026-09-02T23:00:00Z'), ROQUE)
  expect(b.altDeg).toBeCloseTo(38.97, 0); expect(b.azDeg).toBeCloseTo(58.2, 0)
})
it('Moon altitude just after moonrise is low and positive', () => {
  expect(targetAltAz(MOON, new Date('2026-09-02T23:00:00Z'), ROQUE).altDeg).toBeCloseTo(2.7, 0)
})
it('airmass', () => { expect(airmass(90)).toBeCloseTo(1, 2); expect(airmass(30)!).toBeCloseTo(1.99, 1); expect(airmass(-5)).toBeNull() })
it('find returns candidates and rejections with reasons', () => {
  const r = findObservableTargets(night, ROQUE, { limit: 10 })
  expect(r.candidates.length).toBeGreaterThan(3); expect(r.candidates.length).toBeLessThanOrEqual(10)
  expect(r.candidates.map(c => c.target.id)).toContain('M31')
  expect(r.candidates[0].score).toBeGreaterThanOrEqual(r.candidates[1].score)
  const m7 = r.rejected.find(x => x.id === 'M7'); expect(m7?.reason).toMatch(/altitude|Moon/)   // Scorpius is low/setting in September
  const omega = r.rejected.find(x => x.id === 'M83') // far south... any rejected item has a non-empty reason
  for (const x of r.rejected) expect(x.reason.length).toBeGreaterThan(5)
})
it('no darkness → every fixed target rejected with the darkness reason', () => {
  const tromso = computeNightEphemeris('2026-06-21', { latitude: 69.6492, longitude: 18.9553, elevationM: 10, timeZone: 'Europe/Oslo' })
  const r = findObservableTargets(tromso, { latitude: 69.6492, longitude: 18.9553, elevationM: 10, timeZone: 'Europe/Oslo' }, {})
  expect(r.candidates).toHaveLength(0); expect(r.rejected[0].reason).toMatch(/no astronomical darkness/)
})
it('schedules non-overlapping blocks inside darkness', () => {
  const res = scheduleTargets([{ target: getTarget('M31')!, durationMinutes: 45 }, { target: getTarget('M13')!, durationMinutes: 45 }, { target: getTarget('M45')!, durationMinutes: 45 }], night, ROQUE, { minAltDeg: 30, occupied: [] })
  expect(res.blocks.length + res.unscheduled.length).toBe(3)
  const sorted = [...res.blocks].sort((a, b) => a.startUtc.localeCompare(b.startUtc))
  for (let i = 1; i < sorted.length; i++) expect(Date.parse(sorted[i].startUtc)).toBeGreaterThanOrEqual(Date.parse(sorted[i - 1].endUtc))
  for (const b of res.blocks) { expect(Date.parse(b.startUtc)).toBeGreaterThanOrEqual(Date.parse(night.darkness.startUtc!)); expect(Date.parse(b.endUtc)).toBeLessThanOrEqual(Date.parse(night.darkness.endUtc!)) }
})
```

- [ ] Tests first, then implement, then pass. `findObservableTargets` over 110+ targets must run < 400 ms (assert).

---

### Task 5: `src/astro/rank.ts` and `src/astro/sky.ts` (projection)

**Files:** Create `src/astro/rank.ts`, `src/astro/sky.ts`, tests.

**Produces:**

```ts
// rank.ts
export interface NightScore { nightOf: string; score: number; darkHours: number | null; moonFreeHours: number | null; usableHours: number | null; moonIlluminationPct: number; darknessStatus: DarknessStatus; explanation: string }
/** Scores each date (score = round(min(100, 10 * usableHours)); 0 when no darkness). Checks signal.aborted between nights and throws DOMException('AbortError') when aborted. Sorted best-first, ties by earlier date. */
export function rankNights(dates: string[], site: SiteCoords, signal?: AbortSignal): NightScore[]

// sky.ts — stereographic "dome" projection with astronomy-engine rotation
import type { RotationMatrix } from 'astronomy-engine'
export interface SkyView { centerAltDeg: number; centerAzDeg: number; fovDeg: number }
export const DOME_VIEW: SkyView = { centerAltDeg: 90, centerAzDeg: 0, fovDeg: 186 }   // whole sky, horizon just inside the circle
export const MIN_FOV = 4; export const MAX_FOV = 186
export interface Vec3 { x: number; y: number; z: number }     // x = East, y = North, z = Up
export function altAzToVec(altDeg: number, azDeg: number): Vec3
export function vecToAltAz(v: Vec3): AltAz
export interface ViewFrame { center: Vec3; up: Vec3; right: Vec3; scale: number }  // scale = pixel radius for stereographic
/** Frame for a view in a canvas of w×h CSS px. up = toward zenith (toward North when center is the zenith); right = center × up so that EAST APPEARS ON THE LEFT (we look up at the sky). scale = (min(w,h)/2) / (2*tan(fov/4)). */
export function makeFrame(view: SkyView, width: number, height: number): ViewFrame
/** Stereographic projection. Returns null when the point is more than 179° from the center. x,y in CSS px from the top-left. */
export function project(v: Vec3, frame: ViewFrame, width: number, height: number): { x: number; y: number } | null
export function unproject(x: number, y: number, frame: ViewFrame, width: number, height: number): AltAz | null
export function horizontalRotation(date: Date, site: SiteCoords): RotationMatrix   // Rotation_EQJ_HOR(MakeTime(date), new Observer(...))
/** J2000 RA/Dec (degrees) → horizontal vector using a precomputed rotation (no refraction; fine for a map). */
export function eqjToHorizontalVec(raDeg: number, decDeg: number, rot: RotationMatrix): Vec3
export function angularDistanceDeg(a: Vec3, b: Vec3): number
export function starRadiusPx(mag: number, fovDeg: number): number   // base = clamp(3.4 - 0.6*mag, 0.35, 5.5) * sqrt(186/fovDeg) capped at 9
export function bvToColor(bv: number): string   // -0.4→'#9db4ff', 0→'#cad8ff', 0.3→'#f5f3ff', 0.6→'#fff4e8', 1.0→'#ffd9a8', 1.5→'#ffbf78', ≥2→'#ff9e5e' (linear interpolation between stops)
export function easeInOutCubic(t: number): number
export function interpolateView(from: SkyView, to: SkyView, t: number): SkyView   // shortest azimuth path; fov interpolated in log space
export function clampView(view: SkyView): SkyView   // alt to [-30, 90], az to [0,360), fov to [MIN_FOV, MAX_FOV]
```

**Vector conventions.** `altAzToVec(alt, az) = { x: cos(alt)·sin(az), y: cos(alt)·cos(az), z: sin(alt) }`. astronomy-engine's `Rotation_EQJ_HOR` output vector is in the HOR system where **x = North, y = West, z = Zenith** (see astronomy-engine docs for `HorizonFromVector`); convert to ours with `{ x: -v.y, y: v.x, z: v.z }`. Test this against `Horizon()`.

**Tests:**

```ts
it('rank picks the darkest Moon-free nights of early September 2026', () => {
  const r = rankNights(isoDateRange('2026-08-31', '2026-09-14'), ROQUE)
  expect(r[0].nightOf >= '2026-09-09' && r[0].nightOf <= '2026-09-14').toBe(true)
  const aug31 = r.find(x => x.nightOf === '2026-08-31')!; expect(aug31.score).toBeLessThan(r[0].score); expect(aug31.moonIlluminationPct).toBeGreaterThan(80)
  expect(r[0].explanation).toMatch(/usable|Moon/)
})
it('rank honours AbortSignal', () => { const c = new AbortController(); c.abort(); expect(() => rankNights(['2026-09-01', '2026-09-02'], ROQUE, c.signal)).toThrow(/abort/i) })
it('dome projection: zenith at center, north up, east LEFT, horizon on the circle', () => {
  const f = makeFrame(DOME_VIEW, 800, 800)
  expect(project(altAzToVec(90, 0), f, 800, 800)).toEqual({ x: 400, y: 400 })
  const n = project(altAzToVec(0, 0), f, 800, 800)!; expect(n.x).toBeCloseTo(400, 0); expect(n.y).toBeLessThan(30)   // north on top near the rim
  const e = project(altAzToVec(0, 90), f, 800, 800)!; expect(e.x).toBeLessThan(30); expect(e.y).toBeCloseTo(400, 0)   // east on the LEFT
  const back = unproject(e.x, e.y, f, 800, 800)!; expect(back.altDeg).toBeCloseTo(0, 0); expect(back.azDeg).toBeCloseTo(90, 0)
})
it('zoomed view facing south: up is zenith, east still left', () => {
  const f = makeFrame({ centerAltDeg: 30, centerAzDeg: 180, fovDeg: 60 }, 1000, 700)
  const higher = project(altAzToVec(40, 180), f, 1000, 700)!; expect(higher.y).toBeLessThan(350)
  const east = project(altAzToVec(30, 170), f, 1000, 700)!; expect(east.x).toBeLessThan(500)  // az 170 is toward east when facing south → left
})
it('eqjToHorizontalVec matches astronomy-engine Horizon for M31 within 0.3°', () => {
  const d = new Date('2026-09-02T23:00:00Z'); const rot = horizontalRotation(d, ROQUE)
  const aa = vecToAltAz(eqjToHorizontalVec(10.6847, 41.269, rot))
  expect(aa.altDeg).toBeCloseTo(38.97, 0); expect(aa.azDeg).toBeCloseTo(58.22, 0)
})
it('colors and radii', () => { expect(bvToColor(1.8)).toMatch(/^#ff/); expect(starRadiusPx(-1.4, 186)).toBeGreaterThan(starRadiusPx(3, 186)); expect(starRadiusPx(5, 20)).toBeGreaterThan(starRadiusPx(5, 186)) })
it('interpolateView takes the short way around', () => { const v = interpolateView({ centerAltDeg: 0, centerAzDeg: 350, fovDeg: 60 }, { centerAltDeg: 0, centerAzDeg: 10, fovDeg: 60 }, 0.5); expect(v.centerAzDeg).toBeCloseTo(0, 5) })
```

- [ ] Tests first; implement; pass.

---

### Task 6: `src/state/store.ts` — the collaborative store

**Files:** Create `src/state/types.ts` (the shared vocabulary above, verbatim), rewrite `src/state/store.ts`, create `src/state/store.test.ts`.

**Consumes:** `localDate` (T2), `ROQUE` site constant defined here. Nothing from astro beyond `localDate` (keep the store free of ephemeris math so it stays fast and testable; derived data lives in selectors/components).

**Produces:**

```ts
export const ROQUE_DE_LOS_MUCHACHOS: Site = { id: 'roque', name: 'Roque de los Muchachos, La Palma', latitude: 28.7542, longitude: -17.8851, elevationM: 2396, timeZone: 'Atlantic/Canary' }
export const DEFAULT_FILTERS: Filters = { minAltDeg: 30, types: null, maxMag: null, minMoonSepDeg: 30 }
export const HUMAN_ACTIONS_LIMIT = 20; export const ACTIVITY_LIMIT = 100; export const UNDO_TTL_MS = 5 * 60_000
export type WebMCPStatus = 'pending' | 'registered' | 'unsupported'
export interface RoqueState {
  site: Site; nightOf: string; timeUtc: string
  view: SkyViewState; selectedId: string | null; highlightedIds: string[]; favoriteIds: string[]; filters: Filters
  plan: PlanItem[]; proposals: Proposal[]
  undo: { token: string; plan: PlanItem[]; expiresAt: string } | null
  pendingConfirmation: { tool: string; message: string; at: string } | null
  activity: ActivityEntry[]; humanActions: HumanAction[]
  nightMode: boolean
  webmcp: { status: WebMCPStatus; toolCount: number; toolNames: string[] }
  importBanner: { proposalId: string; observableCount: number; totalCount: number; from: string } | null

  setSite(site: Site, source: ActorSource): void            // also resets nightOf to localDate(site.timeZone) ONLY if the human never chose a night? No: keeps nightOf. Logs 'set_site'.
  setNightOf(nightOf: string, source: ActorSource): void   // also sets timeUtc to nightOf 'T22:00:00Z' placeholder? No: the UI/tool passes an explicit timeUtc afterwards if needed. Logs 'set_night'.
  setTime(isoUtc: string, source: ActorSource, opts?: { silent?: boolean }): void   // silent = slider drag (no activity entry, but human action recorded once per drag end by the UI)
  setView(view: Partial<SkyViewState>, source: ActorSource, opts?: { silent?: boolean }): void
  select(id: string | null, source: ActorSource): void
  setHighlights(ids: string[], source: ActorSource): void
  toggleFavorite(id: string, source: ActorSource): void
  setFilters(patch: Partial<Filters>, source: ActorSource): void
  addProposal(p: Omit<Proposal, 'id' | 'createdAt' | 'status' | 'decisions'>): Proposal
  decideProposalItem(proposalId: string, itemId: string, decision: ProposalDecision, reason: string | undefined, source: ActorSource): void
  commitProposal(proposalId: string, opts: { onlyAccepted: boolean }, source: ActorSource): { applied: PlanItem[]; skipped: PlanItem[] } | null   // null = unknown id; sets status 'committed'; replaceExisting → plan = applied, else plan = plan ∪ applied (sorted by startUtc)
  dismissProposal(proposalId: string, source: ActorSource): void
  setPlan(items: PlanItem[], source: ActorSource, detail: string): void     // sorted by startUtc; logs 'edit_plan' with detail
  clearPlan(source: ActorSource): string                     // returns undo token; empties plan; stores undo with expiresAt
  undoClear(token: string): boolean                          // false if unknown/expired
  setPendingConfirmation(pc: RoqueState['pendingConfirmation']): void
  beginActivity(source: ActorSource, action: string, detail: string): string   // returns id, status 'running'
  endActivity(id: string, status: 'ok' | 'error', result: string, durationMs: number): void
  logActivity(source: ActorSource, action: string, detail: string): void       // one-shot 'ok' entry (used by human UI actions)
  recordHumanAction(kind: HumanActionKind, detail: string): void               // ring buffer of 20, newest first
  toggleNightMode(source: ActorSource): void
  setWebMCPStatus(status: WebMCPStatus, toolNames: string[]): void
  setImportBanner(b: RoqueState['importBanner']): void
}
export const store: StoreApi<RoqueState>        // zustand/vanilla createStore
export function useRoqueStore<T>(selector: (s: RoqueState) => T): T
export function planIntervals(plan: PlanItem[]): Interval[]  // helper for schedulers
```

Every mutating action with a `source` appends an activity entry (`status:'ok'`) unless `silent`, and when `source === 'human'` also records the matching `HumanAction` (kind mapping: setView→'drag_map'/'zoom_map' (zoom when only fov changed), select→'tap_object', toggleFavorite→'toggle_favorite', setTime→'set_time', setNightOf→'set_night', setSite→'set_site', decideProposalItem→'accept_item'/'reject_item', setPlan→'edit_plan', clearPlan→'clear_plan', toggleNightMode→'toggle_night_mode'). Initial state: site ROQUE, nightOf = localDate('Atlantic/Canary'), timeUtc = now ISO, view DOME_VIEW + animate:false, nightMode true.

**Tests:** proposal lifecycle (add → decide reject one with reason → commit onlyAccepted:false applies undecided+accepted, skips rejected, returns both lists; proposal status 'committed'), clear+undo (token restores; expired token → false; unknown → false), activity begin/end (status flips, duration stored, list capped at 100), humanActions capped at 20 newest-first with correct kinds, `setView` with only fov → 'zoom_map', `replaceExisting` semantics, `setPlan` sorts by start.

- [ ] Tests first; implement; pass.

---

### Task 7: tool envelope, schemas, site resolution, dark-sky sites catalog

**Files:** Create `src/tools/envelope.ts`, `src/tools/schemas.ts`, `src/tools/resolveSite.ts`, `src/data/sites.ts`, tests.

**Produces:**

```ts
// envelope.ts
export interface SiteRef { id: string | null; name: string; latitude: number; longitude: number; elevation_m: number; time_zone: string | null }
export interface Stamp { utc: string | null; local: string | null }
export type ToolErrorCode = 'invalid_date' | 'invalid_site' | 'invalid_time_zone' | 'invalid_input' | 'unknown_target' | 'unknown_proposal' | 'unknown_item' | 'confirmation_required' | 'nothing_to_undo' | 'empty_plan' | 'network_error' | 'aborted' | 'internal_error'
export interface ToolOk<T> { ok: true; summary: string; data: T; rejected: { id: string; name: string; reason: string }[]; caveats: string[]; site: SiteRef; as_of: string; tools_added?: string[]; tools_removed?: string[] }
export interface ToolError { ok: false; error: { code: ToolErrorCode; message: string; hint?: string }; as_of: string }
export type ToolResult<T> = ToolOk<T> | ToolError
export function ok<T>(summary: string, data: T, site: Site, extra?: { rejected?: ToolOk<T>['rejected']; caveats?: string[]; tools_added?: string[]; tools_removed?: string[] }): ToolOk<T>
export function fail(code: ToolErrorCode, message: string, hint?: string): ToolError
export function siteRef(site: Site): SiteRef
export function stamp(isoUtc: string | null, timeZone: string | null): Stamp
export function excerpt(s: string, max?: number): string   // ≤ 160 chars, ellipsis
export function defineTool<T>(def: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: ModelContextToolAnnotations; run: (input: Record<string, unknown>, options: { signal?: AbortSignal }) => Promise<ToolResult<T>> | ToolResult<T> }): ModelContextToolDefinition   // wraps run in try/catch → fail('internal_error', String(err)); ALWAYS resolves (never rejects)

// schemas.ts  (JSON Schema fragments reused by tools)
export const DATE_SCHEMA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Local calendar date of the EVENING the night starts (YYYY-MM-DD). Omit for the night currently selected in the app.' }
export const SITE_SCHEMA = { type: 'object', description: 'Observing site. Omit to use the site currently shown in the app. When you pass coordinates, pass BOTH latitude and longitude, and pass time_zone (IANA, e.g. "Pacific/Honolulu") if you want local times; without it only UTC is returned.', properties: { latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Decimal degrees, north positive.' }, longitude: { type: 'number', minimum: -180, maximum: 180, description: 'Decimal degrees, EAST positive (Mauna Kea is -155.47).' }, elevation_m: { type: 'number', minimum: -430, maximum: 9000 }, time_zone: { type: 'string', description: 'IANA time zone name.' }, name: { type: 'string', maxLength: 80 } }, required: ['latitude', 'longitude'], additionalProperties: false }
export const TARGET_TYPES = ['galaxy','open_cluster','globular_cluster','planetary_nebula','diffuse_nebula','supernova_remnant','other','planet','moon','star'] as const
export const TARGET_REF_SCHEMA = { type: 'string', minLength: 1, maxLength: 60, description: 'Target id or name: Messier id ("M31"), planet ("Jupiter"), "Moon", or a bright star name ("Vega").' }

// resolveSite.ts
export function resolveSite(input: unknown, fallback: Site): { site: Site; caveats: string[] } | ToolError
//  - undefined → fallback, no caveats
//  - object with lat/lon: validates ranges & pair; time_zone validated with isValidTimeZone → else fail('invalid_time_zone', ..., hint listing 3 examples)
//  - without time_zone: nearest catalog site within 1.0° (haversine) → use its timeZone + caveat "Time zone inferred from nearby site <name> (<tz>)."; else timeZone null + caveat "Local times omitted: no IANA time zone known for these coordinates. Pass site.time_zone (e.g. 'Pacific/Honolulu') to get local times."
//  - name default `${lat.toFixed(3)}, ${lon.toFixed(3)}`, elevationM default 0, id null (or catalog id when matched within 0.05°)
export function resolveNightOf(input: unknown, fallback: string): string | ToolError   // parseIsoDate or fail('invalid_date', `"${input}" is not a valid calendar date`, 'Use YYYY-MM-DD, e.g. 2026-09-12')

// src/data/sites.ts
export interface DarkSkySite extends Site { id: string; country: string; kind: 'observatory' | 'starlight_reserve' | 'dark_sky_park' }
export const DARK_SKY_SITES: DarkSkySite[]   // ≥ 22 entries with correct IANA zones: Roque de los Muchachos (ES, 28.7542,-17.8851,2396, Atlantic/Canary), Teide/Izaña (28.3005,-16.5097,2390, Atlantic/Canary), Mauna Kea (US, 19.8207,-155.4681,4205, Pacific/Honolulu), Haleakalā (20.7083,-156.2571,3055, Pacific/Honolulu), Paranal (CL, -24.6272,-70.4039,2635, America/Santiago), La Silla (-29.2563,-70.7380,2400, America/Santiago), Cerro Pachón (-30.2446,-70.7494,2715, America/Santiago), Cerro Tololo (-30.1692,-70.8063,2200, America/Santiago), Chajnantor/ALMA (-23.0293,-67.7548,5058, America/Santiago), Kitt Peak (US, 31.9583,-111.5967,2096, America/Phoenix), Mount Graham (32.7016,-109.8919,3221, America/Phoenix), Mount Lemmon (32.4420,-110.7893,2791, America/Phoenix), Palomar (33.3563,-116.8650,1712, America/Los_Angeles), Death Valley Dante's View (36.2203,-116.7264,1669, America/Los_Angeles), Jasper Dark Sky Preserve (CA, 52.8737,-118.0814,1062, America/Edmonton), Pic du Midi (FR, 42.9369,0.1426,2877, Europe/Paris), Calar Alto (ES, 37.2236,-2.5461,2168, Europe/Madrid), Montsec (ES, 42.0517,0.7297,1570, Europe/Madrid), Alqueva (PT, 38.2000,-7.5000,150, Europe/Lisbon), Kerry Dark Sky Reserve (IE, 51.8000,-10.1000,50, Europe/Dublin), Brecon Beacons (GB, 51.8800,-3.4400,500, Europe/London), Westhavelland (DE, 52.7000,12.4000,40, Europe/Berlin), Sutherland/SALT (ZA, -32.3760,20.8107,1798, Africa/Johannesburg), NamibRand (NA, -25.0000,16.0000,1200, Africa/Windhoek), Hanle/IAO (IN, 32.7794,78.9642,4500, Asia/Kolkata), Ali Observatory (CN, 32.3260,80.0260,5100, Asia/Shanghai), Siding Spring (AU, -31.2733,149.0644,1165, Australia/Sydney), Aoraki Mackenzie / Mt John (NZ, -43.9856,170.4650,1029, Pacific/Auckland)
export function nearestSite(lat: number, lon: number): { site: DarkSkySite; distanceKm: number }
export function findSite(idOrName: string): DarkSkySite | undefined
```

**Tests:** every `DARK_SKY_SITES[i].timeZone` passes `isValidTimeZone`; ids unique; `resolveSite({latitude: 19.8207, longitude: -155.4681}, ROQUE)` → timeZone 'Pacific/Honolulu' with inference caveat; `resolveSite({latitude: 0, longitude: 0}, ROQUE)` → timeZone null with the "omitted" caveat; `resolveSite({latitude: 10}, ROQUE)` → `ok:false, code 'invalid_site'`; `resolveSite({latitude: 10, longitude: 20, time_zone: 'Mars/Olympus'}, ROQUE)` → 'invalid_time_zone'; `resolveNightOf('2026-13-99', ...)` → 'invalid_date'; `defineTool` turns a throwing `run` into `ok:false internal_error` (never rejects); `stamp(iso, null).local` is null.

- [ ] Tests first; implement; pass.

---

### Task 8: tools 1, 2, 3, 14 (read-only astronomy + weather)

**Files:** Create `src/tools/getNightEphemeris.ts`, `findObservableTargets.ts`, `rankNights.ts`, `compareDarkSkySites.ts`, `src/weather/openMeteo.ts`, `src/weather/snapshot.json`, tests.

**Consumes:** T2, T3 (`getNight`, `NightEphemeris`), T4 (`findObservableTargets`, `getTarget`, `targetAltAz`), T5 (`rankNights`), T6 (`store`), T7 (envelope, schemas, resolveSite, sites).

**Tool 1 — `get_night_ephemeris`** (annotations `{ readOnlyHint: true, openWorldHint: false, idempotentHint: true }`)

Description (verbatim): `Use this first when planning a night. Returns the astronomical ephemeris for the night that STARTS on the given evening: sunset and sunrise, civil, nautical and astronomical twilight, the true astronomical darkness window (Sun below -18 degrees), Moon rise and set, illumination and phase, total dark hours and how many of them are Moon-free. Pure astronomy computed in the browser with astronomy-engine; it does NOT include weather, seeing or transparency (use compare_dark_sky_sites for a cloud forecast). Defaults to the night and site currently shown in the app. Times are returned as UTC plus site-local time; for custom coordinates pass site.time_zone or you will only get UTC. Polar and high-latitude cases are explicit in data.darkness.status and data.sun.status.`

Input schema: `{ type:'object', properties: { date: DATE_SCHEMA, site: SITE_SCHEMA }, additionalProperties: false }`.

Data: `{ night_of, time_zone, sun: { status, sunset: Stamp, sunrise: Stamp, civil_dusk, nautical_dusk, astronomical_dusk, astronomical_dawn, nautical_dawn, civil_dawn: Stamp }, darkness: { status, start: Stamp, end: Stamp, hours, moon_free_hours, usable_hours, moon_free_intervals: {start: Stamp, end: Stamp}[] }, moon: { illumination_pct, phase, rise: Stamp, set: Stamp, up_during_darkness_pct } }`. Summary examples: `Night of 2026-09-12 at Roque de los Muchachos, La Palma: astronomical darkness 21:39–06:35 local (20:39–05:35 UTC, 8.9 h), Moon 4% (waxing crescent) sets 21:01, 8.9 dark hours are Moon-free.` With unknown zone: `... darkness 05:40–14:55 UTC (9.3 h) ...` plus caveat. Polar: use `night.explanation`.

**Tool 2 — `find_observable_targets`** (`readOnlyHint, !openWorld, idempotent`)

Description: `Use this to learn what is actually worth observing on a night: Messier objects, planets, the Moon and bright stars filtered by minimum altitude, darkness window, Moon separation and magnitude, each with its observing window (start, peak, end), peak altitude and airmass, Moon separation and a 0-100 score. Also returns the objects that were REJECTED and why (too low, Moon too close, window too short, no darkness), so you can explain trade-offs to the person. Defaults to the night, site and filters currently shown in the app. Pass ids to check specific targets.`

Input: `{ date, site, min_altitude_deg: {number, 5..85, default 30}, types: {array of TARGET_TYPES enum}, max_magnitude: {number}, min_moon_separation_deg: {number 0..180, default 30}, min_window_minutes: {integer 10..600, default 45}, limit: {integer 1..40, default 12}, query: {string}, ids: {array of TARGET_REF_SCHEMA, maxItems 40} }`. Unknown ids → listed in `rejected` with reason `'unknown target'` (not an error).

Data: `{ night_of, darkness: {start: Stamp, end: Stamp, status}, candidates: [{ id, name, type, magnitude, constellation, score, window: { start: Stamp, peak: Stamp, end: Stamp, minutes }, peak_altitude_deg, peak_azimuth_deg, peak_direction, peak_airmass, moon_separation_deg, transit: Stamp }], filters_used }`, `rejected` from the engine. Summary: `12 of 118 targets are observable on 2026-09-12 from Roque de los Muchachos above 30°: best are M31 (peak 82°, 22:40 local), M13 ..., 3 more. Rejected 106 (58 below 30°, 40 never rise, ...).`

**Tool 3 — `rank_nights`** (`readOnlyHint, !openWorld, idempotent`)

Description: `Use this to compare many nights and pick the best one instead of calling get_night_ephemeris in a loop. Scores every night in a date range (inclusive, up to 62 nights) by USABLE dark hours: astronomical darkness while the Moon is below the horizon or thinner than 15% illuminated. Returns nights sorted best-first with score (0-100), dark hours, Moon-free hours, Moon illumination and a one-line explanation. Honours cancellation.`

Input: `{ from_date: DATE (required), to_date: DATE (required), site, limit: {integer 1..62, default 10} }`. Range > 62 → `fail('invalid_input')`. Runs `rankNights(dates, site, options.signal)`; on AbortError → `fail('aborted', ...)`.

Data: `{ from_date, to_date, nights_evaluated, best: NightScore-like[] (limit), all_scores: {night_of, score}[] }`. Summary: `Best of 15 nights (2026-08-31 to 2026-09-14) at ...: 2026-09-12 (score 89, 8.9 usable dark hours, Moon 4%), then 2026-09-11 (…), 2026-09-13 (…).`

**Tool 14 — `compare_dark_sky_sites`** (`readOnlyHint: true, openWorldHint: true, idempotentHint: false`)

Description: `Use this to compare the world's dark-sky observatories and Starlight reserves for a night: for each site it returns astronomical darkness hours and Moon-free hours, plus (when the network allows) the night's mean cloud cover, humidity and 200 hPa wind (a seeing proxy) from Open-Meteo in ONE request. Ranks sites by usable dark hours and clear-sky fraction. Pass site_ids to restrict, or include_current_site to add the site shown in the app. This is the ONLY tool that calls an external service; if it fails it falls back to a cached forecast and says so in caveats.`

Input: `{ date, site_ids: {array of string, maxItems 30}, include_current_site: {boolean, default true}, include_weather: {boolean, default true}, limit: {integer 1..30, default 10} }`.

`src/weather/openMeteo.ts`: `fetchNightWeather(sites: {id, latitude, longitude}[], darkness: {startUtc, endUtc}, signal?): Promise<Record<id, NightWeather | null>>` using `https://api.open-meteo.com/v1/forecast?latitude=a,b,c&longitude=x,y,z&hourly=cloud_cover,relative_humidity_2m,wind_speed_10m,wind_speed_200hPa,relative_humidity_700hPa&timezone=UTC&start_date&end_date` (multi-coordinate: comma-separated lists; response is an array when >1 site). `NightWeather = { cloud_cover_pct_mean, cloud_cover_pct_max, humidity_2m_pct_mean, wind_10m_kmh_mean, wind_200hpa_kmh_mean, humidity_700hpa_pct_mean, clear_fraction (hours with cloud_cover < 30 % / hours), source: 'open-meteo' | 'cached', fetched_at }` averaged over darkness hours. 6 s timeout via AbortSignal.timeout + caller signal. On any failure return the cached snapshot from `src/weather/snapshot.json` (generate it NOW with a Node one-off for 2026-09-01..2026-09-05 for the catalog sites; if the network is unavailable while implementing, write a plausible static snapshot and mark `source: 'cached'`; document in a comment). Data per site: `{ id, name, country, latitude, longitude, time_zone, darkness_hours, moon_free_hours, usable_hours, moon_illumination_pct, weather: NightWeather | null, rank_score }` where `rank_score = usable_hours * (weather ? (0.4 + 0.6 * clear_fraction) : 1)`. Summary names the top 3 with their numbers and says whether weather is live or cached.

**Tests** (vitest; mock `fetch` with `vi.stubGlobal`): tool 1 golden night (UTC + local strings), Mauna Kea without zone → `data.time_zone` 'Pacific/Honolulu' inferred with caveat; `{latitude: 0, longitude: 0}` → local null + caveat; `2026-13-99` → `invalid_date`; Tromsø → `data.darkness.status 'no_astronomical_darkness'` and summary contains 'never sets'; tool 2 default call returns candidates incl. M31 and rejected with reasons, unknown id in rejected; tool 3 range and abort; tool 14 with mocked fetch (array response for 3 sites) and with fetch throwing → cached + caveat. Also each tool's inputSchema compiles with Ajv and rejects `additionalProperties`.

- [ ] Tests first; implement; pass.

---

### Task 9: tools 4–11 (map, time, view, ghost plan, plan editing)

**Files:** Create `src/tools/pointSkyMap.ts`, `setObservingTime.ts`, `describeCurrentView.ts`, `proposePlan.ts`, `commitProposal.ts`, `modifyPlan.ts`, `getCurrentPlan.ts`, `clearPlan.ts`, tests.

**Consumes:** T3 (`getNight`, `resolveTimeKeyword`), T4 (`getTarget`, `searchTargets`, `targetAltAz`, `computeVisibility`, `moonSeparationDeg`, `airmass`, `compassDirection`, `scheduleTargets`), T5 (`clampView`, `DOME_VIEW`), T6 (store actions), T7.

**Tool 4 — `point_sky_map`** (`readOnlyHint: false, idempotentHint: true`)

Description: `Use this to move the shared sky map the person is looking at: center it on a target (Messier id like "M31", a planet, "Moon" or a bright star) or on an explicit altitude/azimuth, set the zoom as a field of view in degrees (186 = whole sky dome, 60 = a constellation, 10 = a cluster), and optionally highlight objects. The map animates smoothly so the person sees the move; call describe_current_view afterwards if you need to know what became visible. Returns where the target is at the map's current time (altitude, azimuth, compass direction, above or below the horizon) and warns when it is below the horizon. Does not change the plan.`

Input: `{ target: TARGET_REF, altitude_deg: {-30..90}, azimuth_deg: {0..360}, fov_deg: {4..186}, highlight: {array of TARGET_REF, maxItems 20, description: 'Replaces the current agent highlights; pass [] to clear.'}, reset: {boolean, description: 'Return to the whole-sky dome view.'} }`. Rules: `target` wins over alt/az; unknown target → `fail('unknown_target', ..., hint with 3 searchTargets suggestions)`. Default fov when centring on a target and none given: 40. Below-horizon target: still centre (alt clamped to -30) but caveat `"M31 is below the horizon at 21:00 UTC (altitude -12°); it rises at 22:10 UTC."` (compute rise via `computeVisibility` with minAlt 0 over the 24 h window). Calls `store.setView({...clampView, animate: true}, 'agent')`, `store.select(targetId, 'agent')` when a target was given, `store.setHighlights(ids, 'agent')` when `highlight` given. Data: `{ view: {center_alt_deg, center_az_deg, fov_deg}, time: Stamp, target: { id, name, altitude_deg, azimuth_deg, direction, above_horizon, airmass } | null, highlighted: string[] }`.

**Tool 5 — `set_observing_time`** (`idempotentHint: true`)

Description: `Use this to move the time slider that the sky map and all target positions follow. Pass an ISO 8601 UTC instant ("2026-09-12T22:30:00Z") or a keyword for the selected night: "now", "sunset", "darkness_start", "midnight" (middle of astronomical darkness), "darkness_end", "sunrise". Optionally change the selected night with date (YYYY-MM-DD, the evening the night starts), which recomputes everything in the app. Idempotent.`

Input: `{ time: {string, description: 'ISO 8601 UTC or keyword'}, date: DATE }` (at least one required → else `invalid_input`). Keyword not available (e.g. sunset in polar day) → `fail('invalid_input', 'sunset does not occur on 2026-06-21 at this latitude')`. ISO parse via `Date.parse` (must be finite; if no zone suffix, assume UTC and add caveat). Data: `{ time: Stamp, night_of, sun_altitude_deg, moon_altitude_deg, is_astronomical_darkness }`.

**Tool 6 — `describe_current_view`** (`readOnlyHint: true, idempotentHint: true`)

Description: `Use this to see what the person sees BEFORE proposing anything: site, selected night, slider time, sky-map center and field of view, the objects currently on screen above the horizon (planets, Moon, Messier objects with altitude, azimuth and whether they are inside the field of view), the selected object, the person's favorites (objects they tapped on the map), agent highlights, active filters, a summary of the committed plan, pending proposals with the person's accept/reject decisions and reasons, and the last 20 human actions on the page (drags, taps, edits) with timestamps. Read-only and cheap; call it whenever the person refers to "this", "that one", "here" or "what I'm looking at".`

Input: `{ include_visible_objects: {boolean, default true}, max_visible_objects: {integer 1..60, default 20} }`. Visible objects = MESSIER + PLANETS + MOON above the horizon at `timeUtc`, sorted by (inside fov first, then brightness), each `{ id, name, type, altitude_deg, azimuth_deg, direction, magnitude, in_field_of_view, is_favorite, is_selected, is_highlighted, in_plan }`. Data also: `{ site, night_of, time: Stamp, darkness_status, view, selected, favorites: [{id,name}], highlighted: [...], filters, plan: { items: n, first_start: Stamp, last_end: Stamp, targets: string[] }, proposals: [{ id, status, items: n, decisions: [{item_id, target, decision, reason}] }], recent_human_actions: HumanAction[], night_mode }`. Summary: `Looking at the whole sky (fov 186°) from Roque at 22:30 local on 2026-09-12; 14 catalog objects up, selected M31; favorites: M13, Saturn; plan has 3 items; 1 proposal pending (2 accepted, 1 rejected: "too low"). Last action: tapped M13 12 s ago.`

**Tool 7 — `propose_plan`** (`readOnlyHint: false, destructiveHint: false, idempotentHint: false`)

Description: `Use this to propose an observing plan WITHOUT applying it. The proposal appears on the person's night timeline as a dotted "proposed by agent" ghost plan they can accept or reject item by item (with a reason you can read back). Give targets by id or name, optionally a duration per target and a rationale; the app schedules each target inside its visibility window during astronomical darkness, avoiding overlaps with the existing plan, and returns the proposal_id, the scheduled items with times (UTC and local) and the targets it could NOT fit with reasons. Nothing changes in the committed plan until commit_proposal is called or the person clicks Accept.`

Input: `{ targets: { type:'array', minItems:1, maxItems: 20, items: { type:'object', properties: { target: TARGET_REF, duration_minutes: {integer 10..300, default 45}, note: {string, maxLength 200} }, required: ['target'], additionalProperties:false } }, rationale: {string, maxLength 400}, replace_existing: {boolean, default false}, min_altitude_deg: {5..85} }`. Unknown targets → in `rejected` (reason 'unknown target'), not an error, unless ALL are unknown → `fail('unknown_target')`. Uses `scheduleTargets` with `occupied = replace_existing ? [] : planIntervals(plan)`. Creates the proposal via `store.addProposal({ origin:'agent', ... })` with items `source:'agent'`. Data: `{ proposal_id, items: [{ item_id, target_id, name, start: Stamp, end: Stamp, peak_altitude_deg, note }], unscheduled: [{target_id, name, reason}], replace_existing, how_to_apply: 'Call commit_proposal with this proposal_id after the person reviews it, or they can click Accept in the Plan panel.' }`, `tools_added: ['commit_proposal']` when this is the first pending proposal (T13 registers it; T9 just reports). Summary: `Proposed 4 targets for the night of 2026-09-12 (21:39–06:35 darkness): M31 22:00–22:45, ... ; could not fit M7 (below 30° all night). Waiting for the person's review.`

**Tool 8 — `commit_proposal`** (`destructiveHint: false, idempotentHint: true`)

Description: `Use this to apply a proposal created with propose_plan or import_plan, after the person has had a chance to review it in the Plan panel. Items the person rejected are skipped and returned with their reasons so you can renegotiate; accepted and undecided items are applied. Pass only_accepted:true to apply nothing the person did not explicitly accept. Idempotent: committing twice returns the same result.`

Input: `{ proposal_id: {string, required}, only_accepted: {boolean, default false} }`. Unknown → `fail('unknown_proposal')`. Already committed → `ok` with caveat 'already committed'. Data: `{ proposal_id, applied: item[], skipped: [{item_id, target_id, name, decision, reason}], plan_size }`, `tools_added: ['get_current_plan','modify_plan','clear_plan','export_plan']` when the plan was empty before and now has items.

**Tool 9 — `modify_plan`** (`idempotentHint: true`)

Description: `Use this to edit the committed plan directly in one batch: add targets (auto-scheduled or at a given start time), remove items, move an item, change durations or notes, or reorder. Prefer propose_plan when the person should review first. Returns the resulting plan and each operation's outcome, including failures with reasons. Only available once a plan exists.`

Input: `{ operations: { array minItems 1 maxItems 30 of { type:'object', properties: { op: {enum:['add','remove','move','note','reorder']}, target: TARGET_REF, item_id: {string}, start_utc: {string, ISO}, duration_minutes: {10..300}, note: {string}, item_ids: {array of string} }, required:['op'] } } }`. `add` without `start_utc` → schedule with `scheduleTargets` around existing items; with `start_utc` → place as given (caveat if outside darkness or below min alt). `remove` by `item_id` or `target`. `move` needs `item_id`. `reorder` re-sorts by the given id list keeping times? No: reorder is meaningless with fixed times → it re-schedules the listed items sequentially starting at the first item's start, each in its window if possible (report failures). Apply via `store.setPlan(items, 'agent', detail)`. Data: `{ results: [{ op, ok, item_id?, reason? }], plan: items[] }`.

**Tool 10 — `get_current_plan`** (`readOnlyHint: true, idempotentHint: true`)

Description: `Use this to read the committed observing plan: ordered items with target, scheduled window (UTC and local), altitude at start and end, peak altitude, airmass and Moon separation at mid-block, notes and who added them (person or agent), plus warnings (block outside astronomical darkness, target below the minimum altitude during the block, overlaps) and the status of pending proposals. Read-only.`

Input: `{}` (`additionalProperties:false`). Empty plan → `ok:true` with `data.items: []` and summary 'The plan is empty.' Data: `{ night_of, darkness: {start, end}, items: [{ item_id, target_id, name, type, start: Stamp, end: Stamp, minutes, altitude_start_deg, altitude_end_deg, peak_altitude_deg, airmass_mid, moon_separation_deg, note, source, warnings: string[] }], total_minutes, proposals_pending: n }`.

**Tool 11 — `clear_plan`** (`destructiveHint: true, idempotentHint: false`)

Description: `Use this to delete the whole committed plan. DESTRUCTIVE: requires confirm:true. Without confirm nothing is deleted; instead the app shows the person a confirmation banner and this returns confirmation_required. On success returns an undo_token valid for 5 minutes; call clear_plan again with { undo_token } to restore the plan.`

Input: `{ confirm: {boolean}, undo_token: {string} }`. `undo_token` present → `store.undoClear` → ok or `fail('nothing_to_undo')`. Else no `confirm` → `store.setPendingConfirmation({ tool:'clear_plan', message:'The agent asked to clear the plan. Confirm in the Plan panel or tell the agent to proceed.', at })` and `fail('confirmation_required', ..., 'Ask the person, then call again with confirm:true')`. With confirm → `token = store.clearPlan('agent')`, data `{ removed_items, undo_token, undo_expires_at }`, `tools_removed: ['get_current_plan','modify_plan','clear_plan','export_plan']`.

**Tests** for each tool: happy path against a fresh store (`store.setState(initial)` in `beforeEach`), schema compiles with Ajv, key failure codes, `point_sky_map` sets `view.animate` true and selects, below-horizon caveat, `set_observing_time` keywords, `describe_current_view` lists favorites/decisions/human actions, `propose_plan` → pending proposal with `unscheduled`, `commit_proposal` skips rejected with reason, `modify_plan` add/remove, `clear_plan` three branches, `get_current_plan` warnings for a block placed outside darkness.

- [ ] Tests first; implement; pass.

---

### Task 10: tools 12 and 13 — export, import, open schema, share URL

**Files:** Create `src/plan/serialize.ts`, `src/plan/shareUrl.ts`, `src/tools/exportPlan.ts`, `src/tools/importPlan.ts`, `public/schemas/observing-plan.v1.json`, tests.

**Consumes:** T3, T4 (`getTarget`, `scheduleTargets`, `computeVisibility`), T6, T7.

**Produces:**

```ts
// serialize.ts
export interface ObservingPlanV1 {
  $schema: 'https://roque-nights.netlify.app/schemas/observing-plan.v1.json'
  version: 1
  generator: 'roque-nights'
  created_at: string
  site: { name: string; latitude: number; longitude: number; elevation_m: number; time_zone: string | null }
  night_of: string
  darkness: { start_utc: string | null; end_utc: string | null }
  items: { target_id: string; name: string; start_utc: string; end_utc: string; note?: string; source: 'human' | 'agent' }[]
  author?: string
}
export function toObservingPlanV1(state: Pick<RoqueState,'site'|'nightOf'|'plan'>, darkness: {startUtc, endUtc}, author?: string): ObservingPlanV1
export function parseObservingPlanV1(text: string): { plan: ObservingPlanV1 } | { error: string }   // structural validation by hand (no ajv at runtime): version 1, items array, each item with target_id/start_utc/end_utc ISO
export function toIcs(plan: ObservingPlanV1): string   // VCALENDAR with one VEVENT per item, DTSTART/DTEND in UTC (Z), SUMMARY "Observe M31 (Andromeda Galaxy)", DESCRIPTION with note and site, UID `${target}-${start}@roque-nights`
export function toCsv(plan: ObservingPlanV1): string   // header: target_id,name,start_utc,end_utc,start_local,end_local,note,source (local blank when tz null)

// shareUrl.ts
export function encodePlanToHash(plan: ObservingPlanV1): string   // '#plan=' + base64url(utf8 JSON)   (no compression dependency)
export function decodePlanFromHash(hash: string): ObservingPlanV1 | null
export function buildShareUrl(plan: ObservingPlanV1, origin?: string): string   // `${origin || location.origin}/${hash}`
```

**Tool 12 — `export_plan`** (`readOnlyHint: true, idempotentHint: true`)

Description: `Use this to export the committed plan as a portable document: "json" (the open observing-plan.v1 schema published at /schemas/observing-plan.v1.json; includes site, night and darkness so another observer can import and revalidate it for their own sky), "ics" (calendar events in UTC) or "csv". Also returns a share URL of this app that carries the whole plan; anyone opening it gets the plan revalidated for their site. The person can download the same files from the Plan panel.`

Input: `{ format: {enum:['json','ics','csv'], default 'json'}, include_share_url: {boolean, default true}, author: {string, maxLength 80} }`. Empty plan → `fail('empty_plan')`. Data: `{ format, content: string, filename, share_url, item_count }`.

**Tool 13 — `import_plan`** (`readOnlyHint: false, idempotentHint: false`)

Description: `Use this to bring in another observer's plan and REVALIDATE it for the site and night shown here. Accepts a share URL of this app, an observing-plan.v1 JSON document, or a plain list of target names separated by commas or newlines. Every target is recomputed for THIS sky: targets that remain observable are rescheduled into their local windows; targets that do not work here (never rise at this latitude, below minimum altitude, no darkness, Moon too close) are listed with reasons. Creates a ghost proposal (nothing committed) and returns its proposal_id plus the diff versus the original plan, so you can explain what changed and why. Use commit_proposal to apply.`

Input: `{ source: {string, minLength 1, maxLength 200000, required}, min_altitude_deg: {5..85, default from filters}, keep_original_times: {boolean, default false, description:'Try the original UTC times first when they fall inside this night\'s darkness and the target is up.'} }`. Parsing order: URL with `#plan=` → decode; JSON text → parse; else split names. Data: `{ proposal_id, original: { site, night_of, item_count } | null, kept: [{target_id, name, original: {start,end}, new: {start: Stamp, end: Stamp}, changed: boolean, why: string}], dropped: [{target_id, name, reason}], summary_counts: {kept, dropped} }`, `tools_added: ['commit_proposal']`. Summary: `Imported 5 items from a plan made at Madrid (40.42°N) for 2026-09-12; 4 remain observable from Roque de los Muchachos and were rescheduled (M31 moved 22:10→22:40 because it culminates later here), 1 dropped (M7: below 30°).`

**`public/schemas/observing-plan.v1.json`**: a JSON Schema draft 2020-12 describing `ObservingPlanV1` exactly (ids, formats, required). Test: Ajv validates a `toObservingPlanV1` output against this file; `parseObservingPlanV1(toJSON)` round-trips; `decodePlanFromHash(encodePlanToHash(p))` round-trips; ICS has `BEGIN:VCALENDAR`, one `BEGIN:VEVENT` per item and `DTSTART:20260912T210000Z` format; CSV has header + n rows; `import_plan` with a Madrid-authored plan of `['M31','M13','M7']` for 2026-09-12 from the Roque yields a pending proposal with `dropped` containing M7-or-similar with a reason string; unknown names → dropped 'unknown target'; garbage JSON → `invalid_input`.

- [ ] Tests first; implement; pass.

---

### Task 11: the sky dome (canvas)

**Files:** Create `src/sky/scene.ts`, `src/sky/render.ts`, `src/sky/animate.ts`, `src/sky/interaction.ts`, `src/sky/SkyMap.tsx`, tests for scene/animate (pure parts).

**Consumes:** T1 data, T4 (`ALL_TARGETS`, `targetAltAz` for bodies, `MOON`, `PLANETS`), T5 (`makeFrame`, `project`, `unproject`, `horizontalRotation`, `eqjToHorizontalVec`, `starRadiusPx`, `bvToColor`, `interpolateView`, `easeInOutCubic`, `clampView`, `DOME_VIEW`), T6 store, T3 (`sunAltitudeDeg` for the twilight gradient).

**Produces:**

```ts
// scene.ts (pure, testable in node)
export interface SceneInput { site: SiteCoords; timeUtc: string; view: SkyView; width: number; height: number; maxStarMag: number }
export interface SceneStar { x: number; y: number; r: number; color: string; name: string; mag: number }
export interface SceneObject { id: string; name: string; kind: 'messier' | 'planet' | 'moon' | 'sun'; type: TargetType | 'sun'; x: number; y: number; r: number; altDeg: number; azDeg: number; mag: number | null; extra?: { illuminationPct?: number; phaseAngleDeg?: number } }
export interface ScenePolyline { points: ({ x: number; y: number } | null)[] }   // null breaks the line (behind the projection)
export interface Scene {
  frame: ViewFrame; sunAltDeg: number; horizon: { x: number; y: number }[]   // 360 projected horizon points (alt 0), null-free (skip unprojectable)
  cardinals: { label: 'N' | 'E' | 'S' | 'W' | 'NE' | 'SE' | 'SW' | 'NW'; x: number; y: number; visible: boolean }[]
  milkyWay: { level: number; polygons: ({ x: number; y: number } | null)[][] }[]
  constellations: { id: string; name: string; lines: ScenePolyline[]; label: { x: number; y: number } | null }[]
  stars: SceneStar[]          // only above alt -2° and inside the canvas (+margin)
  objects: SceneObject[]      // Messier (all 110 above horizon), planets, Moon, Sun (Sun only for the glow position)
  belowHorizonMask: boolean   // whether to dim the area below the horizon (always true)
}
export function buildScene(input: SceneInput): Scene   // computes horizontalRotation once; projects everything; culls by canvas bounds with 20 px margin

// animate.ts
export function useAnimatedView(target: SkyViewState, durationMs?: number): SkyView   // React hook: when target.animate is true, eases from the current value with easeInOutCubic over durationMs (default 1200) via requestAnimationFrame; otherwise snaps. Exposes nothing else.
export function createViewAnimator(onFrame: (v: SkyView) => void): { animateTo(from: SkyView, to: SkyView, durationMs: number): void; cancel(): void }   // pure-ish class used by the hook, testable with a fake clock

// interaction.ts
export interface Hit { id: string; name: string; kind: SceneObject['kind'] | 'star'; distancePx: number }
export function hitTest(scene: Scene, x: number, y: number, maxPx?: number): Hit | null   // nearest object (Messier/planet/Moon) within 14 px; stars with a proper name within 8 px as 'star:<name>'
export function dragToView(start: { x: number; y: number; view: SkyView }, current: { x: number; y: number }, frame: ViewFrame, width: number, height: number): SkyView   // rotates center so the sky follows the pointer (unproject start & current, apply the alt/az delta), clamped
export function wheelToFov(fov: number, deltaY: number): number   // exponential zoom, clamped

// render.ts
export interface RenderStyle { nightMode: boolean; dpr: number; selectedId: string | null; highlightedIds: Set<string>; favoriteIds: Set<string>; planIds: Map<string, number>; proposedIds: Set<string>; showConstellationNames: boolean; showLabels: boolean; reticlePulse: number }   // reticlePulse 0..1 for the agent-move pulse animation
export function renderSky(ctx: CanvasRenderingContext2D, scene: Scene, style: RenderStyle): void
```

**Rendering order and look** (respect the aesthetic; the sky must look like a real dark sky, not a UI diagram):
1. Background: radial gradient from the sky color at the zenith to the horizon. Sky color from `sunAltDeg`: < -18 → `#05060A`→`#0a0d16`; -18..-6 twilight → blend toward `#1b2440` then `#3a3f5c`; -6..0 → deep blue `#2b4a7a` with amber horizon; > 0 daylight → `#6e8bb8` (a "daylight" tint; the app also shows a cyan "daytime" badge). Night mode (red light) does NOT change the sky rendering, only the UI chrome.
2. Milky Way: fill polygons per level with `rgba(200,205,240, 0.025 * level)` (ol1 faintest → ol5), `globalCompositeOperation: 'lighter'`. Clip to inside the horizon circle (alt ≥ 0) using a path built from `scene.horizon`.
3. Constellation lines: `rgba(255,180,84,0.18)` 1 px (amber, faint); names in 10 px mono `rgba(255,180,84,0.35)` at label positions when `showConstellationNames` and fov ≤ 120.
4. Stars: batch by color; r < 0.8 → `fillRect`, else `arc`; stars brighter than mag 1.5 get a soft glow (second arc r×2.2 alpha 0.18). Labels for proper names when `fov ≤ 90` and mag ≤ 2.0 (or always when fov ≤ 30), 10 px mono faint.
5. Messier objects: glyph by type at r = clamp(3 + sizeArcmin/40, 3, 9)·zoom: galaxy = tilted ellipse outline; open cluster = dotted circle; globular = circle with cross; planetary nebula = circle with 4 ticks; diffuse nebula = square outline; SNR = diamond; other = small circle. Stroke `rgba(255,180,84,0.85)`. Label `M31` in 10 px when fov ≤ 100 or when selected/highlighted/in plan.
6. Planets: filled disc r 3.5..6 by magnitude, color per planet (Mercury `#c9c2b8`, Venus `#fff1c9`, Mars `#ff8f66`, Jupiter `#f3d3a5`, Saturn `#f0e0b5`, Uranus `#a9e5e8`, Neptune `#7fa4ff`) with a 4-spike sparkle for Venus/Jupiter; always labelled.
7. Moon: disc r = 9·zoom (min 6) drawn as the lit fraction (phase-aware: approximate terminator as an ellipse per `illuminationPct`, lit side toward the Sun's projected position), colour `#f4efe6`; halo radial gradient radius `r·(2 + 4·illum/100)` alpha `0.25·illum/100`.
8. Below-horizon dimming: fill outside the horizon path with `rgba(5,6,10,0.78)`; draw the horizon line `#2a3140` 1.5 px; cardinals `N E S W` in 11 px tracking-wide `#8a93a6` just outside the line, NE/SE/SW/NW smaller.
9. Plan route: numbered amber discs (`#FFB454` bg, `#05060A` text, 14 px) at plan targets in order, connected by a dashed amber path `[4,6]`, alpha 0.6; proposed (ghost) items: dotted ring `#FFB454` alpha 0.55 with a "?" glyph and no route.
10. Favorites: small amber star ✦ badge top-right of the object; selected: amber ring r+6 with 2 px stroke; highlighted by agent: red `#FF5C4D` ring r+9 with 4 ticks; reticle pulse: red concentric ring expanding from the center r = 20..80 px with alpha `1-reticlePulse`, drawn while `reticlePulse < 1`.
11. Time/day badge is NOT drawn on the canvas (UI does it).

**`SkyMap.tsx`**: a `<div class="relative h-full w-full">` with a `<canvas>` sized by `ResizeObserver` (CSS px × `devicePixelRatio`, cap dpr at 2). Reads store: `site, timeUtc, view, selectedId, highlightedIds, favoriteIds, plan, proposals (pending items' targetIds), nightMode`. Uses `useAnimatedView(view)` for the animated view; whenever `view.animate` becomes true with `source: 'agent'`, starts a 900 ms reticle pulse (`reticlePulse` animated 0→1). Rebuilds the scene with `useMemo` on `[site, timeUtc, animatedView, width, height]` and renders in a `useEffect`. Interaction: pointer down/move/up → `dragToView` and `store.setView({...}, 'human', {silent: true})` during the drag, then one `store.recordHumanAction('drag_map', ...)` + `logActivity` on pointer up; wheel → `wheelToFov` (throttled) → `setView` silent + one human action per 400 ms burst; click without drag → `hitTest` → `store.select(id, 'human')` (or `null` when empty sky); double-click / long-press (500 ms) on an object → `store.toggleFavorite(id, 'human')` with a 400 ms amber pulse at the object. Hover: cursor `crosshair`, tooltip `<div>` absolutely positioned near the pointer showing `name · alt 42° · az 118° (ESE)` in 11 px mono; `title` attributes are not enough. Top-left overlay (HTML, not canvas): `FOV 186° · 22:30 local (21:30 UTC)` and, when centered off-zenith, a `⟲ Whole sky` button that calls `setView(DOME_VIEW + animate:true, 'human')`. Bottom-right overlay: `☾ 66%` mini badge. All overlays use the panel palette with 70 % opacity.

**Tests (pure parts):** `buildScene` for the Roque at `2026-09-02T23:00:00Z`, 800×800 dome: has ≥ 1500 stars, includes an object with id `M31` at alt ≈ 39° and a Moon at alt ≈ 2.7°, the horizon has 360 points, 8 cardinals with N near the top (y < 60) and E on the left (x < 60); at fov 30 centered on M31 there are far fewer stars and M31 is within 2 px of the canvas center. `hitTest` finds M31 at its projected position and returns null 40 px away from everything. `createViewAnimator` with a fake `requestAnimationFrame`/clock reaches the target exactly at the end and is monotonic. `wheelToFov` clamps to [4,186]. Performance: `buildScene` for the dome < 40 ms (assert < 150 ms).

- [ ] Tests first for the pure parts; implement `scene.ts`, `interaction.ts`, `animate.ts`, then `render.ts` and `SkyMap.tsx`. Report the frame time you measured in a quick manual run if any.

---

### Task 12: UI panels and the night timeline

**Files:** Create `src/ui/Header.tsx`, `NightStrip.tsx`, `TimeSlider.tsx`, `Inspector.tsx`, `PlanPanel.tsx`, `PlanTimeline.tsx`, `ActivityLog.tsx`, `AgentHarness.tsx`, `SiteForm.tsx`, `ProposalCard.tsx`, `ConfirmBanner.tsx`, `ImportBanner.tsx`, `src/ui/format.ts`, tests for `format.ts` and `PlanTimeline` geometry helpers.

**Consumes:** store (T6), `getNight`/`resolveTimeKeyword` (T3), `getTarget`, `targetAltAz`, `computeVisibility`, `moonSeparationDeg`, `airmass`, `compassDirection`, `scheduleTargets` (T4), `DOME_VIEW` (T5), `DARK_SKY_SITES` (T7), `toObservingPlanV1/toIcs/toCsv/buildShareUrl` (T10), `APP_TOOLS`/`getModelContext` (T13: import `{ APP_TOOLS, getModelContext } from '../webmcp/registerTools'`; T13 guarantees these exports).

**Components (all English copy, panel palette, mono numbers, no em dashes):**

- `Header`: `ROQUE NIGHTS` wordmark (ember), tagline `Agent-native observing planner`, site chip (name · elevation · tz, click opens `SiteForm` dialog), night chip (date input `nightOf`, prev/next night arrows → `setNightOf(...,'human')`), WebMCP badge (live · N tools / unsupported with the flag hint / checking), red-light toggle (`nightMode`: when off, UI chrome uses slightly cooler grays and a cyan accent `#6ee7f0` for "daytime planning"; implement via a `data-daylight` attribute on `<html>` that `index.css` (T14) styles), and a `Daytime` cyan badge when the slider time has Sun altitude > 0.
- `NightStrip`: one row of 6 metrics for `nightOf`: Sunset · Darkness (start–end) · Moon (illum % + phase glyph + rise/set) · Dark h · Moon-free h · Usable h; explicit status text when `darkness.status !== 'ok'` (`No astronomical darkness tonight: the Sun never sets.`). Times in local (`site.timeZone`) with a `UTC` hover; when tz is null, show UTC with a `UTC` tag.
- `TimeSlider`: range over `[windowStart, windowEnd]` of the night in 1-min steps bound to `timeUtc` (silent updates during drag, one activity/human action on release); background shows the twilight bands (from `samples.sunAltDeg`) and a Moon-up band; ticks at sunset/darkness/dawn/sunrise; play button with speeds ×60 / ×600 / ×3600 (rAF loop, wraps at the end); keyword buttons `Sunset · Dark · Midnight · Dawn · Now` (→ `resolveTimeKeyword`); the current label `22:30 local · 21:30 UTC · 2026-09-12`.
- `Inspector` (shows when `selectedId`): name + id + type + magnitude + constellation; live alt/az/direction/airmass at `timeUtc`; tonight: rises above 30° / transit (alt) / sets below 30° (from `computeVisibility` over the darkness window, or `Not observable tonight: <reason>`); Moon separation; buttons: `★ Favorite` toggle, `Point map` (`setView` to the object with fov 40, animate, 'human'), `Add to plan` (schedules 45 min via `scheduleTargets` avoiding the plan → `setPlan(...,'human','add M31')`, or explains why not), `Close`.
- `PlanTimeline` (the visual protagonist beside the dome; SVG, responsive width, ~190 px tall): x axis = the night window; background bands: day / civil / nautical / astronomical twilight / darkness computed from `samples.sunAltDeg` thresholds; Moon-up band hatched with opacity `0.15 + 0.35·illum/100`; one row per plan item (max 8 visible + "+n more"): the target's altitude curve across the night (thin faint line, from 10-min `targetAltAz` samples memoized per target/night), the block as a filled amber rect within its window with the name and time, red outline when a warning applies (outside darkness, below min alt); proposed items as dotted rects with a `?` badge and inline `✓ Accept` / `✗ Reject` buttons (reject opens a 1-line reason input → `decideProposalItem(..., 'human')`); a draggable current-time cursor (→ `setTime`). Hover on a block → tooltip with alt at start/end, airmass, Moon separation. Export a pure helper `timelineGeometry(night, width): { x(iso): number, bands: {kind, x0, x1}[] }` and test it.
- `PlanPanel`: wraps `PlanTimeline`; header `PLAN · 4 items · 3.0 h`; list rows (order, time range local, target, note, source badge HUMAN/AGENT, remove ×); pending `ProposalCard`s (rationale, per-item decisions, `Accept all` / `Commit accepted` / `Dismiss`); export buttons `JSON · ICS · CSV · Copy share link` (download via Blob URL + `<a download>`); `Clear plan` with an inline confirm; `ConfirmBanner` when `pendingConfirmation` is set (`The agent asked to clear the plan` → `Confirm` runs `clearPlan('human')` & clears the pending; `Dismiss`); `Undo` chip while `undo` is valid.
- `ActivityLog`: newest first, each row: source badge (`AGENT` red / `HUMAN` amber), time (local HH:mm:ss), action, detail (truncated), status glyph (`●` running pulsing, `✓` ok, `✗` error), duration `312 ms`, result excerpt on a second faint line. Agent rows get a 1.2 s highlight flash when they appear (`@keyframes` in index.css: `agent-flash`). Max 100 rows, scroll.
- `AgentHarness` (collapsible, closed by default, header `AGENT HARNESS · manual tool calls`): lists `APP_TOOLS` names (from the registry, base + contextual, marked); select one → shows its description and a JSON textarea prefilled with `{}`; `Run` executes it via `getModelContext()?.executeTool` when available (object then JSON-string variant, like `scripts/audit-webmcp.mjs`) else directly via the tool's `execute`; prints the result JSON (pretty) and the `summary` on top. Five copyable prompts under `Agent playbook`: `Plan me tonight from the Roque: darkness, Moon and the 5 best targets, then propose a plan.` / `Point the sky map at Saturn and tell me when it culminates.` / `Which night between Sep 5 and Sep 20 is best here? Set the app to it.` / `What am I looking at right now? Add my favorites to the plan.` / `Compare tonight at Mauna Kea, Paranal and here, weather included.`
- `SiteForm`: the declarative WebMCP form. `<form toolname="set_observing_site" tooldescription="Change the observing site shown in the app. Pick a known dark-sky site by id or enter latitude, longitude (east positive), elevation in metres and an IANA time zone. The whole app (ephemeris, sky map, plan) recomputes for the new site.">` with fields: `<select name="site_id">` (DARK_SKY_SITES + `custom`), `latitude`, `longitude`, `elevation_m`, `time_zone` (datalist of `Intl.supportedValuesOf('timeZone')` when available), `name`. On `submit` → validate (same rules as `resolveSite`) → `setSite(site,'human')`. Listen for the `agentInvoked` event on the form (feature-detect; `event.respondWith` may not exist): fill the fields from `event.data ?? event.detail`, validate, `setSite(site,'agent')` and `respondWith({ ok: true, summary: 'Site set to …' })` or `respondWith({ ok:false, error })`. Also a `Use my location` button (geolocation → custom site with `Intl.DateTimeFormat().resolvedOptions().timeZone`).
- `ImportBanner`: when `importBanner` is set: `Plan imported from <from>: 4 of 5 targets are observable here. Review it in the Plan panel.` with `Dismiss`.
- `format.ts`: `fmtLocal(iso, tz)`, `fmtUtc(iso)`, `fmtHours(h)`, `fmtDeg(d)`, `fmtDuration(ms)`, `phaseGlyph(phaseName)` (🌑🌒🌓🌔🌕🌖🌗🌘 mapped from the 8 names) — tested.

Keyboard: `Esc` closes Inspector/dialogs; `←/→` on the slider moves 10 min; `Space` play/pause when the slider is focused.

- [ ] Write `format.ts` + `timelineGeometry` tests first, then components. Compile-check with `npx tsc --noEmit -p tsconfig.app.json` (your files only). No React Testing Library dependency; component tests are not required.

---

### Task 13: registration, instrumentation, contextual tools

**Files:** Rewrite `src/webmcp/registerTools.ts`, create `src/webmcp/contextual.ts`, tests; extend `src/types/webmcp.d.ts` with `unregisterTool?(name: string): void` and the declarative-form event types (`interface AgentInvokedEvent extends Event { data?: Record<string, unknown>; respondWith?(value: unknown): void }`).

**Consumes:** all tool modules (T8–T10 export `const xxxTool: ModelContextToolDefinition` named exactly: `getNightEphemerisTool`, `findObservableTargetsTool`, `rankNightsTool`, `compareDarkSkySitesTool`, `pointSkyMapTool`, `setObservingTimeTool`, `describeCurrentViewTool`, `proposePlanTool`, `commitProposalTool`, `modifyPlanTool`, `getCurrentPlanTool`, `clearPlanTool`, `exportPlanTool`, `importPlanTool`), store (T6), `excerpt` (T7).

**Produces:**

```ts
export const BASE_TOOLS: ModelContextToolDefinition[]        // 1,2,3,4,5,6,7,13,14 (9 tools, always registered)
export const PLAN_TOOLS: ModelContextToolDefinition[]        // 9,10,11,12 (registered while plan.length > 0)
export const PROPOSAL_TOOLS: ModelContextToolDefinition[]    // 8 (registered while a pending proposal exists)
export const APP_TOOLS: ModelContextToolDefinition[]         // all 14, for the harness/docs
export function getModelContext(): ModelContext | undefined
export function instrument(tool: ModelContextToolDefinition): ModelContextToolDefinition   // beginActivity('agent', name, compactInput) → await execute (try/catch → fail('internal_error')) → endActivity(id, ok? 'ok':'error', result.summary ?? result.error.message, ms)
export async function registerWebMCPTools(): Promise<void>   // registers BASE_TOOLS with one AbortController; then startContextualSync(); sets store.webmcp
export function startContextualSync(mc: ModelContext): () => void   // subscribes to the store; registers/unregisters PLAN_TOOLS and PROPOSAL_TOOLS with their own AbortControllers when the condition flips; updates store.webmcp.toolNames; returns unsubscribe
export function currentToolNames(state: RoqueState): string[]   // pure: base + contextual names for a given state (used by tools to fill tools_added/removed and by tests)
```

Compact input for the activity detail: `JSON.stringify(input)` truncated to 120 chars; `{}` → `no arguments`. Unregistration: prefer `controller.abort()`; if the engine exposes `unregisterTool(name)` use it as well (feature-detect). When WebMCP is missing, still call `startContextualSync` against a no-op context so the harness list stays correct? No: harness reads `APP_TOOLS` + `currentToolNames(state)`; contextual sync only runs with a real context.

**Tests:** `instrument` records running→ok with a duration and the summary excerpt; a tool whose execute throws yields `ok:false internal_error` and an 'error' activity; `currentToolNames` returns 9 names for an empty state, 13 with a plan, 10 with only a pending proposal, 14 with both; `startContextualSync` with a fake `ModelContext` (registerTool records names + signal; abort listener removes) registers PLAN_TOOLS when the plan gets items and unregisters when cleared.

- [ ] Tests first; implement; pass.

---

### Task 14: integration (single agent, after T1–T13)

**Files:** `src/App.tsx`, `src/main.tsx`, `src/index.css`, `index.html`, `scripts/audit-webmcp.mjs`, `README.md`; delete `src/App.css`, `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`, `src/astro/conditions.ts`, `src/tools/getObservingConditions.ts`, `src/tools/getObservingConditions.test.ts`, `scripts/smoke.cjs` (replace by `npm test`).

- Layout (`App.tsx`): `<Header/>` full width; below, `grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-3 p-3 h-[calc(100dvh-56px)]`. Left: `SkyMap` in a panel with `aspect-square lg:aspect-auto lg:h-full` and `TimeSlider` under it. Right column `overflow-y-auto space-y-3`: `ImportBanner`, `ConfirmBanner`, `NightStrip`, `Inspector`, `PlanPanel`, `ActivityLog`, `AgentHarness`. On load: if `location.hash` starts with `#plan=` → run the import through the same code path as the tool (`importPlanTool.execute({ source: location.href })`, source `'human'` for the banner) and set `importBanner`.
- `index.css`: keep the theme tokens; add `html[data-daylight]` variants (cooler panel gray `#0f1420`, accent cyan), `@keyframes agent-flash`, `@keyframes pulse-ring`, scrollbar styling, `font-feature-settings: "tnum"` for numbers, Google Fonts link for IBM Plex Mono in `index.html` (`<link rel="preconnect">` + stylesheet; fallback stack stays).
- `scripts/audit-webmcp.mjs`: update `SAMPLE_INPUTS` for the 14 names (e.g. `get_night_ephemeris: {date:'2026-09-12'}`, `find_observable_targets: {limit:5}`, `rank_nights: {from_date:'2026-09-05', to_date:'2026-09-20', limit:3}`, `point_sky_map: {target:'M31', fov_deg: 40}`, `set_observing_time: {time:'midnight'}`, `describe_current_view: {}`, `propose_plan: {targets:[{target:'M31'},{target:'M13'},{target:'Saturn'}]}`, then `get_current_plan`, `export_plan: {format:'json'}`, `import_plan: {source:'M31, M45, M7'}`, `compare_dark_sky_sites: {limit:3, include_weather:false}`, `clear_plan: {}` (expects confirmation_required), `modify_plan: {operations:[{op:'remove', target:'M13'}]}`) and assert every result parses with `ok` boolean; screenshot after `point_sky_map`.
- `README.md`: rewrite for judges: what it is (2 lines), the thesis paragraph (client-side ⇒ WebMCP is the only way), "Try it with an agent" (Chrome flag, ChatGPT Site tools, URL), the 14-tool table (name · when to use · annotations · contextual?), the declarative form, the open plan schema + share URL, Agent playbook prompts, architecture diagram in text (store ↔ tools ↔ UI), data & licenses (link CREDITS.md), development (`npm i && npm run dev`, `npm test`, `npm run build`), roadmap (weather per site, custom targets, session log), license.
- Run `npm run lint`, `npm test`, `npm run build`, `npm run preview` + `node scripts/audit-webmcp.mjs http://localhost:4173/ docs/screenshots/2026-09-01-audit.png` (Playwright Chromium may lack WebMCP: the script must degrade to calling `window.__roqueTools` directly — expose `APP_TOOLS` on `window.__roqueTools` in `main.tsx` for the audit/harness). Fix everything until green. Report bundle size (gzip) from the build output.

---

### Task 15: adversarial review + fixes (workflow, after T14)

Reviewers (independent lenses): correctness of astronomy vs independent recomputation (spot-check 5 numbers with a fresh Node script using astronomy-engine directly), WebMCP spec compliance (`document.modelContext`, plain return values, annotations, `additionalProperties:false`, descriptions start with "Use this"), tool-description quality for an LLM (would GPT-5.6 pick the right tool? ambiguous names?), UX in a 1100×750 viewport (screenshot review), performance (frame time, bundle), robustness (fuzz each tool with 15 malformed inputs: never throws, always `ok` boolean), security (no `dangerouslySetInnerHTML`, share-URL decode is safe on garbage, `import_plan` size limits). Findings are verified by a second agent before fixes are applied.

---

## Self-review notes

- Spec coverage: 14 tools (T8: 1,2,3,14; T9: 4–11; T10: 12,13) ✓; declarative form ✓ (T12 SiteForm); ghost plan ✓ (T6/T9/T12); contextual registration + `tools_added/removed` ✓ (T9/T13); dome with all layers ✓ (T11); timeline ✓ (T12); red-light toggle ✓ (T12/T14); Open-Meteo + cached snapshot ✓ (T8); schema published + share URL ✓ (T10); addendum fixes: site object (T7), invalid date (T2/T7), polar statuses (T3/T8), activity outcomes (T6/T13/T12), rename (T8) ✓; visual direction (stars by mag/B-V, Milky Way, constellations, Messier glyphs, planets, Moon halo, animations, favorites by tap, timeline, 60 fps, ChatGPT window) ✓ (T11/T12/T14).
- Type names used consistently: `Site`, `SiteCoords` (astro-only subset), `NightEphemeris`, `Interval`, `Target`, `TargetVisibility`, `PlanItem`, `Proposal`, `SkyView` (astro) vs `SkyViewState` (store, adds `animate`), `Stamp`, `ToolResult`.
- PWA/offline: cut (decision 8) unless demonstrated later. Custom-target form: stretch, not in this plan.
