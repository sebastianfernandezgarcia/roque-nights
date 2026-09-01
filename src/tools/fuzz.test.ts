/**
 * Robustness fuzz: no agent input may break a turn.
 *
 * An agent fills a tool call from a JSON schema it half remembers, so the page
 * gets `{}`, a date of `2026-13-99`, a latitude of 100, an array where an
 * object belongs, a string where a number belongs, and occasionally a 20 000
 * character blob. The contract of `defineTool` is that NONE of that can throw:
 * every call resolves to the envelope, and the envelope always carries a
 * boolean `ok`, because an agent can act on a structured error and cannot act
 * on a rejected promise.
 *
 * This exercises the same instrumented declarations that get registered with
 * the browser (`APP_TOOLS`), so the activity-log wrapper is under test too: a
 * throw inside `instrument` would be just as fatal to the agent's turn.
 *
 * Every tool times 12 payloads. The payloads spray the union of all 14 input
 * schemas at once, so each tool receives a malformed version of its own fields
 * and ignores the rest, exactly as it would from a confused caller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetStore } from '../state/store'
import { APP_TOOLS } from '../webmcp/contextual'

/** Long enough to be abusive, short enough to keep 168 calls fast. */
const HUGE = 'M31 '.repeat(5_000)

interface Payload {
  label: string
  input: unknown
}

const PAYLOADS: Payload[] = [
  { label: 'empty object', input: {} },
  { label: 'null instead of an object', input: null },
  {
    label: 'every field null',
    input: {
      date: null,
      from_date: null,
      to_date: null,
      site: null,
      target: null,
      targets: null,
      operations: null,
      source: null,
      proposal_id: null,
      time: null,
      format: null,
      query: null,
      ids: null,
      types: null,
      site_ids: null,
      highlight: null,
      limit: null,
      confirm: null,
      undo_token: null,
      author: null,
      rationale: null,
    },
  },
  {
    label: 'wrong types everywhere',
    input: {
      date: 20260901,
      from_date: true,
      to_date: {},
      site: 'Roque de los Muchachos',
      target: 42,
      targets: 'M31',
      operations: 'remove M13',
      source: 12345,
      proposal_id: 7,
      time: false,
      format: ['json'],
      limit: 'three',
      min_altitude_deg: '30',
      fov_deg: 'wide',
      confirm: 'yes',
      reset: 'no',
      include_weather: 1,
      max_visible_objects: '10',
      ids: 'M31,M42',
      types: 'galaxy',
      highlight: 'M31',
      site_ids: 'roque',
    },
  },
  {
    label: 'huge strings',
    input: {
      date: HUGE,
      from_date: HUGE,
      to_date: HUGE,
      target: HUGE,
      source: HUGE,
      proposal_id: HUGE,
      time: HUGE,
      format: HUGE,
      query: HUGE,
      author: HUGE,
      rationale: HUGE,
      undo_token: HUGE,
      ids: [HUGE],
      types: [HUGE],
      site_ids: [HUGE],
      highlight: [HUGE],
      targets: [{ target: HUGE }],
      operations: [{ op: 'add', target: HUGE }],
    },
  },
  {
    label: 'negative numbers',
    input: {
      limit: -5,
      min_altitude_deg: -90,
      max_magnitude: -100,
      min_moon_separation_deg: -180,
      min_window_minutes: -1440,
      altitude_deg: -400,
      azimuth_deg: -720,
      fov_deg: -30,
      max_visible_objects: -1,
      site: { latitude: -100, longitude: -400, elevation_m: -99_999 },
      targets: [{ target: 'M31', duration_min: -60 }],
      operations: [{ op: 'reorder', target: 'M31', to_index: -3 }],
    },
  },
  {
    label: 'unknown ids and targets',
    input: {
      target: 'NGC-does-not-exist',
      proposal_id: 'proposal-does-not-exist',
      undo_token: 'undo-does-not-exist',
      ids: ['M999', 'NOT-A-CATALOG-ID'],
      site_ids: ['atlantis', 'mordor'],
      highlight: ['M999'],
      targets: [{ target: 'Planet Nine' }, { target: 'M999' }],
      operations: [
        { op: 'remove', target: 'M999' },
        { op: 'add', target: 'Planet Nine' },
      ],
      source: 'M999, NGC-does-not-exist',
      query: 'zzzzzzzz',
      format: 'parquet',
      time: 'half past forever',
      types: ['wormhole'],
    },
  },
  {
    label: 'calendar-impossible dates',
    input: {
      date: '2026-13-99',
      from_date: '2026-02-30',
      to_date: '0000-00-00',
      targets: [{ target: 'M31', start: '2026-13-99T99:99:99Z' }],
    },
  },
  {
    label: 'out-of-range coordinates',
    input: {
      site: {
        latitude: 100,
        longitude: 999,
        elevation_m: 1e9,
        time_zone: 'Mars/Olympus_Mons',
        name: 'Nowhere',
      },
      altitude_deg: 100,
      azimuth_deg: 999,
      fov_deg: 1000,
    },
  },
  {
    label: 'arrays where objects belong',
    input: {
      site: [28.75, -17.88],
      targets: [['M31'], ['M13']],
      operations: [['remove', 'M13'], 'remove M13', 42, null],
      ids: [['M31']],
      types: [[]],
      source: [],
      format: [],
    },
  },
  {
    label: 'non-finite and absurd numbers',
    input: {
      limit: Number.NaN,
      min_altitude_deg: Number.POSITIVE_INFINITY,
      max_magnitude: Number.NEGATIVE_INFINITY,
      fov_deg: Number.NaN,
      altitude_deg: Number.MAX_SAFE_INTEGER,
      azimuth_deg: 1e308,
      min_window_minutes: 1e15,
      max_visible_objects: Number.NaN,
      site: { latitude: Number.NaN, longitude: Number.NaN },
      targets: [{ target: 'M31', duration_min: Number.NaN }],
    },
  },
  {
    label: 'empty strings and empty arrays',
    input: {
      date: '',
      from_date: '',
      to_date: '',
      target: '',
      source: '',
      proposal_id: '',
      time: '',
      format: '',
      query: '',
      undo_token: '',
      targets: [],
      operations: [],
      ids: [],
      types: [],
      site_ids: [],
      highlight: [],
      site: {},
    },
  },
]

