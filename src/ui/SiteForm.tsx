/**
 * The declarative WebMCP form.
 *
 * The agent fills in the same form the human uses, so there is one validation
 * path and one source of truth for the observing site. The form stays mounted
 * even while the dialog is closed: an agent must be able to find it in the DOM
 * at any moment.
 *
 * Three callers end in `applySitePayload` (src/site/applySitePayload.ts): this
 * form's submit button, this form's `agentInvoked` handler, and the imperative
 * tool `set_observing_site`. One validator, one set of error messages, one place
 * that writes the store.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { isValidTimeZone } from '../astro/time'
import { DARK_SKY_SITES, SITE_BY_ID, findSite } from '../data/sites'
import {
  CUSTOM_SITE_ID,
  applySitePayload,
  resolveSitePayload,
} from '../site/applySitePayload'
import { useRoqueStore } from '../state/store'
import type { Site } from '../state/types'

// Distinct from the imperative tool: Chrome's engine rejects a duplicate tool name
// ('InvalidStateError: Duplicate tool name'), and the declarative registration wins.
const TOOL_NAME = 'set_observing_site_form'
const TOOL_DESCRIPTION =
  'Change the observing site shown in the app. Pick a known dark-sky site by id or enter latitude, longitude (east positive), elevation in metres and an IANA time zone. The whole app (ephemeris, sky map, plan) recomputes for the new site.'

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

const CUSTOM = CUSTOM_SITE_ID

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

/**
 * The form's fields keyed exactly like an agent payload, which is also exactly
 * what `new FormData(form)` produces from the field names.
 */
function payloadFromValues(values: FormValues): Record<string, string> {
  return {
    site_id: values.siteId,
    latitude: values.latitude,
    longitude: values.longitude,
    elevation_m: values.elevationM,
    time_zone: values.timeZone,
    name: values.name,
  }
}

/**
 * Validate what the form holds, without applying it.
 *
 * A thin adapter over the shared validator: the form speaks in strings and one
 * error line, `resolveSitePayload` speaks in a payload and a structured error,
 * and the rules live in exactly one of the two.
 */
export function buildSiteFromValues(values: FormValues): { site: Site } | { error: string } {
  const result = resolveSitePayload(payloadFromValues(values))
  return result.ok ? { site: result.site } : { error: result.error.message }
}

export interface PayloadValues {
  values: FormValues
  /** A site_id that was supplied and resolves to nothing in the catalog. */
  unknownSiteId: string | null
}

/**
 * Maps an agent payload (snake_case, like the tools) onto the form fields.
 *
 * The id goes through the same forgiving resolver the tools use, so "Mauna Kea",
 * "MAUNA-KEA" and " mauna-kea" all land on `mauna-kea`. An id that resolves to
 * nothing is reported rather than quietly dropped: falling back to the site the
 * app already showed and answering "Site set to ..." is the worst answer here.
 */
export function valuesFromPayload(
  payload: Record<string, unknown>,
  current: FormValues,
): PayloadValues {
  const read = (key: string): string | null => {
    const value = payload[key]
    if (value === undefined || value === null) return null
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value === 'string') return value
    return null
  }
  const rawId = read('site_id') ?? read('id')
  const siteId = rawId === null || rawId.trim() === '' ? null : rawId.trim()
  const matched = siteId === null || siteId === CUSTOM ? undefined : findSite(siteId)
  const explicitId = matched?.id ?? null
  const hasCoords = read('latitude') !== null || read('longitude') !== null
  const unknownSiteId =
    siteId !== null && siteId !== CUSTOM && matched === undefined && !hasCoords ? siteId : null
  return {
    unknownSiteId,
    values: {
      siteId: explicitId ?? (hasCoords || siteId === CUSTOM ? CUSTOM : current.siteId),
      latitude: read('latitude') ?? (hasCoords ? '' : current.latitude),
      longitude: read('longitude') ?? (hasCoords ? '' : current.longitude),
      elevationM: read('elevation_m') ?? read('elevation') ?? (hasCoords ? '' : current.elevationM),
      timeZone: read('time_zone') ?? read('timezone') ?? (hasCoords ? '' : current.timeZone),
      name: read('name') ?? (hasCoords ? '' : current.name),
    },
  }
}

/**
 * The form as it stands in the DOM, keyed exactly like an agent payload.
 *
 * Both paths read this, so a `submit` and an `agentInvoked` on the same form can
 * never disagree about what the human currently has typed in it.
 */
export function payloadFromForm(form: HTMLFormElement): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === 'string') payload[key] = value
  }
  return payload
}

export function SiteForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const site = useRoqueStore((s) => s.site)

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
      // First statement: a UA that treats an un-defaulted agentInvoked as "the
      // page did not handle it" would submit the form natively and undo this.
      event.preventDefault()
      const payload = event as Event & {
        data?: Record<string, unknown>
        detail?: Record<string, unknown>
        respondWith?: (value: unknown) => void
      }
      const respond = (value: unknown) => {
        if (typeof payload.respondWith === 'function') payload.respondWith(value)
      }
      // No payload means "submit what the form holds", which is the DOM, not
      // the site the app already had: answering "Site set to X" for a call that
      // changed nothing is the failure this guards against.
      const data = payload.data ?? payload.detail ?? payloadFromForm(form)
      const { values: next, unknownSiteId } = valuesFromPayload(data, valuesForSite(site))
      if (unknownSiteId !== null) {
        const message = `"${unknownSiteId}" is not a known dark-sky site id.`
        setError(message)
        respond({
          ok: false,
          error: {
            code: 'invalid_site',
            message,
            hint: `Use one of: ${DARK_SKY_SITES.slice(0, 6)
              .map((s) => s.id)
              .join(', ')} (${DARK_SKY_SITES.length} in total), or pass latitude and longitude.`,
          },
        })
        return
      }
      setValues(next)
      const result = applySitePayload(payloadFromValues(next), 'agent')
      if (!result.ok) {
        setError(result.error.message)
        respond({ ok: false, error: result.error })
        return
      }
      setError(null)
      setNotice(result.summary)
      // Show the site that was actually applied, not the payload that asked for
      // it: a catalog id brings its own name, elevation and zone.
      setValues(valuesForSite(result.site))
      respond({ ok: true, summary: result.summary })
    }
    form.addEventListener('agentInvoked', onAgentInvoked)
    return () => form.removeEventListener('agentInvoked', onAgentInvoked)
  }, [site])

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
    // Read the DOM, not the `values` closure: the agent path reads the same
    // thing, so the two can never apply different sites from one form.
    const { values: next } = valuesFromPayload(payloadFromForm(event.currentTarget), values)
    const result = applySitePayload(payloadFromValues(next), 'human')
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setError(null)
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
