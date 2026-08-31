// End-to-end WebMCP audit: for every registered tool, execute it through the
// browser's own executeTool() (the same path an agent uses) and verify the
// activity log reflects the call in the UI.
// Usage: node scripts/audit-webmcp.mjs <url> <outPngAfter>
import { chromium } from 'playwright-core'
import os from 'node:os'
import path from 'node:path'

const url = process.argv[2] ?? 'http://localhost:4173/'
const out = process.argv[3] ?? 'audit-after.png'
const exe = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
)

const SAMPLE_INPUTS = {
  get_observing_conditions: { date: '2026-09-02' },
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--enable-features=WebMCP,WebMCPTesting,EnableWebMCPTesting'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

const report = await page.evaluate(async (sampleInputs) => {
  const mc = document.modelContext ?? navigator.modelContext
  if (!mc) return { error: 'no modelContext' }
  const tools = await mc.getTools()
  const results = []
  for (const tool of tools) {
    const input = sampleInputs[tool.name] ?? {}
    // Spec PR #246 (Aug 2026) changed executeTool's input from a JSON string
    // to a plain object; engines in the wild implement one or the other.
    let raw
    let variant = 'object'
    try {
      raw = await mc.executeTool(tool, input)
    } catch {
      try {
        variant = 'json-string'
        raw = await mc.executeTool(tool, JSON.stringify(input))
      } catch (err2) {
        results.push({ name: tool.name, input, ok: false, summary: `EXECUTE FAILED both variants: ${String(err2)}` })
        continue
      }
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    results.push({
      name: tool.name,
      input,
      variant,
      ok: parsed?.ok === true || parsed !== undefined,
      summary: parsed?.summary ?? parsed?.content?.[0]?.text ?? String(raw).slice(0, 200),
    })
  }
  return { toolCount: tools.length, results }
}, SAMPLE_INPUTS)

console.log(JSON.stringify(report, null, 2))
await page.waitForTimeout(400)
await page.screenshot({ path: out, fullPage: false })
console.log('post-execution screenshot:', out)
await browser.close()
