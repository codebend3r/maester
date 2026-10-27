import { type ItemType, MEDIA_SORTS, type MediaSort, SHUFFLE_LENGTH } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import type { Viewer } from '@/lock/lockService'
import { MediaIndex } from '@/media/mediaIndex'
import { ViewingRepository } from '@/media/viewingRepository'
import { WatchedCards } from '@/media/watchedCards'
import { WatchedRepository } from '@/media/watchedRepository'
import { BLANK_ITEM, type FetchedItem, type FetchedSaga } from '@/metadata/tmdbShapes'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

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
  const media = () => repositories(database.get()).media
  type TitlesProps = { sort: MediaSort; seed?: number }

  const titles = ({ sort, seed }: TitlesProps): string[] =>
    media()
      .list({ libraryId: state.libraryId, sort, seed, account: TEST_ACCOUNTS.a })
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
        .list({
          libraryId: state.libraryId,
          sort: MEDIA_SORTS.added,
          limit: 2,
          account: TEST_ACCOUNTS.a,
        })
        .map((item) => item.title),
    ).toEqual(['Delta', 'Alpha'])
  })

  it('deals a random order before it stops at the limit', () => {
    const dealt = titles({ sort: 'random', seed: 7 })
    expect(
      media()
        .list({
          libraryId: state.libraryId,
          sort: MEDIA_SORTS.random,
          seed: 7,
          limit: 2,
          account: TEST_ACCOUNTS.a,
        })
        .map((item) => item.title),
    ).toEqual(dealt.slice(0, 2))
  })

  it('reads several videos at once, in the order asked, leaving out ones that are gone', () => {
    const [alpha, bravo] = media().list({
      libraryId: state.libraryId,
      sort: MEDIA_SORTS.title,
      account: TEST_ACCOUNTS.a,
    })
    const ids = [bravo?.id ?? -1, 999_999, alpha?.id ?? -1]
    expect(
      media()
        .getMany({ ids, account: TEST_ACCOUNTS.a })
        .map((item) => item.title),
    ).toEqual(['Bravo', 'Alpha'])
    expect(media().get({ id: 999_999, account: TEST_ACCOUNTS.a })).toBeNull()
  })

  it('never hands back a path', () => {
    expect(
      media()
        .list({ libraryId: state.libraryId, account: TEST_ACCOUNTS.a })
        .every((item) => !('path' in item)),
    ).toBe(true)
  })
})

type FetchedProps = {
  type: ItemType
  tmdbId: string
  title: string
  number?: number | null
}

const fetched = ({ type, tmdbId, title, number = null }: FetchedProps): FetchedItem => ({
  ...BLANK_ITEM,
  type,
  tmdbId,
  number,
  title,
})

