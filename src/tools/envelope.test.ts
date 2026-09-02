import { Ajv } from 'ajv'
import { describe, expect, it } from 'vitest'

import type { Site, TargetType } from '../state/types'
import {
  defineTool,
  excerpt,
  fail,
  isToolError,
  ok,
  siteRef,
  stamp,
  type ToolResult,
} from './envelope'
import { DATE_SCHEMA, SITE_SCHEMA, TARGET_REF_SCHEMA, TARGET_TYPES } from './schemas'

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

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe('siteRef', () => {
  it('renames the fields to the snake_case the agent sees', () => {
    expect(siteRef(ROQUE)).toEqual({
      id: 'roque',
      name: 'Roque de los Muchachos, La Palma',
      latitude: 28.7542,
      longitude: -17.8851,
      elevation_m: 2396,
      time_zone: 'Atlantic/Canary',
    })
  })

  it('keeps a custom site anonymous', () => {
    expect(siteRef(NOWHERE)).toMatchObject({ id: null, time_zone: null, elevation_m: 0 })
  })
})

describe('stamp', () => {
  it('pairs UTC with the site local time', () => {
    expect(stamp('2026-09-02T20:52:50Z', 'Atlantic/Canary')).toEqual({
      utc: '2026-09-02T20:52:50Z',
      local: '2026-09-02 21:52',
    })
  })

  it('has a null local time when the zone is unknown', () => {
    expect(stamp('2026-09-02T20:52:50Z', null).local).toBeNull()
    expect(stamp('2026-09-02T20:52:50Z', null).utc).toBe('2026-09-02T20:52:50Z')
    expect(stamp('2026-09-02T20:52:50Z', 'Mars/Olympus').local).toBeNull()
  })

  it('is all nulls for a missing instant', () => {
    expect(stamp(null, 'Atlantic/Canary')).toEqual({ utc: null, local: null })
  })
})

describe('ok', () => {
  it('builds the full envelope', () => {
    const r = ok('Everything is fine.', { hours: 8.9 }, ROQUE)
    expect(r.ok).toBe(true)
    expect(r.summary).toBe('Everything is fine.')
    expect(r.data).toEqual({ hours: 8.9 })
    expect(r.rejected).toEqual([])
    expect(r.caveats).toEqual([])
    expect(r.site).toEqual(siteRef(ROQUE))
    expect(r.as_of).toMatch(ISO)
    expect('tools_added' in r).toBe(false)
    expect('tools_removed' in r).toBe(false)
  })

  it('carries rejections, caveats and tool-list changes when given', () => {
    const r = ok('Plan proposed.', null, ROQUE, {
      rejected: [{ id: 'M74', name: 'Phantom Galaxy', reason: 'peak altitude 12 degrees' }],
      caveats: ['Local times omitted.'],
      tools_added: ['start_session'],
      tools_removed: ['propose_plan'],
    })
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0].reason).toBe('peak altitude 12 degrees')
    expect(r.caveats).toEqual(['Local times omitted.'])
    expect(r.tools_added).toEqual(['start_session'])
    expect(r.tools_removed).toEqual(['propose_plan'])
  })
})

describe('fail', () => {
  it('builds a structured error with a code and an optional hint', () => {
    const e = fail('invalid_date', '"2026-13-99" is not a valid calendar date', 'Use YYYY-MM-DD')
    expect(e).toEqual({
      ok: false,
      error: {
        code: 'invalid_date',
        message: '"2026-13-99" is not a valid calendar date',
        hint: 'Use YYYY-MM-DD',
      },
      as_of: e.as_of,
    })
    expect(e.as_of).toMatch(ISO)
    expect('hint' in fail('empty_plan', 'The plan is empty.').error).toBe(false)
  })

  it('is recognised by isToolError', () => {
    expect(isToolError(fail('aborted', 'Cancelled.'))).toBe(true)
    expect(isToolError(ok('fine', 1, ROQUE))).toBe(false)
    expect(isToolError(null)).toBe(false)
    expect(isToolError({ ok: false })).toBe(false)
  })
})

describe('excerpt', () => {
  it('leaves a short string alone', () => {
    expect(excerpt('8.9 dark hours')).toBe('8.9 dark hours')
  })

  it('truncates to 160 characters by default', () => {
    const out = excerpt('x'.repeat(400))
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out.endsWith('…')).toBe(true)
  })

  it('honours a custom limit and collapses whitespace', () => {
    expect(excerpt('abcdefghij', 5)).toBe('abcd…')
    expect(excerpt('two\n  lines')).toBe('two lines')
    expect(excerpt('')).toBe('')
  })
})

