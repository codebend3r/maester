import type { ItemType, MediaSort } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaRepository } from '@/media/mediaRepository'
import { ViewingRepository } from '@/media/viewingRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'
import type { FetchedItem } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'

type Seed = {
  name: string
  size: number
  addedAt: string
  probe: { bitrate: number; width: number; height: number } | null
}

const VIDEOS: readonly Seed[] = [
  {
    name: 'Alpha',
    size: 300,
    addedAt: '2026-01-03T00:00:00.000Z',
    probe: { bitrate: 5_000_000, width: 1920, height: 1080 },
  },
  {
    name: 'Bravo',
    size: 100,
    addedAt: '2026-01-01T00:00:00.000Z',
    probe: { bitrate: 9_000_000, width: 3840, height: 2160 },
  },
  { name: 'Charlie', size: 200, addedAt: '2026-01-02T00:00:00.000Z', probe: null },
  {
    name: 'Delta',
    size: 400,
    addedAt: '2026-01-04T00:00:00.000Z',
    probe: { bitrate: 1_000_000, width: 1280, height: 720 },
  },
]

const PROBE = {
  duration: 60,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  videoBitDepth: 8,
  hdr: false,
  audioCodec: 'aac',
  audioChannels: 2,
  bitrate: 5_000_000,
}

const TRACKS = { audio: [], subtitles: [], defaultAudio: null, frameRate: 24 }

describe('listing a library', () => {
  const database = testDatabase('raven-sort-')
  const state = { libraryId: 0 }
  const media = () => new MediaRepository(database.get(), new MetadataRepository(database.get()))
  const titles = ({ sort, seed }: { sort: MediaSort; seed?: number }): string[] =>
    media()
      .list({ libraryId: state.libraryId, sort, seed })
      .map((item) => item.title)

  beforeAll(async () => {
    await database.open()
    const index = new MediaIndex(database.get())
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Test',
      paths: ['/m'],
    }).id
    VIDEOS.forEach((video) => {
      const id = index.insert({
        libraryId: state.libraryId,
        kind: 'other',
        file: { path: `/m/${video.name}.mp4`, root: '/m', size: video.size, mtimeMs: 1 },
      })
      database.get().db.prepare('UPDATE media SET added_at = ? WHERE id = ?').run(video.addedAt, id)
      if (video.probe) index.saveProbe({ id, probe: { ...PROBE, ...video.probe }, tracks: TRACKS })
    })
  })

  afterAll(database.close)

  it.each<[MediaSort, string[]]>([
    ['title', ['Alpha', 'Bravo', 'Charlie', 'Delta']],
    ['title-desc', ['Delta', 'Charlie', 'Bravo', 'Alpha']],
    ['added', ['Delta', 'Alpha', 'Charlie', 'Bravo']],
    ['oldest', ['Bravo', 'Charlie', 'Alpha', 'Delta']],
    ['largest', ['Delta', 'Alpha', 'Charlie', 'Bravo']],
    ['smallest', ['Bravo', 'Charlie', 'Alpha', 'Delta']],
    ['bitrate-high', ['Bravo', 'Alpha', 'Delta', 'Charlie']],
    ['bitrate-low', ['Delta', 'Alpha', 'Bravo', 'Charlie']],
    ['resolution-high', ['Bravo', 'Alpha', 'Delta', 'Charlie']],
    ['resolution-low', ['Delta', 'Alpha', 'Bravo', 'Charlie']],
  ])('sorts by %s', (sort, expected) => {
    expect(titles({ sort })).toEqual(expected)
  })

  it('deals the same random order for the same seed', () => {
    const first = titles({ sort: 'random', seed: 7 })
    expect(first.toSorted()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    expect(titles({ sort: 'random', seed: 7 })).toEqual(first)
  })

  it('deals different orders for different seeds', () => {
    const orders = [1, 2, 3, 4, 5, 6].map((seed) => titles({ sort: 'random', seed }).join())
    expect(new Set(orders).size).toBeGreaterThan(1)
  })

  it('stops at the limit, in sort order', () => {
    expect(
      media()
        .list({ libraryId: state.libraryId, sort: 'added', limit: 2 })
        .map((item) => item.title),
    ).toEqual(['Delta', 'Alpha'])
  })

  it('deals a random order before it stops at the limit', () => {
    const dealt = titles({ sort: 'random', seed: 7 })
    expect(
      media()
        .list({ libraryId: state.libraryId, sort: 'random', seed: 7, limit: 2 })
        .map((item) => item.title),
    ).toEqual(dealt.slice(0, 2))
  })

  it('reads several videos at once, in the order asked, leaving out ones that are gone', () => {
    const [alpha, bravo] = media().list({ libraryId: state.libraryId, sort: 'title' })
    const ids = [bravo?.id ?? -1, 999_999, alpha?.id ?? -1]
    expect(
      media()
        .getMany(ids)
        .map((item) => item.title),
    ).toEqual(['Bravo', 'Alpha'])
    expect(media().get(999_999)).toBeNull()
  })

  it('never hands back a path', () => {
    expect(
      media()
        .list({ libraryId: state.libraryId })
        .every((item) => !('path' in item)),
    ).toBe(true)
  })
})