describe("listing a TV library's shows", () => {
  const database = testDatabase('raven-shows-')
  const state = { libraryId: 0, aired: 0, special: 0, ids: new Map<string, number>() }
  const media = () => repositories(database.get()).media
  const fileName = (id: number | null): string =>
    id == null ? 'none' : (media().get({ id, account: TEST_ACCOUNTS.a })?.fileName ?? 'gone')

  type AddShowProps = {
    title: string
    episodes: ReadonlyArray<[number, number]>
  }

  /** A show with an episode file for each `[season, episode]`. */
  const addShow = ({ title, episodes }: AddShowProps): number => {
    const { metadata } = repositories(database.get())
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
    viewing.report({
      id: state.ids.get('Aired - S01E01.mkv') ?? -1,
      position: 60,
      account: TEST_ACCOUNTS.a,
    })
  })

  afterAll(database.close)

  it('gives each show its own first episode not yet watched, specials last, in one go', () => {
    const shows = media().listShows({ libraryId: state.libraryId, account: TEST_ACCOUNTS.a })
    expect(shows.map((entry) => [entry.show.title, entry.episodes, entry.next?.fileName])).toEqual([
      ['Aired', 2, 'Aired - S01E02.mkv'],
      ['Special', 2, 'Special - S01E01.mkv'],
    ])
  })

  it('stops at the limit', () => {
    expect(
      media()
        .listShows({ libraryId: state.libraryId, limit: 1, account: TEST_ACCOUNTS.a })
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
        .listShows({ libraryId: state.libraryId, sort, account: TEST_ACCOUNTS.a })
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
    expect(
      fileName(
        media().nextEpisode({
          showId: state.aired,
          libraryIds: [state.libraryId],
          account: TEST_ACCOUNTS.a,
        })?.id ?? null,
      ),
    ).toBe('Aired - S01E02.mkv')
    expect(
      fileName(
        media().nextEpisode({
          showId: state.special,
          libraryIds: [state.libraryId],
          account: TEST_ACCOUNTS.a,
        })?.id ?? null,
      ),
    ).toBe('Special - S01E01.mkv')
  })

  it('deals every episode of a show, watched or not, as the die falls', () => {
    const libraryIds = [state.libraryId]
    const deal = (roll: number) =>
      media()
        .shuffledEpisodes({
          itemId: state.aired,
          libraryIds,
          roll: () => roll,
          account: TEST_ACCOUNTS.a,
        })
        .map((item) => fileName(item.id))
    expect(deal(0.999)).toEqual(['Aired - S01E01.mkv', 'Aired - S01E02.mkv'])
    expect(deal(0)).toEqual(['Aired - S01E02.mkv', 'Aired - S01E01.mkv'])
  })

  it('deals from one season alone when asked for the season', () => {
    const seasonId =
      database
        .get()
        .db.prepare<[number], { id: number }>(
          "SELECT id FROM items WHERE parent_id = ? AND type = 'season' AND number = 1",
        )
        .get(state.special)?.id ?? -1
    const libraryIds = [state.libraryId]
    const deal = (roll: number) =>
      media()
        .shuffledEpisodes({
          itemId: seasonId,
          libraryIds,
          roll: () => roll,
          account: TEST_ACCOUNTS.a,
        })
        .map((item) => fileName(item.id))
    expect(deal(0)).toEqual(['Special - S01E01.mkv'])
    expect(deal(0.999)).toEqual(['Special - S01E01.mkv'])
  })

  it('deals no episode outside the libraries asked about, nor under an episode', () => {
    const episodeId =
      database
        .get()
        .db.prepare<[], { id: number }>("SELECT id FROM items WHERE type = 'episode' LIMIT 1")
        .get()?.id ?? -1
    expect(
      media().shuffledEpisodes({ itemId: state.aired, libraryIds: [], account: TEST_ACCOUNTS.a }),
    ).toEqual([])
    expect(
      media().shuffledEpisodes({
        itemId: episodeId,
        libraryIds: [state.libraryId],
        account: TEST_ACCOUNTS.a,
      }),
    ).toEqual([])
  })

  it('has none once every episode is watched', () => {
    const viewing = new ViewingRepository(database.get(), media())
    viewing.report({
      id: state.ids.get('Aired - S01E02.mkv') ?? -1,
      position: 60,
      account: TEST_ACCOUNTS.a,
    })
    expect(
      media().nextEpisode({
        showId: state.aired,
        libraryIds: [state.libraryId],
        account: TEST_ACCOUNTS.a,
      }),
    ).toBeNull()
    expect(
      media()
        .listShows({ libraryId: state.libraryId, account: TEST_ACCOUNTS.a })
        .find((entry) => entry.show.id === state.aired)?.next,
    ).toBeNull()
  })
})

