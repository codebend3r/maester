import { describe, expect, it } from 'bun:test'
import {
  EMPTY_QUEUE,
  LYRICS_KINDS,
  LYRICS_SOURCES,
  type Lyrics,
  NO_LYRICS,
  QUEUE_SOURCE_KINDS,
  type Track,
  startQueue,
} from '@raven/core'

import { PLAYER_COPY } from '@/copy/kit'
import { NOW_PLAYING_COPY } from '@/copy/screens'
import {
  LYRIC_TONES,
  PANES,
  barWordsOf,
  lyricOffsetOf,
  lyricToneOf,
  paneAfter,
  placesToClearOf,
  READING_LYRICS,
  shownLyricsOf,
  sourceIdOf,
  sourceTitleOf,
  upNextRowsOf,
} from '@/nowPlaying/nowPlayingModel'

type TrackForProps = { id: number; title: string; duration: number }

const trackFor = ({ id, title, duration }: TrackForProps): Track => ({
  id,
  libraryId: 1,
  albumId: 7,
  title,
  disc: 1,
  number: id,
  duration,
  artists: [{ id: 3, name: 'Sia' }],
  container: 'flac',
  codec: 'flac',
  bitrate: null,
  sampleRate: null,
  bitDepth: null,
  isLossless: true,
  mbid: null,
  addedAt: '2026-11-01T00:00:00.000Z',
  album: { title: '1000 Forms Of Fear', coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
})

const CHANDELIER = trackFor({ id: 1, title: 'Chandelier', duration: 216 })
const CELLOPHANE = trackFor({ id: 2, title: 'Cellophane', duration: 265 })
const HOSTAGE = trackFor({ id: 3, title: 'Hostage', duration: 176 })

const TRACKS = Object.fromEntries([CHANDELIER, CELLOPHANE, HOSTAGE].map((t) => [t.id, t]))

describe('paneAfter', () => {
  it('opens the pane pressed, and goes back to the player when it was open', () => {
    expect(paneAfter({ current: PANES.player, pressed: PANES.lyrics })).toBe(PANES.lyrics)
    expect(paneAfter({ current: PANES.lyrics, pressed: PANES.upNext })).toBe(PANES.upNext)
    expect(paneAfter({ current: PANES.lyrics, pressed: PANES.lyrics })).toBe(PANES.player)
    expect(paneAfter({ current: PANES.upNext, pressed: PANES.player })).toBe(PANES.player)
  })
})

describe('upNextRowsOf', () => {
  it('lists the songs after the one playing, with their artists and lengths', () => {
    const queue = startQueue({ items: [1, 2, 3], startAt: 1 })
    const rows = upNextRowsOf({ queue, tracks: TRACKS })
    expect(rows.map(({ place, track }) => [place, track.title])).toEqual([[2, 'Hostage']])
    expect(rows[0]?.line ?? null).toBe('Sia · 2:56')
    expect(rows[0]?.label ?? null).toBe('Hostage, Sia')
  })

  it('lists every song when none is playing, and none for an empty queue', () => {
    const queue = { ...startQueue({ items: [1, 2] }), at: null }
    expect(upNextRowsOf({ queue, tracks: TRACKS }).map(({ place }) => place)).toEqual([0, 1])
    expect(upNextRowsOf({ queue: EMPTY_QUEUE, tracks: TRACKS })).toEqual([])
  })
})

describe('barWordsOf', () => {
  it('names Lyrics and Up next, and says where the player plays beside its icon', () => {
    const output = 'raven · This iPhone'
    expect(barWordsOf({ pane: PANES.lyrics, output })).toEqual({
      label: PLAYER_COPY.lyrics,
      text: null,
    })
    expect(barWordsOf({ pane: PANES.upNext, output })).toEqual({
      label: PLAYER_COPY.upNext,
      text: null,
    })
    expect(barWordsOf({ pane: PANES.player, output })).toEqual({ label: output, text: output })
  })
})

describe('sourceIdOf', () => {
  it('is the id of a source of the kind asked for', () => {
    const playlist = { kind: QUEUE_SOURCE_KINDS.playlist, id: 4 }
    expect(sourceIdOf({ source: playlist, kind: QUEUE_SOURCE_KINDS.playlist })).toBe(4)
    const artist = { kind: QUEUE_SOURCE_KINDS.artist, id: 3 }
    expect(sourceIdOf({ source: artist, kind: QUEUE_SOURCE_KINDS.artist })).toBe(3)
  })

  it('is nothing for another kind, or with no source', () => {
    const album = { kind: QUEUE_SOURCE_KINDS.album, id: 7 }
    expect(sourceIdOf({ source: album, kind: QUEUE_SOURCE_KINDS.playlist })).toBeNull()
    expect(sourceIdOf({ source: album, kind: QUEUE_SOURCE_KINDS.artist })).toBeNull()
    expect(sourceIdOf({ source: null, kind: QUEUE_SOURCE_KINDS.playlist })).toBeNull()
  })
})

describe('sourceTitleOf', () => {
  const names = { playlistName: null, artistName: null }

  it('names the album, the playlist or the artist the queue started from', () => {
    const album = { kind: QUEUE_SOURCE_KINDS.album, id: 7 }
    expect(sourceTitleOf({ source: album, track: CELLOPHANE, ...names })).toEqual({
      overline: NOW_PLAYING_COPY.from.album,
      name: '1000 Forms Of Fear',
      sourceName: '1000 Forms Of Fear',
    })
    const playlist = { kind: QUEUE_SOURCE_KINDS.playlist, id: 4 }
    expect(
      sourceTitleOf({ source: playlist, track: CELLOPHANE, ...names, playlistName: 'Road trip' }),
    ).toEqual({
      overline: NOW_PLAYING_COPY.from.playlist,
      name: 'Road trip',
      sourceName: 'Road trip',
    })
    const artist = { kind: QUEUE_SOURCE_KINDS.artist, id: 3 }
    expect(
      sourceTitleOf({ source: artist, track: CELLOPHANE, ...names, artistName: 'Sia' }).overline,
    ).toBe(NOW_PLAYING_COPY.from.artist)
  })

  it("falls back to the song's album while a name is read, or with no source", () => {
    const playlist = { kind: QUEUE_SOURCE_KINDS.playlist, id: 4 }
    expect(sourceTitleOf({ source: playlist, track: CELLOPHANE, ...names })).toEqual({
      overline: NOW_PLAYING_COPY.from.other,
      name: '1000 Forms Of Fear',
      sourceName: null,
    })
    expect(sourceTitleOf({ source: null, track: CELLOPHANE, ...names }).sourceName).toBeNull()
  })
})

describe('lyricToneOf', () => {
  it('tones lines sung, being sung and to come', () => {
    expect(lyricToneOf({ place: 0, current: 2 })).toBe(LYRIC_TONES.sung)
    expect(lyricToneOf({ place: 2, current: 2 })).toBe(LYRIC_TONES.current)
    expect(lyricToneOf({ place: 3, current: 2 })).toBe(LYRIC_TONES.upcoming)
    expect(lyricToneOf({ place: 0, current: null })).toBe(LYRIC_TONES.upcoming)
  })
})

describe('lyricOffsetOf', () => {
  it('keeps the line being sung a third of the way down, never above the top', () => {
    expect(lyricOffsetOf({ lineTop: 500, viewport: 600 })).toBe(300)
    expect(lyricOffsetOf({ lineTop: 100, viewport: 600 })).toBe(0)
  })
})

describe('placesToClearOf', () => {
  it('clears from the last place up', () => {
    const queue = startQueue({ items: [1, 2, 3] })
    expect(placesToClearOf(upNextRowsOf({ queue, tracks: TRACKS }))).toEqual([2, 1])
  })
})

describe('shownLyricsOf', () => {
  const WORDS: Lyrics = { kind: LYRICS_KINDS.plain, source: LYRICS_SOURCES.lrclib, text: 'Oh' }

  it('shows the words once they are read, and nothing yet while they are', () => {
    const read = { data: WORDS, isError: false }
    expect(shownLyricsOf({ isAudiobook: false, lyrics: read })).toBe(WORDS)
    const reading = { data: undefined, isError: false }
    expect(shownLyricsOf({ isAudiobook: false, lyrics: reading })).toBe(READING_LYRICS)
  })

  it('shows none for a book, and none for a read that failed', () => {
    expect(shownLyricsOf({ isAudiobook: true, lyrics: { data: WORDS, isError: false } })).toBe(
      NO_LYRICS,
    )
    const failed = { data: undefined, isError: true }
    expect(shownLyricsOf({ isAudiobook: false, lyrics: failed })).toBe(NO_LYRICS)
  })
})
