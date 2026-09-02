// Browser-level audit of the 15 Roque Nights tools.
//
// Runs every tool against the PRODUCTION build in a real Chromium, in the order
// a session actually happens: read-only tools first, then propose_plan ->
// commit_proposal, then the contextual plan tools that only exist once there is
// a plan (eleven of the fifteen are registered for the life of the page; the four
// contextual ones are get_current_plan, modify_plan, export_plan and
// commit_proposal). Each result must carry a boolean `ok` AND match the `expect`
// of its entry below; anything that throws, comes back without an `ok` or
// answers something other than what was expected fails the audit (exit 1).
//
// Playwright's Chromium ships no WebMCP engine, so the script degrades: when
// `document.modelContext` is missing it calls the tool objects the page exposes
// on `window.__roqueTools`, which are the very same instrumented declarations
// that would have been registered. It reports what the store says is actually
// registered (`window.__roqueStore.getState().webmcp`) either way.
//
// Usage: node scripts/audit-webmcp.mjs [url] [outPng]

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const url = process.argv[2] ?? 'http://localhost:4173/'
const out = process.argv[3] ?? 'docs/screenshots/2026-09-01-integration.png'

/** The window Roque Nights is designed for: ChatGPT desktop's built-in browser. */
const VIEWPORT = { width: 1100, height: 750 }

/**
 * The sequence. `after` runs the screenshot; `use` threads a value produced by
 * an earlier call (the proposal id) into a later input.
 */
const CALLS = [
  { name: 'get_night_ephemeris', input: { date: '2026-09-12' }, expect: 'ok' },
  { name: 'find_observable_targets', input: { limit: 5 }, expect: 'ok' },
  {
    name: 'rank_nights',
    input: { from_date: '2026-09-05', to_date: '2026-09-20', limit: 3 },
    expect: 'ok',
  },
  { name: 'point_sky_map', input: { target: 'M31', fov_deg: 40 }, expect: 'ok', screenshot: true },
  { name: 'set_observing_time', input: { time: 'midnight' }, expect: 'ok' },
  { name: 'describe_current_view', input: {}, expect: 'ok' },
  { name: 'compare_dark_sky_sites', input: { limit: 3, include_weather: false }, expect: 'ok' },
  {
    name: 'propose_plan',
    input: {
      targets: [{ target: 'M31' }, { target: 'M13' }, { target: 'Saturn' }],
      rationale: 'Two showpieces while the Moon is down, then Saturn near transit.',
    },
    expect: 'ok',
  },
  // Everything below except import_plan and clear_plan is contextual: it only
  // exists because of the two calls above.
  { name: 'commit_proposal', input: {}, use: 'proposal_id', expect: 'ok' },
  { name: 'get_current_plan', input: {}, expect: 'ok' },
  { name: 'modify_plan', input: { operations: [{ op: 'remove', target: 'M13' }] }, expect: 'ok' },
  { name: 'export_plan', input: { format: 'json' }, expect: 'ok' },
  // Late on purpose: the app moves to the other side of the planet with a plan
  // already committed, which is what marks that plan stale, and then comes back.
  // Both calls must succeed; the staleness lives in the payload, not in an error.
  { name: 'set_observing_site', input: { id: 'mauna-kea' }, expect: 'ok' },
  { name: 'set_observing_site', input: { id: 'roque' }, expect: 'ok' },
  { name: 'import_plan', input: { source: 'M31, M45, M7' }, expect: 'ok' },
  // Base, not contextual: clear_plan hands out the undo token, so it stays
  // registered even with an empty plan. No `confirm` here on purpose: the
  // destructive tool must refuse and ask.
  { name: 'clear_plan', input: {}, expect: 'error:confirmation_required' },
]

