import { describe, expect, it } from 'bun:test'

import {
  type BookControls,
  NOW_PLAYING_ASIDES,
  PLAYING_PANES,
  SPEED_OPTIONS,
  paneTabsOf,
  speedChooserOf,
  toggleLabelOf,
} from '@/layouts/musicKit'

describe('the controls', () => {
  it('says what Play or Pause does', () => {
    expect(toggleLabelOf(true)).toBe('Pause')
    expect(toggleLabelOf(false)).toBe('Play')
  })
})

describe('paneTabsOf', () => {
  it('lists Up next, then Lyrics, or Chapters for a book', () => {
    expect(paneTabsOf({ kind: NOW_PLAYING_ASIDES.none })).toEqual([
      { pane: PLAYING_PANES.queue, label: 'Up next' },
      { pane: PLAYING_PANES.extras, label: 'Lyrics' },
    ])
    const book: BookControls = {
      chapters: [],
      speed: 1,
      onChapter: () => undefined,
      onPreviousChapter: () => undefined,
      onNextChapter: null,
      onSpeed: () => undefined,
    }
    expect(paneTabsOf({ kind: NOW_PLAYING_ASIDES.book, book }).map(({ label }) => label)).toEqual([
      'Up next',
      'Chapters',
    ])
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