/** Anything that reaches the network must not turn a fuzz run into a flake. */
beforeEach(() => {
  resetStore()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('covers all 14 tools with 12 payloads each', () => {
  expect(APP_TOOLS).toHaveLength(14)
  expect(PAYLOADS).toHaveLength(12)
})

describe.each(APP_TOOLS.map((tool) => [tool.name, tool] as const))(
  '%s survives malformed input',
  (_name, tool) => {
    it.each(PAYLOADS.map((payload) => [payload.label, payload.input] as const))(
      'resolves to an envelope with a boolean ok: %s',
      async (_label, input) => {
        // `as never` on purpose: the whole point is to pass what the type forbids.
        const result = await tool.execute(input as never, {})
        expect(result, 'a tool must never resolve to a non-object').toBeTypeOf('object')
        expect(result).not.toBeNull()
        expect(typeof (result as { ok?: unknown }).ok).toBe('boolean')

        const envelope = result as { ok: boolean; error?: { code?: unknown }; summary?: unknown }
        if (envelope.ok) {
          expect(typeof envelope.summary).toBe('string')
        } else {
          // A structured error is the whole contract: the agent needs a code.
          expect(typeof envelope.error?.code).toBe('string')
          // `internal_error` means an exception escaped the tool's own checks.
          expect(
            envelope.error?.code,
            `${_name} leaked an exception on "${_label}" instead of validating`,
          ).not.toBe('internal_error')
        }
      },
    )
  },
)