/** The Chromium Playwright installed here, whatever revision it happens to be. */
function findChromium() {
  const root = path.join(os.homedir(), 'Library/Caches/ms-playwright')
  const candidates = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux/chrome',
  ]
  let revisions = []
  try {
    revisions = fs
      .readdirSync(root)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
  } catch {
    return undefined
  }
  for (const revision of revisions) {
    for (const relative of candidates) {
      const full = path.join(root, revision, relative)
      if (fs.existsSync(full)) return full
    }
  }
  return undefined
}

/** Run one tool the way an agent would, or as directly as this browser allows. */
function callInPage(page, name, input) {
  return page.evaluate(
    async ({ name, input }) => {
      const started = performance.now()
      const mc = document.modelContext ?? navigator.modelContext
      const declared = window.__roqueTools ?? []
      const tool = declared.find((entry) => entry.name === name)

      // The engine hands out its own tool handles; a literal {name} is not one.
      // Contextual tools are absent from this list until the store creates them,
      // which is exactly what the ordering of CALLS is meant to prove.
      let ref = null
      if (mc && typeof mc.getTools === 'function' && typeof mc.executeTool === 'function') {
        try {
          const registered = await mc.getTools()
          ref = registered.find((entry) => entry.name === name) ?? null
        } catch {
          ref = null
        }
      }

      let raw
      let via = 'direct'
      try {
        if (ref) {
          try {
            raw = await mc.executeTool(ref, input)
            via = 'webmcp'
          } catch (first) {
            // Spec PR #246 (Aug 2026) turned the second argument from a JSON
            // string into an object; engines in the wild do one or the other.
            try {
              raw = await mc.executeTool(ref, JSON.stringify(input))
              via = 'webmcp-json'
            } catch (second) {
              throw new Error(
                `object variant: ${first?.message ?? first} | string variant: ${second?.message ?? second}`,
              )
            }
          }
        } else if (tool) {
          raw = await tool.execute(input, {})
        } else {
          return { name, via: 'missing', threw: true, error: `${name} is not on window.__roqueTools` }
        }
      } catch (error) {
        return { name, via, threw: true, error: String(error?.message ?? error) }
      }

      let value = raw
      if (typeof raw === 'string') {
        try {
          value = JSON.parse(raw)
        } catch {
          value = raw
        }
      }
      const hasOk = typeof value?.ok === 'boolean'
      return {
        name,
        via,
        threw: false,
        hasOk,
        ok: hasOk ? value.ok : null,
        code: value?.error?.code ?? null,
        summary: value?.summary ?? value?.error?.message ?? '',
        proposalId: value?.data?.proposal_id ?? null,
        toolsAdded: value?.tools_added ?? [],
        toolsRemoved: value?.tools_removed ?? [],
        ms: Math.round(performance.now() - started),
      }
    },
    { name, input },
  )
}

function readStore(page) {
  return page.evaluate(() => {
    const state = window.__roqueStore?.getState()
    if (!state) return null
    return {
      status: state.webmcp.status,
      registered: state.webmcp.toolNames,
      declared: (window.__roqueTools ?? []).map((tool) => tool.name),
      planItems: state.plan.length,
      proposals: state.proposals.length,
      activity: state.activity.length,
      agentEntries: state.activity.filter((entry) => entry.source === 'agent').length,
    }
  })
}

function pad(text, width) {
  const value = String(text)
  return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length)
}

const executablePath = findChromium()
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  // Best effort: an engine that does not know these flags simply ignores them.
  args: ['--enable-features=WebMCP,WebMCPTesting,EnableWebMCPTesting'],
})
const page = await browser.newPage({ viewport: VIEWPORT })

const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error.message ?? error)))
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => Array.isArray(window.__roqueTools), null, { timeout: 10_000 })

const before = await readStore(page)
console.log(`URL           ${url}`)
console.log(`Chromium      ${executablePath ?? '(playwright default)'}`)
console.log(`Viewport      ${VIEWPORT.width}x${VIEWPORT.height}`)
console.log(`WebMCP        ${before?.status ?? 'unknown'}`)
console.log(
  `Registered    ${before?.registered.length ? before.registered.join(', ') : '(none: this browser exposes no WebMCP engine, calling window.__roqueTools directly)'}`,
)
console.log(`Declared      ${before?.declared.length ?? 0} tools\n`)