describe('defineTool', () => {
  const definition = (
    run: (input: Record<string, unknown>, options: { signal?: AbortSignal }) => unknown,
  ): ModelContextToolDefinition =>
    defineTool({
      name: 'test_tool',
      title: 'Test tool',
      description: 'Use this in tests only.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
      run: run as (
        input: Record<string, unknown>,
        options: { signal?: AbortSignal },
      ) => ToolResult<unknown>,
    })

  it('keeps the declaration the agent sees', () => {
    const tool = definition(() => ok('fine', 1, ROQUE))
    expect(tool.name).toBe('test_tool')
    expect(tool.title).toBe('Test tool')
    expect(tool.description).toBe('Use this in tests only.')
    expect(tool.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false })
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    })
    expect(typeof tool.execute).toBe('function')
  })

  it('returns what run returns', async () => {
    const tool = definition(() => ok('fine', { n: 1 }, ROQUE))
    await expect(tool.execute({})).resolves.toMatchObject({ ok: true, summary: 'fine' })
  })

  it('awaits an async run', async () => {
    const tool = definition(async () => ok('slow but fine', null, ROQUE))
    await expect(tool.execute({})).resolves.toMatchObject({ ok: true })
  })

  it('passes input and the abort signal through', async () => {
    const seen: { input?: Record<string, unknown>; signal?: AbortSignal } = {}
    const controller = new AbortController()
    const tool = definition((input, options) => {
      seen.input = input
      seen.signal = options.signal
      return ok('fine', null, ROQUE)
    })
    await tool.execute({ date: '2026-09-02' }, { signal: controller.signal })
    expect(seen.input).toEqual({ date: '2026-09-02' })
    expect(seen.signal).toBe(controller.signal)
  })

  it('never gets undefined input', async () => {
    const seen: Record<string, unknown>[] = []
    const tool = definition((input) => {
      seen.push(input)
      return ok('fine', null, ROQUE)
    })
    await (tool.execute as (i?: unknown) => Promise<unknown>)()
    expect(seen[0]).toEqual({})
  })

  // An engine that still passes the pre-PR-246 JSON string used to have its
  // arguments replaced by {}, so the tool answered the app's current state as
  // if it were the answer to a question nobody asked.
  it('parses arguments delivered as a JSON string', async () => {
    const seen: Record<string, unknown>[] = []
    const tool = definition((input) => {
      seen.push(input)
      return ok('fine', null, ROQUE)
    })
    const result = (await (tool.execute as (i?: unknown) => Promise<unknown>)(
      '{"date":"2026-09-12"}',
    )) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(seen[0]).toEqual({ date: '2026-09-12' })
  })

  it('refuses a string of arguments that is not JSON instead of dropping it', async () => {
    let ran = false
    const tool = definition(() => {
      ran = true
      return ok('fine', null, ROQUE)
    })
    const result = (await (tool.execute as (i?: unknown) => Promise<unknown>)(
      'date=2026-09-12',
    )) as ReturnType<typeof fail>
    expect(ran).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('invalid_input')
    expect(result.error.message).toContain('test_tool')
  })

  it('refuses arguments that are neither an object nor a JSON object', async () => {
    const tool = definition(() => ok('fine', null, ROQUE))
    for (const bad of [42, true, '[1,2]', '"just a string"']) {
      const result = (await (tool.execute as (i?: unknown) => Promise<unknown>)(bad)) as ReturnType<
        typeof fail
      >
      expect(result.ok).toBe(false)
      expect(result.error.code).toBe('invalid_input')
    }
  })

  it('still treats an empty string and null as no arguments', async () => {
    const seen: Record<string, unknown>[] = []
    const tool = definition((input) => {
      seen.push(input)
      return ok('fine', null, ROQUE)
    })
    await (tool.execute as (i?: unknown) => Promise<unknown>)('')
    await (tool.execute as (i?: unknown) => Promise<unknown>)(null)
    expect(seen).toEqual([{}, {}])
  })

  it('turns a thrown error into internal_error instead of rejecting', async () => {
    const tool = definition(() => {
      throw new Error('boom')
    })
    const result = (await tool.execute({})) as ReturnType<typeof fail>
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('internal_error')
    expect(result.error.message).toContain('boom')
    expect(result.error.message).toContain('test_tool')
  })

  it('catches a rejected promise too', async () => {
    const tool = definition(async () => {
      await Promise.resolve()
      throw new TypeError('cannot read properties of undefined')
    })
    const result = (await tool.execute({})) as ReturnType<typeof fail>
    expect(result.error.code).toBe('internal_error')
  })

  it('catches a thrown non-error value', async () => {
    const tool = definition(() => {
      throw 'plain string'
    })
    const result = (await tool.execute({})) as ReturnType<typeof fail>
    expect(result.error.code).toBe('internal_error')
    expect(result.error.message).toContain('plain string')
  })

  it('reports cancellation as aborted, not as a bug', async () => {
    const tool = definition(() => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    const result = (await tool.execute({})) as ReturnType<typeof fail>
    expect(result.error.code).toBe('aborted')
  })

  it('recognises an abort thrown as a plain Error', async () => {
    const tool = definition(() => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    const result = (await tool.execute({})) as ReturnType<typeof fail>
    expect(result.error.code).toBe('aborted')
  })
})

