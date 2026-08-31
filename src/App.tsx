import { useMemo } from 'react'
import { computeNightConditions, formatInZone } from './astro/conditions'
import { useRoqueStore } from './state/store'
import { APP_TOOLS } from './webmcp/registerTools'

export default function App() {
  const site = useRoqueStore((s) => s.site)
  const nightOf = useRoqueStore((s) => s.nightOf)
  const webmcp = useRoqueStore((s) => s.webmcp)
  const activityLog = useRoqueStore((s) => s.activityLog)

  const conditions = useMemo(() => computeNightConditions(nightOf, site), [nightOf, site])
  const tz = site.timeZone

  const simulateAgentCall = async () => {
    // Harness path: exercises the exact same tool the agent calls.
    const tool = APP_TOOLS[0]
    await tool.execute({}, {})
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 font-mono">
      <header className="mb-8">
        <p className="text-xs tracking-[0.3em] text-signal">SPIKE 001 · WEBMCP CIRCUIT</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ember">ROQUE NIGHTS</h1>
        <p className="mt-1 text-sm text-faint">
          Agent-native observing planner · {site.name} · {site.elevationM} m
        </p>
      </header>

      <WebMCPBadge status={webmcp.status} toolCount={webmcp.toolCount} />

      <section className="mt-6 rounded border border-panel-edge bg-panel p-5">
        <h2 className="text-xs tracking-[0.2em] text-faint">
          NIGHT OF {conditions.nightOf} · LOCAL TIME ({tz})
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <Metric label="Sunset" value={formatInZone(conditions.sunsetUtc, tz)} />
          <Metric label="Darkness begins" value={formatInZone(conditions.darknessStartUtc, tz)} accent />
          <Metric label="Darkness ends" value={formatInZone(conditions.darknessEndUtc, tz)} accent />
          <Metric label="Moonrise" value={formatInZone(conditions.moonriseUtc, tz)} />
          <Metric label="Moonset" value={formatInZone(conditions.moonsetUtc, tz)} />
          <Metric
            label="Moon"
            value={`${conditions.moonIlluminationPct}% · ${conditions.moonPhaseName}`}
          />
          <Metric label="Dark hours" value={`${conditions.darkHours ?? '—'} h`} />
          <Metric label="Moon-free dark" value={`${conditions.moonFreeDarkHours ?? '—'} h`} accent />
        </dl>
      </section>

      <section className="mt-6 rounded border border-panel-edge bg-panel p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs tracking-[0.2em] text-faint">ACTIVITY</h2>
          <button
            onClick={simulateAgentCall}
            className="rounded border border-ember/40 px-3 py-1 text-xs text-ember hover:bg-ember/10"
          >
            Simulate agent call
          </button>
        </div>
        <ul className="mt-3 space-y-2 text-xs">
          {activityLog.length === 0 && (
            <li className="text-faint">No activity yet. Ask your agent about tonight's sky.</li>
          )}
          {activityLog.map((e) => (
            <li key={e.at + e.action} className="flex items-baseline gap-2">
              <span
                className={
                  e.source === 'agent'
                    ? 'rounded bg-signal/15 px-1.5 py-0.5 text-signal'
                    : 'rounded bg-ember/15 px-1.5 py-0.5 text-ember'
                }
              >
                {e.source.toUpperCase()}
              </span>
              <span className="text-faint">{formatInZone(e.at, tz)}</span>
              <span>{e.action}</span>
              <span className="truncate text-faint">{e.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-faint">{label}</dt>
      <dd className={`mt-0.5 text-base ${accent ? 'text-ember' : ''}`}>{value}</dd>
    </div>
  )
}

function WebMCPBadge({ status, toolCount }: { status: string; toolCount: number }) {
  if (status === 'registered') {
    return (
      <p className="inline-flex items-center gap-2 rounded border border-ember/30 bg-ember/10 px-3 py-1.5 text-xs text-ember">
        <span className="h-2 w-2 rounded-full bg-ember" />
        WebMCP live · {toolCount} site tool{toolCount === 1 ? '' : 's'} registered
      </p>
    )
  }
  if (status === 'unsupported') {
    return (
      <div className="rounded border border-signal/30 bg-signal/10 p-3 text-xs text-signal">
        <p className="font-bold">This browser does not expose WebMCP.</p>
        <p className="mt-1 text-faint">
          Chrome 149+: enable <code>chrome://flags/#enable-webmcp-testing</code> and reload. Or open
          this page in the ChatGPT desktop app's built-in browser and use "Site tools".
        </p>
      </div>
    )
  }
  return <p className="text-xs text-faint">Checking WebMCP…</p>
}
