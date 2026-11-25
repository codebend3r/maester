import { describe, expect, it } from 'bun:test'
import {
  AUDIO_BITRATES,
  LYRICS_KINDS,
  REPEAT_MODES,
  TRACK_STREAM_KINDS,
  audioQualityOf,
  queueRowsOf,
  startQueue,
} from '@raven/core'

import { type BookControls, NOW_PLAYING_ASIDES } from '@/layouts/musicKit'
import {
  chapterRowsOf,
  nowPlayingAsideOf,
  playModesOf,
  playingQualityOf,
  queueFactsOf,
  queueLineOf,
} from '@/layouts/musicRows'
import { AIRBAG, AIRBAG_LYRICS, PARANOID, PARANOID_LYRICS } from '@/test/musicServer'

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

describe('playingQualityOf', () => {
  it("draws the file's format and bit depth as chips, then its rate and bitrate", () => {
    const quality = playingQualityOf(
      audioQualityOf({ track: AIRBAG, stream: { kind: TRACK_STREAM_KINDS.file } }),
    )
    expect(quality.chips.map(({ text }) => text)).toEqual(['FLAC', '16-bit'])
    expect(quality.facts).toBe('44.1 kHz \u00B7 900 kbps')
    expect(quality.label).toBe('Playing in FLAC, 16-bit, 44.1 kHz, 900 kbps.')
  })

  it("names the transcode a lossless file plays through, and a download's own", () => {
    const transcode = playingQualityOf(
      audioQualityOf({
        track: AIRBAG,
        stream: { kind: TRACK_STREAM_KINDS.transcode, kbps: AUDIO_BITRATES.standard },
      }),
    )
    expect(transcode.chips.map(({ text }) => text)).toEqual(['AAC'])
    expect(transcode.facts).toBe(`${AUDIO_BITRATES.standard} kbps`)
    const download = playingQualityOf(
      audioQualityOf({
        track: AIRBAG,
        stream: { kind: TRACK_STREAM_KINDS.download, kbps: null },
      }),
    )
    expect(download.facts).toBe('Downloaded')
    expect(download.label).toBe('Playing in AAC, Downloaded.')
  })
})

describe('queueFactsOf', () => {
  it('counts the queue and adds up how long it runs', () => {
    const tracks = { [AIRBAG.id]: AIRBAG, [PARANOID.id]: PARANOID }
    const queue = startQueue({ items: [AIRBAG.id, PARANOID.id] })
    expect(queueFactsOf(queueRowsOf({ queue, tracks }))).toBe('2 tracks \u00B7 10:00')
    expect(queueFactsOf([])).toBe('0 tracks \u00B7 0:00')
  })
})

describe('queueLineOf', () => {
  it("puts a row's artists and its length on one line", () => {
    const tracks = { [AIRBAG.id]: AIRBAG }
    const [row] = queueRowsOf({ queue: startQueue({ items: [AIRBAG.id] }), tracks })
    if (row === undefined) throw new Error('Expected a queue row')
    expect(queueLineOf(row)).toBe(`${row.line} \u00B7 ${row.length}`)
  })
})

describe('playModesOf', () => {
  it('says whether shuffle is on, and how the queue repeats, with the icon for it', () => {
    expect(playModesOf({ isShuffled: true, repeat: REPEAT_MODES.off })).toEqual({
      shuffle: { isOn: true, label: 'Shuffle on' },
      repeat: { isOn: false, label: 'Repeat off', icon: 'repeat' },
    })
    expect(playModesOf({ isShuffled: false, repeat: REPEAT_MODES.all })).toEqual({
      shuffle: { isOn: false, label: 'Shuffle off' },
      repeat: { isOn: true, label: 'Repeat all', icon: 'repeat' },
    })
    expect(playModesOf({ isShuffled: false, repeat: REPEAT_MODES.one }).repeat).toEqual({
      isOn: true,
      label: 'Repeat one',
      icon: 'repeatOne',
    })
  })
})
