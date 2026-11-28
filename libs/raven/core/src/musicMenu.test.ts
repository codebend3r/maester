import { describe, expect, it } from 'bun:test'
import { ALBUM_TYPES, type AlbumSummary, MATCH_STATES } from '@/contract'
import {
  MUSIC_FACTS,
  MUSIC_LINKS,
  MUSIC_LINK_COPY,
  type MusicFactWording,
  RAVEN_FACT_WORDING,
  albumInfoOf,
  musicLinkKeyOf,
  musicLinkLabelOf,
  musicLinksOf,
  trackInfoOf,
} from '@/musicMenu'
import { track } from '@/test/fixtures'

const OK_COMPUTER: AlbumSummary = {
  id: 7,
  libraryId: 3,
  title: 'OK Computer',
  sortTitle: 'OK Computer',
  releaseDate: null,
  year: 1997,
  type: ALBUM_TYPES.album,
  artists: [{ id: 1, name: 'Radiohead' }],
  isCompilation: false,
  trackCount: 12,
  duration: 3201,
  coverVersion: null,
  match: MATCH_STATES.matched,
  addedAt: '2026-01-01T00:00:00Z',
}

const TWO_ARTISTS = [
  { id: 1, name: 'Radiohead' },
  { id: 2, name: 'Thom Yorke' },
]

/** A wording other than Raven's, as Wren's is: a bare count, genres on a dotted line, minutes. */
const OTHER_WORDING = {
  albumFacts: [
    MUSIC_FACTS.kind,
    MUSIC_FACTS.released,
    MUSIC_FACTS.genres,
    MUSIC_FACTS.label,
    MUSIC_FACTS.tracks,
    MUSIC_FACTS.length,
    MUSIC_FACTS.format,
  ],
  trackFacts: [
    MUSIC_FACTS.album,
    MUSIC_FACTS.released,
    MUSIC_FACTS.genres,
    MUSIC_FACTS.length,
    MUSIC_FACTS.format,
  ],
  trackCount: (count: number) => (count > 0 ? String(count) : null),
  genres: (genres: readonly string[]) => genres.join(' · '),
  albumLength: (seconds: number) => (seconds > 0 ? `${Math.round(seconds / 60)} min` : null),
  quality: (quality) =>
    [quality.format, quality.bitDepth, quality.bitrate].filter(Boolean).join(' / '),
} as const satisfies MusicFactWording

const READ_PAGE = {
  label: 'Parlophone',
  genres: ['Alternative', 'Art rock'],
  tracks: [track(), track({ id: 102 })],
}

const FLAC = {
  format: 'FLAC',
  bitDepth: '24-bit',
  sampleRate: '96 kHz',
  bitrate: '2304 kbps',
  isDownloaded: false,
}

describe('albumInfoOf', () => {
  it('tells a plain album by its artists, year, tracks and length, its kind left unsaid', () => {
    expect(albumInfoOf({ album: OK_COMPUTER, extras: null, wording: RAVEN_FACT_WORDING })).toEqual([
      { key: MUSIC_FACTS.artists, value: 'Radiohead' },
      { key: MUSIC_FACTS.released, value: '1997' },
      { key: MUSIC_FACTS.tracks, value: '12 tracks' },
      { key: MUSIC_FACTS.length, value: '53:21' },
    ])
  })

  it("adds an EP's kind, its page's genres and label, and how often it was played", () => {
    const facts = albumInfoOf({
      album: {
        ...OK_COMPUTER,
        type: ALBUM_TYPES.ep,
        artists: [
          { id: 1, name: 'Radiohead' },
          { id: 2, name: 'Thom Yorke' },
        ],
        releaseDate: '1997-05',
        trackCount: 1,
        plays: 3,
      },
      extras: { label: 'Parlophone', genres: ['Alternative', 'Rock'], tracks: [track()] },
      wording: RAVEN_FACT_WORDING,
    })
    expect(facts).toEqual([
      { key: MUSIC_FACTS.artists, value: 'Radiohead, Thom Yorke' },
      { key: MUSIC_FACTS.released, value: 'May 1997' },
      { key: MUSIC_FACTS.kind, value: 'EP' },
      { key: MUSIC_FACTS.genres, value: 'Alternative, Rock' },
      { key: MUSIC_FACTS.label, value: 'Parlophone' },
      { key: MUSIC_FACTS.tracks, value: '1 track' },
      { key: MUSIC_FACTS.length, value: '53:21' },
      { key: MUSIC_FACTS.plays, value: '3 plays' },
    ])
  })

  it('says nothing of a length not yet probed, a year the tags lack or plays never made', () => {
    const keys = albumInfoOf({
      album: { ...OK_COMPUTER, year: null, duration: 0, plays: 0 },
      extras: { label: null, genres: [], tracks: [] },
      wording: RAVEN_FACT_WORDING,
    }).map(({ key }) => key)
    expect(keys).toEqual([MUSIC_FACTS.artists, MUSIC_FACTS.tracks])
  })
})

