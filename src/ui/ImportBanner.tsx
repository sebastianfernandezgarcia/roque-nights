/**
 * Someone else's night, revalidated for this sky. Shown after import_plan (or
 * after opening a share link) so the human knows where the plan came from.
 */

import { useRoqueStore } from '../state/store'
import { plural, truncate } from './format'

export function ImportBanner() {
  const banner = useRoqueStore((s) => s.importBanner)
  const setImportBanner = useRoqueStore((s) => s.setImportBanner)
  if (!banner) return null

  return (
    <section className="rounded-sm border border-ember/40 bg-ember/10 p-3 font-mono text-xs text-ember">
      <div className="flex items-start justify-between gap-3">
        <p>
          Plan imported from {truncate(banner.from, 60)}: {banner.observableCount} of{' '}
          {banner.totalCount} {plural(banner.totalCount, 'target')}{' '}
          {banner.observableCount === 1 ? 'is' : 'are'} observable here. Review it in the Plan panel.
        </p>
        <button
          type="button"
          className="shrink-0 rounded-sm border border-ember/40 px-2 py-1 text-[11px] uppercase tracking-[0.2em] hover:bg-ember/20"
          onClick={() => setImportBanner(null)}
        >
          Dismiss
        </button>
      </div>
    </section>
  )
}
