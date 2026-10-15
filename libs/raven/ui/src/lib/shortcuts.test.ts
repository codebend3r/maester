import { describe, expect, it } from 'bun:test'
import { type PlayerAction, shortcutFor, stepCaptionScale, stepSpeed } from '@/lib/shortcuts'

const press = (
  key: string,
  held: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) => shortcutFor({ key, metaKey: false, ctrlKey: false, altKey: false, ...held })

describe('shortcutFor', () => {
  const cases: Array<[string, PlayerAction]> = [
    ['k', { type: 'togglePlay' }],
    [' ', { type: 'togglePlay' }],
    ['K', { type: 'togglePlay' }],
    ['j', { type: 'seekBy', seconds: -10 }],
    ['l', { type: 'seekBy', seconds: 10 }],
    ['ArrowLeft', { type: 'seekBy', seconds: -5 }],
    ['ArrowRight', { type: 'seekBy', seconds: 5 }],
    ['ArrowUp', { type: 'volumeBy', delta: 0.05 }],
    ['ArrowDown', { type: 'volumeBy', delta: -0.05 }],
    ['m', { type: 'toggleMute' }],
    ['f', { type: 'toggleFullscreen' }],
    ['c', { type: 'toggleSubtitles' }],
    ['0', { type: 'seekToFraction', fraction: 0 }],
    ['7', { type: 'seekToFraction', fraction: 0.7 }],
    ['Home', { type: 'seekToEdge', edge: 'start' }],
    ['End', { type: 'seekToEdge', edge: 'end' }],
    [',', { type: 'stepFrame', direction: -1 }],
    ['.', { type: 'stepFrame', direction: 1 }],
    ['<', { type: 'stepSpeed', direction: -1 }],
    ['>', { type: 'stepSpeed', direction: 1 }],
    ['+', { type: 'stepCaptionSize', direction: 1 }],
    ['-', { type: 'stepCaptionSize', direction: -1 }],
    ['?', { type: 'showShortcuts' }],
    ['Escape', { type: 'escape' }],
  ]

  it.each(cases)('maps %p', (key, action) => {
    expect(press(key)).toEqual(action)
  })

  it('leaves keys with a modifier to the browser', () => {
    expect(press('f', { metaKey: true })).toBeNull()
    expect(press('l', { ctrlKey: true })).toBeNull()
    expect(press('k', { altKey: true })).toBeNull()
  })

  it('ignores keys the player does not use', () => {
    expect(press('q')).toBeNull()
    expect(press('Tab')).toBeNull()
    expect(press('F5')).toBeNull()
  })
})

describe('stepSpeed', () => {
  it('walks the ladder and stops at its ends', () => {
    expect(stepSpeed({ current: 1, direction: 1 })).toBe(1.25)
    expect(stepSpeed({ current: 1, direction: -1 })).toBe(0.75)
    expect(stepSpeed({ current: 2, direction: 1 })).toBe(2)
    expect(stepSpeed({ current: 0.25, direction: -1 })).toBe(0.25)
  })

  it('snaps an off-ladder speed to its neighbours', () => {
    expect(stepSpeed({ current: 1.1, direction: 1 })).toBe(1.25)
    expect(stepSpeed({ current: 1.1, direction: -1 })).toBe(1)
  })
})

describe('stepCaptionScale', () => {
  it('grows and shrinks within bounds', () => {
    expect(stepCaptionScale({ current: 1, direction: 1 })).toBe(1.25)
    expect(stepCaptionScale({ current: 0.75, direction: -1 })).toBe(0.75)
    expect(stepCaptionScale({ current: 2, direction: 1 })).toBe(2)
  })
})
