import { useStore as useZustandStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  ActivityEntry,
  ActorSource,
  Filters,
  HumanAction,
  HumanActionKind,
  Interval,
  PlanItem,
  Proposal,
  ProposalDecision,
  Site,
  SkyViewState,
} from './types'

// Re-exported so consumers can pull the shared vocabulary straight from the
// store they are already importing.
export type {
  ActivityEntry,
  ActorSource,
  Filters,
  HumanAction,
  HumanActionKind,
  Interval,
  PlanItem,
  Proposal,
  ProposalDecision,
  Site,
  SkyViewState,
  TargetType,
} from './types'

export const ROQUE_DE_LOS_MUCHACHOS: Site = {
  id: 'roque',
  name: 'Roque de los Muchachos, La Palma',
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}

export const DEFAULT_FILTERS: Filters = {
  minAltDeg: 30,
  types: null,
  maxMag: null,
  minMoonSepDeg: 30,
}

export const HUMAN_ACTIONS_LIMIT = 20
export const ACTIVITY_LIMIT = 100
export const UNDO_TTL_MS = 5 * 60_000
/** Longest activity `detail` / `result` string kept; the log is a glance, not a transcript. */
export const DETAIL_LIMIT = 160

/**
 * Whole sky, horizon just inside the circle. Same values as `DOME_VIEW` in
 * src/astro/sky.ts, inlined so the store pulls in no astronomy code.
 */
export const INITIAL_VIEW: SkyViewState = {
  centerAltDeg: 90,
  centerAzDeg: 0,
  fovDeg: 186,
  animate: false,
}

export type WebMCPStatus = 'pending' | 'registered' | 'unsupported'

export interface UndoRecord {
  token: string
  plan: PlanItem[]
  expiresAt: string
}

export interface PendingConfirmation {
  tool: string
  message: string
  at: string
}

export interface ImportBannerState {
  proposalId: string
  observableCount: number
  totalCount: number
  from: string
}

export interface WebMCPState {
  status: WebMCPStatus
  toolCount: number
  toolNames: string[]
}

/** The data half of the store: everything a snapshot or a reset needs. */
export interface RoqueData {
  site: Site
  nightOf: string
  timeUtc: string
  view: SkyViewState
  selectedId: string | null
  highlightedIds: string[]
  favoriteIds: string[]
  filters: Filters
  plan: PlanItem[]
  proposals: Proposal[]
  undo: UndoRecord | null
  pendingConfirmation: PendingConfirmation | null
  activity: ActivityEntry[]
  humanActions: HumanAction[]
  nightMode: boolean
  webmcp: WebMCPState
  importBanner: ImportBannerState | null
}

export interface RoqueState extends RoqueData {
  setSite(site: Site, source: ActorSource): void
  setNightOf(nightOf: string, source: ActorSource): void
  setTime(isoUtc: string, source: ActorSource, opts?: { silent?: boolean }): void
  setView(view: Partial<SkyViewState>, source: ActorSource, opts?: { silent?: boolean }): void
  select(id: string | null, source: ActorSource): void
  setHighlights(ids: string[], source: ActorSource): void
  toggleFavorite(id: string, source: ActorSource): void
  setFilters(patch: Partial<Filters>, source: ActorSource): void
  addProposal(p: Omit<Proposal, 'id' | 'createdAt' | 'status' | 'decisions'>): Proposal
  decideProposalItem(
    proposalId: string,
    itemId: string,
    decision: ProposalDecision,
    reason: string | undefined,
    source: ActorSource,
  ): void
  commitProposal(
    proposalId: string,
    opts: { onlyAccepted: boolean },
    source: ActorSource,
  ): { applied: PlanItem[]; skipped: PlanItem[] } | null
  dismissProposal(proposalId: string, source: ActorSource): void
  setPlan(items: PlanItem[], source: ActorSource, detail: string): void
  clearPlan(source: ActorSource): string
  undoClear(token: string, source?: ActorSource): boolean
  setPendingConfirmation(pc: PendingConfirmation | null): void
  beginActivity(source: ActorSource, action: string, detail: string): string
  endActivity(id: string, status: 'ok' | 'error', result: string, durationMs: number): void
  logActivity(source: ActorSource, action: string, detail: string): void
  recordHumanAction(kind: HumanActionKind, detail: string): void
  toggleNightMode(source: ActorSource): void
  setWebMCPStatus(status: WebMCPStatus, toolNames: string[]): void
  setImportBanner(b: ImportBannerState | null): void
}

