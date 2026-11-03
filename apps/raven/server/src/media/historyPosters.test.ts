import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { withShowPosters } from '@/media/historyPosters'
import { MediaIndex } from '@/media/mediaIndex'
import { BLANK_ITEM, type FetchedItem } from '@/metadata/tmdbShapes'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

type ItemProps = Pick<FetchedItem, 'type' | 'tmdbId'> & {
  number?: number | null
  poster?: string | null
}

const fetched = ({ type, tmdbId, number = null, poster = null }: ItemProps): FetchedItem => ({
  ...BLANK_ITEM,
  type,
  tmdbId,
  number,
  title: tmdbId,
  images: { poster, backdrop: null, still: null, logo: null },
})

describe('the poster a played video stands under', () => {
  const database = testDatabase('raven-history-posters-')
  const state = { libraryId: 0, showId: 0, seasonId: 0, episodeId: 0, mediaIds: [0] }

  type AddFileProps = { name: string; itemId: number | null }

  const addFile = ({ name, itemId }: AddFileProps): number => {
    const id = new MediaIndex(database.get()).insert({
      libraryId: state.libraryId,
      kind: 'shows',
      file: { path: `/tv/${name}`, root: '/tv', size: 100, mtimeMs: 1 },
    })
    if (itemId != null)
      repositories(database.get()).metadata.link({ mediaIds: [id], itemIds: [itemId] })
    return id
  }

  beforeAll(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'TV',
      paths: ['/tv'],
      settings: { kind: 'shows' },
    }).id
    const { metadata } = repositories(database.get())
    state.showId = metadata.save({
      item: fetched({ type: 'show', tmdbId: '700', poster: '/show.jpg' }),
    })
    state.seasonId = metadata.save({
      item: fetched({ type: 'season', tmdbId: '700-1', number: 1, poster: '/season.jpg' }),
      parentId: state.showId,
    })
    state.episodeId = metadata.save({
      item: fetched({ type: 'episode', tmdbId: '700-1-1', number: 1 }),
      parentId: state.seasonId,
    })
    state.mediaIds = [
      addFile({ name: 'Show - S01E01.mkv', itemId: state.episodeId }),
      addFile({ name: 'Loose.mkv', itemId: null }),
    ]
  })

  afterAll(database.close)

  it("is an episode's show's, past its season's own, and none for a file matched to nothing", () => {
    const { media, metadata } = repositories(database.get())
    const entries = media
      .getMany({ ids: state.mediaIds, account: TEST_ACCOUNTS.a })
      .map((item) => ({
        media: item,
        lastPlayedAt: '2026-11-03T00:00:00.000Z',
        plays: 1,
        furthest: 60,
        watched: true,
        marked: false,
      }))
    const posters = withShowPosters({ entries, libraryId: state.libraryId, metadata })
    expect(posters.map(({ media: item, poster }) => [item.fileName, poster?.id ?? null])).toEqual([
      ['Show - S01E01.mkv', state.showId],
      ['Loose.mkv', null],
    ])
    expect(posters[0]?.poster?.posterVersion).not.toBeNull()
  })
})
