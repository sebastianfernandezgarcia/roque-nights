/**
 * The night scrubber. Everything on the page is drawn for the instant this
 * slider holds, so agents and humans move the same handle.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { getNight } from '../astro/cache'
import { resolveTimeKeyword, type TimeKeyword } from '../astro/night'
import { store, useRoqueStore } from '../state/store'
import { fmtLocal, fmtUtc, zoneLabel } from './format'
import { BAND_FILL, timelineGeometry } from './timelineGeometry'

const MINUTE_MS = 60_000
const STEP_MINUTES = 10

const SPEEDS = [60, 600, 3600] as const

const KEYWORDS: { label: string; keyword: TimeKeyword }[] = [
  { label: 'Sunset', keyword: 'sunset' },
  { label: 'Dark', keyword: 'darkness_start' },
  { label: 'Midnight', keyword: 'midnight' },
  { label: 'Dawn', keyword: 'darkness_end' },
  { label: 'Now', keyword: 'now' },
]

const BUTTON =
  'rounded-sm border border-panel-edge px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-faint hover:border-ember/50 hover:text-ember disabled:opacity-30 disabled:hover:border-panel-edge disabled:hover:text-faint'

export function TimeSlider() {
  const site = useRoqueStore((s) => s.site)
  const nightOf = useRoqueStore((s) => s.nightOf)
  const timeUtc = useRoqueStore((s) => s.timeUtc)
  const setTime = useRoqueStore((s) => s.setTime)
  const [speed, setSpeed] = useState(0)
  const dragging = useRef(false)

  const night = useMemo(() => {
    try {
      return getNight(nightOf, site)
    } catch {
      return null
    }
  }, [nightOf, site])

  const startMs = night ? Date.parse(night.windowStartUtc) : 0
  const endMs = night ? Date.parse(night.windowEndUtc) : 0
  const totalMinutes = night ? Math.round((endMs - startMs) / MINUTE_MS) : 0

  const geo = useMemo(() => (night ? timelineGeometry(night, 1000) : null), [night])

  // Play mode advances the app clock, not a private one: the sky map, the plan
  // timeline and any agent reading the store all follow the same instant.
  useEffect(() => {
    if (speed === 0 || !night) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const current = Date.parse(store.getState().timeUtc)
      const base = Number.isFinite(current) ? current : startMs
      let next = base + dt * speed
      if (next > endMs || next < startMs) next = startMs + ((next - startMs) % (endMs - startMs))
      if (next < startMs) next += endMs - startMs
      setTime(new Date(next).toISOString(), 'human', { silent: true })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [speed, night, startMs, endMs, setTime])

  if (!night || !geo || totalMinutes <= 0) {
    return (
      <div className="rounded-sm border border-panel-edge bg-panel p-3 text-xs text-signal">
        No night to scrub: {nightOf} is not a valid calendar date.
      </div>
    )
  }

  const currentMs = Number.isFinite(Date.parse(timeUtc)) ? Date.parse(timeUtc) : startMs
  const clampedMs = Math.min(Math.max(currentMs, startMs), endMs)
  const currentMinute = Math.round((clampedMs - startMs) / MINUTE_MS)
  const cursorPct = (geo.x(clampedMs) / geo.width) * 100

  const commit = (ms: number, silent: boolean) => {
    const bounded = Math.min(Math.max(ms, startMs), endMs)
    setTime(new Date(bounded).toISOString(), 'human', { silent })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      commit(clampedMs + direction * STEP_MINUTES * MINUTE_MS, false)
      return
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      setSpeed((s) => (s === 0 ? SPEEDS[0] : 0))
    }
  }

  const ticks = [
    { iso: night.sun.sunsetUtc, label: 'sunset' },
    { iso: night.darkness.startUtc, label: 'dark' },
    { iso: night.darkness.endUtc, label: 'dawn' },
    { iso: night.sun.sunriseUtc, label: 'sunrise' },
  ].filter((t): t is { iso: string; label: string } => typeof t.iso === 'string')

  return (
    <div className="rounded-sm border border-panel-edge bg-panel p-2 font-mono">
      <div className="relative h-6 w-full overflow-hidden rounded-sm border border-panel-edge">
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${geo.width} 24`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {geo.bands.map((band, i) => (
            <rect
              key={`${band.kind}-${i}`}
              x={band.x0}
              y={0}
              width={Math.max(band.x1 - band.x0, 0.5)}
              height={24}
              fill={BAND_FILL[band.kind]}
            />
          ))}
          {geo.moonSpans.map((span, i) => (
            <rect
              key={`moon-${i}`}
              x={span.x0}
              y={0}
              width={Math.max(span.x1 - span.x0, 0.5)}
              height={5}
              fill="#8a93a6"
              opacity={geo.moonOpacity + 0.2}
            />
          ))}
          {ticks.map((tick) => (
            <rect key={tick.label} x={geo.x(tick.iso)} y={0} width={1} height={24} fill="#8a93a6" />
          ))}
        </svg>
        <div
          className="pointer-events-none absolute top-0 h-full w-px bg-ember"
          style={{ left: `${cursorPct}%` }}
        />
      </div>

      <input
        type="range"
        min={0}
        max={totalMinutes}
        step={1}
        value={currentMinute}
        className="mt-1 h-4 w-full accent-[#ffb454]"
        aria-label="Observing time"
        onChange={(e) => {
          dragging.current = true
          commit(startMs + Number(e.target.value) * MINUTE_MS, true)
        }}
        onPointerUp={() => {
          if (!dragging.current) return
          dragging.current = false
          commit(clampedMs, false)
        }}
        onBlur={() => {
          if (!dragging.current) return
          dragging.current = false
          commit(clampedMs, false)
        }}
        onKeyDown={onKeyDown}
      />

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ember tabular-nums">
          {site.timeZone && `${fmtLocal(new Date(clampedMs).toISOString(), site.timeZone)} local · `}
          {fmtUtc(new Date(clampedMs).toISOString())} UTC · {night.nightOf}
          <span className="ml-2 text-faint">{zoneLabel(site.timeZone)}</span>
        </p>

        <div className="flex flex-wrap items-center gap-1">
          {KEYWORDS.map(({ label, keyword }) => {
            const target = resolveTimeKeyword(keyword, night)
            return (
              <button
                key={keyword}
                type="button"
                className={BUTTON}
                disabled={target === null}
                onClick={() => {
                  if (target) commit(Date.parse(target), false)
                }}
              >
                {label}
              </button>
            )
          })}
          <button
            type="button"
            className={BUTTON}
            onClick={() => setSpeed((s) => (s === 0 ? SPEEDS[0] : 0))}
            aria-label={speed === 0 ? 'Play the night' : 'Pause'}
          >
            {speed === 0 ? 'Play' : 'Pause'}
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={`${BUTTON} ${speed === s ? 'border-ember/60 text-ember' : ''}`}
              onClick={() => setSpeed((current) => (current === s ? 0 : s))}
            >
              x{s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
