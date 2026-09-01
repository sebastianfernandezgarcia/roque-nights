import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import publishedSchema from '../../public/schemas/observing-plan.v1.json'
import type { PlanItem, Site } from '../state/types'
import {
  OBSERVING_PLAN_SCHEMA_URL,
  parseObservingPlanV1,
  toCsv,
  toIcs,
  toObservingPlanV1,
  type ObservingPlanV1,
} from './serialize'

const ROQUE: Site = {
  id: 'roque',
  name: 'Roque de los Muchachos, La Palma',
  latitude: 28.7542,
  longitude: -17.8851,
  elevationM: 2396,
  timeZone: 'Atlantic/Canary',
}

const NOWHERE: Site = {
  id: null,
  name: '0.000, 0.000',
  latitude: 0,
  longitude: 0,
  elevationM: 0,
  timeZone: null,
}

const PLAN: PlanItem[] = [
  {
    id: 'a',
    targetId: 'M31',
    targetName: 'Andromeda',
    startUtc: '2026-09-12T21:00:00.000Z',
    endUtc: '2026-09-12T21:45:00.000Z',
    source: 'agent',
    note: 'wide field, low power',
  },
  {
    id: 'b',
    targetId: 'M13',
    targetName: 'Great Hercules Cluster',
    startUtc: '2026-09-12T22:00:00.000Z',
    endUtc: '2026-09-12T22:40:00.000Z',
    source: 'human',
  },
]

const DARKNESS = {
  startUtc: '2026-09-12T20:39:43.722Z',
  endUtc: '2026-09-13T05:35:53.066Z',
}

function build(overrides?: {
  site?: Site
  plan?: PlanItem[]
  author?: string
  darkness?: { startUtc: string | null; endUtc: string | null }
}): ObservingPlanV1 {
  return toObservingPlanV1(
    {
      site: overrides?.site ?? ROQUE,
      nightOf: '2026-09-12',
      plan: overrides?.plan ?? PLAN,
    },
    overrides?.darkness ?? DARKNESS,
    overrides?.author,
  )
}

function asPlan(result: ReturnType<typeof parseObservingPlanV1>): ObservingPlanV1 {
  if ('error' in result) throw new Error(`expected a plan, got error: ${result.error}`)
  return result.plan
}

function asError(result: ReturnType<typeof parseObservingPlanV1>): string {
  if ('plan' in result) throw new Error('expected an error, got a plan')
  return result.error
}

describe('toObservingPlanV1', () => {
  it('writes a self describing v1 document', () => {
    const doc = build()
    expect(doc.$schema).toBe(OBSERVING_PLAN_SCHEMA_URL)
    expect(doc.version).toBe(1)
    expect(doc.generator).toBe('roque-nights')
    expect(doc.night_of).toBe('2026-09-12')
    expect(Date.parse(doc.created_at)).not.toBeNaN()
    expect(doc.darkness).toEqual({
      start_utc: '2026-09-12T20:39:43.722Z',
      end_utc: '2026-09-13T05:35:53.066Z',
    })
  })

  it('carries the site so another observer can revalidate', () => {
    expect(build().site).toEqual({
      name: 'Roque de los Muchachos, La Palma',
      latitude: 28.7542,
      longitude: -17.8851,
      elevation_m: 2396,
      time_zone: 'Atlantic/Canary',
    })
  })

  it('keeps an unknown time zone null instead of inventing one', () => {
    expect(build({ site: NOWHERE }).site.time_zone).toBeNull()
  })

  it('maps plan items to snake_case and keeps notes and authorship', () => {
    const doc = build()
    expect(doc.items).toEqual([
      {
        target_id: 'M31',
        name: 'Andromeda',
        start_utc: '2026-09-12T21:00:00.000Z',
        end_utc: '2026-09-12T21:45:00.000Z',
        note: 'wide field, low power',
        source: 'agent',
      },
      {
        target_id: 'M13',
        name: 'Great Hercules Cluster',
        start_utc: '2026-09-12T22:00:00.000Z',
        end_utc: '2026-09-12T22:40:00.000Z',
        source: 'human',
      },
    ])
  })

  it('sorts items chronologically', () => {
    const doc = build({ plan: [PLAN[1], PLAN[0]] })
    expect(doc.items.map((i) => i.target_id)).toEqual(['M31', 'M13'])
  })

  it('omits author unless one was given', () => {
    expect(build()).not.toHaveProperty('author')
    expect(build({ author: 'Sebastian' }).author).toBe('Sebastian')
  })

  it('accepts a night with no darkness', () => {
    expect(build({ darkness: { startUtc: null, endUtc: null } }).darkness).toEqual({
      start_utc: null,
      end_utc: null,
    })
  })
})

