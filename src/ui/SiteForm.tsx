/**
 * The declarative WebMCP form.
 *
 * The agent fills in the same form the human uses, so there is one validation
 * path and one source of truth for the observing site. The form stays mounted
 * even while the dialog is closed: an agent must be able to find it in the DOM
 * at any moment.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { isValidTimeZone } from '../astro/time'
import { DARK_SKY_SITES, SITE_BY_ID } from '../data/sites'
import { useRoqueStore } from '../state/store'
import type { Site } from '../state/types'

const TOOL_NAME = 'set_observing_site'
const TOOL_DESCRIPTION =
  'Change the observing site shown in the app. Pick a known dark-sky site by id or enter latitude, longitude (east positive), elevation in metres and an IANA time zone. The whole app (ephemeris, sky map, plan) recomputes for the new site.'

const MIN_ELEVATION_M = -430
const MAX_ELEVATION_M = 9000
const MAX_NAME_LENGTH = 80

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'
const FIELD =
  'w-full rounded-sm border border-panel-edge bg-abyss px-2 py-1 font-mono text-xs text-ember outline-none focus:border-ember/60'

/** IANA zones this browser knows, for the datalist. Empty when unavailable. */
function supportedTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  if (typeof intl.supportedValuesOf !== 'function') return []
  try {
    return intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

interface FormValues {
  siteId: string
  latitude: string
  longitude: string
  elevationM: string
  timeZone: string
  name: string
}

const CUSTOM = 'custom'

function valuesForSite(site: Site): FormValues {
  return {
    siteId: site.id ?? CUSTOM,
    latitude: String(site.latitude),
    longitude: String(site.longitude),
    elevationM: String(site.elevationM),
    timeZone: site.timeZone ?? '',
    name: site.name,
  }
}

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** Same rules as resolveSite in src/tools/resolveSite.ts, one message per failure. */
export function buildSiteFromValues(values: FormValues): { site: Site } | { error: string } {
  const catalog = values.siteId && values.siteId !== CUSTOM ? SITE_BY_ID.get(values.siteId) : undefined
  if (catalog) {
    const { country: _country, kind: _kind, ...site } = catalog
    return { site }
  }

  const latitude = parseNumber(values.latitude)
  const longitude = parseNumber(values.longitude)
  if (latitude === null || longitude === null) {
    return { error: 'Latitude and longitude are both required for a custom site.' }
  }
  if (Math.abs(latitude) > 90) return { error: 'Latitude must be between -90 and 90 degrees.' }
  if (Math.abs(longitude) > 180) {
    return { error: 'Longitude must be between -180 and 180 degrees, east positive.' }
  }

  const elevationRaw = values.elevationM.trim()
  let elevationM = 0
  if (elevationRaw !== '') {
    const parsed = parseNumber(elevationRaw)
    if (parsed === null || parsed < MIN_ELEVATION_M || parsed > MAX_ELEVATION_M) {
      return { error: `Elevation must be a number between ${MIN_ELEVATION_M} and ${MAX_ELEVATION_M} metres.` }
    }
    elevationM = parsed
  }

  const zoneRaw = values.timeZone.trim()
  let timeZone: string | null = null
  if (zoneRaw !== '') {
    if (!isValidTimeZone(zoneRaw)) {
      return { error: `"${zoneRaw}" is not an IANA time zone this browser knows, for example Atlantic/Canary.` }
    }
    timeZone = zoneRaw
  }

  const nameRaw = values.name.trim()
  if (nameRaw.length > MAX_NAME_LENGTH) {
    return { error: `Name must be at most ${MAX_NAME_LENGTH} characters.` }
  }

  return {
    site: {
      id: null,
      name: nameRaw === '' ? `${latitude.toFixed(3)}, ${longitude.toFixed(3)}` : nameRaw,
      latitude,
      longitude,
      elevationM,
      timeZone,
    },
  }
}

/** Maps an agent payload (snake_case, like the tools) onto the form fields. */
function valuesFromPayload(payload: Record<string, unknown>, current: FormValues): FormValues {
  const read = (key: string): string | null => {
    const value = payload[key]
    if (value === undefined || value === null) return null
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value === 'string') return value
    return null
  }
  const siteId = read('site_id') ?? read('id')
  const explicitId = siteId && SITE_BY_ID.has(siteId) ? siteId : null
  const hasCoords = read('latitude') !== null || read('longitude') !== null
  return {
    siteId: explicitId ?? (hasCoords ? CUSTOM : current.siteId),
    latitude: read('latitude') ?? (hasCoords ? '' : current.latitude),
    longitude: read('longitude') ?? (hasCoords ? '' : current.longitude),
    elevationM: read('elevation_m') ?? read('elevation') ?? (hasCoords ? '' : current.elevationM),
    timeZone: read('time_zone') ?? read('timezone') ?? (hasCoords ? '' : current.timeZone),
    name: read('name') ?? (hasCoords ? '' : current.name),
  }
}

function describeSite(site: Site): string {
  const zone = site.timeZone ?? 'no time zone, local times will be UTC'
  return `Site set to ${site.name} (${site.latitude.toFixed(3)}, ${site.longitude.toFixed(3)}, ${Math.round(site.elevationM)} m, ${zone}).`
}

