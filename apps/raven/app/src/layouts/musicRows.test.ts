import { describe, expect, it } from 'bun:test'
import { EMPTY_QUEUE, LYRICS_KINDS, startQueue } from '@raven/core'

import { type BookControls, NOW_PLAYING_ASIDES } from '@/layouts/musicKit'
import {
  albumDiscsOf,
  albumFactsOf,
  chapterRowsOf,
  nowPlayingAsideOf,
  playTimeOf,
  playlistFactsOf,
  playlistTracksOf,
  queueRowsOf,
} from '@/layouts/musicRows'
import {
  AIRBAG,
  AIRBAG_LYRICS,
  LUCKY,
  MIXTAPE,
  OK_COMPUTER,
  PARANOID,
  PARANOID_LYRICS,
} from '@/test/musicServer'

describe('albumFactsOf', () => {
  it("says the album's year, tracks and length, leaving out a year the tags lack", () => {
    expect(albumFactsOf({ album: OK_COMPUTER })).toBe('1997 · 3 tracks · 15:00')
    expect(albumFactsOf({ album: { ...OK_COMPUTER, year: null, trackCount: 1 } })).toBe(
      '1 track · 15:00',
    )
  })
})

describe('albumDiscsOf', () => {
  it('splits the tracks by disc, titled only on an album of several', () => {
    const discs = albumDiscsOf({ tracks: [AIRBAG, PARANOID, LUCKY], discCount: 2 })
    expect(discs.map(({ title, tracks }) => [title, tracks.map(({ label }) => label)])).toEqual([
      ['Disc 1', ['1. Airbag', '2. Paranoid Android']],
      ['Disc 2', ['3. Lucky']],
    ])
    expect(discs[1]?.tracks[0] ?? null).toMatchObject({ index: 2, number: '1', length: '5:00' })
  })

  it('keeps one untitled disc for an album of one, numbering a track the tags leave unnumbered by its place', () => {
    const [disc, ...rest] = albumDiscsOf({
      tracks: [AIRBAG, { ...PARANOID, number: null }],
      discCount: 1,
    })
    expect(rest).toEqual([])
    expect(disc?.title ?? null).toBeNull()
    expect(disc?.tracks.map(({ number }) => number) ?? null).toEqual(['1', '2'])
  })
})

describe('queueRowsOf', () => {
  const tracks = { [AIRBAG.id]: AIRBAG, [PARANOID.id]: PARANOID }

  it('lists the queue in play order, the playing track marked', () => {
    const queue = startQueue({ items: [AIRBAG.id, PARANOID.id], startAt: 1 })
    expect(queueRowsOf({ queue, tracks })).toEqual([
      { key: `${AIRBAG.id}:0`, place: 0, title: 'Airbag', line: 'Radiohead', isCurrent: false },
      {
        key: `${PARANOID.id}:1`,
        place: 1,
        title: 'Paranoid Android',
        line: 'Radiohead',
        isCurrent: true,
      },
    ])
  })

  it('leaves out a track the store does not know, and is empty for an empty queue', () => {
    const queue = startQueue({ items: [AIRBAG.id, LUCKY.id] })
    expect(queueRowsOf({ queue, tracks }).map(({ title }) => title)).toEqual(['Airbag'])
    expect(queueRowsOf({ queue: EMPTY_QUEUE, tracks })).toEqual([])
  })
})

describe('playTimeOf', () => {
  it('says how far the track has played and how long it is', () => {
    expect(playTimeOf({ position: 62, duration: 284 })).toBe('1:02 / 4:44')
    expect(playTimeOf({ position: 0, duration: null })).toBe('0:00 / 0:00')
  })
})

describe('playlists', () => {
  it("says a playlist's tracks and minutes, leaving out minutes under one", () => {
    expect(playlistFactsOf({ playlist: MIXTAPE })).toBe('3 tracks · 15 min')
    expect(playlistFactsOf({ playlist: { ...MIXTAPE, trackCount: 1, duration: 20 } })).toBe(
      '1 track',
    )
  })

  it('keys each track by its place, so a track held twice is two rows', () => {
    const rows = playlistTracksOf({ tracks: [AIRBAG, AIRBAG] })
    expect(rows.map(({ key, label }) => [key, label])).toEqual([
      ['101:0', '1. Airbag'],
      ['101:1', '2. Airbag'],
    ])
    expect(rows[0]).toMatchObject({ line: 'Radiohead', length: '5:00' })
  })
})

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
