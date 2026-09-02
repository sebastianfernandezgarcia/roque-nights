import { describe, expect, it } from 'vitest'

import { favoriteLabel } from './Inspector'

describe('favoriteLabel', () => {
  it('names a Messier object the way the dome does, by its id', () => {
    expect(favoriteLabel('M13')).toBe('M13')
    expect(favoriteLabel('M31')).toBe('M31')
  })

  it('names everything else by its common name', () => {
    expect(favoriteLabel('saturn')).toBe('Saturn')
    expect(favoriteLabel('moon')).toBe('Moon')
    expect(favoriteLabel('star:vega')).toBe('Vega')
  })

  it('falls back to the raw id for something no longer in the catalog', () => {
    expect(favoriteLabel('not-a-target')).toBe('not-a-target')
  })

  it('reads as the row the Inspector prints', () => {
    expect(['M13', 'saturn'].map(favoriteLabel).join(', ')).toBe('M13, Saturn')
  })
})
