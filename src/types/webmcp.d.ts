/**
 * Type declarations for the experimental WebMCP API.
 *
 * Surface verified on 2026-08-31 against three primary sources that agree:
 *  - the spec source (webmachinelearning/webmcp index.bs): the API lives on
 *    `document.modelContext` (moved off `navigator` in May 2026, PR #184),
 *  - ChatGPT "Site tools" docs (learn.chatgpt.com/docs/webmcp),
 *  - Cloudflare's official webmcp-react example.
 *
 * `navigator.modelContext` is kept as an optional fallback for engines that
 * still expose the pre-May-2026 location.
 */
export {}

declare global {
  interface ModelContextToolAnnotations {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }

  interface ModelContextToolDefinition {
    name: string
    title?: string
    description: string
    inputSchema?: Record<string, unknown>
    annotations?: ModelContextToolAnnotations
    /** Returns any JSON-serializable value; the browser serializes it. */
    execute: (
      input: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ) => Promise<unknown> | unknown
  }

  interface RegisteredModelContextTool {
    name: string
    description?: string
  }

  interface ModelContext extends EventTarget {
    registerTool(
      tool: ModelContextToolDefinition,
      options?: { signal?: AbortSignal },
    ): Promise<void>
    getTools(): Promise<RegisteredModelContextTool[]>
    executeTool(
      tool: RegisteredModelContextTool,
      input?: Record<string, unknown>,
    ): Promise<string>
    ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null
  }

  interface Document {
    readonly modelContext?: ModelContext
  }

  interface Navigator {
    /** Pre-May-2026 location of the API; kept as fallback only. */
    readonly modelContext?: ModelContext
  }
}
