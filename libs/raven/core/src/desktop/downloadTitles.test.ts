import { describe, expect, it } from 'bun:test'
import { DEFAULT_SAGA_BACKDROP, ITEM_TYPES, RATING_KINDS, RATING_SOURCES } from '@/contract'
import {
  artworkOfMedia,
  coverOf,
  DOWNLOAD_MAX_FILES,
  draftOfItem,
  draftOfMedia,
  draftOfSaga,
  episodeLabel,
  factsOf,
  libraryOf,
  oncePerFile,
  posterOf,
  seasonIdsOf,
  titleItemIdOf,
} from '@/desktop/downloadTitles'
import { DOWNLOAD_ARTWORK_KINDS, DOWNLOAD_KINDS } from '@/desktop/protocol'
import {
  episodeSummary,
  itemDetails,
  itemSummary,
  library,
  mediaItem,
  seasonSummary,
} from '@/test/fixtures'

const SHOW = { id: 30, title: 'Severance' }

describe('DOWNLOAD_MAX_FILES', () => {
  it('caps one ask at 500 files', () => {
    expect(DOWNLOAD_MAX_FILES).toBe(500)
  })
})

describe('episodeLabel', () => {
  it('leads with the season and episode numbers', () => {
    expect(episodeLabel({ season: 2, episode: 4, title: 'Trojan Horse' })).toBe(
      'S02E04 Trojan Horse',
    )
  })

  it('is the title alone without both numbers', () => {
    expect(episodeLabel({ season: null, episode: 4, title: 'Trojan Horse' })).toBe('Trojan Horse')
    expect(episodeLabel({ season: 2, episode: null, title: 'Trojan Horse' })).toBe('Trojan Horse')
  })
})

describe('posterOf', () => {
  it('names the item and the poster version', () => {
    expect(posterOf({ id: 4, posterVersion: 'v9' })).toEqual({
      kind: DOWNLOAD_ARTWORK_KINDS.poster,
      itemId: 4,
      version: 'v9',
    })
  })

  it('is none while the server has no poster', () => {
    expect(posterOf({ id: 4, posterVersion: null })).toEqual({ kind: DOWNLOAD_ARTWORK_KINDS.none })
  })
})

describe('coverOf', () => {
  it('names the album and the cover version, and is none without either', () => {
    expect(coverOf({ cover: { albumId: 6, coverVersion: 'c1' } })).toEqual({
      kind: DOWNLOAD_ARTWORK_KINDS.cover,
      albumId: 6,
      version: 'c1',
    })
    expect(coverOf({ cover: { albumId: 6, coverVersion: null } })).toEqual({
      kind: DOWNLOAD_ARTWORK_KINDS.none,
    })
    expect(coverOf({ cover: null })).toEqual({ kind: DOWNLOAD_ARTWORK_KINDS.none })
  })
})

describe('artworkOfMedia', () => {
  it('is the matched item poster, and none for a file with no item', () => {
    const item = itemSummary({ id: 3, posterVersion: 'v1' })
    expect(artworkOfMedia(mediaItem({ item }))).toEqual({
      kind: DOWNLOAD_ARTWORK_KINDS.poster,
      itemId: 3,
      version: 'v1',
    })
    expect(artworkOfMedia(mediaItem({ item: null }))).toEqual({ kind: DOWNLOAD_ARTWORK_KINDS.none })
  })
})

describe('factsOf', () => {
  it('keeps what the library sorts a file on', () => {
    const media = mediaItem({
      width: 1920,
      height: 1080,
      bitrate: 6_000_000,
      item: itemSummary({
        year: 1999,
        ratings: [
          { source: RATING_SOURCES.tmdb, kind: RATING_KINDS.audience, value: 8.1, votes: null },
        ],
      }),
    })
    expect(factsOf(media)).toEqual({
      year: 1999,
      score: 8.1,
      bitrate: 6_000_000,
      pixels: 1920 * 1080,
      addedAt: media.addedAt,
      changedAt: media.changedAt,
    })
  })

  it('leaves what a file lacks empty', () => {
    const facts = factsOf(mediaItem({ width: null, height: 720, year: 2004, item: null }))
    expect(facts.pixels).toBeNull()
    expect(facts.score).toBeNull()
    expect(facts.year).toBe(2004)
  })
})

describe('libraryOf', () => {
  it('keeps the id and the name, private when the library is locked', () => {
    const locked = library({ id: 2, name: 'Films' })
    expect(libraryOf(locked)).toEqual({ id: 2, name: 'Films', isPrivate: locked.settings.locked })
  })
})

describe('titleItemIdOf', () => {
  it("is the show's item for an episode, the item's own for a movie, and none without one", () => {
    const episode = itemSummary({ id: 9, type: ITEM_TYPES.episode, show: SHOW })
    expect(titleItemIdOf(mediaItem({ item: episode }))).toBe(30)
    expect(titleItemIdOf(mediaItem({ item: itemSummary({ id: 4 }) }))).toBe(4)
    expect(titleItemIdOf(mediaItem({ item: null }))).toBeNull()
  })
})

