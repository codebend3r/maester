import { describe, expect, it } from 'bun:test'

import { REPEAT_MODES } from '@raven/core'

import {
  SCRUB_STEP_SECONDS,
  progressOf,
  repeatIconOf,
  scrubTextOf,
  toggleLookOf,
} from '@/playerModel'

describe('progressOf', () => {
  it('is the share played, never past the end', () => {
    expect(progressOf({ position: 66, length: 264 })).toBe(0.25)
    expect(progressOf({ position: 300, length: 264 })).toBe(1)
  })

  it('is nothing while the length is unknown', () => {
    expect(progressOf({ position: 12, length: 0 })).toBe(0)
  })
})

describe('scrubTextOf', () => {
  it('reads out how far in it is, of how long', () => {
    expect(scrubTextOf({ position: 62, length: 284 })).toBe('1:02 of 4:44')
  })
})

describe('toggleLookOf', () => {
  const colors = {
    accentText: 'red',
    accentSoft: 'soft red',
    text3: 'grey',
    surface2: 'ground',
    text: 'ink',
  } as const

  it('is red on a soft red circle while the toggle is on', () => {
    expect(toggleLookOf({ isOn: true, colors })).toEqual({ color: 'red', fill: 'soft red' })
  })

  it('is quiet on the raised ground while it is off', () => {
    expect(toggleLookOf({ isOn: false, colors })).toEqual({ color: 'grey', fill: 'ground' })
  })
})

describe('repeatIconOf', () => {
  const icons = { repeat: 'repeat', repeatOne: 'repeat-one' } as const

  it('draws the plain loop while repeat is off or repeats them all', () => {
    expect(repeatIconOf({ repeat: REPEAT_MODES.off, icons })).toBe(icons.repeat)
    expect(repeatIconOf({ repeat: REPEAT_MODES.all, icons })).toBe(icons.repeat)
  })

  it('draws the loop with a 1 while it repeats one song', () => {
    expect(repeatIconOf({ repeat: REPEAT_MODES.one, icons })).toBe(icons.repeatOne)
  })
})

describe('SCRUB_STEP_SECONDS', () => {
  it('moves the playhead a quarter of a minute a step', () => {
    expect(SCRUB_STEP_SECONDS).toBe(15)
  })
})
