import { describe, expect, it } from 'vitest'

import { CSV_HEADER } from '../plan/serialize'
import { decodePlanFromHash } from '../plan/shareUrl'
import { ROQUE_DE_LOS_MUCHACHOS } from '../state/store'
import type { PlanItem } from '../state/types'
import {
  EMPTY_EXPORT_NOTE,
  EXPORT_FORMATS,
  READY_EXPORT_NOTE,
  STALE_EXPORT_NOTE,
  buildExportPayload,
  buildShareLink,
  exportGate,
  planFilename,
} from './ExportActions'

const DARKNESS = { startUtc: '2026-09-12T21:00:00Z', endUtc: '2026-09-13T05:00:00Z' }

const ITEM: PlanItem = {
  id: '11111111-2222-3333-4444-555555555555',
  targetId: 'M31',
  targetName: 'Andromeda Galaxy',
  startUtc: '2026-09-12T22:00:00Z',
  endUtc: '2026-09-12T22:45:00Z',
  note: 'Low power, sweep the halo',
  source: 'agent',
}

const STATE = {
  site: ROQUE_DE_LOS_MUCHACHOS,
  nightOf: '2026-09-12',
  plan: [ITEM],
}

describe('planFilename', () => {
  it('names the file after the night, one extension per format', () => {
    expect(planFilename('json', '2026-09-12')).toBe('roque-nights-plan-2026-09-12.json')
    expect(planFilename('ics', '2026-09-12')).toBe('roque-nights-plan-2026-09-12.ics')
    expect(planFilename('csv', '2026-09-12')).toBe('roque-nights-plan-2026-09-12.csv')
  })

  it('never lets a strange night value build a path', () => {
    expect(planFilename('json', '../../etc/passwd')).toBe('roque-nights-plan-etc-passwd.json')
    expect(planFilename('csv', '')).toBe('roque-nights-plan.csv')
  })

  it('offers exactly the three documented formats', () => {
    expect(EXPORT_FORMATS).toEqual(['json', 'ics', 'csv'])
  })
})

describe('buildExportPayload', () => {
  it('builds the open observing-plan.v1 document for JSON', () => {
    const payload = buildExportPayload(STATE, DARKNESS, 'json')
    expect(payload.filename).toBe('roque-nights-plan-2026-09-12.json')
    expect(payload.mimeType).toBe('application/json')
    const document = JSON.parse(payload.content)
    expect(document.version).toBe(1)
    expect(document.night_of).toBe('2026-09-12')
    expect(document.darkness).toEqual({
      start_utc: DARKNESS.startUtc,
      end_utc: DARKNESS.endUtc,
    })
    expect(document.site.time_zone).toBe('Atlantic/Canary')
    expect(document.items).toHaveLength(1)
    expect(document.items[0].target_id).toBe('M31')
    expect(document.author).toBeUndefined()
  })

  it('builds a calendar for ICS', () => {
    const payload = buildExportPayload(STATE, DARKNESS, 'ics')
    expect(payload.filename.endsWith('.ics')).toBe(true)
    expect(payload.mimeType).toBe('text/calendar;charset=utf-8')
    expect(payload.content.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(payload.content).toContain('DTSTART:20260912T220000Z')
  })

  it('builds a spreadsheet for CSV', () => {
    const payload = buildExportPayload(STATE, DARKNESS, 'csv')
    expect(payload.mimeType).toBe('text/csv;charset=utf-8')
    expect(payload.content.split('\n')[0]).toBe(CSV_HEADER)
    expect(payload.content.split('\n')).toHaveLength(2)
  })

  it('keeps a null darkness window instead of inventing one', () => {
    const payload = buildExportPayload(STATE, { startUtc: null, endUtc: null }, 'json')
    expect(JSON.parse(payload.content).darkness).toEqual({ start_utc: null, end_utc: null })
  })
})

describe('buildShareLink', () => {
  it('carries the whole plan inside the fragment', () => {
    const url = buildShareLink(STATE, DARKNESS)
    expect(url).toContain('#plan=')
    const decoded = decodePlanFromHash(url)
    expect(decoded?.items).toHaveLength(1)
    expect(decoded?.items[0].name).toBe('Andromeda Galaxy')
    expect(decoded?.site.name).toBe(ROQUE_DE_LOS_MUCHACHOS.name)
  })
})

describe('exportGate', () => {
  it('lets a plan built for this sky out of the browser', () => {
    expect(exportGate({ empty: false, stale: false })).toEqual({
      blocked: false,
      note: READY_EXPORT_NOTE,
      warning: false,
    })
  })

  it('refuses to export a plan built for another sky, and says what to do first', () => {
    const gate = exportGate({ empty: false, stale: true })
    expect(gate.blocked).toBe(true)
    expect(gate.warning).toBe(true)
    expect(gate.note).toBe('Revalidate or keep the plan before exporting.')
    expect(gate.note).toBe(STALE_EXPORT_NOTE)
  })

  it('puts the stale warning before the empty one: a stale plan is not empty', () => {
    expect(exportGate({ empty: true, stale: true }).note).toBe(STALE_EXPORT_NOTE)
    expect(exportGate({ empty: true, stale: false })).toEqual({
      blocked: true,
      note: EMPTY_EXPORT_NOTE,
      warning: false,
    })
  })
})
