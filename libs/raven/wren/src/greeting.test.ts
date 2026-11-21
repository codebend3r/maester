import { describe, expect, it } from 'bun:test'

import { HOME_COPY } from '@/copy/screens'
import { greetingOf } from '@/greeting'

describe('greetingOf', () => {
  it('says good morning until noon, good afternoon until six, then good evening', () => {
    expect(greetingOf(0)).toBe(HOME_COPY.greeting.morning)
    expect(greetingOf(11)).toBe(HOME_COPY.greeting.morning)
    expect(greetingOf(12)).toBe(HOME_COPY.greeting.afternoon)
    expect(greetingOf(17)).toBe(HOME_COPY.greeting.afternoon)
    expect(greetingOf(18)).toBe(HOME_COPY.greeting.evening)
    expect(greetingOf(23)).toBe(HOME_COPY.greeting.evening)
  })
})