describe('public/schemas/observing-plan.v1.json', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validate = ajv.compile(publishedSchema)

  it('is a draft 2020-12 schema published at the documented URL', () => {
    expect(publishedSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(publishedSchema.$id).toBe(OBSERVING_PLAN_SCHEMA_URL)
    // The URL an importer fetches is the path the export_plan description names.
    expect(new URL(OBSERVING_PLAN_SCHEMA_URL).pathname).toBe('/schemas/observing-plan.v1.json')
    expect(ajv.validateSchema(publishedSchema)).toBe(true)
  })

  it('validates what toObservingPlanV1 produces', () => {
    const doc = build({ author: 'Sebastian' })
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true)
  })

  it('validates a plan with no items and no darkness', () => {
    const doc = build({ plan: [], darkness: { startUtc: null, endUtc: null }, site: NOWHERE })
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true)
  })

  it('rejects a document from another version', () => {
    expect(validate({ ...build(), version: 2 })).toBe(false)
  })

  it('rejects a document with no items array', () => {
    const { items: _items, ...rest } = build()
    expect(validate(rest)).toBe(false)
  })

  it('rejects an item whose times are not UTC ISO strings', () => {
    const doc = build()
    const broken = { ...doc, items: [{ ...doc.items[0], start_utc: '2026-09-12 21:00' }] }
    expect(validate(broken)).toBe(false)
  })
})

describe('parseObservingPlanV1', () => {
  it('round trips a document produced by this page', () => {
    const doc = build({ author: 'Sebastian' })
    expect(asPlan(parseObservingPlanV1(JSON.stringify(doc)))).toEqual(doc)
  })

  it('fills the optional fields of a hand written document', () => {
    const plan = asPlan(
      parseObservingPlanV1(
        JSON.stringify({
          version: 1,
          site: { name: 'Madrid', latitude: 40.4168, longitude: -3.7038 },
          night_of: '2026-09-12',
          items: [
            { target_id: 'M31', start_utc: '2026-09-12T21:00:00Z', end_utc: '2026-09-12T21:45:00Z' },
          ],
        }),
      ),
    )
    expect(plan.generator).toBe('roque-nights')
    expect(plan.site.elevation_m).toBe(0)
    expect(plan.site.time_zone).toBeNull()
    expect(plan.darkness).toEqual({ start_utc: null, end_utc: null })
    expect(plan.items[0]).toMatchObject({ target_id: 'M31', name: 'M31', source: 'human' })
  })

  it('refuses text that is not JSON', () => {
    expect(asError(parseObservingPlanV1('not a plan at all'))).toMatch(/JSON/i)
    expect(asError(parseObservingPlanV1('{'))).toMatch(/JSON/i)
  })

  it('refuses JSON that is not an object', () => {
    expect(asError(parseObservingPlanV1('[1,2,3]'))).toMatch(/object/i)
    expect(asError(parseObservingPlanV1('"M31"'))).toMatch(/object/i)
  })

  it('refuses another version', () => {
    expect(asError(parseObservingPlanV1('{"version":2,"items":[]}'))).toMatch(/version/i)
  })

  it('refuses a document with no items array', () => {
    expect(asError(parseObservingPlanV1('{"version":1,"site":{"latitude":0,"longitude":0}}'))).toMatch(
      /items/i,
    )
  })

  it('refuses an item with no usable identity or times', () => {
    const base = { version: 1, site: { latitude: 0, longitude: 0 }, night_of: '2026-09-12' }
    expect(
      asError(parseObservingPlanV1(JSON.stringify({ ...base, items: [{ start_utc: 'x' }] }))),
    ).toMatch(/items\[0\]/)
    expect(
      asError(
        parseObservingPlanV1(
          JSON.stringify({
            ...base,
            items: [{ target_id: 'M31', start_utc: 'yesterday', end_utc: '2026-09-12T21:45:00Z' }],
          }),
        ),
      ),
    ).toMatch(/start_utc/)
  })

  it('refuses a site with no coordinates', () => {
    expect(
      asError(
        parseObservingPlanV1(
          JSON.stringify({ version: 1, night_of: '2026-09-12', site: { name: 'Madrid' }, items: [] }),
        ),
      ),
    ).toMatch(/site/i)
  })

  it('never throws, whatever it is handed', () => {
    for (const text of ['', '   ', 'null', 'undefined', '{"items":[]}', ' ']) {
      expect(() => parseObservingPlanV1(text)).not.toThrow()
    }
  })
})

