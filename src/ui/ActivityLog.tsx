/**
 * Attribution, live. Every action carries who did it, what came back and how
 * long it took, so the human never has to trust the agent's word for it.
 */

import { useRoqueStore } from '../state/store'
import { fmtDuration, fmtLocal, truncate, zoneLabel } from './format'

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'

const STATUS_GLYPH: Record<string, string> = { running: '●', ok: '✓', error: '✗' }

/**
 * 'HH:mm:ss' in the site zone. Seconds come from the instant itself: every IANA
 * zone in use today is offset by whole minutes.
 */
function hhmmss(iso: string, timeZone: string | null): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return fmtLocal(iso, timeZone)
  const seconds = String(new Date(ms).getUTCSeconds()).padStart(2, '0')
  return `${fmtLocal(iso, timeZone)}:${seconds}`
}

export function ActivityLog() {
  const activity = useRoqueStore((s) => s.activity)
  const site = useRoqueStore((s) => s.site)
  const tz = site.timeZone

  return (
    <section className="rounded-sm border border-panel-edge bg-panel p-3 font-mono">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className={LABEL}>Activity</h2>
        <span className="text-[11px] text-faint">{zoneLabel(tz)}</span>
      </div>

      {activity.length === 0 ? (
        <p className="text-xs text-faint">
          Nothing yet. Move the time slider, or ask your agent what tonight looks like.
        </p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
          {activity.map((entry) => {
            const agent = entry.source === 'agent'
            return (
              <li
                key={entry.id}
                className={`rounded-sm border border-panel-edge px-2 py-1 ${
                  agent ? 'agent-flash' : ''
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`rounded-sm px-1 text-[10px] tracking-[0.2em] uppercase ${
                      agent ? 'bg-signal/15 text-signal' : 'bg-ember/15 text-ember'
                    }`}
                  >
                    {entry.source}
                  </span>
                  <span className="text-faint tabular-nums">{hhmmss(entry.at, tz)}</span>
                  <span className="text-[#e6e9f0]">{entry.action}</span>
                  <span className="flex-1 truncate text-faint">{truncate(entry.detail, 48)}</span>
                  <span
                    className={
                      entry.status === 'error'
                        ? 'text-signal'
                        : entry.status === 'running'
                          ? 'animate-pulse text-ember'
                          : 'text-ember'
                    }
                  >
                    {STATUS_GLYPH[entry.status] ?? '?'}
                  </span>
                  {entry.durationMs !== undefined && (
                    <span className="text-faint tabular-nums">{fmtDuration(entry.durationMs)}</span>
                  )}
                </div>
                {entry.result && (
                  <p className="mt-0.5 text-[11px] text-faint">{truncate(entry.result, 120)}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