describe('listing what is in progress', () => {
  const database = testDatabase('raven-progress-')
  const state = { libraryId: 0, ids: new Map<string, number>() }
  const media = () => repositories(database.get()).media
  const titles = (): string[] =>
    media()
      .listInProgress({ account: TEST_ACCOUNTS.a })
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
    type WatchProps = { name: string; position: number; at: string }

    const watch = ({ name, position, at }: WatchProps) =>
      viewing.report({
        id: state.ids.get(name) ?? -1,
        position,
        at: new Date(at),
        account: TEST_ACCOUNTS.a,
      })
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
        .listInProgress({ account: TEST_ACCOUNTS.a })
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

const EVERYONE: Viewer = {
  listsLibrary: () => true,
  seesLibrary: () => true,
  seesItem: () => true,
  sees: () => true,
}

describe('what is watched, card by card', () => {
  const database = testDatabase('raven-watched-lists-')
  const state = { libraryId: 0, otherId: 0 }
  const media = () => repositories(database.get()).media
  const viewing = () => new ViewingRepository(database.get(), media())
  const index = () => new MediaIndex(database.get())

  type AddFileProps = {
    libraryId: number
    name: string
    height?: number
  }

  const addFile = ({ libraryId, name, height = 1080 }: AddFileProps): number => {
    const id = index().insert({
      libraryId,
      kind: 'other',
      file: { path: `/${libraryId}/${name}.mkv`, root: `/${libraryId}`, size: 100, mtimeMs: 1 },
    })
    index().saveProbe({
      id,
      probe: { ...PROBE, width: (height * 16) / 9, height },
      tracks: TRACKS,
    })
    return id
  }
  type AddMovieProps = {
    title: string
    heights: readonly number[]
    libraryId?: number
    saga?: FetchedSaga | null
  }

  /** A movie with a file for each height, best first once listed. */
  const addMovie = ({
    title,
    heights,
    libraryId = state.libraryId,
    saga = null,
  }: AddMovieProps): { itemId: number; ids: number[] } => {
    const { metadata } = repositories(database.get())
    const itemId = metadata.save({
      item: { ...fetched({ type: 'movie', tmdbId: title, title }), saga },
    })
    const ids = heights.map((height) => addFile({ libraryId, name: `${title} ${height}p`, height }))
    metadata.link({ mediaIds: ids, itemIds: [itemId] })
    return { itemId, ids }
  }
  type AddShowProps = {
    title: string
    count: number
  }

  /** A show whose episodes are numbered 1 to `count`; `shared` is one file holding episodes 1 and 2. */
  const addShow = ({ title, count }: AddShowProps): { showId: number; episodeIds: number[] } => {
    const { metadata } = repositories(database.get())
    const showId = metadata.save({ item: fetched({ type: 'show', tmdbId: title, title }) })
    const seasonId = metadata.save({
      item: fetched({ type: 'season', tmdbId: `${title}-1`, title, number: 1 }),
      parentId: showId,
    })
    const episodeIds = Array.from({ length: count }, (_, at) =>
      metadata.save({
        item: fetched({
          type: 'episode',
          tmdbId: `${title}-1-${at + 1}`,
          title: `Episode ${at + 1}`,
          number: at + 1,
        }),
        parentId: seasonId,
      }),
    )
    return { showId, episodeIds }
  }
  type FilesOfProps = {
    episodeId: number
    libraryId?: number
    heights: readonly number[]
  }

  const filesOf = ({ episodeId, libraryId = state.libraryId, heights }: FilesOfProps): number[] => {
    const ids = heights.map((height) =>
      addFile({ libraryId, name: `episode ${episodeId} ${height}p`, height }),
    )
    repositories(database.get()).metadata.link({ mediaIds: ids, itemIds: [episodeId] })
    return ids
  }
  const finish = (id: number): void => {
    viewing().report({ id, position: 60, account: TEST_ACCOUNTS.a })
  }
  type MarkProps = { id: number; watched: boolean }

  const mark = ({ id, watched }: MarkProps): void => {
    new WatchedRepository(database.get()).set({
      cards: new WatchedCards(database.get(), repositories(database.get()).metadata).resolve({
        targets: [{ kind: 'media', id }],
        viewer: EVERYONE,
      }),
      watched,
      at: new Date(),
      account: TEST_ACCOUNTS.a,
    })
  }
  const watchedOf = (title: string): boolean | undefined =>
    media()
      .list({ libraryId: state.libraryId, account: TEST_ACCOUNTS.a })
      .find((item) => item.title.startsWith(title))?.watched

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    state.libraryId = libraries.create({ name: 'Mixed', paths: ['/1'] }).id
    state.otherId = libraries.create({ name: 'Other', paths: ['/2'] }).id
  })

  afterAll(database.close)

  it('watches a movie’s whole card when any one of its files is', () => {
    const { ids } = addMovie({ title: 'Heat', heights: [1080, 720] })
    addMovie({ title: 'Ronin', heights: [1080] })
    expect(watchedOf('Heat')).toBe(false)
    finish(ids[1] ?? -1)
    expect(watchedOf('Heat')).toBe(true)
    expect(watchedOf('Ronin')).toBe(false)
    expect(
      media()
        .getMany({ ids, account: TEST_ACCOUNTS.a })
        .map((item) => item.watched),
    ).toEqual([true, true])
  })

  it('keeps a split card apart from the files that share the movie', () => {
    const { ids } = addMovie({ title: 'Alexander', heights: [1080, 720] })
    database
      .get()
      .db.prepare("UPDATE media SET split = 'cut:Final Cut' WHERE id = ?")
      .run(ids[1] ?? -1)
    finish(ids[1] ?? -1)
    const [theatrical, finalCut] = media().getMany({ ids, account: TEST_ACCOUNTS.a })
    expect([theatrical?.watched, finalCut?.watched]).toEqual([false, true])
  })

  it('shows a file watched and started again as both', () => {
    const { ids } = addMovie({ title: 'Collateral', heights: [1080] })
    const id = ids[0] ?? -1
    mark({ id, watched: true })
    viewing().report({
      id,
      position: 20,
      at: new Date(Date.now() + 3_600_000),
      account: TEST_ACCOUNTS.a,
    })
    expect(
      media()
        .listInProgress({ account: TEST_ACCOUNTS.a })
        .find((item) => item.id === id),
    ).toMatchObject({
      watched: true,
      position: 20,
    })
  })

  it('carries the flag on a saga’s movies', () => {
    const saga = { tmdbId: '9001', name: 'The Heist Collection' }
    const [first, second] = ['Ocean’s 11', 'Ocean’s 12'].map(
      (title) => addMovie({ title, heights: [1080], saga }).ids[0] ?? -1,
    )
    finish(second ?? -1)
    const movies = media()
      .listSagas({ libraryId: state.libraryId, account: TEST_ACCOUNTS.a })
      .flatMap((each) => each.media)
    expect(movies.map((item) => [item.id, item.watched])).toEqual(
      expect.arrayContaining([
        [first, false],
        [second, true],
      ]),
    )
  })

  it('counts a show’s watched episodes once, a two-episode file watching both', () => {
    const { showId, episodeIds } = addShow({ title: 'Doubled', count: 3 })
    const shared = filesOf({ episodeId: episodeIds[0] ?? -1, heights: [1080] })
    repositories(database.get()).metadata.link({
      mediaIds: shared,
      itemIds: [episodeIds[0] ?? -1, episodeIds[1] ?? -1],
    })
    filesOf({ episodeId: episodeIds[2] ?? -1, heights: [1080] })
    const entry = () =>
      media()
        .listShows({ libraryId: state.libraryId, account: TEST_ACCOUNTS.a })
        .find((each) => each.show.id === showId)
    expect(entry()).toMatchObject({ episodes: 3, watchedEpisodes: 0 })
    finish(shared[0] ?? -1)
    expect(entry()).toMatchObject({ episodes: 3, watchedEpisodes: 2 })
    expect(entry()?.next?.item?.id).toBe(episodeIds[2])
  })

  it('skips an episode watched in any one of its files when picking the next', () => {
    const { showId, episodeIds } = addShow({ title: 'Versions', count: 2 })
    const first = filesOf({ episodeId: episodeIds[0] ?? -1, heights: [1080, 720] })
    const second = filesOf({ episodeId: episodeIds[1] ?? -1, heights: [1080] })
    const libraryIds = [state.libraryId]
    const next = () =>
      media().nextEpisode({ showId, libraryIds, account: TEST_ACCOUNTS.a })?.id ?? null
    expect(next()).toBe(first[0])
    finish(first[1] ?? -1)
    expect(next()).toBe(second[0])
  })

  it('deals each episode once, playing its best file', () => {
    const { showId, episodeIds } = addShow({ title: 'Dice', count: 2 })
    const first = filesOf({ episodeId: episodeIds[0] ?? -1, heights: [720, 1080] })
    const second = filesOf({ episodeId: episodeIds[1] ?? -1, heights: [1080] })
    const libraryIds = [state.libraryId]
    const deal = (roll: number) =>
      media()
        .shuffledEpisodes({
          itemId: showId,
          libraryIds,
          roll: () => roll,
          account: TEST_ACCOUNTS.a,
        })
        .map((item) => item.id)
    expect(deal(0.999)).toEqual([first[1], second[0]])
    expect(deal(0)).toEqual([second[0], first[1]])
  })

  it('deals no more than a shuffle lines up', () => {
    const { showId, episodeIds } = addShow({ title: 'Long', count: SHUFFLE_LENGTH + 1 })
    episodeIds.forEach((episodeId) => filesOf({ episodeId, heights: [1080] }))
    expect(
      media().shuffledEpisodes({
        itemId: showId,
        libraryIds: [state.libraryId],
        account: TEST_ACCOUNTS.a,
      }),
    ).toHaveLength(SHUFFLE_LENGTH)
  })

  it('judges the next episode by the libraries it is asked about alone', () => {
    const { showId, episodeIds } = addShow({ title: 'Everywhere', count: 2 })
    const here = filesOf({ episodeId: episodeIds[0] ?? -1, heights: [1080] })
    const there = filesOf({
      episodeId: episodeIds[0] ?? -1,
      libraryId: state.otherId,
      heights: [1080],
    })
    filesOf({ episodeId: episodeIds[1] ?? -1, heights: [1080] })
    finish(there[0] ?? -1)
    expect(
      media().nextEpisode({ showId, libraryIds: [state.libraryId], account: TEST_ACCOUNTS.a })
        ?.id ?? null,
    ).toBe(here[0])
    expect(
      media().nextEpisode({
        showId,
        libraryIds: [state.libraryId, state.otherId],
        account: TEST_ACCOUNTS.a,
      })?.item?.episode ?? null,
    ).toBe(2)
  })

  it('answers which episodes are watched, and where', () => {
    const { episodeIds } = addShow({ title: 'Where', count: 2 })
    const there = filesOf({
      episodeId: episodeIds[0] ?? -1,
      libraryId: state.otherId,
      heights: [1080],
    })
    filesOf({ episodeId: episodeIds[1] ?? -1, heights: [1080] })
    finish(there[0] ?? -1)
    expect(media().watchedEpisodes({ ids: episodeIds, account: TEST_ACCOUNTS.a })).toEqual([
      { episodeId: episodeIds[0], libraryId: state.otherId },
    ])
    expect(media().watchedEpisodes({ ids: [], account: TEST_ACCOUNTS.a })).toEqual([])
  })
})
