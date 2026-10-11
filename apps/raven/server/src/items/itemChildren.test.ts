import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { itemChildren } from '@/items/itemChildren'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import type { Viewer } from '@/lock/lockService'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaRepository } from '@/media/mediaRepository'
import { ViewingRepository } from '@/media/viewingRepository'
import { localEpisode, localSeason } from '@/metadata/localItems'
import { MetadataRepository } from '@/metadata/metadataRepository'
import type { FetchedItem } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'

const show: FetchedItem = {
  ...localSeason({ showTmdbId: '1', number: 1 }),
  type: 'show',
  tmdbId: '700',
  number: null,
  title: 'Andor',
}

/** A browser that sees every library but `hidden`, and an item when a library it sees holds it. */
const viewerHiding = ({
  hidden,
  metadata,
}: {
  hidden: number
  metadata: MetadataRepository
}): Viewer => {
  const seesLibrary = (libraryId: number): boolean => libraryId !== hidden
  const seesItem = (itemId: number): boolean => {
    const holding = metadata.librariesHolding(itemId)
    return holding.length === 0 || holding.some(seesLibrary)
  }
  return { seesLibrary, seesItem, sees: () => true }
}

describe("a page's children", () => {
  const database = testDatabase('raven-item-children-')
  const state = { open: 0, locked: 0, showId: 0, seasons: [0, 0], files: new Map<string, number>() }
  const repositories = () => {
    const metadata = new MetadataRepository(database.get())
    return { metadata, media: new MediaRepository(database.get(), metadata) }
  }

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    state.open = libraries.create({ name: 'TV', paths: ['/tv'], settings: { kind: 'shows' } }).id
    state.locked = libraries.create({
      name: 'Private TV',
      paths: ['/private'],
      settings: { kind: 'shows', locked: true },
    }).id
    const { metadata } = repositories()
    const index = new MediaIndex(database.get())
    const file = ({ libraryId, path }: { libraryId: number; path: string }) => {
      const root = libraryId === state.open ? '/tv' : '/private'
      const id = index.insert({
        libraryId,
        kind: 'shows',
        file: { path: `${root}/${path}`, root, size: 1, mtimeMs: 1 },
      })
      state.files.set(path, id)
      return id
    }
    state.showId = metadata.save({ item: show })
    const seasonOne = metadata.saveSeason({
      showId: state.showId,
      number: 1,
      season: localSeason({ showTmdbId: '700', number: 1 }),
      episodes: [1, 2, 3].map((number) => ({
        ...localEpisode({ showTmdbId: '700', season: 1, number, title: `Episode ${number}` }),
        tmdbId: `700-1-${number}`,
        summary: `What happens in ${number}.`,
        released: `2022-09-0${number}`,
        runtime: 40 + number,
      })),
    })
    const seasonTwo = metadata.saveSeason({
      showId: state.showId,
      number: 2,
      season: localSeason({ showTmdbId: '700', number: 2 }),
      episodes: [
        {
          ...localEpisode({ showTmdbId: '700', season: 2, number: 1, title: null }),
          tmdbId: '700-2-1',
        },
      ],
    })
    state.seasons = [seasonOne.id, seasonTwo.id]
    const episode = (season: { episodes: Map<number, number> }, number: number) =>
      season.episodes.get(number) ?? -1
    // Episode 1 is in both libraries, the open copy watched part way; episode 2 only in the
    // locked one; episode 3 has no file. Season 2's only episode sits in the locked library.
    metadata.link({
      mediaIds: [file({ libraryId: state.open, path: 'Andor/S01E01.mkv' })],
      itemIds: [episode(seasonOne, 1)],
    })
    metadata.link({
      mediaIds: [file({ libraryId: state.locked, path: 'Andor/S01E01 2160p.mkv' })],
      itemIds: [episode(seasonOne, 1)],
    })
    metadata.link({
      mediaIds: [file({ libraryId: state.locked, path: 'Andor/S01E02.mkv' })],
      itemIds: [episode(seasonOne, 2)],
    })
    metadata.link({
      mediaIds: [file({ libraryId: state.locked, path: 'Andor/S02E01.mkv' })],
      itemIds: [episode(seasonTwo, 1)],
    })
    new ViewingRepository(database.get(), new MediaRepository(database.get(), metadata)).report({
      id: state.files.get('Andor/S01E01.mkv') ?? -1,
      position: 300,
      at: new Date(),
    })
  })

  afterAll(database.close)

  it('counts only the episodes on disk this browser may see, and leaves out a season it may not', () => {
    const { metadata, media } = repositories()
    const everything = itemChildren({
      parentId: state.showId,
      viewer: viewerHiding({ hidden: -1, metadata }),
      metadata,
      media,
    })
    expect(
      everything.map((child) => (child.type === 'season' ? child.episodeCount : null)),
    ).toEqual([2, 1])
    const locked = itemChildren({
      parentId: state.showId,
      viewer: viewerHiding({ hidden: state.locked, metadata }),
      metadata,
      media,
    })
    expect(locked.map((child) => child.id)).toEqual([state.seasons[0]])
    expect(locked.map((child) => (child.type === 'season' ? child.episodeCount : null))).toEqual([
      1,
    ])
  })

  it('gives each episode its row and the file Play starts, from what this browser may see', () => {
    const { metadata, media } = repositories()
    const [seasonOne = -1] = state.seasons
    const rows = itemChildren({
      parentId: seasonOne,
      viewer: viewerHiding({ hidden: -1, metadata }),
      metadata,
      media,
    }).flatMap((child) => (child.type === 'episode' ? [child] : []))
    expect(rows.map((row) => [row.episode, row.summary, row.released, row.runtime])).toEqual([
      [1, 'What happens in 1.', '2022-09-01', 41],
      [2, 'What happens in 2.', '2022-09-02', 42],
    ])
    // The copy with a saved spot wins, as on the episode's own page.
    expect(rows[0]?.primary?.id).toBe(state.files.get('Andor/S01E01.mkv'))
    expect(rows[1]?.primary?.id).toBe(state.files.get('Andor/S01E02.mkv'))

    const hidden = itemChildren({
      parentId: seasonOne,
      viewer: viewerHiding({ hidden: state.open, metadata }),
      metadata,
      media,
    }).flatMap((child) => (child.type === 'episode' ? [child] : []))
    expect(hidden.map((row) => row.primary?.id ?? null)).toEqual([
      state.files.get('Andor/S01E01 2160p.mkv'),
      state.files.get('Andor/S01E02.mkv'),
    ])
  })
})
