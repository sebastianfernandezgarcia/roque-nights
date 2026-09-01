import { Ajv } from 'ajv'
import { describe, expect, it } from 'vitest'

import { addDays } from '../astro/time'
import { resetStore, store } from '../state/store'
import { APP_TOOLS } from '../webmcp/registerTools'
import {
  AGENT_PLAYBOOK,
  SAMPLE_INPUTS,
  parseToolInput,
  runToolCall,
  sampleInputText,
} from './AgentHarness'

const ajv = new Ajv({ allErrors: true, strict: false })

function fakeTool(execute: ModelContextToolDefinition['execute']): ModelContextToolDefinition {
  return { name: 'fake_tool', description: 'Use this in tests only.', execute }
}

describe('SAMPLE_INPUTS', () => {
  it('has one sample for every tool of the app', () => {
    for (const tool of APP_TOOLS) {
      expect(SAMPLE_INPUTS[tool.name], `missing sample for ${tool.name}`).toBeDefined()
    }
    expect(Object.keys(SAMPLE_INPUTS).sort()).toEqual(APP_TOOLS.map((t) => t.name).sort())
  })

  it('every sample validates against the tool inputSchema', () => {
    for (const tool of APP_TOOLS) {
      const schema = tool.inputSchema
      if (!schema) continue
      const validate = ajv.compile(schema)
      const valid = validate(structuredClone(SAMPLE_INPUTS[tool.name]))
      expect(valid, `${tool.name}: ${ajv.errorsText(validate.errors)}`).toBe(true)
    }
  })

  it('does not preload a destructive confirmation', () => {
    expect(SAMPLE_INPUTS.clear_plan.confirm).toBeUndefined()
  })
})

describe('sampleInputText', () => {
  it('is pretty printed JSON pinned to the night the app is showing', () => {
    resetStore()
    const state = store.getState()
    const text = sampleInputText('get_night_ephemeris', state)
    expect(text).toContain('\n')
    expect(JSON.parse(text)).toEqual({ date: state.nightOf })
  })

  it('spans two weeks from the selected night for rank_nights', () => {
    resetStore()
    const state = store.getState()
    const input = JSON.parse(sampleInputText('rank_nights', state))
    expect(input.from_date).toBe(state.nightOf)
    expect(input.to_date).toBe(addDays(state.nightOf, 14))
    expect(input.limit).toBe(SAMPLE_INPUTS.rank_nights.limit)
  })

  it('falls back to an empty object for an unknown tool', () => {
    expect(sampleInputText('not_a_tool', store.getState())).toBe('{}')
  })

  it('fills commit_proposal with the id of the proposal that is actually pending', () => {
    resetStore()
    const proposal = store.getState().addProposal({
      items: [],
      unscheduled: [],
      replaceExisting: false,
      origin: 'agent',
      rationale: 'test',
    })
    const text = sampleInputText('commit_proposal', store.getState())
    expect(JSON.parse(text).proposal_id).toBe(proposal.id)
    resetStore()
  })
})

describe('parseToolInput', () => {
  it('treats blank text as no arguments', () => {
    expect(parseToolInput('')).toEqual({ input: {} })
    expect(parseToolInput('   \n ')).toEqual({ input: {} })
  })

  it('accepts a JSON object', () => {
    expect(parseToolInput('{"date":"2026-09-12"}')).toEqual({ input: { date: '2026-09-12' } })
  })

  it('rejects JSON that is not an object', () => {
    const result = parseToolInput('[1,2]')
    expect('error' in result && result.error).toContain('JSON object')
  })

  it('explains malformed JSON instead of throwing', () => {
    const result = parseToolInput('{ nope')
    expect('error' in result).toBe(true)
  })
})

describe('runToolCall', () => {
  it('calls the tool directly when the browser has no WebMCP', async () => {
    const tool = fakeTool((input) => ({ ok: true, summary: `direct ${input.n}` }))
    const outcome = await runToolCall(tool, { n: 1 }, undefined)
    expect(outcome.via).toBe('direct')
    expect((outcome.value as { summary: string }).summary).toBe('direct 1')
  })

  it('prefers the browser executeTool and parses its JSON string', async () => {
    const calls: unknown[] = []
    const mc = {
      executeTool: (_tool: RegisteredModelContextTool, input?: unknown) => {
        calls.push(input)
        return Promise.resolve(JSON.stringify({ ok: true, summary: 'through the engine' }))
      },
    } as unknown as ModelContext
    const outcome = await runToolCall(fakeTool(() => ({ ok: true })), { n: 2 }, mc)
    expect(outcome.via).toBe('webmcp')
    expect(calls[0]).toEqual({ n: 2 })
    expect((outcome.value as { summary: string }).summary).toBe('through the engine')
  })

  it('retries with the JSON string variant when the object variant is refused', async () => {
    const seen: unknown[] = []
    const mc = {
      executeTool: (_tool: RegisteredModelContextTool, input?: unknown) => {
        seen.push(input)
        if (typeof input !== 'string') return Promise.reject(new Error('object input refused'))
        return Promise.resolve({ ok: true, summary: 'string variant' })
      },
    } as unknown as ModelContext
    const outcome = await runToolCall(fakeTool(() => ({ ok: true })), { n: 3 }, mc)
    expect(outcome.via).toBe('webmcp-json-string')
    expect(seen[1]).toBe('{"n":3}')
    expect((outcome.value as { summary: string }).summary).toBe('string variant')
  })

  it('falls back to the tool itself when the engine refuses both variants', async () => {
    const mc = {
      executeTool: () => Promise.reject(new Error('nope')),
    } as unknown as ModelContext
    const outcome = await runToolCall(fakeTool(() => ({ ok: true, summary: 'local' })), {}, mc)
    expect(outcome.via).toBe('direct')
    expect((outcome.value as { summary: string }).summary).toBe('local')
  })

  it('surfaces a tool that throws as an error outcome, never as a rejection', async () => {
    const tool = fakeTool(() => {
      throw new Error('boom')
    })
    const outcome = await runToolCall(tool, {}, undefined)
    expect(outcome.error).toContain('boom')
    expect(outcome.value).toBeUndefined()
  })
})

describe('AGENT_PLAYBOOK', () => {
  it('offers the five prompts of the plan', () => {
    expect(AGENT_PLAYBOOK).toHaveLength(5)
    for (const prompt of AGENT_PLAYBOOK) {
      expect(prompt.trim().length).toBeGreaterThan(20)
      expect(prompt).not.toContain('—')
    }
  })
})