const results = []
let proposalId = null

for (const call of CALLS) {
  const input = { ...call.input }
  if (call.use === 'proposal_id') {
    if (!proposalId) {
      results.push({
        name: call.name,
        via: 'skipped',
        threw: true,
        error: 'propose_plan returned no proposal_id',
      })
      continue
    }
    input.proposal_id = proposalId
  }

  const result = await callInPage(page, call.name, input)
  result.expected = call.expect
  if (result.proposalId && call.name === 'propose_plan') proposalId = result.proposalId
  results.push(result)

  if (call.screenshot) {
    // The reticle animation is 900 ms; let it land before the shutter.
    await page.waitForTimeout(1400)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    await page.screenshot({ path: out, fullPage: false })
    console.log(`screenshot after ${call.name}: ${out}\n`)
  }
}

// Second frame: the instrument column scrolled to the bottom, after the whole
// session. This is where the activity log proves every call was attributed.
const sessionShot = out.replace(/\.png$/, '-session.png')
await page.evaluate(() => {
  const column = document.querySelector('.roque-scroll')
  if (column) column.scrollTop = column.scrollHeight
})
await page.waitForTimeout(600)
await page.screenshot({ path: sessionShot, fullPage: false })
console.log(`\nscreenshot after the full session: ${sessionShot}`)

const after = await readStore(page)

console.log(`${pad('TOOL', 26)}${pad('VIA', 14)}${pad('OK', 6)}${pad('MS', 6)}RESULT`)
console.log('-'.repeat(96))
let failures = 0
let mismatches = 0
for (const result of results) {
  const okCell = result.threw ? 'THREW' : result.hasOk ? String(result.ok) : 'NO OK'
  const detail = result.threw
    ? result.error
    : result.ok
      ? result.summary
      : `${result.code}: ${result.summary}`
  const mismatch =
    !result.threw &&
    result.hasOk &&
    ((result.expected === 'ok' && result.ok !== true) ||
      (result.expected?.startsWith('error:') &&
        (result.ok !== false || result.code !== result.expected.slice(6))))
  // A tool that answers the wrong thing is a failed audit, not a footnote: the
  // whole point of `expect` is that clear_plan asks before it deletes.
  if (result.threw || !result.hasOk) failures += 1
  else if (mismatch) mismatches += 1
  console.log(
    `${pad(result.name, 26)}${pad(result.via, 14)}${pad(okCell, 6)}${pad(result.ms ?? '-', 6)}${mismatch ? '[unexpected] ' : ''}${String(detail).replace(/\s+/g, ' ').slice(0, 100)}`,
  )
}

const contextual = results.find((r) => r.name === 'commit_proposal')
console.log('')
console.log(`Plan items    ${after?.planItems} (was ${before?.planItems})`)
console.log(`Proposals     ${after?.proposals}`)
console.log(`Activity      ${after?.activity} entries, ${after?.agentEntries} attributed to AGENT`)
if (contextual?.toolsAdded?.length) {
  console.log(`tools_added   ${contextual.toolsAdded.join(', ')}`)
}
if (pageErrors.length > 0) {
  console.log(`\nPage errors:\n  ${pageErrors.join('\n  ')}`)
}

await browser.close()

if (failures > 0 || mismatches > 0) {
  if (failures > 0) {
    console.error(
      `\nFAILED: ${failures} of ${results.length} tools threw or returned no boolean ok.`,
    )
  }
  if (mismatches > 0) {
    console.error(
      `FAILED: ${mismatches} of ${results.length} tools answered something other than their expected result (marked [unexpected] above).`,
    )
  }
  process.exit(1)
}
console.log(
  `\nPASSED: ${results.length} tools, every result carries a boolean ok and matches its expected outcome.`,
)
