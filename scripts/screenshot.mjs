// Screenshot + WebMCP registration probe against the production build.
// Usage: node scripts/screenshot.mjs <url> <outPng>
import { chromium } from 'playwright-core'
import os from 'node:os'
import path from 'node:path'

const url = process.argv[2] ?? 'http://localhost:4173/'
const out = process.argv[3] ?? 'app.png'
const exe = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
)

const browser = await chromium.launch({
  executablePath: exe,
  // Best-effort attempts at the WebMCP runtime flag; unknown features are ignored.
  args: ['--enable-features=WebMCP,WebMCPTesting,EnableWebMCPTesting'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const probe = await page.evaluate(async () => {
  const mc = document.modelContext ?? navigator.modelContext
  const base = {
    documentModelContext: typeof document.modelContext,
    navigatorModelContext: typeof navigator.modelContext,
  }
  if (!mc) return { ...base, tools: null }
  try {
    const tools = await mc.getTools()
    return { ...base, tools: tools.map((t) => t.name) }
  } catch (err) {
    return { ...base, tools: `getTools failed: ${String(err)}` }
  }
})
console.log('WebMCP probe:', JSON.stringify(probe))

await page.screenshot({ path: out, fullPage: true })
console.log('screenshot saved:', out)
await browser.close()
