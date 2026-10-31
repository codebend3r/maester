import { describe, expect, it } from 'bun:test'
import { LYRICS_KINDS } from '@raven/core'

import { type BookControls, NOW_PLAYING_ASIDES } from '@/layouts/musicKit'
import { chapterRowsOf, nowPlayingAsideOf } from '@/layouts/musicRows'
import { AIRBAG_LYRICS, PARANOID_LYRICS } from '@/test/musicServer'

describe('nowPlayingAsideOf', () => {
  const book: BookControls = {
    chapters: [],
    speed: 1,
    onChapter: () => undefined,
    onPreviousChapter: () => undefined,
    onNextChapter: null,
    onSpeed: () => undefined,
  }

  it('marks the line sung at the clock, and draws a line with no words as a note', () => {
    const aside = nowPlayingAsideOf({ book: null, lyrics: AIRBAG_LYRICS, at: 13 })
    if (aside.kind !== NOW_PLAYING_ASIDES.lyrics || aside.lyrics.kind !== LYRICS_KINDS.synced) {
      throw new Error('Expected synced lyrics')
    }
    expect(aside.lyrics.current).toBe(1)
    expect(aside.lyrics.lines.map(({ text, isCurrent }) => [text, isCurrent])).toEqual([
      ['In the next world war', false],
      ['In a jackknifed juggernaut', true],
      ['\u266A', false],
    ])
  })

  it('keeps plain lyrics as they are, and draws nothing while none are read', () => {
    expect(nowPlayingAsideOf({ book: null, lyrics: PARANOID_LYRICS, at: 0 })).toEqual({
      kind: NOW_PLAYING_ASIDES.lyrics,
      lyrics: { kind: LYRICS_KINDS.plain, text: PARANOID_LYRICS.text },
    })
    expect(nowPlayingAsideOf({ book: null, lyrics: null, at: 0 })).toEqual({
      kind: NOW_PLAYING_ASIDES.none,
    })
  })

  it('gives a book its controls in place of any lyrics', () => {
    expect(nowPlayingAsideOf({ book, lyrics: AIRBAG_LYRICS, at: 0 })).toEqual({
      kind: NOW_PLAYING_ASIDES.book,
      book,
    })
  })
})

describe('audiobooks', () => {
  it('names each chapter by its title or its place, the one playing marked', () => {
    const rows = chapterRowsOf({
      chapters: [
        { start: 0, end: 600, title: 'Opening' },
        { start: 600, end: 900, title: null },
      ],
      current: 1,
    })
    expect(rows.map(({ label, isCurrent }) => [label, isCurrent])).toEqual([
      ['Opening, 0:00', false],
      ['Chapter 2, 10:00', true],
    ])
  })
})
