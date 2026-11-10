import { describe, expect, it } from 'bun:test'

import { PIN_MAX_DIGITS, pinWith, pinWithoutLast } from '@/layouts/lockKit'

describe('the PIN', () => {
  it('adds each digit at its end and takes back the last', () => {
    expect(pinWith({ pin: '12', digit: '0' })).toBe('120')
    expect(pinWithoutLast('120')).toBe('12')
    expect(pinWithoutLast('')).toBe('')
  })

  it('stops growing at the longest a PIN may be', () => {
    const longest = '9'.repeat(PIN_MAX_DIGITS)
    expect(pinWith({ pin: longest, digit: '1' })).toBe(longest)
  })
})
