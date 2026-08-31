import { useStore as useZustandStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { localDate } from '../astro/conditions'

export interface Site {
  name: string
  latitude: number
  longitude: number
  elevationM: number
  timeZone: string
}

/** Who performed an action — the collaboration model of the whole app. */
export type ActorSource = 'human' | 'agent'

export interface ActivityEntry {
  at: string
  source: ActorSource
  action: string
  detail: string
}

export type WebMCPStatus = 'pending' | 'registered' | 'unsupported'

interface RoqueNightsState {
  site: Site
  nightOf: string
  webmcp: { status: WebMCPStatus; toolCount: number }
  activityLog: ActivityEntry[]
  setSite: (site: Site, source: ActorSource) => void
  setNightOf: (nightOf: string, source: ActorSource) => void
  setWebMCPStatus: (status: WebMCPStatus, toolCount: number) => void
  logActivity: (source: ActorSource, action: string, detail: string) => void
}

export const ROQUE_DE_LOS_MUCHACHOS: Site = {
  name: 'Roque de los Muchachos, La Palma',
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}

// Vanilla store so WebMCP tools (which live outside React) and UI components
// share one source of truth: every agent action is instantly visible to the
// human, and vice versa.
export const store = createStore<RoqueNightsState>()((set) => ({
  site: ROQUE_DE_LOS_MUCHACHOS,
  nightOf: localDate(ROQUE_DE_LOS_MUCHACHOS.timeZone),
  webmcp: { status: 'pending', toolCount: 0 },
  activityLog: [],
  setSite: (site, source) =>
    set((s) => ({
      site,
      activityLog: appendLog(s.activityLog, source, 'set_site', site.name),
    })),
  setNightOf: (nightOf, source) =>
    set((s) => ({
      nightOf,
      activityLog: appendLog(s.activityLog, source, 'set_night', nightOf),
    })),
  setWebMCPStatus: (status, toolCount) => set({ webmcp: { status, toolCount } }),
  logActivity: (source, action, detail) =>
    set((s) => ({ activityLog: appendLog(s.activityLog, source, action, detail) })),
}))

const LOG_LIMIT = 50

function appendLog(
  log: ActivityEntry[],
  source: ActorSource,
  action: string,
  detail: string,
): ActivityEntry[] {
  const entry: ActivityEntry = { at: new Date().toISOString(), source, action, detail }
  return [entry, ...log].slice(0, LOG_LIMIT)
}

export function useRoqueStore<T>(selector: (s: RoqueNightsState) => T): T {
  return useZustandStore(store, selector)
}
