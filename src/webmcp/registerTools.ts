import { store } from '../state/store'
import { getObservingConditionsTool } from '../tools/getObservingConditions'

/**
 * Registered once at module level, BEFORE React renders. Deliberately outside
 * any component: React StrictMode double-mounts effects in dev, and an
 * AbortController cleanup there silently unregisters freshly-registered tools.
 * App-global tools have no reason to live inside the component tree.
 */
export const APP_TOOLS: ModelContextToolDefinition[] = [getObservingConditionsTool]

function instrument(tool: ModelContextToolDefinition): ModelContextToolDefinition {
  return {
    ...tool,
    execute: async (input, options) => {
      store.getState().logActivity('agent', tool.name, JSON.stringify(input))
      return tool.execute(input, options)
    },
  }
}

export function getModelContext(): ModelContext | undefined {
  return document.modelContext ?? navigator.modelContext
}

export async function registerWebMCPTools(): Promise<void> {
  const mc = getModelContext()
  if (!mc) {
    store.getState().setWebMCPStatus('unsupported', 0)
    return
  }
  const controller = new AbortController()
  for (const tool of APP_TOOLS) {
    await mc.registerTool(instrument(tool), { signal: controller.signal })
  }
  store.getState().setWebMCPStatus('registered', APP_TOOLS.length)
}