const fetched = ({
  type,
  tmdbId,
  title,
  number = null,
}: {
  type: ItemType
  tmdbId: string
  title: string
  number?: number | null
}): FetchedItem => ({
  type,
  tmdbId,
  number,
  title,
  originalTitle: null,
  year: null,
  released: null,
  ended: null,
  summary: null,
  tagline: null,
  contentRating: null,
  runtime: null,
  studio: null,
  genres: [],
  imdbId: null,
  tvdbId: null,
  images: { poster: null, backdrop: null, still: null },
  credits: [],
  rating: null,
  reviews: [],
})

describe("listing a TV library's shows", () => {
  const database = testDatabase('raven-shows-')
  const state = { libraryId: 0, aired: 0, special: 0, ids: new Map<string, number>() }
  const media = () => new MediaRepository(database.get(), new MetadataRepository(database.get()))
  const fileName = (id: number | undefined): string =>
    id == null ? 'none' : (media().get(id)?.fileName ?? 'gone')

  /** A show with an episode file for each `[season, episode]`. */
  const addShow = ({
    title,
    episodes,
  }: {
    title: string
    episodes: ReadonlyArray<[number, number]>
  }): number => {
    const metadata = new MetadataRepository(database.get())
    const index = new MediaIndex(database.get())
    const showId = metadata.save({ item: fetched({ type: 'show', tmdbId: title, title }) })
    episodes.forEach(([season, episode]) => {
      const seasonId = metadata.save({
        item: fetched({ type: 'season', tmdbId: `${title}-${season}`, title, number: season }),
        parentId: showId,
      })
      const episodeId = metadata.save({
        item: fetched({
          type: 'episode',
          tmdbId: `${title}-${season}-${episode}`,
          title: `Episode ${episode}`,
          number: episode,
        }),
        parentId: seasonId,
      })
      const name = `${title} - S0${season}E0${episode}.mkv`
      const id = index.insert({
        libraryId: state.libraryId,
        kind: 'shows',
        file: { path: `/tv/${name}`, root: '/tv', size: 100, mtimeMs: 1 },
      })
      index.saveProbe({ id, probe: PROBE, tracks: TRACKS })
      metadata.link({ mediaIds: [id], itemIds: [episodeId] })
      state.ids.set(name, id)
    })
    return showId
  }

  beforeAll(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'TV',
      paths: ['/tv'],
      settings: { kind: 'shows' },
    }).id
    state.aired = addShow({
      title: 'Aired',
      episodes: [
        [1, 1],
        [1, 2],
      ],
    })
    state.special = addShow({
      title: 'Special',
      episodes: [
        [0, 1],
        [1, 1],
      ],
    })
    const viewing = new ViewingRepository(database.get(), media())
    viewing.report({ id: state.ids.get('Aired - S01E01.mkv') ?? -1, position: 60 })
  })

  afterAll(database.close)

  it('gives each show its own first episode not yet watched, specials last, in one go', () => {
    const shows = media().listShows({ libraryId: state.libraryId })
    expect(shows.map((entry) => [entry.show.title, entry.episodes, entry.next?.fileName])).toEqual([
      ['Aired', 2, 'Aired - S01E02.mkv'],
      ['Special', 2, 'Special - S01E01.mkv'],
    ])
  })

  it('stops at the limit', () => {
    expect(
      media()
        .listShows({ libraryId: state.libraryId, limit: 1 })
        .map((entry) => entry.show.title),
    ).toEqual(['Aired'])
  })

  it("sorts shows by their files' mean bitrate, a show with none probed last either way", () => {
    const bitrates = database
      .get()
      .db.prepare('UPDATE media SET bitrate = ? WHERE file_name LIKE ?')
    bitrates.run(9_000_000, 'Special%')
    const listed = (sort: 'bitrate-high' | 'bitrate-low') =>
      media()
        .listShows({ libraryId: state.libraryId, sort })
        .map((entry) => [entry.show.title, entry.bitrate])
    expect(listed('bitrate-high')).toEqual([
      ['Special', 9_000_000],
      ['Aired', 5_000_000],
    ])
    expect(listed('bitrate-low')).toEqual([
      ['Aired', 5_000_000],
      ['Special', 9_000_000],
    ])
    bitrates.run(null, 'Aired%')
    expect(listed('bitrate-low')).toEqual([
      ['Special', 9_000_000],
      ['Aired', null],
    ])
    bitrates.run(5_000_000, 'Aired%')
    bitrates.run(5_000_000, 'Special%')
  })

  it("answers a show's next episode on its own too", () => {
    expect(fileName(media().nextEpisode(state.aired)?.id)).toBe('Aired - S01E02.mkv')
    expect(fileName(media().nextEpisode(state.special)?.id)).toBe('Special - S01E01.mkv')
  })

  it('has none once every episode is watched', () => {
    const viewing = new ViewingRepository(database.get(), media())
    viewing.report({ id: state.ids.get('Aired - S01E02.mkv') ?? -1, position: 60 })
    expect(media().nextEpisode(state.aired)).toBeNull()
    expect(
      media()
        .listShows({ libraryId: state.libraryId })
        .find((entry) => entry.show.id === state.aired)?.next,
    ).toBeNull()
  })
})