// ---------------------------------------------------------------------------
// Small local helpers. The store deliberately knows no astronomy: derived sky
// data lives in src/astro/* and is read by selectors and tools.
// ---------------------------------------------------------------------------

/**
 * Today's calendar date in a zone. Same contract as `localDate` in
 * src/astro/time.ts; duplicated here to keep the store dependency free.
 */
function todayIn(timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function nowIso(): string {
  return new Date().toISOString()
}

function newId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  // randomUUID needs a secure context; keep the app alive on plain http.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function trim(text: string, max = DETAIL_LIMIT): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function pushActivity(log: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  return [entry, ...log].slice(0, ACTIVITY_LIMIT)
}

function pushHumanAction(log: HumanAction[], entry: HumanAction): HumanAction[] {
  return [entry, ...log].slice(0, HUMAN_ACTIONS_LIMIT)
}

function sortPlan(items: PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => a.startUtc.localeCompare(b.startUtc))
}

function mergePlan(current: PlanItem[], incoming: PlanItem[]): PlanItem[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return sortPlan([...byId.values()])
}

function describeView(patch: Partial<SkyViewState>, view: SkyViewState): string {
  const parts: string[] = []
  if (patch.centerAltDeg !== undefined) parts.push(`alt ${round1(view.centerAltDeg)}°`)
  if (patch.centerAzDeg !== undefined) parts.push(`az ${round1(view.centerAzDeg)}°`)
  if (patch.fovDeg !== undefined) parts.push(`fov ${round1(view.fovDeg)}°`)
  if (parts.length > 0) return parts.join(' ')
  return `alt ${round1(view.centerAltDeg)}° az ${round1(view.centerAzDeg)}° fov ${round1(view.fovDeg)}°`
}

function describeFilters(patch: Partial<Filters>): string {
  const parts = Object.entries(patch).map(
    ([key, value]) => `${key}=${Array.isArray(value) ? value.join('|') : String(value)}`,
  )
  return parts.length > 0 ? parts.join(' ') : 'no change'
}

/**
 * Every mutating action carries who did it. This is the collaboration model:
 * one activity entry per action (unless silent) and, for the human, an entry in
 * the 20 action ring buffer the agent reads through describe_current_view.
 */
function withLog(
  state: RoqueData,
  source: ActorSource,
  action: string,
  detail: string,
  opts?: { silent?: boolean; humanKind?: HumanActionKind },
): Pick<RoqueData, 'activity' | 'humanActions'> {
  if (opts?.silent) {
    return { activity: state.activity, humanActions: state.humanActions }
  }
  const at = nowIso()
  const compact = trim(detail)
  const activity = pushActivity(state.activity, {
    id: newId(),
    at,
    source,
    action,
    detail: compact,
    status: 'ok',
  })
  const humanActions =
    source === 'human' && opts?.humanKind
      ? pushHumanAction(state.humanActions, { at, kind: opts.humanKind, detail: compact })
      : state.humanActions
  return { activity, humanActions }
}

/** A pristine data snapshot. Tests and the UI reset with `store.setState(createInitialState())`. */
export function createInitialState(): RoqueData {
  return {
    site: ROQUE_DE_LOS_MUCHACHOS,
    nightOf: todayIn(ROQUE_DE_LOS_MUCHACHOS.timeZone),
    timeUtc: nowIso(),
    view: { ...INITIAL_VIEW },
    selectedId: null,
    highlightedIds: [],
    favoriteIds: [],
    filters: { ...DEFAULT_FILTERS },
    plan: [],
    proposals: [],
    undo: null,
    pendingConfirmation: null,
    activity: [],
    humanActions: [],
    nightMode: true,
    webmcp: { status: 'pending', toolCount: 0, toolNames: [] },
    importBanner: null,
  }
}

