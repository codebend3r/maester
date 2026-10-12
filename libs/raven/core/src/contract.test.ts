import { describe, expect, it } from 'vitest'
import {
  ITEM_IMAGE_KINDS,
  MEDIA_SORTS,
  STREAM_MODES,
  isCredit,
  isFavouriteChange,
  isHwAccel,
  isImageChoice,
  isItemImageKind,
  isItemMetadataChange,
  isItemMetadataState,
  isMatchChoice,
  isMatchItemType,
  isMediaSort,
  isPlaybackSettingsChange,
  isProgressChange,
  isServerHealth,
  isShowMatchChoice,
  isStreamMode,
  isTmdbId,
  isUnlockRequest,
  isHistoryEntry,
  isEpisodeSummary,
  isItemChild,
  isItemDetails,
  isItemSummary,
  isLibrary,
  isMatchCandidate,
  isMediaItem,
  isMediaLocation,
  isMetadataHealth,
  isPersonDetails,
  isRating,
  isReview,
  isSeasonSummary,
  isServerEvent,
  isShowListing,
} from '@/contract'
import {
  episodeSummary,
  itemDetails,
  itemSummary,
  library,
  mediaItem,
  review,
  seasonSummary,
  showEntry,
} from '@/test/fixtures'

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
            ratingsSource: 'imdb',
            autoRefresh: false,
            locked: true,
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

  it("accepts a page's children: seasons with their episode count, episodes with their row", () => {
    expect(isSeasonSummary(seasonSummary())).toBe(true)
    expect(isEpisodeSummary(episodeSummary())).toBe(true)
    expect(isEpisodeSummary(episodeSummary({ primary: null, stillVersion: null }))).toBe(true)
    expect(isItemDetails(itemDetails({ children: [seasonSummary(), episodeSummary()] }))).toBe(true)
  })

  it('refuses a child that is not a season or an episode, or lacks what its row needs', () => {
    expect(isItemChild({ ...seasonSummary(), type: 'movie' })).toBe(false)
    const { episodeCount: _count, ...countless } = seasonSummary()
    expect(isItemChild(countless)).toBe(false)
    const { primary: _primary, ...unplayable } = episodeSummary()
    expect(isItemChild(unplayable)).toBe(false)
    expect(isItemDetails(itemDetails({ children: [] }))).toBe(true)
    expect(isItemDetails({ ...itemDetails(), children: [itemSummary()] })).toBe(false)
  })

  it('accepts a show listing and refuses one whose next episode is malformed', () => {
    expect(isShowListing({ shows: [showEntry()], unmatched: [mediaItem()] })).toBe(true)
    expect(isShowListing({ shows: [showEntry({ next: null })], unmatched: [] })).toBe(true)
    expect(isShowListing({ shows: [{ ...showEntry(), next: { id: 1 } }], unmatched: [] })).toBe(
      false,
    )
  })

  it('accepts reviews and a person, and refuses a settings record without a ratings source', () => {
    expect(isReview(review())).toBe(true)
    expect(isReview({ ...review(), content: 7 })).toBe(false)
    expect(isItemDetails({ ...itemDetails(), reviews: [review({ rating: null })] })).toBe(true)
    expect(
      isPersonDetails({
        id: 1,
        name: 'Keanu Reeves',
        photoVersion: null,
        credits: [{ item: itemSummary(), job: 'cast', role: 'Neo' }],
      }),
    ).toBe(true)
    const { ratingsSource: _source, ...settings } = library().settings
    expect(isLibrary({ ...library(), settings })).toBe(false)
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

describe('isServerEvent', () => {
  it("accepts a library's change and nothing else", () => {
    expect(isServerEvent({ type: 'library', libraryId: 3 })).toBe(true)
    expect(isServerEvent({ type: 'library', libraryId: '3' })).toBe(false)
    expect(isServerEvent({ type: 'scan', libraryId: 3 })).toBe(false)
  })
})

describe('isMediaLocation', () => {
  it('takes a path', () => {
    expect(isMediaLocation({ path: '/media/Movies/Busboys (2026).mkv' })).toBe(true)
    expect(isMediaLocation({})).toBe(false)
  })
})

describe('the choice lists', () => {
  it('derive each union from its own list', () => {
    expect(MEDIA_SORTS).toHaveLength(15)
    expect(isMediaSort('rating-high')).toBe(true)
    expect(isMediaSort('loudest')).toBe(false)
    expect(STREAM_MODES).toEqual(['remux', 'transcode'])
    expect(isStreamMode('direct')).toBe(false)
    expect(ITEM_IMAGE_KINDS).toEqual(['poster', 'backdrop', 'still'])
    expect(isItemImageKind('banner')).toBe(false)
    expect(isHwAccel('vaapi')).toBe(true)
    expect(isHwAccel('cuda')).toBe(false)
  })

  it('matches files to movies and shows, and nothing else', () => {
    expect(isMatchItemType.values).toEqual(['movie', 'show'])
    expect(['movie', 'show', 'season', 'episode', 'other', 7].map(isMatchItemType)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ])
  })
})

describe('the change guards', () => {
  it('takes part of the playback settings, each a value it takes', () => {
    expect(isPlaybackSettingsChange({ quality: 'high' })).toBe(true)
    expect(isPlaybackSettingsChange({ maxHeight: 2160, tonemap: false })).toBe(true)
    expect(isPlaybackSettingsChange({ maxHeight: 480 })).toBe(false)
    expect(isPlaybackSettingsChange({ quality: 'high', colour: 'red' })).toBe(false)
  })

  it('takes metadata fields written over or cleared, and nothing else', () => {
    expect(isItemMetadataChange({ title: 'Heat', year: null })).toBe(true)
    expect(isItemMetadataChange({ year: '1995' })).toBe(false)
    expect(isItemMetadataChange({ studio: 'Warner' })).toBe(false)
  })

  it('names only the fields Edit metadata knows as written over', () => {
    const metadata = {
      title: 'Heat',
      year: 1995,
      tagline: null,
      summary: null,
      contentRating: null,
    }
    expect(
      isItemMetadataState({ shown: metadata, original: metadata, overridden: ['title'] }),
    ).toBe(true)
    expect(
      isItemMetadataState({ shown: metadata, original: metadata, overridden: ['studio'] }),
    ).toBe(false)
  })
})

describe('the request bodies', () => {
  it('takes a position at or past the start', () => {
    expect(isProgressChange({ position: 0 })).toBe(true)
    expect(isProgressChange({ position: 61.5 })).toBe(true)
    expect(isProgressChange({ position: -1 })).toBe(false)
    expect(isProgressChange({ position: '61' })).toBe(false)
  })

  it('takes a favourite flag and a PIN', () => {
    expect(isFavouriteChange({ favourite: false })).toBe(true)
    expect(isFavouriteChange({ favourite: 'yes' })).toBe(false)
    expect(isUnlockRequest({ pin: '1234' })).toBe(true)
    expect(isUnlockRequest({})).toBe(false)
  })

  it('takes a TMDB id for Fix match, or null for a file that is not one', () => {
    expect(isTmdbId('603')).toBe(true)
    expect(isTmdbId('tt0133093')).toBe(false)
    expect(isMatchChoice({ tmdbId: '603' })).toBe(true)
    expect(isMatchChoice({ tmdbId: null })).toBe(true)
    expect(isMatchChoice({ tmdbId: 603 })).toBe(false)
    expect(isShowMatchChoice({ tmdbId: '95396' })).toBe(true)
    expect(isShowMatchChoice({ tmdbId: null })).toBe(false)
  })

  it("takes one of TMDB's pictures with its path, or the one beside the media", () => {
    expect(isImageChoice({ source: 'tmdb', ref: '/poster.jpg' })).toBe(true)
    expect(isImageChoice({ source: 'local' })).toBe(true)
    expect(isImageChoice({ source: 'tmdb' })).toBe(false)
    expect(isImageChoice({ source: 'web', ref: '/poster.jpg' })).toBe(false)
  })
})

describe('isServerHealth', () => {
  it('takes the whole health check, its metadata included', () => {
    const health = {
      status: 'ok',
      ffmpeg: null,
      tonemap: false,
      encoder: 'vaapi',
      thumbnailsPending: 2,
      metadata: { tmdb: 'off', omdb: 'off', pending: 0, error: null, lastOk: null },
    }
    expect(isServerHealth(health)).toBe(true)
    expect(isServerHealth({ ...health, encoder: 'nvenc' })).toBe(false)
  })
})