describe('toIcs', () => {
  const ics = toIcs(build())
  const lines = ics.split('\r\n')

  it('is a CRLF terminated VCALENDAR', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // No bare LF anywhere: every newline is part of a CRLF pair.
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/)
  })

  it('writes one VEVENT per plan item', () => {
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2)
    expect(lines.filter((l) => l === 'END:VEVENT')).toHaveLength(2)
  })

  it('writes UTC timestamps in the compact calendar format', () => {
    expect(lines).toContain('DTSTART:20260912T210000Z')
    expect(lines).toContain('DTEND:20260912T214500Z')
    expect(lines.filter((l) => l.startsWith('DTSTAMP:'))).toHaveLength(2)
  })

  it('names the target in the summary and gives every event a stable unique id', () => {
    expect(lines).toContain('SUMMARY:Observe M31 (Andromeda)')
    const uids = lines.filter((l) => l.startsWith('UID:'))
    expect(uids).toEqual([
      'UID:M31-20260912T210000Z@roque-nights',
      'UID:M13-20260912T220000Z@roque-nights',
    ])
    expect(new Set(uids).size).toBe(2)
  })

  it('escapes commas and semicolons in text fields', () => {
    expect(ics).toContain('LOCATION:Roque de los Muchachos\\, La Palma')
    expect(ics).toContain('wide field\\, low power')
  })

  it('carries the note and the site in the description', () => {
    const description = lines.find((l) => l.startsWith('DESCRIPTION:')) ?? ''
    expect(description).toContain('wide field')
    expect(description).toContain('2026-09-12')
  })

  it('exports an empty plan as an empty calendar', () => {
    const empty = toIcs(build({ plan: [] }))
    expect(empty).toContain('BEGIN:VCALENDAR')
    expect(empty).not.toContain('BEGIN:VEVENT')
  })
})

describe('toCsv', () => {
  it('writes the documented header and one row per item', () => {
    const rows = toCsv(build()).split('\n')
    expect(rows[0]).toBe('target_id,name,start_utc,end_utc,start_local,end_local,note,source')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toBe(
      'M31,Andromeda,2026-09-12T21:00:00.000Z,2026-09-12T21:45:00.000Z,2026-09-12 22:00,2026-09-12 22:45,"wide field, low power",agent',
    )
  })

  it('leaves the local columns blank when the site has no time zone', () => {
    const rows = toCsv(build({ site: NOWHERE })).split('\n')
    expect(rows[1].split(',').slice(4, 6)).toEqual(['', ''])
  })

  it('quotes fields that contain a comma, a quote or a newline', () => {
    const rows = toCsv(
      build({
        plan: [{ ...PLAN[0], note: 'say "hi"\nthen look', targetName: 'Andromeda, M31' }],
      }),
    ).split('\n')
    expect(rows[1]).toContain('"Andromeda, M31"')
    expect(rows[1]).toContain('"say ""hi"" then look"')
  })

  it('exports an empty plan as a header only file', () => {
    expect(toCsv(build({ plan: [] })).split('\n')).toHaveLength(1)
  })
})
