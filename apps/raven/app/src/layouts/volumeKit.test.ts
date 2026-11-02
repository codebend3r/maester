import { describe, expect, it } from 'bun:test'

import { steppedVolume, volumeAfterAction, volumeAt, volumeIconOf } from '@/layouts/volumeKit'

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

describe('volumeAt', () => {
  it('reads the finger as a share of the slider and holds it inside', () => {
    expect(volumeAt({ x: 50, width: 200 })).toBe(0.25)
    expect(volumeAt({ x: -10, width: 200 })).toBe(0)
    expect(volumeAt({ x: 400, width: 200 })).toBe(1)
    expect(volumeAt({ x: 10, width: 0 })).toBe(0)
  })
})

describe('steppedVolume', () => {
  it('moves by a tenth and stops at the ends', () => {
    expect(steppedVolume({ volume: 0.5, direction: 1 })).toBe(0.6)
    expect(steppedVolume({ volume: 0.05, direction: -1 })).toBe(0)
    expect(steppedVolume({ volume: 0.95, direction: 1 })).toBe(1)
  })
})

describe('volumeAfterAction', () => {
  it("moves by the screen reader's action and ignores any other", () => {
    expect(volumeAfterAction({ volume: 0.5, name: 'increment' })).toBe(0.6)
    expect(volumeAfterAction({ volume: 0.5, name: 'decrement' })).toBe(0.4)
    expect(volumeAfterAction({ volume: 0.5, name: 'activate' })).toBe(0.5)
  })
})
