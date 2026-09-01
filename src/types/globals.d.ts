/**
 * The two handles Roque Nights hangs off `window`.
 *
 * They exist for the audit script (`scripts/audit-webmcp.mjs`), which has to
 * work in a Playwright Chromium that ships no WebMCP engine: it calls the tool
 * objects directly and reads the tool names the store would register. They are
 * also the fastest way to poke the app from a devtools console.
 *
 * Read-only by convention: nothing in the app ever writes through them.
 */
export {}

declare global {
  interface Window {
    /** The 14 instrumented tool declarations, in the numbering of docs/PLAN.md. */
    __roqueTools?: ModelContextToolDefinition[]
    /** The vanilla Zustand store both the UI and the tools write to. */
    __roqueStore?: import('zustand/vanilla').StoreApi<import('../state/store').RoqueState>
  }
}
