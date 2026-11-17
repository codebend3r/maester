import { describe, expect, it } from 'bun:test'
import { EMPTY_QUEUE, QUEUE_SOURCE_KINDS, type Track, startQueue } from '@raven/core'

import { NOW_PLAYING_COPY } from '@/screens/copy'
import { FORM_FACTORS } from '@/theme/wrenTokens'
import {
  LYRIC_TONES,
  PANES,
  deviceOf,
  dropPlaceOf,
  lyricOffsetOf,
  lyricToneOf,
  paneAfter,
  placesToClearOf,
  sourceTitleOf,
  upNextRowsOf,
} from '@/screens/nowPlaying/nowPlayingModel'

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
    expect(rows[0]?.line).toBe('Sia · 2:56')
    expect(rows[0]?.label).toBe('Hostage, Sia')
  })

  it('lists every song when none is playing, and none for an empty queue', () => {
    const queue = { ...startQueue({ items: [1, 2] }), at: null }
    expect(upNextRowsOf({ queue, tracks: TRACKS }).map(({ place }) => place)).toEqual([0, 1])
    expect(upNextRowsOf({ queue: EMPTY_QUEUE, tracks: TRACKS })).toEqual([])
  })
})

describe('dropPlaceOf', () => {
  it('moves a row by the whole rows it passed, inside the songs still to play', () => {
    const at = { place: 3, rowHeight: 60, first: 2, last: 6 }
    expect(dropPlaceOf({ ...at, shift: 20 })).toBe(3)
    expect(dropPlaceOf({ ...at, shift: 130 })).toBe(5)
    expect(dropPlaceOf({ ...at, shift: -70 })).toBe(2)
    expect(dropPlaceOf({ ...at, shift: -600 })).toBe(2)
    expect(dropPlaceOf({ ...at, shift: 600 })).toBe(6)
  })
})

describe('deviceOf', () => {
  it('names the iPhone, the iPad and Android', () => {
    expect(deviceOf({ os: 'ios', formFactor: FORM_FACTORS.phone })).toBe(
      NOW_PLAYING_COPY.devices.iPhone,
    )
    expect(deviceOf({ os: 'ios', formFactor: FORM_FACTORS.tablet })).toBe(
      NOW_PLAYING_COPY.devices.iPad,
    )
    expect(deviceOf({ os: 'android', formFactor: FORM_FACTORS.tablet })).toBe(
      NOW_PLAYING_COPY.devices.android,
    )
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
