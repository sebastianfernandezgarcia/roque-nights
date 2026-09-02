/**
 * The six screen recordings for the Roque Nights submission video.
 *
 * Every agent action in these clips is a real WebMCP call against the deployed
 * app: `document.modelContext.getTools()` for the handle, then
 * `executeTool(ref, JSON.stringify(input))`, which is the form Chromium's engine
 * accepts (the object form throws). Every human action is a real pointer event
 * through CDP, with a drawn cursor injected into the page so the audience can
 * see the hand. Nothing here pokes the store to fake a result; the store is
 * touched only to REBUILD PRE-STATE before a clip's timer starts, and only where
 * the scene notes say so.
 *
 * Output (the contract both this script and the Remotion composition code against):
 *
 *   video/public/clips/01-onboarding.mp4 ... 06-dome.mp4
 *       H.264, 1920x1080, 30 fps, yuv420p, no audio
 *   video/public/clips/log.json
 *       { recordedAt, url, clips: [{ id, file, durationMs, events }], facts }
 *
 * `events[].atMs` is measured from the clip's FIRST FRAME (the moment the page
 * is created, which is when Playwright starts the video), so the composition can
 * place a "TOOL CALL · <name>" chip without guessing. A tool event is stamped
 * the instant its call RESOLVED. Each clip also carries a `firstActionAtMs`
 * note: everything before it is page load and pre-state, safe to trim.
 *
 * Usage:
 *   node scripts/video/record.mjs                # all six clips
 *   node scripts/video/record.mjs 03 05          # re-record two, keep the rest
 *   ROQUE_URL=http://localhost:4173 node scripts/video/record.mjs
 *
 * Re-running is safe: clips are overwritten in place and log.json is merged.
 */

import { chromium } from 'playwright-core'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const CLIPS_DIR = path.join(REPO, 'video/public/clips')
const RAW_DIR = path.join(os.tmpdir(), 'roque-nights-video-raw')

const URL = process.env.ROQUE_URL ?? 'https://roque-nights.netlify.app'
const VIEWPORT = { width: 1920, height: 1080 }
const ONBOARDING_KEY = 'roque-nights.onboarding.v1'

/** The dome swing is 900 ms and the reticle pulses after it; 1.6 s is settled. */
const SWING_MS = 1600

// ---------------------------------------------------------------- utilities

function log(...parts) {
  const stamp = new Date().toISOString().slice(11, 19)
  console.log(`[${stamp}] ${parts.join(' ')}`)
}

/** The newest Chromium Playwright has on this machine. */
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