// Vanilla store so WebMCP tools (which live outside React) and UI components
// share one source of truth: every agent action is instantly visible to the
// human, and vice versa.
export const store: StoreApi<RoqueState> = createStore<RoqueState>()((set, get) => ({
  ...createInitialState(),

  setSite: (site, source) =>
    set((s) => ({ site, ...withLog(s, source, 'set_site', site.name, { humanKind: 'set_site' }) })),

  setNightOf: (nightOf, source) =>
    set((s) => ({
      nightOf,
      ...withLog(s, source, 'set_night', nightOf, { humanKind: 'set_night' }),
    })),

  setTime: (isoUtc, source, opts) =>
    set((s) => ({
      timeUtc: isoUtc,
      ...withLog(s, source, 'set_time', isoUtc, { silent: opts?.silent, humanKind: 'set_time' }),
    })),

  setView: (patch, source, opts) =>
    set((s) => {
      const view: SkyViewState = { ...s.view, ...patch, animate: patch.animate ?? false }
      const moved = (['centerAltDeg', 'centerAzDeg', 'fovDeg'] as const).filter(
        (key) => patch[key] !== undefined,
      )
      const zoomOnly = moved.length === 1 && moved[0] === 'fovDeg'
      return {
        view,
        ...withLog(s, source, 'set_view', describeView(patch, view), {
          silent: opts?.silent,
          humanKind: zoomOnly ? 'zoom_map' : 'drag_map',
        }),
      }
    }),

  select: (id, source) =>
    set((s) => ({
      selectedId: id,
      ...withLog(s, source, 'select_object', id ?? 'none', { humanKind: 'tap_object' }),
    })),

  setHighlights: (ids, source) =>
    set((s) => ({
      highlightedIds: [...ids],
      ...withLog(s, source, 'set_highlights', ids.length > 0 ? ids.join(', ') : 'cleared'),
    })),

  toggleFavorite: (id, source) =>
    set((s) => {
      const had = s.favoriteIds.includes(id)
      return {
        favoriteIds: had ? s.favoriteIds.filter((f) => f !== id) : [...s.favoriteIds, id],
        ...withLog(s, source, 'toggle_favorite', `${id} ${had ? 'removed' : 'added'}`, {
          humanKind: 'toggle_favorite',
        }),
      }
    }),

  setFilters: (patch, source) =>
    set((s) => ({
      filters: { ...s.filters, ...patch },
      ...withLog(s, source, 'set_filters', describeFilters(patch)),
    })),

  addProposal: (p) => {
    const proposal: Proposal = {
      ...p,
      items: p.items.map((item) => (item.id ? item : { ...item, id: newId() })),
      id: newId(),
      createdAt: nowIso(),
      status: 'pending',
      decisions: {},
    }
    set((s) => ({ proposals: [proposal, ...s.proposals] }))
    return proposal
  },

  decideProposalItem: (proposalId, itemId, decision, reason, source) => {
    const proposal = get().proposals.find((p) => p.id === proposalId)
    // A committed proposal is history: decisions on it are ignored on purpose.
    if (!proposal || proposal.status === 'committed') return
    const item = proposal.items.find((i) => i.id === itemId)
    if (!item) return
    const at = nowIso()
    const action = decision === 'accepted' ? 'accept_item' : 'reject_item'
    set((s) => ({
      proposals: s.proposals.map((p) =>
        p.id === proposalId
          ? { ...p, decisions: { ...p.decisions, [itemId]: { decision, reason, at } } }
          : p,
      ),
      ...withLog(s, source, action, reason ? `${item.targetName}: ${reason}` : item.targetName, {
        humanKind: decision === 'accepted' ? 'accept_item' : 'reject_item',
      }),
    }))
  },

  commitProposal: (proposalId, opts, source) => {
    const proposal = get().proposals.find((p) => p.id === proposalId)
    if (!proposal) return null
    const applied: PlanItem[] = []
    const skipped: PlanItem[] = []
    for (const item of proposal.items) {
      const decision = proposal.decisions[item.id]?.decision
      const keep = opts.onlyAccepted ? decision === 'accepted' : decision !== 'rejected'
      ;(keep ? applied : skipped).push(item)
    }
    set((s) => ({
      // Merging by id keeps a second commit of the same proposal idempotent.
      plan: proposal.replaceExisting ? sortPlan(applied) : mergePlan(s.plan, applied),
      proposals: s.proposals.map((p) =>
        p.id === proposalId ? { ...p, status: 'committed' as const } : p,
      ),
      ...withLog(
        s,
        source,
        'commit_proposal',
        `${applied.length} applied, ${skipped.length} skipped`,
      ),
    }))
    return { applied, skipped }
  },

  dismissProposal: (proposalId, source) => {
    const proposal = get().proposals.find((p) => p.id === proposalId)
    if (!proposal || proposal.status === 'committed') return
    set((s) => ({
      proposals: s.proposals.map((p) =>
        p.id === proposalId ? { ...p, status: 'dismissed' as const } : p,
      ),
      ...withLog(s, source, 'dismiss_proposal', proposalId),
    }))
  },

  setPlan: (items, source, detail) =>
    set((s) => ({
      plan: sortPlan(items),
      ...withLog(s, source, 'edit_plan', detail, { humanKind: 'edit_plan' }),
    })),

  clearPlan: (source) => {
    const token = newId()
    const removed = get().plan
    set((s) => ({
      plan: [],
      undo: { token, plan: removed, expiresAt: new Date(Date.now() + UNDO_TTL_MS).toISOString() },
      pendingConfirmation:
        s.pendingConfirmation?.tool === 'clear_plan' ? null : s.pendingConfirmation,
      ...withLog(s, source, 'clear_plan', `${removed.length} item${removed.length === 1 ? '' : 's'}`, {
        humanKind: 'clear_plan',
      }),
    }))
    return token
  },

  undoClear: (token, source) => {
    const undo = get().undo
    if (!undo || undo.token !== token) return false
    if (Date.parse(undo.expiresAt) <= Date.now()) {
      set({ undo: null })
      return false
    }
    set((s) => ({
      plan: sortPlan(undo.plan),
      undo: null,
      ...(source
        ? withLog(s, source, 'undo_clear', `${undo.plan.length} item${undo.plan.length === 1 ? '' : 's'} restored`)
        : {}),
    }))
    return true
  },

  setPendingConfirmation: (pc) => set({ pendingConfirmation: pc }),

  beginActivity: (source, action, detail) => {
    const id = newId()
    set((s) => ({
      activity: pushActivity(s.activity, {
        id,
        at: nowIso(),
        source,
        action,
        detail: trim(detail),
        status: 'running',
      }),
    }))
    return id
  },

  endActivity: (id, status, result, durationMs) =>
    set((s) => ({
      activity: s.activity.map((entry) =>
        entry.id === id ? { ...entry, status, result: trim(result), durationMs } : entry,
      ),
    })),

  logActivity: (source, action, detail) =>
    set((s) => ({
      activity: pushActivity(s.activity, {
        id: newId(),
        at: nowIso(),
        source,
        action,
        detail: trim(detail),
        status: 'ok',
      }),
    })),

  recordHumanAction: (kind, detail) =>
    set((s) => ({
      humanActions: pushHumanAction(s.humanActions, { at: nowIso(), kind, detail: trim(detail) }),
    })),

  toggleNightMode: (source) =>
    set((s) => ({
      nightMode: !s.nightMode,
      ...withLog(s, source, 'toggle_night_mode', s.nightMode ? 'off' : 'on', {
        humanKind: 'toggle_night_mode',
      }),
    })),

  setWebMCPStatus: (status, toolNames) =>
    set({ webmcp: { status, toolCount: toolNames.length, toolNames: [...toolNames] } }),

  setImportBanner: (b) => set({ importBanner: b }),
}))

export function useRoqueStore<T>(selector: (s: RoqueState) => T): T {
  return useZustandStore(store, selector)
}

/** Occupied spans of the committed plan, for the schedulers in src/astro. */
export function planIntervals(plan: PlanItem[]): Interval[] {
  return plan
    .map((item) => ({ startUtc: item.startUtc, endUtc: item.endUtc }))
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
}

/** Back to a pristine session. Used by tests and by the "reset" affordance. */
export function resetStore(): void {
  store.setState(createInitialState())
}
