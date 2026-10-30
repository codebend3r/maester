import { describe, expect, it } from 'bun:test'
import { REPEAT_MODES } from '@raven/core'

import { MUSIC_COPY } from '@/layouts/copy'
import { SPEED_OPTIONS, shuffleLabelOf, speedChooserOf, toggleLabelOf } from '@/layouts/musicKit'

describe('the controls', () => {
  it('says whether shuffle is on, how the queue repeats, and what Play or Pause does', () => {
    expect(shuffleLabelOf(true)).toBe('Shuffle on')
    expect(shuffleLabelOf(false)).toBe('Shuffle off')
    expect(MUSIC_COPY.repeat[REPEAT_MODES.one]).toBe('Repeat one')
    expect(toggleLabelOf(true)).toBe('Pause')
    expect(toggleLabelOf(false)).toBe('Play')
  })
})

describe('the speed picker', () => {
  it('offers every speed, and sets the one a key names, never one it does not', () => {
    expect(SPEED_OPTIONS.map(({ label }) => label)).toEqual([
      '0.75\u00D7',
      '1\u00D7',
      '1.25\u00D7',
      '1.5\u00D7',
      '1.75\u00D7',
      '2\u00D7',
    ])
    const chosen: number[] = []
    const choose = speedChooserOf((speed) => chosen.push(speed))
    choose('1.25')
    choose('3')
    expect(chosen).toEqual([1.25])
  })
})
