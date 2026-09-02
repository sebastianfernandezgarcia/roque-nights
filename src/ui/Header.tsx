/**
 * The instrument header: who is observing, which night, and whether an agent
 * can reach the page at all.
 */

import { useEffect, useMemo, useState } from 'react'

import { makeObserver, sunAltitudeDeg } from '../astro/night'
import { addDays, parseIsoDate } from '../astro/time'
import { useRoqueStore } from '../state/store'
import { fmtDeg, zoneLabel } from './format'
import { SiteForm } from './SiteForm'

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'
const CHIP =
  'flex items-center gap-2 rounded-sm border border-panel-edge bg-abyss px-2 py-1 text-xs text-left'

/**
 * "Roque de los Muchachos, La Palma" is the name everywhere else; the header
 * has room for the place, not for the island.
 */
function shortSiteName(name: string): string {
  const head = name.split(',')[0].trim()
  return head === '' ? name : head
}

export interface HeaderProps {
  /** Reopens the first-visit tour. The Header is the only permanent way back in. */
  onOpenTour: () => void
}

export function Header({ onOpenTour }: HeaderProps) {
  const site = useRoqueStore((s) => s.site)
  const nightOf = useRoqueStore((s) => s.nightOf)
  const timeUtc = useRoqueStore((s) => s.timeUtc)
  const nightMode = useRoqueStore((s) => s.nightMode)
  const webmcp = useRoqueStore((s) => s.webmcp)
  const setNightOf = useRoqueStore((s) => s.setNightOf)
  const toggleNightMode = useRoqueStore((s) => s.toggleNightMode)

  const [siteFormOpen, setSiteFormOpen] = useState(false)

  // The red-light identity is the default; daylight planning is the exception,
  // and index.css keys the cooler palette off this attribute.
  useEffect(() => {
    const root = document.documentElement
    if (nightMode) root.removeAttribute('data-daylight')
    else root.setAttribute('data-daylight', 'on')
  }, [nightMode])

  const sunAltDeg = useMemo(() => {
    const ms = Date.parse(timeUtc)
    if (!Number.isFinite(ms)) return null
    try {
      return sunAltitudeDeg(new Date(ms), makeObserver(site))
    } catch {
      return null
    }
  }, [timeUtc, site])

  const shiftNight = (days: number) => {
    if (!parseIsoDate(nightOf)) return
    setNightOf(addDays(nightOf, days), 'human')
  }

  return (
    // min-h, never h: at 900 px and again above 1280 px the chips wrap onto a
    // second row, and a fixed height with overflow-hidden sliced them in half.
    <header className="flex min-h-14 w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-panel-edge bg-panel px-3 py-1.5">
      <div className="flex min-w-0 shrink-0 flex-wrap items-baseline gap-x-3">
        <span className="font-mono text-base font-bold tracking-[0.18em] whitespace-nowrap text-ember">
          ROQUE NIGHTS
        </span>
        <span className="hidden text-[11px] tracking-[0.2em] whitespace-nowrap text-faint uppercase xl:inline">
          Agent-native observing planner
        </span>
        {/* Below 960 px the tagline is gone and the chips have wrapped: this one
            line is all a first-time visitor has to tell them what the page is. */}
        <span className="font-mono text-[11px] tracking-[0.16em] text-faint uppercase lg:hidden">
          Plan with your AI agent
        </span>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 font-mono">
        <button
          type="button"
          className={`${CHIP} min-w-0 hover:border-ember/50`}
          onClick={() => setSiteFormOpen(true)}
          title={`${site.name} · ${Math.round(site.elevationM)} m · ${zoneLabel(site.timeZone)}. Click to change the observing site.`}
        >
          <span className={LABEL}>Site</span>
          <span className="max-w-[15rem] truncate text-ember">{shortSiteName(site.name)}</span>
          <span className="hidden whitespace-nowrap text-faint xl:inline">
            {Math.round(site.elevationM)} m · {zoneLabel(site.timeZone)}
          </span>
        </button>

        <div className={CHIP}>
          <span className={LABEL}>Night</span>
          <button
            type="button"
            className="px-1 text-faint hover:text-ember"
            onClick={() => shiftNight(-1)}
            aria-label="Previous night"
          >
            {'<'}
          </button>
          <input
            type="date"
            className="bg-transparent text-ember outline-none"
            value={nightOf}
            onChange={(e) => {
              const value = e.target.value
              if (parseIsoDate(value)) setNightOf(value, 'human')
            }}
            aria-label="Night of"
          />
          <button
            type="button"
            className="px-1 text-faint hover:text-ember"
            onClick={() => shiftNight(1)}
            aria-label="Next night"
          >
            {'>'}
          </button>
        </div>

        {sunAltDeg !== null && sunAltDeg > 0 && (
          <span
            className="rounded-sm border border-daylight/40 bg-daylight/10 px-2 py-1 text-[11px] tracking-[0.2em] text-daylight uppercase"
            title={`Sun altitude ${fmtDeg(sunAltDeg)} at the selected time`}
          >
            Daytime
          </span>
        )}

        <button
          type="button"
          className={`${CHIP} border-ember/50 text-ember hover:bg-ember/10`}
          onClick={onOpenTour}
          title="Four steps: what an agent can do on this page, and the prompt to start with."
        >
          <span className="text-[11px] tracking-[0.2em] uppercase">Try with your agent</span>
        </button>

        <WebMCPBadge status={webmcp.status} toolCount={webmcp.toolCount} />

        <button
          type="button"
          className={`${CHIP} accent-chrome hover:border-ember/50`}
          onClick={() => toggleNightMode('human')}
          title="Red light keeps your dark adaptation. Daylight is for planning before sunset."
        >
          <span className={nightMode ? 'text-signal' : ''}>
            {nightMode ? 'RED LIGHT' : 'DAYLIGHT'}
          </span>
        </button>
      </div>

      <SiteForm open={siteFormOpen} onClose={() => setSiteFormOpen(false)} />
    </header>
  )
}

function WebMCPBadge({ status, toolCount }: { status: string; toolCount: number }) {
  if (status === 'registered') {
    return (
      <span className="accent-chrome flex items-center gap-2 rounded-sm border border-ember/40 bg-ember/10 px-2 py-1 text-[11px] tracking-[0.2em] text-ember uppercase">
        <span className="accent-dot h-1.5 w-1.5 rounded-full bg-ember" />
        WebMCP live · {toolCount} tools
      </span>
    )
  }
  if (status === 'unsupported') {
    return (
      <span
        className="rounded-sm border border-signal/40 bg-signal/10 px-2 py-1 text-[11px] tracking-[0.2em] text-signal uppercase"
        title="Chrome 149+: enable chrome://flags/#enable-webmcp-testing and reload, or open this page in the ChatGPT desktop browser and use Site tools."
      >
        WebMCP off · enable the flag
      </span>
    )
  }
  return (
    <span className="rounded-sm border border-panel-edge px-2 py-1 text-[11px] tracking-[0.2em] text-faint uppercase">
      Checking WebMCP
    </span>
  )
}
