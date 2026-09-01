/**
 * What the human is looking at right now. The agent reads the same selection
 * through describe_current_view, so this panel is literally the shared subject
 * of the conversation.
 */

import { useEffect, useMemo, useState } from 'react'

import { getNight } from '../astro/cache'
import { getTarget, targetTypeLabel } from '../astro/catalog'
import { scheduleTargets } from '../astro/schedule'
import {
  airmass,
  apparentMagnitude,
  compassDirection,
  computeVisibility,
  moonSeparationDeg,
  targetAltAz,
} from '../astro/targets'
import { planIntervals, useRoqueStore } from '../state/store'
import type { PlanItem } from '../state/types'
import { EMPTY, fmtAirmass, fmtDeg, fmtLocal, fmtMag, fmtTimeRange, zoneLabel } from './format'

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'
const BUTTON =
  'rounded-sm border border-panel-edge px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-faint hover:border-ember/50 hover:text-ember'
const BLOCK_MINUTES = 45

function newId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function Inspector() {
  const selectedId = useRoqueStore((s) => s.selectedId)
  const site = useRoqueStore((s) => s.site)
  const nightOf = useRoqueStore((s) => s.nightOf)
  const timeUtc = useRoqueStore((s) => s.timeUtc)
  const filters = useRoqueStore((s) => s.filters)
  const plan = useRoqueStore((s) => s.plan)
  const favoriteIds = useRoqueStore((s) => s.favoriteIds)
  const select = useRoqueStore((s) => s.select)
  const setView = useRoqueStore((s) => s.setView)
  const setPlan = useRoqueStore((s) => s.setPlan)
  const toggleFavorite = useRoqueStore((s) => s.toggleFavorite)
  // Keyed by target so a message never survives a change of selection.
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null)

  const target = selectedId ? getTarget(selectedId) : undefined

  useEffect(() => {
    if (!selectedId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const active = document.activeElement
      // Esc inside a text field belongs to that field, not to the panel.
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
      select(null, 'human')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, select])

  const night = useMemo(() => {
    try {
      return getNight(nightOf, site)
    } catch {
      return null
    }
  }, [nightOf, site])

  const live = useMemo(() => {
    if (!target || !night) return null
    const ms = Date.parse(timeUtc)
    const at = new Date(Number.isFinite(ms) ? ms : Date.parse(night.windowStartUtc))
    const altAz = targetAltAz(target, at, site)
    return {
      altAz,
      direction: compassDirection(altAz.azDeg),
      airmass: airmass(altAz.altDeg),
      moonSep: moonSeparationDeg(target, at, site),
      mag: apparentMagnitude(target, at),
    }
  }, [target, night, timeUtc, site])

  const visibility = useMemo(() => {
    if (!target || !night) return null
    return computeVisibility(target, night, site, {
      minAltDeg: filters.minAltDeg,
      interval: null,
      minMoonSepDeg: filters.minMoonSepDeg,
      at: timeUtc,
    })
  }, [target, night, site, filters.minAltDeg, filters.minMoonSepDeg, timeUtc])

  if (!selectedId) {
    // An empty panel is a dead end. Say what the dome is for instead.
    return (
      <section className="rounded-sm border border-panel-edge bg-panel p-3 font-mono">
        <h2 className={LABEL}>Inspector</h2>
        <p className="mt-1 text-xs text-faint">
          Tap an object on the dome for its altitude, airmass, Moon separation and tonight's
          window. Double click or long press to mark a favorite: your agent reads favorites
          through describe_current_view.
        </p>
      </section>
    )
  }

  if (!target) {
    return (
      <section className="rounded-sm border border-panel-edge bg-panel p-3 font-mono">
        <div className="flex items-baseline justify-between">
          <h2 className={LABEL}>Inspector</h2>
          <button type="button" className={BUTTON} onClick={() => select(null, 'human')}>
            Close
          </button>
        </div>
        <p className="mt-2 text-xs text-signal">
          Nothing in the catalog matches "{selectedId}". Try a Messier id like M31, a planet or a
          bright star.
        </p>
      </section>
    )
  }

  const tz = site.timeZone
  const isFavorite = favoriteIds.includes(target.id)

  const addToPlan = () => {
    if (!night) return
    const result = scheduleTargets([{ target, durationMinutes: BLOCK_MINUTES }], night, site, {
      minAltDeg: filters.minAltDeg,
      occupied: planIntervals(plan),
    })
    const block = result.blocks[0]
    if (!block) {
      const reason = result.unscheduled[0]?.reason ?? 'no free slot in the darkness window'
      setMessage({ id: target.id, text: `Not added: ${reason}` })
      return
    }
    const item: PlanItem = {
      id: newId(),
      targetId: target.id,
      targetName: target.name,
      startUtc: block.startUtc,
      endUtc: block.endUtc,
      note: block.note,
      source: 'human',
    }
    setPlan([...plan, item], 'human', `add ${target.id}`)
    setMessage({
      id: target.id,
      text: `Added ${target.name} at ${fmtLocal(block.startUtc, tz)} ${zoneLabel(tz)}.`,
    })
  }

  const pointMap = () => {
    if (!live) return
    setView(
      {
        centerAltDeg: live.altAz.altDeg,
        centerAzDeg: live.altAz.azDeg,
        fovDeg: 40,
        animate: true,
      },
      'human',
    )
  }

  return (
    <section className="rounded-sm border border-panel-edge bg-panel p-3 font-mono">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm text-ember">{target.name}</h2>
          <p className="text-[11px] text-faint">
            {target.id} · {targetTypeLabel(target.type)}
            {target.con ? ` · ${target.con}` : ''} ·{' '}
            {live?.mag !== null && live?.mag !== undefined ? fmtMag(live.mag) : fmtMag(target.mag)}
          </p>
        </div>
        <button type="button" className={BUTTON} onClick={() => select(null, 'human')}>
          Close
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
        <Field label="Altitude" value={fmtDeg(live?.altAz.altDeg)} accent />
        <Field
          label="Azimuth"
          value={live ? `${fmtDeg(live.altAz.azDeg)} ${live.direction}` : EMPTY}
        />
        <Field label="Airmass" value={fmtAirmass(live?.airmass)} />
        <Field label="Moon sep" value={fmtDeg(live?.moonSep)} />
      </dl>

      <div className="mt-3 border-t border-panel-edge pt-2 text-xs">
        <p className={LABEL}>Tonight</p>
        {visibility?.observable && visibility.window ? (
          <ul className="mt-1 space-y-0.5 text-[#e6e9f0] tabular-nums">
            <li>
              Above {Math.round(filters.minAltDeg)}°:{' '}
              {fmtTimeRange(visibility.window.startUtc, visibility.window.endUtc, tz)} (
              {visibility.window.minutes} min)
            </li>
            <li>
              Transit {fmtLocal(visibility.transitUtc, tz)} at {fmtDeg(visibility.transitAltDeg)},
              airmass {fmtAirmass(visibility.window.peakAirmass)}
            </li>
            <li className="text-faint">
              Moon separation at peak {fmtDeg(visibility.window.moonSeparationDeg)} · score{' '}
              {visibility.score}
            </li>
          </ul>
        ) : (
          <p className="mt-1 text-signal">
            Not observable tonight: {visibility?.reason ?? 'no darkness window for this night'}.
          </p>
        )}
      </div>

      {message?.id === target.id && <p className="mt-2 text-xs text-ember">{message.text}</p>}

      <div className="mt-3 flex flex-wrap gap-1">
        <button
          type="button"
          className={`${BUTTON} ${isFavorite ? 'border-ember/60 text-ember' : ''}`}
          onClick={() => toggleFavorite(target.id, 'human')}
        >
          {isFavorite ? '★ Favorite' : '☆ Favorite'}
        </button>
        <button type="button" className={BUTTON} onClick={pointMap}>
          Point map
        </button>
        <button type="button" className={BUTTON} onClick={addToPlan}>
          Add to plan
        </button>
      </div>
    </section>
  )
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className={LABEL}>{label}</dt>
      <dd className={`mt-0.5 tabular-nums ${accent ? 'text-ember' : 'text-[#e6e9f0]'}`}>{value}</dd>
    </div>
  )
}
