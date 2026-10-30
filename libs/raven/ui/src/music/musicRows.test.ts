import { describe, expect, it } from 'bun:test'
import {
  ALBUM_TYPES,
  type AlbumSummary,
  EMPTY_QUEUE,
  MATCH_STATES,
  type PlaylistSummary,
  startQueue,
} from '@raven/core'

import {
  albumDiscsOf,
  albumFactsOf,
  playTimeOf,
  playlistFactsOf,
  playlistTracksOf,
  queueRowsOf,
} from '@/music/musicRows'
import { track } from '@/test/fixtures'

const AIRBAG = track({ duration: 300 })
const PARANOID = track({ id: 102, title: 'Paranoid Android', number: 2, duration: 300 })
const LUCKY = track({ id: 103, title: 'Lucky', disc: 2, number: 1, duration: 300 })

const OK_COMPUTER: AlbumSummary = {
  id: 7,
  libraryId: 3,
  title: 'OK Computer',
  sortTitle: 'OK Computer',
  year: 1997,
  type: ALBUM_TYPES.album,
  artists: [{ id: 1, name: 'Radiohead' }],
  isCompilation: false,
  trackCount: 3,
  duration: 900,
  coverVersion: null,
  match: MATCH_STATES.matched,
  addedAt: '2026-01-01T00:00:00Z',
}

const MIXTAPE: PlaylistSummary = {
  id: 4,
  name: 'Mixtape',
  trackCount: 3,
  duration: 900,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
}

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
