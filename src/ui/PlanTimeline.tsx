/**
 * Altitude by time for the whole night: twilight bands, Moon interference, one
 * row per plan item with its altitude curve, and the agent's proposals as
 * dotted ghost blocks the human accepts or rejects with the mouse.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { getNight } from '../astro/cache'
import { getTarget } from '../astro/catalog'
import { airmass, moonSeparationDeg, targetAltAz } from '../astro/targets'
import { useRoqueStore } from '../state/store'
import type { PlanItem, Proposal, Site } from '../state/types'
import { fmtAirmass, fmtDeg, fmtLocal, fmtTimeRange, truncate, zoneLabel } from './format'
import { BAND_FILL, timelineGeometry } from './timelineGeometry'

const TOP = 18
const BOTTOM = 14
const ROW_H = 22
const MAX_ROWS = 8
const MIN_HEIGHT = 150
const CURVE_STEP_MINUTES = 10

const CURVE_CACHE = new Map<string, number[]>()
const CURVE_CACHE_LIMIT = 256

function siteKey(site: Site): string {
  return `${site.latitude.toFixed(4)},${site.longitude.toFixed(4)},${Math.round(site.elevationM)}`
}

/**
 * Altitude of one target every 10 minutes across the night window. Memoized per
 * target, night and site: redrawing on every slider tick must cost nothing.
 */
export function altitudeCurve(
  targetId: string,
  nightOf: string,
  site: Site,
  startMs: number,
  endMs: number,
): number[] {
  const key = `${targetId}|${nightOf}|${siteKey(site)}`
  const cached = CURVE_CACHE.get(key)
  if (cached) return cached
  const target = getTarget(targetId)
  const samples: number[] = []
  if (target) {
    const stepMs = CURVE_STEP_MINUTES * 60_000
    for (let ms = startMs; ms <= endMs; ms += stepMs) {
      samples.push(targetAltAz(target, new Date(ms), site).altDeg)
    }
  }
  if (CURVE_CACHE.size >= CURVE_CACHE_LIMIT) {
    const oldest = CURVE_CACHE.keys().next().value
    if (oldest !== undefined) CURVE_CACHE.delete(oldest)
  }
  CURVE_CACHE.set(key, samples)
  return samples
}

interface Row {
  key: string
  item: PlanItem
  ghost: boolean
  proposalId: string | null
  decision: 'accepted' | 'rejected' | null
  warning: string | null
}

function warningFor(
  item: PlanItem,
  darkStart: string | null,
  darkEnd: string | null,
  peakAltDeg: number,
  minAltDeg: number,
): string | null {
  if (darkStart && darkEnd && (item.startUtc < darkStart || item.endUtc > darkEnd)) {
    return 'Runs outside the astronomical darkness window.'
  }
  if (peakAltDeg < minAltDeg) {
    return `Stays below ${Math.round(minAltDeg)}° during this block.`
  }
  return null
}

