import { describe, expect, it } from 'bun:test'

import { isTvPrebuild } from '@/config/tvPrebuild'

describe('isTvPrebuild', () => {
  it.each([['1'], ['true']])('is a TV prebuild for %p', (value) => {
    expect(isTvPrebuild({ value })).toBe(true)
  })

  it.each([[undefined], [''], ['0'], ['false'], [' 1 '], ['TRUE'], ['yes']])(
    'is a phone prebuild for %p, as config-tv reads it',
    (value) => {
      expect(isTvPrebuild({ value })).toBe(false)
    },
  )
})