describe('shared JSON Schema fragments', () => {
  const ajv = new Ajv({ allErrors: true, strict: false })

  it('compiles the date fragment and matches only YYYY-MM-DD shapes', () => {
    const validate = ajv.compile(DATE_SCHEMA)
    expect(validate('2026-09-02')).toBe(true)
    expect(validate('2026-9-2')).toBe(false)
    expect(validate(20260902)).toBe(false)
  })

  it('compiles the site fragment, accepts a catalog id and refuses extras', () => {
    const validate = ajv.compile(SITE_SCHEMA)
    expect(validate({ latitude: 19.8207, longitude: -155.4681 })).toBe(true)
    expect(
      validate({
        latitude: 19.8207,
        longitude: -155.4681,
        elevation_m: 4205,
        time_zone: 'Pacific/Honolulu',
        name: 'Mauna Kea',
      }),
    ).toBe(true)
    // Naming a catalog site is the preferred shape: it carries the exact
    // elevation and IANA zone, which coordinates alone do not.
    expect(validate({ id: 'mauna-kea' })).toBe(true)
    expect(validate({ name: 'Mauna Kea' })).toBe(true)
    // Half a coordinate pair is a runtime invalid_site, not a schema error:
    // the two valid shapes cannot be expressed here without a top-level anyOf
    // that strict function-calling validators reject.
    expect(validate({ latitude: 19.8207 })).toBe(true)
    expect(validate({ latitude: 19.8207, longitude: -155.4681, lat: 1 })).toBe(false)
    expect(validate({ latitude: 100, longitude: 0 })).toBe(false)
    expect(validate({ latitude: 0, longitude: -200 })).toBe(false)
  })

  it('compiles the target reference fragment', () => {
    const validate = ajv.compile(TARGET_REF_SCHEMA)
    expect(validate('M31')).toBe(true)
    expect(validate('')).toBe(false)
    expect(validate('x'.repeat(61))).toBe(false)
  })

  it('advertises the forgiving resolver and the way out of a bad name', () => {
    const text = TARGET_REF_SCHEMA.description as string
    for (const accepted of ['M 31', 'Ring Nebula', 'NGC 7089', 'Jupiter', 'Moon', 'Vega']) {
      expect(text).toContain(accepted)
    }
    expect(text).toContain('unknown_target')
  })

  it('tells the agent that a site here does not move the app', () => {
    const text = SITE_SCHEMA.description as string
    expect(text).toContain('set_observing_site')
    expect(text).toContain('invalid_site')
    const id = (SITE_SCHEMA.properties as { id: { description: string } }).id
    expect(id.description).toContain('mauna-kea')
  })

  it('lists exactly the ten target types of the shared vocabulary', () => {
    expect([...TARGET_TYPES]).toEqual([
      'galaxy',
      'open_cluster',
      'globular_cluster',
      'planetary_nebula',
      'diffuse_nebula',
      'supernova_remnant',
      'other',
      'planet',
      'moon',
      'star',
    ])
  })

  it('only names types the shared vocabulary knows', () => {
    // The annotation is the point: a stray value in TARGET_TYPES fails to compile.
    const asVocabulary: TargetType[] = [...TARGET_TYPES]
    expect(new Set(asVocabulary).size).toBe(TARGET_TYPES.length)
  })

  it('explains itself to the agent in every fragment', () => {
    for (const fragment of [DATE_SCHEMA, SITE_SCHEMA, TARGET_REF_SCHEMA]) {
      expect(typeof fragment.description).toBe('string')
      expect(String(fragment.description).length).toBeGreaterThan(30)
    }
  })
})