export function PlanTimeline() {
  const site = useRoqueStore((s) => s.site)
  const nightOf = useRoqueStore((s) => s.nightOf)
  const timeUtc = useRoqueStore((s) => s.timeUtc)
  const plan = useRoqueStore((s) => s.plan)
  const proposals = useRoqueStore((s) => s.proposals)
  const filters = useRoqueStore((s) => s.filters)
  const setTime = useRoqueStore((s) => s.setTime)
  const decideProposalItem = useRoqueStore((s) => s.decideProposalItem)

  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [hovered, setHovered] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<{ proposalId: string; item: PlanItem } | null>(null)
  const [reason, setReason] = useState('')
  const dragging = useRef(false)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const measure = () => setWidth(Math.max(160, node.clientWidth))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const night = useMemo(() => {
    try {
      return getNight(nightOf, site)
    } catch {
      return null
    }
  }, [nightOf, site])

  const pending: Proposal[] = useMemo(
    () => proposals.filter((p) => p.status === 'pending'),
    [proposals],
  )

  const rows: Row[] = useMemo(() => {
    if (!night) return []
    const startMs = Date.parse(night.windowStartUtc)
    const endMs = Date.parse(night.windowEndUtc)
    const make = (
      item: PlanItem,
      ghost: boolean,
      proposalId: string | null,
      decision: 'accepted' | 'rejected' | null,
    ): Row => {
      const curve = altitudeCurve(item.targetId, nightOf, site, startMs, endMs)
      const from = Date.parse(item.startUtc)
      const to = Date.parse(item.endUtc)
      let peak = -90
      const stepMs = CURVE_STEP_MINUTES * 60_000
      for (let i = 0; i < curve.length; i++) {
        const ms = startMs + i * stepMs
        if (ms >= from && ms <= to && curve[i] > peak) peak = curve[i]
      }
      if (peak === -90) {
        const target = getTarget(item.targetId)
        peak = target ? targetAltAz(target, new Date(from), site).altDeg : 0
      }
      return {
        key: `${proposalId ?? 'plan'}:${item.id}`,
        item,
        ghost,
        proposalId,
        decision,
        warning: warningFor(
          item,
          night.darkness.startUtc,
          night.darkness.endUtc,
          peak,
          filters.minAltDeg,
        ),
      }
    }
    const planRows = plan.map((item) => make(item, false, null, null))
    const ghostRows = pending.flatMap((proposal) =>
      proposal.items.map((item) =>
        make(item, true, proposal.id, proposal.decisions[item.id]?.decision ?? null),
      ),
    )
    return [...planRows, ...ghostRows]
  }, [night, plan, pending, nightOf, site, filters.minAltDeg])

  const visibleRows = rows.slice(0, MAX_ROWS)
  const hiddenCount = rows.length - visibleRows.length
  const height = Math.max(MIN_HEIGHT, TOP + Math.max(visibleRows.length, 1) * ROW_H + BOTTOM)
  const geo = useMemo(() => (night ? timelineGeometry(night, width) : null), [night, width])

  if (!night || !geo) {
    return (
      <p className="text-xs text-signal">
        No timeline: {nightOf} is not a valid calendar date for this site.
      </p>
    )
  }

  const tz = site.timeZone
  const startMs = geo.startMs
  const endMs = geo.endMs
  const rowsTop = TOP
  const rowsBottom = height - BOTTOM
  const rowHeight = (rowsBottom - rowsTop) / Math.max(visibleRows.length, 1)

  const altToY = (altDeg: number, rowTop: number, rowH: number): number => {
    const clamped = Math.min(Math.max(altDeg, 0), 90)
    return rowTop + rowH - (clamped / 90) * (rowH - 2) - 1
  }

  // The timeline lives in a 380 px column: pick the coarsest hour step that
  // still fills the axis, so 'HH:mm' labels never run into each other.
  const spanHours = (endMs - startMs) / 3_600_000
  const MIN_LABEL_PX = 40
  const tickStepHours =
    [1, 2, 3, 4, 6, 8, 12].find((hours) => (width * hours) / spanHours >= MIN_LABEL_PX) ?? 12
  const hourTicks: { x: number; label: string; showLabel: boolean }[] = []
  for (let ms = startMs; ms <= endMs; ms += tickStepHours * 3_600_000) {
    const x = geo.x(ms)
    // The last tick is right aligned against the edge, which can walk it back
    // into its neighbour: keep the grid line, drop the label.
    const previous = hourTicks[hourTicks.length - 1]
    const rightAligned = x > width - 26
    const showLabel = !rightAligned || previous === undefined || x - previous.x >= MIN_LABEL_PX * 1.6
    hourTicks.push({ x, label: fmtLocal(new Date(ms).toISOString(), tz), showLabel })
  }

  const cursorMs = Number.isFinite(Date.parse(timeUtc)) ? Date.parse(timeUtc) : startMs
  const cursorX = geo.x(cursorMs)

  const scrub = (clientX: number, silent: boolean) => {
    const node = containerRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setTime(geo.timeAt(clientX - rect.left), 'human', { silent })
  }

  const hoveredRow = visibleRows.find((row) => row.key === hovered) ?? null
  const hoverInfo = hoveredRow ? describeBlock(hoveredRow.item, site, tz) : null

  return (
    <div className="font-mono">
      <div ref={containerRef} className="relative w-full select-none">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full touch-none"
          onPointerDown={(event) => {
            dragging.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
            scrub(event.clientX, true)
          }}
          onPointerMove={(event) => {
            if (dragging.current) scrub(event.clientX, true)
          }}
          onPointerUp={(event) => {
            if (!dragging.current) return
            dragging.current = false
            event.currentTarget.releasePointerCapture(event.pointerId)
            scrub(event.clientX, false)
          }}
        >
          <defs>
            <pattern
              id="moon-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="#8a93a6" strokeWidth="2" />
            </pattern>
          </defs>

          {geo.bands.map((band, i) => (
            <rect
              key={`${band.kind}-${i}`}
              x={band.x0}
              y={0}
              width={Math.max(band.x1 - band.x0, 0.5)}
              height={height}
              fill={BAND_FILL[band.kind]}
            />
          ))}

          {geo.moonSpans.map((span, i) => (
            <rect
              key={`moon-${i}`}
              x={span.x0}
              y={0}
              width={Math.max(span.x1 - span.x0, 0.5)}
              height={height}
              fill="url(#moon-hatch)"
              opacity={geo.moonOpacity}
            />
          ))}

          {hourTicks.map((tick, i) => {
            const atEnd = tick.x > width - 26
            return (
              <g key={`tick-${i}`}>
                <line
                  x1={tick.x}
                  y1={TOP - 6}
                  x2={tick.x}
                  y2={height - BOTTOM}
                  stroke="#1c2230"
                  strokeWidth={1}
                />
                <text
                  x={atEnd ? tick.x - 2 : tick.x + 2}
                  y={10}
                  fill="#8a93a6"
                  fontSize={9}
                  textAnchor={atEnd ? 'end' : 'start'}
                  opacity={tick.showLabel ? 1 : 0}
                >
                  {tick.label}
                </text>
              </g>
            )
          })}

          {visibleRows.map((row, index) => {
            const rowTop = rowsTop + index * rowHeight
            const curve = altitudeCurve(row.item.targetId, nightOf, site, startMs, endMs)
            const points = curve
              .map((alt, i) => {
                const ms = startMs + i * CURVE_STEP_MINUTES * 60_000
                return `${geo.x(ms).toFixed(1)},${altToY(alt, rowTop, rowHeight).toFixed(1)}`
              })
              .join(' ')
            const x0 = geo.x(row.item.startUtc)
            const x1 = geo.x(row.item.endUtc)
            const blockWidth = Math.max(x1 - x0, 3)
            const stroke = row.warning ? '#ff5c4d' : '#ffb454'
            const label = `${row.item.targetName} ${fmtLocal(row.item.startUtc, tz)}`
            return (
              <g key={row.key}>
                <line
                  x1={0}
                  y1={rowTop + rowHeight - 1}
                  x2={width}
                  y2={rowTop + rowHeight - 1}
                  stroke="#1c2230"
                  strokeWidth={1}
                />
                <polyline points={points} fill="none" stroke="#8a93a6" strokeWidth={1} opacity={0.5} />
                <rect
                  x={x0}
                  y={rowTop + 2}
                  width={blockWidth}
                  height={rowHeight - 5}
                  fill={row.ghost ? 'none' : '#ffb454'}
                  fillOpacity={row.ghost ? 0 : 0.3}
                  stroke={row.decision === 'rejected' ? '#ff5c4d' : stroke}
                  strokeWidth={1}
                  strokeDasharray={row.ghost ? '3 2' : undefined}
                  opacity={row.decision === 'rejected' ? 0.45 : 1}
                  onMouseEnter={() => setHovered(row.key)}
                  onMouseLeave={() => setHovered((current) => (current === row.key ? null : current))}
                />
                <text
                  x={blockWidth > 90 ? x0 + 4 : Math.min(x1 + 4, width - 4)}
                  y={rowTop + rowHeight / 2 + 3}
                  fontSize={9}
                  fill={blockWidth > 90 ? '#ffe6bf' : '#8a93a6'}
                  textAnchor={blockWidth > 90 ? 'start' : x1 > width - 90 ? 'end' : 'start'}
                >
                  {row.ghost ? `? ${label}` : label}
                </text>
              </g>
            )
          })}

          <line x1={cursorX} y1={0} x2={cursorX} y2={height} stroke="#ffb454" strokeWidth={1} />
          <polygon
            points={`${cursorX - 4},0 ${cursorX + 4},0 ${cursorX},6`}
            fill="#ffb454"
          />
        </svg>

        {visibleRows.map((row, index) => {
          if (!row.ghost || !row.proposalId) return null
          const rowTop = rowsTop + index * rowHeight
          const left = Math.min(geo.x(row.item.endUtc) + 6, Math.max(width - 96, 0))
          return (
            <div
              key={`actions-${row.key}`}
              className="absolute flex gap-1"
              style={{ left, top: rowTop + 2 }}
            >
              <button
                type="button"
                title={`Accept ${row.item.targetName}`}
                className={`rounded-sm border px-1 text-[10px] ${
                  row.decision === 'accepted'
                    ? 'border-ember bg-ember/20 text-ember'
                    : 'border-panel-edge text-faint hover:border-ember/60 hover:text-ember'
                }`}
                onClick={() =>
                  decideProposalItem(row.proposalId!, row.item.id, 'accepted', undefined, 'human')
                }
              >
                ✓
              </button>
              <button
                type="button"
                title={`Reject ${row.item.targetName}`}
                className={`rounded-sm border px-1 text-[10px] ${
                  row.decision === 'rejected'
                    ? 'border-signal bg-signal/20 text-signal'
                    : 'border-panel-edge text-faint hover:border-signal/60 hover:text-signal'
                }`}
                onClick={() => {
                  setReason('')
                  setRejecting({ proposalId: row.proposalId!, item: row.item })
                }}
              >
                ✗
              </button>
            </div>
          )
        })}

        {hoveredRow && hoverInfo && (
          <div
            className="pointer-events-none absolute z-10 rounded-sm border border-panel-edge bg-abyss/95 px-2 py-1 text-[11px] text-faint"
            style={{
              left: Math.min(geo.x(hoveredRow.item.startUtc), Math.max(width - 220, 0)),
              top: 2,
            }}
          >
            <p className="text-ember">{hoveredRow.item.targetName}</p>
            <p className="tabular-nums">{hoverInfo}</p>
            {hoveredRow.warning && <p className="text-signal">{hoveredRow.warning}</p>}
          </div>
        )}
      </div>

      {hiddenCount > 0 && (
        <p className="mt-1 text-[11px] text-faint">
          +{hiddenCount} more {hiddenCount === 1 ? 'item' : 'items'} not drawn. Remove one to see it.
        </p>
      )}

      {rows.length === 0 && (
        <p className="mt-1 text-[11px] text-faint">
          No blocks yet. Add a target from the inspector, or ask your agent to propose a plan.
        </p>
      )}

      {rejecting && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-signal/40 bg-signal/5 p-2">
          <span className="text-[11px] tracking-[0.2em] text-signal uppercase">
            Reject {truncate(rejecting.item.targetName, 24)}
          </span>
          <input
            autoFocus
            type="text"
            value={reason}
            placeholder="Why? The agent reads this."
            className="min-w-40 flex-1 rounded-sm border border-panel-edge bg-abyss px-2 py-1 text-xs text-[#e6e9f0] outline-none focus:border-signal/60"
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRejecting(null)
              if (event.key !== 'Enter') return
              decideProposalItem(
                rejecting.proposalId,
                rejecting.item.id,
                'rejected',
                reason.trim() || undefined,
                'human',
              )
              setRejecting(null)
            }}
          />
          <button
            type="button"
            className="rounded-sm border border-signal/50 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-signal hover:bg-signal/20"
            onClick={() => {
              decideProposalItem(
                rejecting.proposalId,
                rejecting.item.id,
                'rejected',
                reason.trim() || undefined,
                'human',
              )
              setRejecting(null)
            }}
          >
            Reject
          </button>
          <button
            type="button"
            className="rounded-sm border border-panel-edge px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-faint hover:text-ember"
            onClick={() => setRejecting(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

/** Tooltip line: altitude at both ends of the block, airmass and Moon separation. */
function describeBlock(item: PlanItem, site: Site, tz: string | null): string | null {
  const target = getTarget(item.targetId)
  if (!target) return null
  const from = new Date(item.startUtc)
  const to = new Date(item.endUtc)
  const startAlt = targetAltAz(target, from, site).altDeg
  const endAlt = targetAltAz(target, to, site).altDeg
  const best = Math.max(startAlt, endAlt)
  return `${fmtTimeRange(item.startUtc, item.endUtc, tz)} ${zoneLabel(tz)} · alt ${fmtDeg(
    startAlt,
  )} to ${fmtDeg(endAlt)} · airmass ${fmtAirmass(airmass(best))} · Moon ${fmtDeg(
    moonSeparationDeg(target, from, site),
  )}`
}
