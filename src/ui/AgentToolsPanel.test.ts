import { describe, expect, it } from 'vitest'

import { BASE_TOOL_NAMES, PLAN_TOOL_NAMES, PROPOSAL_TOOL_NAMES } from '../tools/contextualNames'
import { CONTEXTUAL_HINTS, TOOL_ORDER, TOOL_PHRASES, buildToolRows } from './AgentToolsPanel'

describe('TOOL_PHRASES', () => {
  it('says what all fifteen tools do, in one phrase each', () => {
    expect(TOOL_ORDER).toEqual([
      'get_night_ephemeris',
      'find_observable_targets',
      'rank_nights',
      'point_sky_map',
      'set_observing_time',
      'describe_current_view',
      'propose_plan',
      'commit_proposal',
      'modify_plan',
      'get_current_plan',
      'clear_plan',
      'export_plan',
      'import_plan',
      'compare_dark_sky_sites',
      'set_observing_site',
    ])
    expect(TOOL_PHRASES.get_night_ephemeris).toBe("Read tonight's darkness and Moon")
    expect(TOOL_PHRASES.point_sky_map).toBe('Point the sky map')
    expect(TOOL_PHRASES.clear_plan).toBe('Clear the plan (asks you first)')
    expect(TOOL_PHRASES.import_plan).toBe('Import and revalidate a shared plan')
    expect(TOOL_PHRASES.set_observing_site).toBe('Move the app to another site')
  })

  it('covers every tool the page can register, so no row is ever nameless', () => {
    const registrable = [...BASE_TOOL_NAMES, ...PLAN_TOOL_NAMES, ...PROPOSAL_TOOL_NAMES]
    for (const name of registrable) expect(TOOL_PHRASES[name]).toBeTypeOf('string')
  })

  it('is written in plain sentences: no em dashes anywhere', () => {
    for (const phrase of Object.values(TOOL_PHRASES)) expect(phrase).not.toMatch(/[—–]/)
  })
})

describe('buildToolRows', () => {
  it('lists the registered tools first, in the order the engine has them', () => {
    const rows = buildToolRows(['point_sky_map', 'get_night_ephemeris'])
    expect(rows.slice(0, 2)).toEqual([
      { name: 'point_sky_map', phrase: 'Point the sky map', registered: true, hint: null },
      {
        name: 'get_night_ephemeris',
        phrase: "Read tonight's darkness and Moon",
        registered: true,
        hint: null,
      },
    ])
  })

  it('keeps the contextual tools visible but dimmed, with the condition that wakes them', () => {
    const rows = buildToolRows([...BASE_TOOL_NAMES])
    const dimmed = rows.filter((row) => !row.registered)
    const base: readonly string[] = BASE_TOOL_NAMES
    expect(dimmed.map((row) => row.name)).toEqual(TOOL_ORDER.filter((name) => !base.includes(name)))
    expect(dimmed.map((row) => row.name)).toEqual(
      expect.arrayContaining(['commit_proposal', 'modify_plan', 'get_current_plan', 'export_plan']),
    )
    expect(dimmed.find((row) => row.name === 'modify_plan')?.hint).toBe(
      'appears when there is a plan',
    )
    expect(dimmed.find((row) => row.name === 'commit_proposal')?.hint).toBe(
      'appears when a proposal is pending',
    )
    expect(CONTEXTUAL_HINTS.export_plan).toBe('appears when there is a plan')
  })

  it('never lists a tool twice', () => {
    const rows = buildToolRows([...BASE_TOOL_NAMES, ...PLAN_TOOL_NAMES])
    expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length)
    expect(rows).toHaveLength(TOOL_ORDER.length)
  })

  it('still shows the whole catalogue when the browser registered nothing', () => {
    const rows = buildToolRows([])
    expect(rows.map((row) => row.name)).toEqual(TOOL_ORDER)
    expect(rows.every((row) => !row.registered)).toBe(true)
  })

  it('does not choke on a tool it has never heard of', () => {
    const rows = buildToolRows(['some_future_tool'])
    expect(rows[0]).toEqual({
      name: 'some_future_tool',
      phrase: 'some future tool',
      registered: true,
      hint: null,
    })
  })
})
