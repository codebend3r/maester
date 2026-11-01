import { describe, expect, it } from 'bun:test'

import { translucent } from '@/theme/translucent'

describe('translucent', () => {
  it('adds the alpha as a hex byte to a six digit colour', () => {
    expect(translucent({ colour: '#f4efe4', alpha: 0.75 })).toBe('#f4efe4bf')
    expect(translucent({ colour: '#000000', alpha: 1 })).toBe('#000000ff')
    expect(translucent({ colour: '#000000', alpha: 0 })).toBe('#00000000')
  })

  it('keeps the alpha within 0 and 1', () => {
    expect(translucent({ colour: '#ffffff', alpha: 2 })).toBe('#ffffffff')
  })

  it('returns any other colour as it is', () => {
    expect(translucent({ colour: 'rgba(0, 0, 0, 0.5)', alpha: 0.75 })).toBe('rgba(0, 0, 0, 0.5)')
  })
})