describe('trackInfoOf', () => {
  it('tells the playing track by its artists, album, year, length and quality', () => {
    expect(
      trackInfoOf({
        track: track({ duration: 284 }),
        details: { album: OK_COMPUTER, genres: ['Rock'] },
        quality: FLAC,
        wording: RAVEN_FACT_WORDING,
      }),
    ).toEqual([
      { key: MUSIC_FACTS.artists, value: 'Radiohead' },
      { key: MUSIC_FACTS.album, value: 'OK Computer' },
      { key: MUSIC_FACTS.released, value: '1997' },
      { key: MUSIC_FACTS.length, value: '4:44' },
      { key: MUSIC_FACTS.quality, value: 'FLAC · 24-bit · 96 kHz · 2304 kbps' },
    ])
  })

  it('leaves out the year until the album is read, and the length and quality until known', () => {
    const keys = trackInfoOf({
      track: track({ duration: null }),
      details: null,
      quality: null,
      wording: RAVEN_FACT_WORDING,
    }).map(({ key }) => key)
    expect(keys).toEqual([MUSIC_FACTS.artists, MUSIC_FACTS.album])
  })
})

describe('a wording of its own', () => {
  it("orders an album's facts as the app does, and words its count, genres and length", () => {
    expect(albumInfoOf({ album: OK_COMPUTER, extras: READ_PAGE, wording: OTHER_WORDING })).toEqual([
      { key: MUSIC_FACTS.released, value: '1997' },
      { key: MUSIC_FACTS.genres, value: 'Alternative · Art rock' },
      { key: MUSIC_FACTS.label, value: 'Parlophone' },
      { key: MUSIC_FACTS.tracks, value: '12' },
      { key: MUSIC_FACTS.length, value: '53 min' },
      { key: MUSIC_FACTS.format, value: 'FLAC / 16-bit' },
    ])
  })

  it('names a release that is not a plain album first, and leaves out what it does not know', () => {
    const ep = { ...OK_COMPUTER, type: ALBUM_TYPES.ep, year: null, trackCount: 0, duration: 0 }
    expect(albumInfoOf({ album: ep, extras: null, wording: OTHER_WORDING })).toEqual([
      { key: MUSIC_FACTS.kind, value: 'EP' },
    ])
  })

  it('says no format when the files are in more than one', () => {
    const mp3 = track({ id: 102, codec: 'mp3', container: 'mp3', isLossless: false })
    const keys = albumInfoOf({
      album: OK_COMPUTER,
      extras: { ...READ_PAGE, tracks: [track(), mp3] },
      wording: OTHER_WORDING,
    }).map(({ key }) => key)
    expect(keys).not.toContain(MUSIC_FACTS.format)
  })

  it("says a track's album, length and its file's format before the album's page is read", () => {
    expect(
      trackInfoOf({
        track: track({ duration: 300 }),
        details: null,
        quality: null,
        wording: OTHER_WORDING,
      }),
    ).toEqual([
      { key: MUSIC_FACTS.album, value: 'OK Computer' },
      { key: MUSIC_FACTS.length, value: '5:00' },
      { key: MUSIC_FACTS.format, value: 'FLAC / 16-bit / 900 kbps' },
    ])
  })

  it("adds the album's release date and genres once its page is read", () => {
    const keys = trackInfoOf({
      track: track(),
      details: { album: OK_COMPUTER, genres: READ_PAGE.genres },
      quality: null,
      wording: OTHER_WORDING,
    }).map(({ key }) => key)
    expect(keys).toEqual([
      MUSIC_FACTS.album,
      MUSIC_FACTS.released,
      MUSIC_FACTS.genres,
      MUSIC_FACTS.length,
      MUSIC_FACTS.format,
    ])
  })
})

describe('musicLinksOf', () => {
  it('goes to the album and to its one artist, unnamed', () => {
    expect(musicLinksOf({ albumId: 7, artists: OK_COMPUTER.artists })).toEqual([
      { kind: MUSIC_LINKS.album, albumId: 7 },
      { kind: MUSIC_LINKS.artist, artistId: 1, name: 'Radiohead', isNamed: false },
    ])
  })

  it("names each of several artists, and leaves the album out on the album's own page", () => {
    const links = musicLinksOf({ albumId: null, artists: TWO_ARTISTS })
    expect(links).toEqual([
      { kind: MUSIC_LINKS.artist, artistId: 1, name: 'Radiohead', isNamed: true },
      { kind: MUSIC_LINKS.artist, artistId: 2, name: 'Thom Yorke', isNamed: true },
    ])
    expect(links.map(musicLinkKeyOf)).toEqual(['artist:1', 'artist:2'])
  })

  it('goes to the first artist alone, unnamed, when asked to', () => {
    expect(musicLinksOf({ albumId: 7, artists: TWO_ARTISTS, isFirstArtistOnly: true })).toEqual([
      { kind: MUSIC_LINKS.album, albumId: 7 },
      { kind: MUSIC_LINKS.artist, artistId: 1, name: 'Radiohead', isNamed: false },
    ])
  })

  it('says Go to album, Go to artist, or the name of one of several', () => {
    expect(musicLinksOf({ albumId: 7, artists: TWO_ARTISTS }).map(musicLinkLabelOf)).toEqual([
      MUSIC_LINK_COPY.goToAlbum,
      MUSIC_LINK_COPY.goToNamed('Radiohead'),
      MUSIC_LINK_COPY.goToNamed('Thom Yorke'),
    ])
    expect(
      musicLinksOf({ albumId: null, artists: OK_COMPUTER.artists }).map(musicLinkLabelOf),
    ).toEqual([MUSIC_LINK_COPY.goToArtist])
  })

  it('keys the album by its kind alone', () => {
    expect(musicLinkKeyOf({ kind: MUSIC_LINKS.album, albumId: 7 })).toBe(MUSIC_LINKS.album)
  })
})