/** 'YYYY-MM-DD' for a date in the site's zone; the app's night ids are local dates. */
function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addDays(iso, days) {
  const ms = Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** '2026-09-13 22:14' -> '22:14'. The stamps carry their date; a chip does not. */
function clockOf(stampLocal) {
  if (typeof stampLocal !== 'string') return null
  const match = stampLocal.match(/(\d{2}:\d{2})/)
  return match ? match[1] : stampLocal
}

// --------------------------------------------------------- the drawn cursor

/**
 * A 26 px arrow that follows the real pointer, plus a 400 ms amber ring on every
 * press. Injected before the app's own scripts and parented to <html>, so React
 * never owns it. Hidden until the pointer first moves: an arrow parked at 0,0
 * before the scene starts reads as a rendering bug.
 */
function installCursor() {
  const ID = '__roque_cursor__'
  const install = () => {
    if (document.getElementById(ID)) return
    const root = document.documentElement
    if (!root) return
    const wrap = document.createElement('div')
    wrap.id = ID
    wrap.setAttribute('aria-hidden', 'true')
    wrap.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:0',
      'height:0',
      'z-index:2147483647',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 140ms linear',
      'will-change:transform',
    ].join(';')
    wrap.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 26 26" style="position:absolute;left:-1px;top:-1px;' +
      'filter:drop-shadow(0 2px 4px rgba(0,0,0,.75))">' +
      '<path d="M3 1.5 L3 20.5 L8.4 15.4 L11.9 23 L15.6 21.3 L12.2 13.9 L19.5 13.6 Z" ' +
      'fill="#ffffff" stroke="#0b0e14" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
      '<div id="' +
      ID +
      'ring" style="position:absolute;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;' +
      'border-radius:50%;border:2px solid #ffb454;opacity:0"></div>'
    root.appendChild(wrap)

    const ring = document.getElementById(`${ID}ring`)
    let shown = false
    const move = (event) => {
      wrap.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`
      if (!shown) {
        shown = true
        wrap.style.opacity = '1'
      }
    }
    document.addEventListener('mousemove', move, { capture: true, passive: true })
    document.addEventListener('pointermove', move, { capture: true, passive: true })
    document.addEventListener(
      'mousedown',
      () => {
        if (!ring || typeof ring.animate !== 'function') return
        ring.animate(
          [
            { opacity: 0.95, transform: 'scale(0.3)' },
            { opacity: 0, transform: 'scale(1.7)' },
          ],
          { duration: 400, easing: 'cubic-bezier(0.2,0.7,0.3,1)' },
        )
      },
      { capture: true, passive: true },
    )
  }
  install()
  document.addEventListener('DOMContentLoaded', install)
}

/** Pre-seed the tour's dismissal flag so clips 02-06 never see the modal. */
function seedOnboardingSeen() {
  try {
    window.localStorage.setItem('roque-nights.onboarding.v1', new Date().toISOString())
  } catch {
    // Private mode; the scene falls back to pressing Escape.
  }
}

// ------------------------------------------------------------------- Scene

/**
 * One clip: its own browser context, its own video file, its own event list.
 * `t0` is taken the moment the page exists, which is the moment Playwright
 * starts writing frames, so every `atMs` is an offset into the finished clip.
 */
class Scene {
  constructor(browser, spec) {
    this.browser = browser
    this.spec = spec
    this.events = []
    this.firstActionAtMs = null
    this.warnings = []
  }

  async open({ seedTour = true } = {}) {
    const context = await this.browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      permissions: ['clipboard-read', 'clipboard-write'],
      recordVideo: { dir: RAW_DIR, size: { width: VIEWPORT.width, height: VIEWPORT.height } },
    })
    await context.addInitScript(installCursor)
    if (seedTour) await context.addInitScript(seedOnboardingSeen)

    this.context = context
    const page = await context.newPage()
    // Recording begins with the page. Everything is measured from here.
    this.t0 = Date.now()
    this.page = page
    this.video = page.video()

    page.on('pageerror', (error) => this.warnings.push(`pageerror: ${error.message ?? error}`))

    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Array.isArray(window.__roqueTools), null, { timeout: 20_000 })
    // The badge is the app's own statement that the engine registered the tools.
    await page.waitForFunction(
      () => document.body.innerText.toLowerCase().includes('webmcp live'),
      null,
      { timeout: 20_000 },
    )
    await page.waitForTimeout(600)
    return page
  }

  get atMs() {
    return Date.now() - this.t0
  }

  /** Stamp an event at this instant. Tool events are stamped after the call resolves. */
  mark(kind, label, detail) {
    const event = { atMs: this.atMs, kind, label }
    if (detail !== undefined) event.detail = detail
    this.events.push(event)
    return event
  }

  /** The line the editor trims to: pre-state and page load are everything before it. */
  beginScene(label = 'scene start') {
    this.firstActionAtMs = this.atMs
    this.mark('note', label)
    log(`  scene starts at ${(this.firstActionAtMs / 1000).toFixed(1)}s into the clip`)
  }

  // --- the agent -----------------------------------------------------------

  /**
   * One WebMCP call, exactly the way an agent makes it. Returns the parsed
   * envelope. `silent` keeps pre-state calls out of the event list.
   */
  async tool(name, input = {}, { silent = false, detail } = {}) {
    const result = await this.page.evaluate(
      async ({ name, input }) => {
        const mc = document.modelContext ?? navigator.modelContext
        if (!mc) return { __transport: 'missing', error: 'no document.modelContext' }
        const tools = await mc.getTools()
        const ref = tools.find((entry) => entry.name === name)
        if (!ref) return { __transport: 'unregistered', error: `${name} is not registered` }
        // The JSON-string form is the one this engine accepts.
        const raw = await mc.executeTool(ref, JSON.stringify(input))
        if (typeof raw !== 'string') return raw
        try {
          return JSON.parse(raw)
        } catch {
          return { __transport: 'unparsed', raw }
        }
      },
      { name, input },
    )
    if (!silent) this.mark('tool', name, detail ?? result?.summary)
    if (result?.__transport) {
      throw new Error(`${name}: ${result.error ?? result.__transport}`)
    }
    if (result?.ok === false) {
      this.warnings.push(`${name} returned ${result.error?.code}: ${result.error?.message}`)
    }
    log(`  tool ${name}${silent ? ' (pre-state)' : ''} -> ${result?.ok}`)
    return result
  }

  // --- the human -----------------------------------------------------------

  async move(x, y, steps = 45) {
    await this.page.mouse.move(x, y, { steps })
  }

  /** Where an element is on screen, or null when it is not there. */
  async box(locator) {
    const target = typeof locator === 'string' ? this.page.locator(locator) : locator
    try {
      await target.first().waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      return null
    }
    return target.first().boundingBox()
  }

  /** Glide onto an element and stop on it. */
  async hover(locator, { steps = 45 } = {}) {
    const box = await this.box(locator)
    if (!box) {
      this.warnings.push(`hover: nothing visible for ${locator}`)
      return null
    }
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await this.move(point.x, point.y, steps)
    return point
  }

  /** Glide onto an element and press it for real. */
  async click(locator, { steps = 45, label, pauseMs = 220 } = {}) {
    const point = await this.hover(locator, { steps })
    if (!point) return null
    await this.page.waitForTimeout(pauseMs)
    await this.page.mouse.down()
    await this.page.waitForTimeout(70)
    await this.page.mouse.up()
    if (label) this.mark('human', label)
    return point
  }

  async pause(ms) {
    await this.page.waitForTimeout(ms)
  }

  // --- the instrument column ----------------------------------------------

  /** Geometry of the scrolling right-hand column and of one panel inside it. */
  async column(headingText) {
    return this.page.evaluate((heading) => {
      const aside = document.querySelector('.roque-scroll')
      if (!aside) return null
      const rect = aside.getBoundingClientRect()
      const out = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        scrollTop: aside.scrollTop,
        scrollHeight: aside.scrollHeight,
        panelTop: null,
      }
      if (heading) {
        const needle = heading.toLowerCase()
        const hit = (selector) =>
          [...aside.querySelectorAll(selector)].find((node) =>
            (node.textContent ?? '').toLowerCase().includes(needle),
          )
        // Headings first: a banner announces itself in a <p>, but a <p> earlier
        // in the column must never win over the panel that owns the words.
        const match = hit('h2, h3') ?? hit('p')
        if (match) {
          const panel = match.closest('section') ?? match
          out.panelTop = panel.getBoundingClientRect().top - rect.top + aside.scrollTop
        }
      }
      return out
    }, headingText ?? null)
  }

  /**
   * Scroll the column with the real wheel, in a handful of notches so the motion
   * reads as a scroll rather than a jump cut.
   */
  async wheelColumnTo(scrollTop, { steps = 6, stepMs = 90 } = {}) {
    const info = await this.column()
    if (!info) return
    const from = info.scrollTop
    const to = Math.max(0, Math.min(scrollTop, info.scrollHeight - info.height))
    const delta = to - from
    if (Math.abs(delta) < 4) return
    await this.move(info.left + info.width / 2, info.top + info.height / 2, 30)
    for (let i = 0; i < steps; i += 1) {
      await this.page.mouse.wheel(0, delta / steps)
      await this.pause(stepMs)
    }
  }

  /** Put a named panel near the top of the column. Used before a clip's timer starts too. */
  async showPanel(headingText, { offset = 12, wheel = true } = {}) {
    const info = await this.column(headingText)
    if (!info || info.panelTop === null) {
      this.warnings.push(`showPanel: no panel matching "${headingText}"`)
      return
    }
    const target = Math.max(0, info.panelTop - offset)
    if (wheel) await this.wheelColumnTo(target)
    else {
      await this.page.evaluate((top) => {
        const aside = document.querySelector('.roque-scroll')
        if (aside) aside.scrollTop = top
      }, target)
    }
  }

  /**
   * Scroll the column until one particular element is near its top. Used where
   * the panel has no stable heading: the Inspector renames itself after the
   * selected object, so "Inspector" is only its empty-state title.
   */
  async revealLocator(locator, { offset = 60 } = {}) {
    const target = typeof locator === 'string' ? this.page.locator(locator) : locator
    const handle = await target.first().elementHandle()
    if (!handle) {
      this.warnings.push('revealLocator: element not found')
      return
    }
    const top = await this.page.evaluate((element) => {
      const aside = document.querySelector('.roque-scroll')
      if (!aside) return null
      const rect = aside.getBoundingClientRect()
      return element.getBoundingClientRect().top - rect.top + aside.scrollTop
    }, handle)
    await handle.dispose()
    if (top === null) return
    await this.wheelColumnTo(Math.max(0, top - offset))
  }

  /** Centre of the sky canvas, in viewport pixels. */
  async domeCentre() {
    const box = await this.box('canvas[aria-label="Interactive sky dome"]')
    if (!box) throw new Error('the sky canvas is not on screen')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
  }

  async state(pick) {
    return this.page.evaluate(pick)
  }

  // --- close out ------------------------------------------------------------

  async finish() {
    const video = this.video
    await this.context.close()
    const raw = await video.path()
    const out = path.join(CLIPS_DIR, this.spec.file)
    log(`  encoding ${this.spec.file}`)
    await run('ffmpeg', [
      '-y',
      '-i',
      raw,
      '-vf',
      'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '18',
      '-movflags',
      '+faststart',
      '-an',
      out,
    ])
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      out,
    ])
    const durationMs = Math.round(Number.parseFloat(stdout.trim()) * 1000)
    fs.rmSync(raw, { force: true })
    const clip = {
      id: this.spec.id,
      file: this.spec.file,
      durationMs,
      firstActionAtMs: this.firstActionAtMs ?? 0,
      events: this.events,
    }
    log(`  ${this.spec.file}: ${(durationMs / 1000).toFixed(1)}s, ${this.events.length} events`)
    if (this.warnings.length > 0) {
      for (const warning of this.warnings) log(`  ! ${warning}`)
    }
    return { clip, warnings: this.warnings }
  }
}

// ------------------------------------------------------------------- scenes

/** Today's date in the app's own zone, and the two-week window the agent ranks. */
function nightWindow() {
  const today = localDate(new Date(), 'Atlantic/Canary')
  return { today, from: today, to: addDays(today, 14) }
}

/**
 * The one call the later clips depend on. Kept out of the clips that do not show
 * it so their pre-state stays short.
 */
async function bestNightOf(scene) {
  const { from, to } = nightWindow()
  const result = await scene.tool('rank_nights', { from_date: from, to_date: to, limit: 3 }, { silent: true })
  const best = result?.data?.best?.[0]
  if (!best) throw new Error('rank_nights returned no best night')
  return best
}

/** The scheduler keys planets by a lowercase id ('saturn'), catalog objects by 'M31'. */
function findSaturn(plan) {
  return (plan?.data?.items ?? []).find(
    (item) =>
      String(item.target_id ?? '').toLowerCase() === 'saturn' ||
      String(item.name ?? '').toLowerCase() === 'saturn',
  )
}

/** 01 · the tour, the copied prompt, the tool list. */
async function clip01(browser, facts) {
  const scene = new Scene(browser, { id: '01-onboarding', file: '01-onboarding.mp4' })
  await scene.open({ seedTour: false })

  const dialog = scene.page.locator('[role="dialog"]')
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })

  // Pre-state, behind the modal: the page opens at the wall clock, which during
  // a working afternoon is a white daylight dome. One real call moves it to the
  // middle of tonight so the tour sits over the sky the product is about.
  await scene.tool('set_observing_time', { time: 'midnight' }, { silent: true })

  // Everything the page can tell us about its own tool surface, recorded once.
  const surface = await scene.state(() => ({
    declared: (window.__roqueTools ?? []).length,
    registered: window.__roqueStore?.getState()?.webmcp?.toolNames?.length ?? 0,
    badge: document.body.innerText.match(/WebMCP live · \d+ tools/i)?.[0] ?? null,
  }))
  const engineTools = await scene.state(async () => (await document.modelContext.getTools()).length)
  facts.__surface = { ...surface, engineTools }

  scene.beginScene('tour step 1')
  await scene.hover(dialog.locator('p').first(), { steps: 55 })
  await scene.pause(2000)

  await scene.click(dialog.getByRole('button', { name: 'Next' }), { label: 'Next' })
  await scene.pause(900)

  // Step 2: the prompt, and the one click that puts it on the clipboard.
  scene.mark('note', 'tour step 2 · the prompt')
  await scene.click(dialog.getByRole('button', { name: /^Copy(ed)?$/ }), { label: 'Copy prompt' })
  await scene.pause(500)
  const copied = await dialog.getByRole('button', { name: 'Copied' }).count()
  if (copied === 0) scene.warnings.push('the Copy button never showed "Copied"')
  await scene.pause(1800)

  await scene.click(dialog.getByRole('button', { name: 'Next' }), { label: 'Next' })
  scene.mark('note', 'tour step 3 · favorites')
  await scene.pause(2200)

  await scene.click(dialog.getByRole('button', { name: 'Next' }), { label: 'Next' })
  scene.mark('note', 'tour step 4 · the ghost plan')
  await scene.pause(2200)

  await scene.click(dialog.getByRole('button', { name: 'Done' }), { label: 'Done' })
  await scene.pause(1200)

  // The tool list, read slowly the way a judge would read it.
  await scene.showPanel('Agent tools')
  await scene.pause(700)
  const panel = scene.page.locator('section', { has: scene.page.locator('h2', { hasText: 'Agent tools' }) })
  const rows = panel.locator('li')
  const count = Math.min(await rows.count(), 15)
  for (const index of [0, 3, 6, 10]) {
    if (index >= count) continue
    await scene.hover(rows.nth(index), { steps: 40 })
    await scene.pause(1100)
  }
  await scene.pause(1600)

  return scene.finish()
}

/** 02 · the agent ranks the nights and swings the dome, four targets in a row. */
async function clip02(browser, facts) {
  const scene = new Scene(browser, { id: '02-agent-points', file: '02-agent-points.mp4' })
  await scene.open()

  // Pre-state: tonight at midnight, so the dome is dark before the scene opens.
  await scene.tool('set_observing_time', { time: 'midnight' }, { silent: true })
  await scene.showPanel('Agent tools', { wheel: false })
  await scene.pause(500)

  scene.beginScene('the agent takes over')
  await scene.pause(900)

  const { from, to } = nightWindow()
  const ranked = await scene.tool('rank_nights', { from_date: from, to_date: to, limit: 3 })
  const best = ranked?.data?.best?.[0]
  if (!best) throw new Error('rank_nights returned no best night')
  facts.bestNight = best.night_of
  facts.bestScore = best.score
  facts.usableHours = best.usable_hours
  facts.moonPct = best.moon_illumination_pct
  await scene.pause(1500)

  await scene.tool('set_observing_time', { date: best.night_of, time: 'midnight' })
  await scene.pause(1500)

  await scene.tool('find_observable_targets', { limit: 8 })
  await scene.pause(1500)

  for (const target of ['M13', 'M31', 'Saturn', 'M45']) {
    await scene.tool('point_sky_map', { target, fov_deg: 40 }, { detail: target })
    await scene.pause(3200)
  }
  await scene.tool('point_sky_map', { reset: true }, { detail: 'whole sky' })
  await scene.pause(3600)

  return scene.finish()
}

/**
 * 03 · the gesture the agent can read. A double click on the dome centre is a
 * real double click; the favourite it toggles is verified against the store, and
 * only if the hit test missed does the Inspector's own button stand in.
 */
async function clip03(browser, facts) {
  const scene = new Scene(browser, { id: '03-favorites', file: '03-favorites.mp4' })
  await scene.open()

  const best = facts.bestNight ?? (await bestNightOf(scene)).night_of
  await scene.tool('set_observing_time', { date: best, time: 'midnight' }, { silent: true })
  await scene.tool('point_sky_map', { reset: true }, { silent: true })
  await scene.pause(600)

  const favouriteAtCentre = async (id) => {
    const centre = await scene.domeCentre()
    await scene.move(centre.x, centre.y, 55)
    await scene.pause(700)
    await scene.page.mouse.dblclick(centre.x, centre.y)
    scene.mark('human', `double-click · favorite ${id}`)
    await scene.pause(700)
    const has = await scene.state(
      () => window.__roqueStore.getState().favoriteIds,
    )
    if (has.includes(id)) return true
    // The hit test missed: select it and use the Inspector's own button, which
    // is the other way the product says a human marks a favourite.
    scene.warnings.push(`double-click missed ${id}; used the Inspector button`)
    await scene.page.mouse.click(centre.x, centre.y)
    await scene.pause(500)
    await scene.click(scene.page.getByRole('button', { name: /Favorite/ }), {
      label: `Favorite ${id}`,
    })
    await scene.pause(500)
    const after = await scene.state(() => window.__roqueStore.getState().favoriteIds)
    return after.includes(id)
  }

  scene.beginScene('the human marks two favorites')
  await scene.pause(700)

  await scene.tool('point_sky_map', { target: 'M31', fov_deg: 30 }, { detail: 'M31' })
  await scene.pause(2200)
  const gotM31 = await favouriteAtCentre('M31')
  await scene.pause(2000)

  await scene.tool('point_sky_map', { target: 'M45', fov_deg: 30 }, { detail: 'M45' })
  await scene.pause(2200)
  const gotM45 = await favouriteAtCentre('M45')
  await scene.pause(1600)

  await scene.tool('point_sky_map', { reset: true }, { detail: 'whole sky' })
  await scene.pause(2400)

  const described = await scene.tool('describe_current_view', {})
  facts.__favorites = described?.data?.favorites ?? null
  await scene.pause(2600)

  // Rest on the line the agent just read. The Inspector renames itself after
  // the selected object, so the Favorites row itself is the anchor.
  const favourites = scene.page.locator('.roque-scroll p:has-text("Favorites")').last()
  await scene.revealLocator(favourites, { offset: 120 })
  await scene.pause(600)
  // The names themselves, not the "clear" link two words to their right.
  await scene.hover(favourites.locator('span.text-ember').first(), { steps: 45 })
  await scene.pause(2600)

  if (!gotM31 || !gotM45) scene.warnings.push(`favorites ended as M31=${gotM31} M45=${gotM45}`)
  return scene.finish()
}

/** 04 · the ghost plan: dotted blocks, four Accepts, one Commit. */
async function clip04(browser, facts) {
  const scene = new Scene(browser, { id: '04-ghost-plan', file: '04-ghost-plan.mp4' })
  await scene.open()

  const best = facts.bestNight ?? (await bestNightOf(scene)).night_of
  await scene.tool('set_observing_time', { date: best, time: 'midnight' }, { silent: true })
  // Pre-state only: the favourites the plan is built around already exist by the
  // time this clip opens, and clip 03 is where a human puts them there.
  await scene.page.evaluate(() => {
    const state = window.__roqueStore.getState()
    for (const id of ['M31', 'M45']) {
      if (!state.favoriteIds.includes(id)) state.toggleFavorite(id, 'human')
    }
  })
  await scene.showPanel('Plan ·', { wheel: false })
  await scene.pause(500)

  scene.beginScene('the agent proposes')
  await scene.pause(900)

  const proposed = await scene.tool('propose_plan', {
    targets: [{ target: 'M13' }, { target: 'M31' }, { target: 'Saturn' }, { target: 'M45' }],
    rationale:
      'Your two favorites, plus Saturn near transit and M13 while the sky is darkest.',
  })
  const proposalId = proposed?.data?.proposal_id
  await scene.pause(3000)

  // Both halves of the ghost plan on screen at once: the dotted blocks and the
  // card that explains them.
  await scene.showPanel('Plan ·')
  await scene.pause(1000)

  // The tooltip on a ghost block: hover the dashed rect itself.
  const ghost = scene.page.locator('rect[stroke-dasharray="3 2"]').first()
  await scene.hover(ghost, { steps: 45 })
  scene.mark('human', 'hover a ghost block')
  await scene.pause(2000)

  const accepts = scene.page.locator('button:has-text("✓ Accept")')
  const acceptCount = await accepts.count()
  for (let index = 0; index < acceptCount; index += 1) {
    await scene.click(accepts.nth(index), { steps: 30, label: `Accept ${index + 1}` })
    await scene.pause(1000)
  }
  await scene.pause(1200)

  await scene.click(scene.page.getByRole('button', { name: 'Commit accepted' }), {
    label: 'Commit accepted',
  })
  await scene.pause(3400)

  const plan = await scene.tool('get_current_plan', {}, { silent: true })
  const saturn = findSaturn(plan)
  if (saturn) facts.saturnRoque = `${clockOf(saturn.start.local)}–${clockOf(saturn.end.local)}`
  facts.__planRoque = (plan?.data?.items ?? []).map((item) => item.target_id)
  facts.__proposalId = proposalId
  await scene.pause(900)

  return scene.finish()
}

/** 05 · the same plan under a different sky, revalidated and exported. */
async function clip05(browser, facts) {
  const scene = new Scene(browser, { id: '05-another-sky', file: '05-another-sky.mp4' })
  await scene.open()

  const best = facts.bestNight ?? (await bestNightOf(scene)).night_of
  await scene.tool('set_observing_time', { date: best, time: 'midnight' }, { silent: true })
  const proposed = await scene.tool(
    'propose_plan',
    {
      targets: [{ target: 'M13' }, { target: 'M31' }, { target: 'Saturn' }, { target: 'M45' }],
      rationale: 'Your two favorites, plus Saturn near transit and M13 while the sky is darkest.',
    },
    { silent: true },
  )
  await scene.tool(
    'commit_proposal',
    { proposal_id: proposed?.data?.proposal_id },
    { silent: true },
  )
  await scene.showPanel('Inspector', { wheel: false })
  await scene.pause(600)

  scene.beginScene('the app moves to Mauna Kea')
  await scene.pause(900)

  await scene.tool('set_observing_site', { id: 'mauna-kea' }, { detail: 'Mauna Kea' })
  await scene.pause(2600)

  // The site moves, the instant does not: 01:07 UTC is a quarter past three in
  // the afternoon on Mauna Kea, and the dome goes white. One more real call puts
  // the clock in Hawaii's own night, which is the night the plan is about to
  // slide into.
  await scene.tool('set_observing_time', { time: 'midnight' }, { detail: 'Mauna Kea midnight' })
  await scene.pause(2600)

  // The banner is the app's own objection; make sure it is the thing on screen.
  await scene.showPanel('Plan out of date')
  await scene.pause(1000)

  await scene.click(scene.page.getByRole('button', { name: 'Revalidate plan' }), {
    label: 'Revalidate plan',
  })
  await scene.pause(2600)

  const revalidation = await scene.state(() => {
    const heading = [...document.querySelectorAll('p')].find(
      (node) => (node.textContent ?? '').trim().toLowerCase() === 'plan revalidated',
    )
    const line = heading?.nextElementSibling?.textContent?.trim() ?? null
    return line
  })
  if (revalidation) facts.revalidation = revalidation
  else scene.warnings.push('no revalidation result line found on screen')
  await scene.pause(1400)

  const plan = await scene.tool('get_current_plan', {}, { silent: true })
  const saturn = findSaturn(plan)
  if (saturn) facts.saturnMaunaKea = `${clockOf(saturn.start.local)}–${clockOf(saturn.end.local)}`
  facts.__planMaunaKea = (plan?.data?.items ?? []).map((item) => item.target_id)

  await scene.tool('export_plan', { format: 'json' }, { detail: 'json' })
  await scene.pause(1800)

  const share = scene.page.getByRole('button', { name: 'Copy share link' })
  await scene.revealLocator(share, { offset: 260 })
  await scene.pause(600)
  await scene.click(share, { label: 'Copy share link' })
  await scene.pause(600)
  const copied = await scene.page.getByRole('button', { name: 'Copied' }).count()
  if (copied === 0) scene.warnings.push('the share-link button never showed "Copied"')
  await scene.pause(2600)

  return scene.finish()
}

/** 06 · the closing dome, wheeling at 600x with nobody's hand in frame. */
async function clip06(browser, facts) {
  const scene = new Scene(browser, { id: '06-dome', file: '06-dome.mp4' })
  await scene.open()

  const best = facts.bestNight ?? (await bestNightOf(scene)).night_of
  await scene.tool('set_observing_time', { date: best, time: 'midnight' }, { silent: true })
  await scene.tool('point_sky_map', { reset: true }, { silent: true })
  await scene.pause(800)

  scene.beginScene('the night runs')
  // x600 sets the speed AND starts the clock: pressing Play afterwards would
  // stop it again (the button is a toggle on speed 0).
  await scene.click(scene.page.getByRole('button', { name: 'x600', exact: true }), {
    label: 'x600',
  })
  const playing = await scene.state(
    () => document.body.innerText.toLowerCase().includes('pause'),
  )
  if (!playing) scene.warnings.push('the time slider did not enter play mode')
  // Park the hand off the dome.
  await scene.move(1890, 1060, 40)
  await scene.pause(18_000)

  return scene.finish()
}

// -------------------------------------------------------------------- main

const SCENES = [
  { id: '01-onboarding', fn: clip01 },
  { id: '02-agent-points', fn: clip02 },
  { id: '03-favorites', fn: clip03 },
  { id: '04-ghost-plan', fn: clip04 },
  { id: '05-another-sky', fn: clip05 },
  { id: '06-dome', fn: clip06 },
]

function loadExistingLog() {
  const file = path.join(CLIPS_DIR, 'log.json')
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

async function main() {
  const wanted = process.argv.slice(2)
  const selected =
    wanted.length === 0
      ? SCENES
      : SCENES.filter((scene) => wanted.some((token) => scene.id.startsWith(token)))
  if (selected.length === 0) {
    console.error(`No scene matches ${wanted.join(', ')}. Known: ${SCENES.map((s) => s.id).join(', ')}`)
    process.exit(1)
  }

  fs.mkdirSync(CLIPS_DIR, { recursive: true })
  fs.rmSync(RAW_DIR, { recursive: true, force: true })
  fs.mkdirSync(RAW_DIR, { recursive: true })

  const executablePath = findChromium()
  log(`url        ${URL}`)
  log(`chromium   ${executablePath ?? '(playwright default)'}`)
  log(`clips      ${CLIPS_DIR}`)
  log(`scenes     ${selected.map((s) => s.id).join(', ')}`)

  const previous = loadExistingLog()
  const facts = { ...(previous?.facts ?? {}) }
  const clips = new Map((previous?.clips ?? []).map((clip) => [clip.id, clip]))
  const allWarnings = []

  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--enable-features=WebMCP,WebMCPTesting,EnableWebMCPTesting'],
  })

  try {
    for (const scene of selected) {
      log(`recording ${scene.id}`)
      const { clip, warnings } = await scene.fn(browser, facts)
      clips.set(clip.id, clip)
      for (const warning of warnings) allWarnings.push(`${clip.id}: ${warning}`)
    }
  } finally {
    await browser.close()
  }

  // The catalogue the page declares is the honest "how many tools": the badge
  // counts what is registered right now, which is 11 until a plan exists.
  const surface = facts.__surface
  if (surface) facts.toolsRegistered = surface.declared

  const ordered = SCENES.map((scene) => clips.get(scene.id)).filter(Boolean)
  const payload = {
    recordedAt: new Date().toISOString(),
    url: URL,
    clips: ordered,
    facts: {
      toolsRegistered: facts.toolsRegistered ?? null,
      bestNight: facts.bestNight ?? null,
      bestScore: facts.bestScore ?? null,
      usableHours: facts.usableHours ?? null,
      moonPct: facts.moonPct ?? null,
      saturnRoque: facts.saturnRoque ?? null,
      saturnMaunaKea: facts.saturnMaunaKea ?? null,
      revalidation: facts.revalidation ?? null,
    },
  }
  fs.writeFileSync(path.join(CLIPS_DIR, 'log.json'), `${JSON.stringify(payload, null, 2)}\n`)
  fs.rmSync(RAW_DIR, { recursive: true, force: true })

  console.log('')
  console.log('CLIP              DURATION  EVENTS  TOOL CALLS')
  console.log('-'.repeat(78))
  for (const clip of ordered) {
    const tools = clip.events.filter((event) => event.kind === 'tool')
    console.log(
      `${clip.id.padEnd(18)}${`${(clip.durationMs / 1000).toFixed(1)}s`.padEnd(10)}${String(
        clip.events.length,
      ).padEnd(8)}${tools.map((event) => event.label).join(', ')}`,
    )
  }
  console.log('')
  console.log('FACTS')
  for (const [key, value] of Object.entries(payload.facts)) {
    console.log(`  ${key.padEnd(16)}${value}`)
  }
  if (facts.__surface) {
    console.log(
      `  (surface: declared ${facts.__surface.declared}, registered at rest ${facts.__surface.registered}, engine getTools ${facts.__surface.engineTools}, badge "${facts.__surface.badge}")`,
    )
  }
  if (allWarnings.length > 0) {
    console.log('')
    console.log('WARNINGS')
    for (const warning of allWarnings) console.log(`  ! ${warning}`)
  }
  console.log('')
  console.log(`log.json written to ${path.join(CLIPS_DIR, 'log.json')}`)
}

await main()
