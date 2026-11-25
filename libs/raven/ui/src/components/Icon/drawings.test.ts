import { describe, expect, it } from 'bun:test'
import { REPEAT_MODES } from '@raven/core'
import { repeatIconOf, volumeIconOf } from '@/components/Icon/drawings'

describe('volumeIconOf', () => {
  it('crosses the speaker out when muted or silent', () => {
    expect(volumeIconOf({ volume: 0.8, isMuted: true })).toBe('muted')
    expect(volumeIconOf({ volume: 0, isMuted: false })).toBe('muted')
  })

  it('draws one wave when low and two otherwise', () => {
    expect(volumeIconOf({ volume: 0.3, isMuted: false })).toBe('volumeLow')
    expect(volumeIconOf({ volume: 0.5, isMuted: false })).toBe('volume')
  })
})

describe('repeatIconOf', () => {
  it('puts a one in the loop only while one track repeats', () => {
    expect(repeatIconOf(REPEAT_MODES.one)).toBe('repeatOne')
    expect(repeatIconOf(REPEAT_MODES.all)).toBe('repeat')
    expect(repeatIconOf(REPEAT_MODES.off)).toBe('repeat')
  })
})
