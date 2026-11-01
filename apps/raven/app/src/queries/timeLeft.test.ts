import { describe, expect, it } from 'bun:test'

import { timeLeftOf } from '@/queries/timeLeft'

describe('timeLeftOf', () => {
  it('says minutes under an hour, rounded up', () => {
    expect(timeLeftOf({ duration: 3600, position: 1080 })).toBe('42m left')
    expect(timeLeftOf({ duration: 3600, position: 3501 })).toBe('2m left')
  })

  it('says hours, with the minutes when there are some', () => {
    expect(timeLeftOf({ duration: 7200, position: 0 })).toBe('2h left')
    expect(timeLeftOf({ duration: 7200, position: 3300 })).toBe('1h 5m left')
  })

  it('says the last seconds as under a minute, and nothing when nothing is left or known', () => {
    expect(timeLeftOf({ duration: 100, position: 70 })).toBe('Under 1m left')
    expect(timeLeftOf({ duration: 100, position: 100 })).toBeNull()
    expect(timeLeftOf({ duration: null, position: 10 })).toBeNull()
  })
})
