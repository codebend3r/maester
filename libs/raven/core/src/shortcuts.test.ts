import { describe, expect, it } from 'bun:test'
import {
  type PlayerAction,
  type SkipStep,
  essentialShortcutRows,
  shortcutFor,
  shortcutRows,
  stepCaptionScale,
  stepSkip,
  stepSpeed,
} from '@/shortcuts'

const press = ({
  key,
  ...held
}: { key: string } & Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }>) =>
  shortcutFor({ key, metaKey: false, ctrlKey: false, altKey: false, ...held })

describe('shortcutFor', () => {
  const cases: Array<[string, PlayerAction]> = [
    ['k', { type: 'togglePlay' }],
    [' ', { type: 'togglePlay' }],
    ['K', { type: 'togglePlay' }],
    ['j', { type: 'skip', direction: -1 }],
    ['l', { type: 'skip', direction: 1 }],
    ['ArrowLeft', { type: 'skip', direction: -1 }],
    ['ArrowRight', { type: 'skip', direction: 1 }],
    ['ArrowUp', { type: 'volumeBy', delta: 0.05 }],
    ['ArrowDown', { type: 'volumeBy', delta: -0.05 }],
    ['m', { type: 'toggleMute' }],
    ['f', { type: 'toggleFullscreen' }],
    ['c', { type: 'toggleSubtitles' }],
    ['i', { type: 'toggleStats' }],
    ['I', { type: 'toggleStats' }],
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
    expect(press({ key })).toEqual(action)
  })

  it('leaves keys with a modifier to the browser', () => {
    expect(press({ key: 'f', metaKey: true })).toBeNull()
    expect(press({ key: 'l', ctrlKey: true })).toBeNull()
    expect(press({ key: 'k', altKey: true })).toBeNull()
  })

  it('ignores keys the player does not use', () => {
    expect(press({ key: 'q' })).toBeNull()
    expect(press({ key: 'Tab' })).toBeNull()
    expect(press({ key: 'F5' })).toBeNull()
  })
})

describe('stepSpeed', () => {
  it('walks the ladder and stops at its ends', () => {
    expect(stepSpeed({ current: 1, direction: 1 })).toBe(1.25)
    expect(stepSpeed({ current: 1, direction: -1 })).toBe(0.75)
    expect(stepSpeed({ current: 2, direction: 1 })).toBe(2.5)
    expect(stepSpeed({ current: 4, direction: 1 })).toBe(4)
    expect(stepSpeed({ current: 0.25, direction: -1 })).toBe(0.25)
  })

  it('snaps an off-ladder speed to its neighbours', () => {
    expect(stepSpeed({ current: 1.1, direction: 1 })).toBe(1.25)
    expect(stepSpeed({ current: 1.1, direction: -1 })).toBe(1)
  })
})

describe('stepSkip', () => {
  const run = (presses: ReadonlyArray<{ direction: 1 | -1; at: number }>) =>
    presses
      .reduce<SkipStep[]>(
        (steps, skip) => [...steps, stepSkip({ last: steps.at(-1) ?? null, ...skip })],
        [],
      )
      .map((step) => step.seconds * step.direction)

  it('goes 10 seconds on a lone press', () => {
    expect(run([{ direction: 1, at: 0 }])).toEqual([10])
    expect(run([{ direction: -1, at: 0 }])).toEqual([-10])
  })

  it('climbs to 20 and then 30 on quick presses, and stays at 30', () => {
    expect(run([0, 400, 800, 1_200].map((at) => ({ direction: 1 as const, at })))).toEqual([
      10, 20, 30, 30,
    ])
  })

  it('stays at 10 when the presses come a second or more apart', () => {
    expect(run([0, 1_000, 2_000].map((at) => ({ direction: -1 as const, at })))).toEqual([
      -10, -10, -10,
    ])
  })

  it('starts again at 10 after a pause or a change of direction', () => {
    expect(
      run([
        { direction: 1, at: 0 },
        { direction: 1, at: 500 },
        { direction: -1, at: 900 },
        { direction: -1, at: 1_300 },
        { direction: -1, at: 3_000 },
      ]),
    ).toEqual([10, 20, -10, -20, -10])
  })
})

describe('stepCaptionScale', () => {
  it('grows and shrinks within bounds', () => {
    expect(stepCaptionScale({ current: 1, direction: 1 })).toBe(1.25)
    expect(stepCaptionScale({ current: 0.75, direction: -1 })).toBe(0.75)
    expect(stepCaptionScale({ current: 2, direction: 1 })).toBe(2)
  })
})

describe('shortcutRows', () => {
  const keysOf = (canShowStats: boolean) =>
    shortcutRows({ canShowStats }).map((row) => row.keys.join(' '))

  it('lists video info just before these shortcuts, only when the player can show it', () => {
    expect(keysOf(true).slice(-3)).toEqual(['i', '?', 'Esc'])
    expect(keysOf(false)).not.toContain('i')
    expect(keysOf(false).slice(-2)).toEqual(['?', 'Esc'])
    expect(keysOf(true).filter((keys) => keys !== 'i')).toEqual(keysOf(false))
  })
})

describe('essentialShortcutRows', () => {
  it('teaches play, skip, volume, full screen and subtitles, then where the rest are', () => {
    expect(essentialShortcutRows().map((row) => row.keys.join(' '))).toEqual([
      'k Space',
      'j l ← →',
      '↑ ↓',
      'f',
      'c',
      '?',
    ])
  })
})