export function SiteForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const site = useRoqueStore((s) => s.site)
  const setSite = useRoqueStore((s) => s.setSite)

  const [values, setValues] = useState<FormValues>(() => valuesForSite(site))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const zones = useMemo(() => supportedTimeZones(), [])

  // Reopening the dialog always shows the site the app is actually using.
  useEffect(() => {
    if (open) {
      setValues(valuesForSite(site))
      setError(null)
      setNotice(null)
    }
  }, [open, site])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // The declarative half of WebMCP: the agent submits this very form.
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const onAgentInvoked = (event: Event) => {
      const payload = event as Event & {
        data?: Record<string, unknown>
        detail?: Record<string, unknown>
        respondWith?: (value: unknown) => void
      }
      const data = payload.data ?? payload.detail ?? {}
      const next = valuesFromPayload(data, valuesForSite(site))
      setValues(next)
      const result = buildSiteFromValues(next)
      if ('error' in result) {
        setError(result.error)
        if (typeof payload.respondWith === 'function') {
          payload.respondWith({
            ok: false,
            error: { code: 'invalid_site', message: result.error },
          })
        }
        return
      }
      setError(null)
      setNotice(describeSite(result.site))
      setSite(result.site, 'agent')
      if (typeof payload.respondWith === 'function') {
        payload.respondWith({ ok: true, summary: describeSite(result.site) })
      }
    }
    form.addEventListener('agentInvoked', onAgentInvoked)
    return () => form.removeEventListener('agentInvoked', onAgentInvoked)
  }, [site, setSite])

  const patch = (part: Partial<FormValues>) => setValues((v) => ({ ...v, ...part }))

  const onSelectSite = (id: string) => {
    if (id === CUSTOM) {
      patch({ siteId: CUSTOM })
      return
    }
    const hit = SITE_BY_ID.get(id)
    if (!hit) return
    setValues({
      siteId: id,
      latitude: String(hit.latitude),
      longitude: String(hit.longitude),
      elevationM: String(hit.elevationM),
      timeZone: hit.timeZone ?? '',
      name: hit.name,
    })
    setError(null)
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = buildSiteFromValues(values)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    setSite(result.site, 'human')
    onClose()
  }

  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('This browser does not expose geolocation.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
        setValues({
          siteId: CUSTOM,
          latitude: position.coords.latitude.toFixed(4),
          longitude: position.coords.longitude.toFixed(4),
          elevationM:
            position.coords.altitude !== null && Number.isFinite(position.coords.altitude)
              ? String(Math.round(position.coords.altitude))
              : '0',
          timeZone: isValidTimeZone(zone) ? zone : '',
          name: 'My location',
        })
        setError(null)
      },
      (geoError) => setError(`Could not read your location: ${geoError.message}`),
    )
  }

  return (
    <div
      className={
        open
          ? 'fixed inset-0 z-50 flex items-start justify-center bg-abyss/85 p-6'
          : 'sr-only'
      }
      onMouseDown={open ? (event) => { if (event.target === event.currentTarget) onClose() } : undefined}
    >
      <div
        className={
          open
            ? 'w-full max-w-lg rounded-sm border border-panel-edge bg-panel p-4 shadow-2xl'
            : ''
        }
      >
        {open && (
          <div className="mb-3 flex items-center justify-between">
            <h2 className={LABEL}>Observing site</h2>
            <button type="button" className="text-xs text-faint hover:text-ember" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        <form
          ref={formRef}
          onSubmit={onSubmit}
          className="space-y-3 font-mono"
          {...({ toolname: TOOL_NAME, tooldescription: TOOL_DESCRIPTION } as Record<string, string>)}
        >
          <div>
            <label className={LABEL} htmlFor="site-id">
              Known dark-sky site
            </label>
            <select
              id="site-id"
              name="site_id"
              className={FIELD}
              value={values.siteId}
              onChange={(e) => onSelectSite(e.target.value)}
            >
              {DARK_SKY_SITES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value={CUSTOM}>Custom coordinates</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="site-latitude">
                Latitude (north +)
              </label>
              <input
                id="site-latitude"
                name="latitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                className={FIELD}
                value={values.latitude}
                onChange={(e) => patch({ siteId: CUSTOM, latitude: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="site-longitude">
                Longitude (east +)
              </label>
              <input
                id="site-longitude"
                name="longitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                className={FIELD}
                value={values.longitude}
                onChange={(e) => patch({ siteId: CUSTOM, longitude: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="site-elevation">
                Elevation (m)
              </label>
              <input
                id="site-elevation"
                name="elevation_m"
                type="number"
                step="any"
                className={FIELD}
                value={values.elevationM}
                onChange={(e) => patch({ siteId: CUSTOM, elevationM: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="site-time-zone">
                Time zone (IANA)
              </label>
              <input
                id="site-time-zone"
                name="time_zone"
                type="text"
                list="site-time-zones"
                placeholder="Atlantic/Canary"
                className={FIELD}
                value={values.timeZone}
                onChange={(e) => patch({ siteId: CUSTOM, timeZone: e.target.value })}
              />
              {open && zones.length > 0 && (
                <datalist id="site-time-zones">
                  {zones.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              )}
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="site-name">
              Name
            </label>
            <input
              id="site-name"
              name="name"
              type="text"
              maxLength={MAX_NAME_LENGTH}
              className={FIELD}
              value={values.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>

          {error && <p className="text-xs text-signal">{error}</p>}
          {notice && !error && <p className="text-xs text-ember">{notice}</p>}
          {values.siteId === CUSTOM && values.timeZone.trim() === '' && (
            <p className="text-xs text-faint">
              Without a time zone every hour in the app is shown in UTC. Roque Nights never guesses
              a zone.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded-sm border border-ember/50 bg-ember/10 px-3 py-1 text-xs text-ember hover:bg-ember/20"
            >
              Set site
            </button>
            <button
              type="button"
              className="rounded-sm border border-panel-edge px-3 py-1 text-xs text-faint hover:text-ember"
              onClick={useMyLocation}
            >
              Use my location
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
