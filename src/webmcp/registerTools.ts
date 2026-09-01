/**
 * Where Roque Nights hands its tools to the browser's agent.
 *
 * Called once from `src/main.tsx` at module level, BEFORE React renders, and
 * deliberately outside any component: React StrictMode double-mounts effects in
 * development, so an AbortController cleaned up in a `useEffect` silently
 * unregisters the tools that were just registered. App-global tools have no
 * reason to live inside the component tree, and the bug only shows up against
 * `npm run build && npm run preview`, which is far too late to find it.
 *
 * Registration is deliberately split in two:
 *  - the nine base tools are registered here, once, for the life of the page;
 *  - the five contextual ones follow the store through `startContextualSync`
 *    (see contextual.ts), so an agent is only offered `modify_plan` when there
 *    is a plan to modify.
 */

import { store } from '../state/store'
import {
  APP_TOOLS,
  BASE_TOOLS,
  INPUT_DETAIL_LIMIT,
  PLAN_TOOLS,
  PROPOSAL_TOOLS,
  currentToolNames,
  instrument,
  startContextualSync,
} from './contextual'

export {
  APP_TOOLS,
  BASE_TOOLS,
  INPUT_DETAIL_LIMIT,
  PLAN_TOOLS,
  PROPOSAL_TOOLS,
  currentToolNames,
  instrument,
  startContextualSync,
}

/** Aborting this drops every base tool at once. */
let baseController: AbortController | null = null
let stopSync: (() => void) | null = null

/**
 * The WebMCP entry point, `document.modelContext` since the May 2026 spec
 * change, with `navigator.modelContext` kept as a fallback for engines that
 * have not moved yet. Returns undefined in a plain browser and under Node.
 */
export function getModelContext(): ModelContext | undefined {
  const doc = typeof document === 'undefined' ? undefined : document
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return doc?.modelContext ?? nav?.modelContext
}

/**
 * Register the base tools and start following the store. Safe to call twice:
 * the previous registration is torn down first, so a hot reload or a second
 * call cannot stack two store subscriptions on one page.
 */
export async function registerWebMCPTools(): Promise<void> {
  stopWebMCPTools()

  const mc = getModelContext()
  if (!mc) {
    // Not an error: the page is fully usable by a human without an agent.
    store.getState().setWebMCPStatus('unsupported', [])
    return
  }

  const controller = new AbortController()
  baseController = controller
  const registered: string[] = []
  for (const tool of BASE_TOOLS) {
    try {
      await mc.registerTool(instrument(tool), { signal: controller.signal })
      registered.push(tool.name)
    } catch {
      // One tool an engine dislikes must not cost the page the other eight.
    }
  }

  if (registered.length === 0) {
    store.getState().setWebMCPStatus('unsupported', [])
    baseController = null
    return
  }

  store.getState().setWebMCPStatus('registered', registered)
  stopSync = startContextualSync(mc, registered)
}

/** Unregister everything this module registered and stop following the store. */
export function stopWebMCPTools(): void {
  stopSync?.()
  stopSync = null
  baseController?.abort()
  baseController = null
}
