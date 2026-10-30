import { describe, expect, it } from 'bun:test'
import { createApiClient } from '@/apiClient'
import { ITEM_TYPES, THUMBNAIL_STATES } from '@/contract'
import {
  allFileFacts,
  episodeByline,
  episodeFacts,
  episodeRowFacts,
  episodeStillUrl,
  episodesOf,
  episodesWatched,
  formatAirDate,
  movieFacts,
  nextEpisodeIn,
  runtimeFact,
  seasonFacts,
  seasonsOf,
  seasonsWatched,
  versionFacts,
  watchedCountLabel,
} from '@/itemFacts'
import { episodeSummary, itemDetails, mediaItem, seasonSummary } from '@/test/fixtures'

describe('runtimeFact', () => {
  it("prefers the file's own length to TMDB's runtime", () => {
    expect(runtimeFact({ file: mediaItem({ duration: 3600 }), runtime: 97 })).toBe('1h 0m')
    expect(runtimeFact({ file: mediaItem({ duration: null }), runtime: 97 })).toBe('1h 37m')
    expect(runtimeFact({ file: undefined, runtime: null })).toBeNull()
  })
})

describe('movie facts', () => {
  it('counts the files only once the movie has two or more', () => {
    const one = itemDetails({
      year: 2026,
      released: '2026-03-07',
      runtime: 97,
      genres: ['Comedy', 'Drama', 'Crime', 'Romance'],
      versions: [mediaItem({ id: 1, duration: null })],
    })
    expect(movieFacts({ details: one, primary: undefined })).toEqual([
      formatAirDate('2026-03-07') ?? '',
      '1h 37m',
      'Comedy',
      'Drama',
      'Crime',
    ])
    const two = { ...one, versions: [mediaItem({ id: 1 }), mediaItem({ id: 2 })] }
    expect(movieFacts({ details: two, primary: undefined }).at(-1)).toBe('2 files')
  })

  it('falls back to the year when TMDB gave no release day', () => {
    const undated = itemDetails({ year: 2026, released: null, runtime: null, genres: [] })
    expect(movieFacts({ details: undated, primary: undefined })).toEqual(['2026'])
  })
})

describe('episode facts', () => {
  it('names the show, season and episode, then the air date and runtime', () => {
    const details = itemDetails({
      type: 'episode',
      show: { id: 5, title: 'Severance' },
      season: 1,
      episode: 2,
      released: '2022-02-18',
      runtime: 55,
    })
    expect(episodeByline(details)).toBe('Severance · Season 1 · Episode 2')
    expect(episodeFacts({ details, primary: undefined })).toEqual([
      formatAirDate('2022-02-18')!,
      '55m',
    ])
  })
})

describe('versionFacts', () => {
  it("names a file's resolution, HDR, codec and size, leaving out what it does not have", () => {
    expect(
      versionFacts(
        mediaItem({
          width: 3840,
          height: 2160,
          hdr: true,
          videoCodec: 'hevc',
          size: 61_000_000_000,
        }),
      ),
    ).toEqual(['4K', 'HDR', 'HEVC', '61.0 GB'])
    expect(
      versionFacts(mediaItem({ width: null, height: null, videoCodec: null, size: 1_500_000_000 })),
    ).toEqual(['1.5 GB'])
  })
})

describe('allFileFacts', () => {
  it("lists the file's tracks, then its container, bitrate and size", () => {
    expect(allFileFacts({ media: mediaItem({ size: 2_500_000_000 }), tracks: undefined })).toEqual([
      { label: 'Video', values: ['1080p (H.264)'] },
      { label: 'Audio', values: ['AAC Stereo'] },
      { label: 'Container', values: ['MP4'] },
      { label: 'Bitrate', values: ['5.0 Mb/s'] },
      { label: 'Size', values: ['2.5 GB'] },
    ])
  })

  it('lists every audio track, the default first, each by its language and sound', () => {
    const audio = allFileFacts({
      media: mediaItem({}),
      tracks: {
        audio: [
          { index: 0, codec: 'ac3', channels: 6, language: 'en', title: null, default: false },
          { index: 1, codec: 'dts', channels: 7, language: 'ja', title: null, default: true },
        ],
        subtitles: [],
        defaultAudio: 1,
        frameRate: null,
      },
    }).find((fact) => fact.label === 'Audio')
    expect(audio?.values).toEqual(['Japanese (DTS 7 ch)', 'English (Dolby Digital 5.1)'])
  })

  it('leaves out a bitrate the file has not been probed for', () => {
    const labels = allFileFacts({ media: mediaItem({ bitrate: null }), tracks: undefined }).map(
      (fact) => fact.label,
    )
    expect(labels).not.toContain('Bitrate')
  })
})

