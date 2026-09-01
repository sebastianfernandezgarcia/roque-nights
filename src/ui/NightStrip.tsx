/**
 * Six numbers that decide whether a night is worth driving up the mountain for.
 */

import { useMemo } from 'react'

import { getNight } from '../astro/cache'
import { useRoqueStore } from '../state/store'
import { EMPTY, fmtHours, fmtLocal, fmtPct, fmtUtc, phaseGlyph, zoneLabel } from './format'

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'

const DARKNESS_NOTE: Record<string, string> = {
  no_astronomical_darkness:
    'No astronomical darkness tonight: the Sun stays above 18 degrees below the horizon.',
  continuous_darkness: 'Continuous astronomical darkness tonight: the Sun never rises.',
}

const SUN_NOTE: Record<string, string> = {
  never_sets: 'The Sun never sets on this date at this latitude.',
  never_rises: 'The Sun never rises on this date at this latitude.',
}

export function NightStrip() {
  const site = useRoqueStore((s) => s.site)
  const nightOf = useRoqueStore((s) => s.nightOf)

  const night = useMemo(() => {
    try {
      return getNight(nightOf, site)
    } catch {
      return null
    }
  }, [nightOf, site])

  if (!night) {
    return (
      <section className="rounded-sm border border-panel-edge bg-panel p-3">
        <p className="text-xs text-signal">
          {nightOf} is not a valid calendar date. Pick a night between 1900 and 2100.
        </p>
      </section>
    )
  }

  const tz = site.timeZone
  const zone = zoneLabel(tz)
  const moon = night.moon
  const darknessNote = DARKNESS_NOTE[night.darkness.status]
  const sunNote = SUN_NOTE[night.sun.status]

  return (
    <section className="rounded-sm border border-panel-edge bg-panel p-3 font-mono">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className={`${LABEL} whitespace-nowrap`}>Night of {night.nightOf}</h2>
        <span className="truncate text-[11px] tracking-[0.2em] text-faint uppercase">
          {tz ? zone : 'UTC (no zone)'}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
        <Metric
          label="Sunset"
          value={fmtLocal(night.sun.sunsetUtc, tz)}
          utc={fmtUtc(night.sun.sunsetUtc)}
        />
        <Metric
          label="Darkness"
          accent
          value={
            night.darkness.startUtc && night.darkness.endUtc
              ? `${fmtLocal(night.darkness.startUtc, tz)}-${fmtLocal(night.darkness.endUtc, tz)}`
              : EMPTY
          }
          utc={
            night.darkness.startUtc && night.darkness.endUtc
              ? `${fmtUtc(night.darkness.startUtc)}-${fmtUtc(night.darkness.endUtc)} UTC`
              : 'no astronomical darkness'
          }
        />
        <Metric
          label="Moon"
          value={`${phaseGlyph(moon.phaseName)} ${fmtPct(moon.illuminationPct)}`}
          utc={`${moon.phaseName}, rise ${fmtUtc(moon.riseUtc)} UTC, set ${fmtUtc(moon.setUtc)} UTC`}
          hint={`${fmtLocal(moon.riseUtc, tz)} / ${fmtLocal(moon.setUtc, tz)}`}
        />
        <Metric label="Dark" value={fmtHours(night.darkness.hours)} utc="Hours below -18 degrees" />
        <Metric
          label="Moon-free"
          accent
          value={fmtHours(night.darkness.moonFreeHours)}
          utc="Dark hours with the Moon below the horizon"
        />
        <Metric
          label="Usable"
          value={fmtHours(night.darkness.usableHours)}
          utc="Dark hours with no Moon or a Moon under 15 percent"
        />
      </dl>

      {(darknessNote || sunNote) && (
        <p className="mt-2 text-xs text-signal">{sunNote ?? darknessNote}</p>
      )}
    </section>
  )
}

function Metric({
  label,
  value,
  utc,
  hint,
  accent,
}: {
  label: string
  value: string
  utc?: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div title={utc}>
      <dt className={LABEL}>{label}</dt>
      <dd className={`mt-0.5 tabular-nums ${accent ? 'text-ember' : 'text-[#e6e9f0]'}`}>{value}</dd>
      {hint && <dd className="text-[11px] text-faint tabular-nums">{hint}</dd>}
    </div>
  )
}
