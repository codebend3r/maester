import { describe, expect, it } from 'vitest'
import {
  isCredit,
  isHistoryEntry,
  isItemDetails,
  isItemSummary,
  isLibrary,
  isMatchCandidate,
  isMediaItem,
  isMetadataHealth,
  isRating,
  isShowListing,
} from '@/guards'
import { itemDetails, itemSummary, library, mediaItem, showEntry } from '@/test/fixtures'

describe('isMediaItem', () => {
  it('accepts an item that carries its favourite flag', () => {
    expect(isMediaItem(mediaItem({ favourite: true }))).toBe(true)
  })

  it('rejects an item whose favourite flag is missing', () => {
    const { favourite: _favourite, ...withoutFlag } = mediaItem()
    expect(isMediaItem(withoutFlag)).toBe(false)
  })
})

describe('isLibrary', () => {
  it('accepts a library that carries its settings', () => {
    expect(
      isLibrary(
        library({
          settings: {
            saveProgress: false,
            pinned: true,
            sort: 'random',
            view: 'tiles',
            groupBy: 'month',
            watchedPercent: 80,
            kind: 'shows',
          },
        }),
      ),
    ).toBe(true)
  })

  it('rejects a library whose type is not one of the three', () => {
    expect(isLibrary({ ...library(), settings: { ...library().settings, kind: 'music' } })).toBe(
      false,
    )
  })

  it('rejects a library whose watched percentage is out of range', () => {
    expect(isLibrary(library({ settings: { ...library().settings, watchedPercent: 150 } }))).toBe(
      false,
    )
  })

  it('rejects a library whose settings are missing', () => {
    const { settings: _settings, ...withoutSettings } = library()
    expect(isLibrary(withoutSettings)).toBe(false)
  })

  it('rejects a library with a setting that is not a boolean', () => {
    expect(isLibrary({ ...library(), settings: { ...library().settings, pinned: 'yes' } })).toBe(
      false,
    )
  })

  it('rejects a library whose view is not one of the choices', () => {
    expect(isLibrary({ ...library(), settings: { ...library().settings, view: 'poster' } })).toBe(
      false,
    )
  })
})

describe('isHistoryEntry', () => {
  it('accepts a video with when it was last played and how often', () => {
    expect(
      isHistoryEntry({
        media: mediaItem(),
        lastPlayedAt: '2026-10-10T19:00:00.000Z',
        plays: 2,
        furthest: 5000,
        watched: true,
      }),
    ).toBe(true)
  })

  it('rejects an entry that does not say whether it was watched', () => {
    expect(
      isHistoryEntry({
        media: mediaItem(),
        lastPlayedAt: '2026-10-10T19:00:00.000Z',
        plays: 2,
        furthest: 5000,
      }),
    ).toBe(false)
  })
})

describe('the metadata guards', () => {
  it('accepts a matched file with its item', () => {
    expect(
      isMediaItem(mediaItem({ match: 'matched', year: 1999, item: itemSummary(), versions: 2 })),
    ).toBe(true)
  })

  it('rejects a file whose match state is unknown', () => {
    expect(isMediaItem({ ...mediaItem(), match: 'guessed' })).toBe(false)
  })

  it('rejects a file without its versions count', () => {
    const { versions: _versions, ...without } = mediaItem()
    expect(isMediaItem(without)).toBe(false)
  })

  it('accepts an episode summary with its show', () => {
    expect(
      isItemSummary(
        itemSummary({
          type: 'episode',
          title: 'Half Loop',
          show: { id: 4, title: 'Severance' },
          season: 1,
          episode: 2,
        }),
      ),
    ).toBe(true)
  })

  it('accepts item details and refuses a bad rating or credit', () => {
    expect(isItemDetails(itemDetails())).toBe(true)
    expect(
      isItemDetails({
        ...itemDetails(),
        ratings: [{ source: 'letterboxd', kind: 'audience', value: 4, votes: 1 }],
      }),
    ).toBe(false)
    expect(
      isCredit({ personId: 1, name: 'X', job: 'gaffer', role: null, photoVersion: null }),
    ).toBe(false)
    expect(isRating({ source: 'imdb', kind: 'audience', value: 7.5, votes: null })).toBe(true)
  })

  it('accepts a show listing and refuses one whose next episode is malformed', () => {
    expect(isShowListing({ shows: [showEntry()], unmatched: [mediaItem()] })).toBe(true)
    expect(isShowListing({ shows: [showEntry({ next: null })], unmatched: [] })).toBe(true)
    expect(isShowListing({ shows: [{ ...showEntry(), next: { id: 1 } }], unmatched: [] })).toBe(
      false,
    )
  })

  it('accepts match candidates and the metadata health', () => {
    expect(
      isMatchCandidate({
        tmdbId: '603',
        title: 'The Matrix',
        year: 1999,
        overview: null,
        poster: null,
      }),
    ).toBe(true)
    expect(
      isMetadataHealth({ tmdb: 'off', omdb: 'off', pending: 0, error: null, lastOk: null }),
    ).toBe(true)
    expect(
      isMetadataHealth({ tmdb: 'broken', omdb: 'off', pending: 0, error: null, lastOk: null }),
    ).toBe(false)
  })
})