describe('seasons and episodes', () => {
  const show = itemDetails({
    type: ITEM_TYPES.show,
    children: [seasonSummary({ id: 5 }), seasonSummary({ id: 7, season: 2, title: 'Season 2' })],
  })
  const season = itemDetails({
    type: ITEM_TYPES.season,
    year: 2022,
    children: [
      episodeSummary({ id: 6, episode: 1, watched: true }),
      episodeSummary({ id: 8, episode: 2, primary: null }),
      episodeSummary({ id: 9, episode: 3 }),
    ],
  })

  it("reads a show's seasons and a season's episodes off their children", () => {
    expect(seasonsOf(show).map((child) => child.id)).toEqual([5, 7])
    expect(episodesOf(show)).toEqual([])
    expect(episodesOf(season).map((child) => child.id)).toEqual([6, 8, 9])
  })

  it('plays next the first episode not watched that has a file', () => {
    expect(nextEpisodeIn(episodesOf(season))!.id).toBe(9)
    expect(nextEpisodeIn([episodeSummary({ watched: true })])).toBeUndefined()
  })

  it("gives a season's year and how many of its episodes are on disk", () => {
    expect(seasonFacts(season)).toEqual(['2022', '3 episodes'])
    expect(seasonFacts(itemDetails({ type: ITEM_TYPES.season, year: null, children: [] }))).toEqual(
      ['0 episodes'],
    )
  })

  it('says how many are watched, and adds up a show across its seasons', () => {
    expect(watchedCountLabel({ watched: 1, total: 3 })).toBe('1 of 3 watched')
    expect(episodesWatched(episodesOf(season))).toEqual({ watched: 1, total: 3 })
    expect(
      seasonsWatched([
        seasonSummary({ episodeCount: 9, watchedCount: 9 }),
        seasonSummary({ episodeCount: 8, watchedCount: 2 }),
      ]),
    ).toEqual({ watched: 11, total: 17 })
  })

  it("gives an episode row's air date and length, the file's own over TMDB's", () => {
    expect(
      episodeRowFacts(
        episodeSummary({
          released: '2022-02-18',
          runtime: 54,
          primary: mediaItem({ duration: 3300 }),
        }),
      ),
    ).toEqual([formatAirDate('2022-02-18')!, '55m'])
    expect(episodeRowFacts(episodeSummary({ released: null, runtime: 54, primary: null }))).toEqual(
      ['54m'],
    )
  })
})

describe('episodeStillUrl', () => {
  const api = createApiClient({
    fetch: async () => {
      throw new Error('no request is made for a picture address')
    },
  })

  it("uses the episode's still, else a frame of its file, else nothing", () => {
    expect(episodeStillUrl({ api, episode: episodeSummary({ id: 6, stillVersion: 's1' }) })).toBe(
      '/api/pictures/items/6/still/s1',
    )
    expect(
      episodeStillUrl({
        api,
        episode: episodeSummary({ stillVersion: null, primary: mediaItem({ id: 12 }) }),
      }),
    ).toBe('/api/media/12/thumbnail?v=1')
    expect(
      episodeStillUrl({
        api,
        episode: episodeSummary({
          stillVersion: null,
          primary: mediaItem({ thumbnail: THUMBNAIL_STATES.pending }),
        }),
      }),
    ).toBeNull()
    expect(
      episodeStillUrl({ api, episode: episodeSummary({ stillVersion: null, primary: null }) }),
    ).toBeNull()
  })
})