describe('listing what is in progress', () => {
  const database = testDatabase('raven-progress-')
  const state = { libraryId: 0, ids: new Map<string, number>() }
  const media = () => new MediaRepository(database.get(), new MetadataRepository(database.get()))
  const titles = (): string[] =>
    media()
      .listInProgress()
      .map((item) => item.title)

  beforeAll(async () => {
    await database.open()
    const index = new MediaIndex(database.get())
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Test',
      paths: ['/m'],
    }).id
    ;['Alpha', 'Bravo', 'Charlie', 'Delta'].forEach((name) => {
      const id = index.insert({
        libraryId: state.libraryId,
        kind: 'other',
        file: { path: `/m/${name}.mp4`, root: '/m', size: 100, mtimeMs: 1 },
      })
      index.saveProbe({ id, probe: PROBE, tracks: TRACKS })
      state.ids.set(name, id)
    })
    const viewing = new ViewingRepository(database.get(), media())
    const watch = ({ name, position, at }: { name: string; position: number; at: string }) =>
      viewing.report({ id: state.ids.get(name) ?? -1, position, at: new Date(at) })
    watch({ name: 'Alpha', position: 30, at: '2026-01-01T00:00:00.000Z' })
    watch({ name: 'Bravo', position: 20, at: '2026-01-02T00:00:00.000Z' })
    // Finished, and barely started: neither keeps a spot.
    watch({ name: 'Charlie', position: 59, at: '2026-01-03T00:00:00.000Z' })
    watch({ name: 'Delta', position: 1, at: '2026-01-04T00:00:00.000Z' })
  })

  afterAll(database.close)

  it('lists every video with a saved spot, the most recently watched first', () => {
    expect(titles()).toEqual(['Bravo', 'Alpha'])
    expect(
      media()
        .listInProgress()
        .map((item) => item.position),
    ).toEqual([20, 30])
  })

  it('lists none from a library that saves no progress', () => {
    const libraries = new LibrariesRepository(database.get())
    libraries.update({
      id: state.libraryId,
      input: { name: 'Test', paths: ['/m'], settings: { saveProgress: false } },
    })
    expect(titles()).toEqual([])
  })
})
