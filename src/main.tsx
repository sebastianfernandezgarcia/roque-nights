import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import App from './App.tsx'
import { store } from './state/store'
import { APP_TOOLS, registerWebMCPTools } from './webmcp/registerTools'

// Register the site tools before the first render and OUTSIDE the React tree.
// StrictMode double-mounts effects, so an AbortController cleaned up in a
// useEffect silently unregisters the tools it had just registered, and the bug
// only shows against `npm run build && npm run preview`. Fire and forget: the
// store carries the status and the Header badge reads it.
void registerWebMCPTools()

// Handles for the audit script and for a devtools console. Not an API: the app
// itself never reads them.
window.__roqueTools = APP_TOOLS
window.__roqueStore = store

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
