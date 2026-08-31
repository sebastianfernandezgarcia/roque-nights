import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerWebMCPTools } from './webmcp/registerTools'

// Register site tools before first render, outside the React tree (see
// registerTools.ts for why). Fire-and-forget: the store carries the status.
void registerWebMCPTools()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
