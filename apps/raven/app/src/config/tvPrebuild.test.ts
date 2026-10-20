import { describe, expect, it } from 'bun:test'

import { isTvPrebuild } from '@/config/tvPrebuild'

describe('isTvPrebuild', () => {
  it.each([['1'], ['true'], [' 1 '], ['TRUE']])('is a TV prebuild for %p', (value) => {
    expect(isTvPrebuild({ value })).toBe(true)
  })

  it.each([[undefined], [''], ['0'], ['false'], ['yes']])('is a phone prebuild for %p', (value) => {
    expect(isTvPrebuild({ value })).toBe(false)
  })
})