describe('draftOfMedia', () => {
  it('files a movie under itself', () => {
    const media = mediaItem({ id: 7, item: itemSummary({ title: 'Heat' }) })
    expect(draftOfMedia(media)).toMatchObject({
      group: { kind: DOWNLOAD_KINDS.movie, key: 'movie:7' },
      artwork: null,
      entries: [{ media, order: 0 }],
    })
  })

  it('files an episode under its show, by its place in it', () => {
    const item = itemSummary({
      id: 9,
      type: ITEM_TYPES.episode,
      title: 'Half Loop',
      show: SHOW,
      season: 1,
      episode: 2,
    })
    expect(draftOfMedia(mediaItem({ id: 8, item }))).toMatchObject({
      group: { kind: DOWNLOAD_KINDS.episode, key: 'show:30', title: 'Severance' },
      entries: [{ label: 'S01E02 Half Loop', order: 10_002 }],
    })
  })
})

describe('draftOfItem', () => {
  const episodeOf = (episode: number) =>
    episodeSummary({
      id: 100 + episode,
      title: `Part ${episode}`,
      show: SHOW,
      season: 1,
      episode,
      primary: mediaItem({ id: 200 + episode }),
    })
  const season = itemDetails({
    id: 31,
    type: ITEM_TYPES.season,
    show: SHOW,
    season: 1,
    children: [episodeOf(2), episodeOf(1)],
  })
  const show = itemDetails({
    id: 30,
    type: ITEM_TYPES.show,
    title: 'Severance',
    versions: [],
    children: [seasonSummary({ id: 31, show: SHOW, season: 1 })],
  })

  it('reads the seasons of a show alone', () => {
    expect(seasonIdsOf(show)).toEqual([31])
    expect(seasonIdsOf(season)).toEqual([])
  })

  it("lists every season's episodes under the show, wearing its poster", () => {
    expect(draftOfItem({ details: show, seasons: [season] })).toMatchObject({
      title: 'Severance',
      group: { kind: DOWNLOAD_KINDS.show, key: 'show:30', title: 'Severance' },
      artwork: posterOf(show),
      entries: [{ order: 10_002 }, { order: 10_001 }],
    })
  })

  it("lists a season's episodes under its show", () => {
    expect(draftOfItem({ details: season, seasons: [] })).toMatchObject({
      group: { kind: DOWNLOAD_KINDS.season, key: 'show:30', title: 'Severance' },
      entries: [{ label: 'S01E02 Part 2' }, { label: 'S01E01 Part 1' }],
    })
  })

  it('takes the first version of a movie, and has none for a movie with no file', () => {
    const movie = itemDetails({ versions: [mediaItem({ id: 5 }), mediaItem({ id: 6 })] })
    expect(draftOfItem({ details: movie, seasons: [] })).toMatchObject({
      group: { kind: DOWNLOAD_KINDS.movie, key: 'movie:5' },
      entries: [{ media: { id: 5 } }],
    })
    expect(draftOfItem({ details: itemDetails({ versions: [] }), seasons: [] })).toBeNull()
  })

  it('takes the first version of an episode, under its show', () => {
    const details = itemDetails({
      id: 101,
      type: ITEM_TYPES.episode,
      title: 'Part 1',
      show: SHOW,
      season: 1,
      episode: 1,
      versions: [mediaItem({ id: 201 })],
    })
    expect(draftOfItem({ details, seasons: [] })).toMatchObject({
      group: { kind: DOWNLOAD_KINDS.episode, key: 'show:30' },
      artwork: null,
      entries: [{ media: { id: 201 }, label: 'S01E01 Part 1', order: 10_001 }],
    })
    expect(draftOfItem({ details: { ...details, versions: [] }, seasons: [] })).toBeNull()
  })
})

describe('draftOfSaga', () => {
  it('orders the films as the saga does, each to wear its own poster', () => {
    const saga = {
      tmdbId: '119',
      name: 'Rings',
      backdrop: DEFAULT_SAGA_BACKDROP,
      media: [mediaItem({ id: 2 }), mediaItem({ id: 1 })],
    }
    expect(draftOfSaga({ saga, libraryId: 4 })).toMatchObject({
      title: 'Rings',
      group: { kind: DOWNLOAD_KINDS.saga, key: 'saga:4:119', title: 'Rings' },
      artwork: null,
      entries: [
        { media: { id: 2 }, order: 0 },
        { media: { id: 1 }, order: 1 },
      ],
    })
  })
})

describe('oncePerFile', () => {
  it('keeps the first entry of each file', () => {
    const entries = [
      { media: mediaItem({ id: 1 }), label: 'first' },
      { media: mediaItem({ id: 1 }), label: 'second' },
      { media: mediaItem({ id: 2 }), label: 'third' },
    ]
    expect(oncePerFile(entries).map(({ label }) => label)).toEqual(['first', 'third'])
  })
})
