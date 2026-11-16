import { describe, expect, it } from 'bun:test'
import { ageOn } from '@/pages/PersonPage/ageOn'

describe('ageOn', () => {
  it('counts whole years, a birthday not yet come not included', () => {
    expect(ageOn({ birthday: '2000-11-21', on: '2026-10-17' })).toBe(25)
    expect(ageOn({ birthday: '2000-11-21', on: '2026-11-21' })).toBe(26)
    expect(ageOn({ birthday: '1956-07-09', on: '2026-07-08' })).toBe(69)
  })

  it('counts a Feb 29 birthday as not yet come on Feb 28, and come on Mar 1', () => {
    expect(ageOn({ birthday: '2000-02-29', on: '2026-02-28' })).toBe(25)
    expect(ageOn({ birthday: '2000-02-29', on: '2026-03-01' })).toBe(26)
    expect(ageOn({ birthday: '2000-02-29', on: '2028-02-29' })).toBe(28)
  })

  it('is null for a day before the birthday', () => {
    expect(ageOn({ birthday: '2000-11-21', on: '2000-11-20' })).toBeNull()
    expect(ageOn({ birthday: '2000-11-21', on: '1999-12-31' })).toBeNull()
    expect(ageOn({ birthday: '2000-11-21', on: '2000-11-21' })).toBe(0)
  })

  it('is null for a missing or malformed date', () => {
    expect(ageOn({ birthday: null, on: '2026-10-17' })).toBeNull()
    expect(ageOn({ birthday: '2000-11-21', on: null })).toBeNull()
    expect(ageOn({ birthday: '2000-11', on: '2026-10-17' })).toBeNull()
    expect(ageOn({ birthday: '2000-11-21', on: 'yesterday' })).toBeNull()
  })
})
