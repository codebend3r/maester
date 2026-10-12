import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { LOCAL, localEpisode, localSeason } from '@/metadata/localItems'
import { MatchFiles } from '@/metadata/matchFiles'
import type { FetchedItem } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

const show: FetchedItem = {
  ...localSeason({ showTmdbId: '1', number: 1 }),
  type: 'show',
  tmdbId: '500',
  number: null,
  title: 'Slow Horses',
  credits: [
    { tmdbId: '9001', name: 'Gary Oldman', photo: null, job: 'cast', role: 'Jackson Lamb' },
  ],
}

const episode = (number: number): FetchedItem => ({
  ...localEpisode({ showTmdbId: '500', season: 1, number, title: null }),
  tmdbId: `500-1-${number}`,
})

describe('the metadata store', () => {
  const database = testDatabase('raven-metadata-repository-')
  const metadata = () => repositories(database.get()).metadata
  const state = { libraryId: 0, mediaId: 0, showId: 0, seasonId: 0 }

  beforeAll(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Shows',
      paths: ['/tv'],
      settings: { kind: 'shows' },
    }).id
    state.mediaId = new MediaIndex(database.get()).insert({
      libraryId: state.libraryId,
      kind: 'shows',
      file: {
        path: '/tv/Slow Horses/Season 01/Slow Horses S01 Recap.mkv',
        root: '/tv',
        size: 1,
        mtimeMs: 1,
      },
    })
    state.showId = metadata().save({ item: show })
  })

  afterAll(database.close)

  it('stores a season and its episodes together, and answers with every episode by number', () => {
    const stored = metadata()
    const madeUp = stored.saveSeason({
      showId: state.showId,
      number: 1,
      season: localSeason({ showTmdbId: '500', number: 1 }),
      episodes: [],
    })
    const extra = stored.save({
      item: localEpisode({ showTmdbId: '500', season: 1, number: 9, title: 'Made up' }),
      parentId: madeUp.id,
    })
    const saved = stored.saveSeason({
      showId: state.showId,
      number: 1,
      season: localSeason({ showTmdbId: '500', number: 1 }),
      episodes: [episode(1), episode(2)],
    })
    state.seasonId = saved.id
    expect(saved.id).toBe(madeUp.id)
    expect(saved.number).toBe(1)
    expect([...saved.episodes.keys()].toSorted()).toEqual([1, 2, 9])
    expect(saved.episodes.get(9)).toBe(extra)
    expect(stored.get(saved.id)).toMatchObject({
      type: 'season',
      number: 1,
      parentId: state.showId,
    })
    expect(stored.get(state.showId)).toMatchObject({ type: 'show', number: null })
  })

  it("counts a file linked to a season as the show's, everywhere a file under an item counts", () => {
    const stored = metadata()
    stored.link({ mediaIds: [state.mediaId], itemIds: [state.seasonId] })
    expect(stored.mediaUnder(state.showId)).toEqual([state.mediaId])
    expect(stored.librariesHolding(state.showId)).toEqual([state.libraryId])
    expect(stored.childrenOnDisk(state.showId).map((child) => child.id)).toEqual([state.seasonId])
    expect(stored.itemsUnder(state.showId)).toContain(state.seasonId)
    const personId = stored.credits(state.showId)[0]?.personId ?? -1
    expect(stored.person(personId)?.credits.map((credit) => credit.item.id)).toEqual([state.showId])
  })

  it('keeps a Fix match by place: none, not one at all, or a TMDB id', () => {
    const stored = new MatchFiles(database.get(), metadata())
    const at = { libraryId: state.libraryId, place: 'Slow Horses' }
    expect(stored.fixMatchAt(at)).toEqual({ kind: 'none' })
    stored.saveFixMatch({ ...at, fix: { kind: 'not-a-match' } })
    expect(stored.fixMatchAt(at)).toEqual({ kind: 'not-a-match' })
    stored.saveFixMatch({ ...at, fix: { kind: 'tmdb', tmdbId: '500' } })
    expect(stored.fixMatchAt(at)).toEqual({ kind: 'tmdb', tmdbId: '500' })
  })

  it('forgets an item and puts its files back in one go', () => {
    const files = new MatchFiles(database.get(), metadata())
    files.setMatch({ ids: [state.mediaId], match: 'manual' })
    expect(files.forgetItem(state.showId)).toEqual([state.libraryId])
    expect(metadata().get(state.showId)).toBeNull()
    expect(files.byId(state.mediaId)?.match).toBe('unmatched')
    expect(metadata().mediaUnder(state.showId)).toEqual([])
  })
})

describe('the pictures that stand for an item', () => {
  const database = testDatabase('raven-poster-items-')
  const metadata = () => repositories(database.get()).metadata
  const ids = { show: 0, postered: 0, bare: 0, inPostered: 0, inBare: 0, movie: 0, plain: 0 }

  const item = ({
    type,
    tmdbId,
    number = null,
    poster = null,
    backdrop = null,
  }: {
    type: FetchedItem['type']
    tmdbId: string
    number?: number | null
    poster?: string | null
    backdrop?: string | null
  }): FetchedItem => ({
    ...show,
    type,
    tmdbId,
    number,
    title: tmdbId,
    credits: [],
    images: { poster, backdrop, still: null, logo: null },
  })

  beforeAll(async () => {
    await database.open()
    const stored = metadata()
    ids.show = stored.save({
      item: item({ type: 'show', tmdbId: '700', poster: '/show.jpg', backdrop: '/wide.jpg' }),
    })
    ids.postered = stored.save({
      item: item({ type: 'season', tmdbId: '700-1', number: 1, poster: '/one.jpg' }),
      parentId: ids.show,
    })
    ids.bare = stored.save({
      item: item({ type: 'season', tmdbId: '700-2', number: 2 }),
      parentId: ids.show,
    })
    ids.inPostered = stored.save({
      item: item({ type: 'episode', tmdbId: '700-1-1', number: 1 }),
      parentId: ids.postered,
    })
    ids.inBare = stored.save({
      item: item({ type: 'episode', tmdbId: '700-2-1', number: 1 }),
      parentId: ids.bare,
    })
    ids.movie = stored.save({
      item: item({ type: 'movie', tmdbId: '800', poster: '/movie.jpg', backdrop: '/set.jpg' }),
    })
    ids.plain = stored.save({ item: item({ type: 'movie', tmdbId: '801' }) })
  })

  afterAll(database.close)

  it("is a movie's own, an episode's season's, else its show's, and none where no poster is", () => {
    const posters = metadata().posterItems([ids.inPostered, ids.inBare, ids.movie, ids.plain])
    expect(posters.get(ids.inPostered)?.id).toBe(ids.postered)
    expect(posters.get(ids.inBare)?.id).toBe(ids.show)
    expect(posters.get(ids.movie)?.id).toBe(ids.movie)
    expect(posters.get(ids.plain)).toBeUndefined()
    expect(posters.get(ids.inPostered)?.posterVersion).not.toBeNull()
  })

  it('keeps the saga and logo of a movie, and which movies have yet to learn either', () => {
    const { images, metadata: stored } = repositories(database.get())
    const saga = { tmdbId: '119', name: 'The Lord of the Rings Collection' }
    const sagaMovie = stored.save({ item: { ...item({ type: 'movie', tmdbId: '120' }), saga } })
    stored.save({ item: item({ type: 'movie', tmdbId: `${LOCAL}121` }) })
    expect(stored.sagasOf([sagaMovie, ids.plain])).toEqual(new Map([[sagaMovie, saga]]))
    expect(stored.extrasUnchecked()).toEqual([])

    const db = database.get().db
    db.prepare("UPDATE items SET saga_checked = 0 WHERE tmdb_id IN ('800', '120')").run()
    db.prepare("UPDATE items SET logo_checked = 0 WHERE type = 'movie' AND tmdb_id <> '800'").run()
    // A movie raven made up is never asked about, whatever it has yet to learn.
    expect(stored.extrasUnchecked().map((movie) => movie.tmdbId)).toEqual(['800', '801', '120'])
    stored.saveMovieExtras({ itemId: ids.plain, saga: null, logo: null })
    stored.saveMovieExtras({ itemId: sagaMovie, saga, logo: '/rings.png' })
    expect(stored.extrasUnchecked().map((movie) => movie.tmdbId)).toEqual(['800'])
    expect(stored.sagasOf([sagaMovie]).get(sagaMovie)).toEqual(saga)
    expect(images.imageFrom({ itemId: sagaMovie, kind: 'logo', source: 'tmdb' })).toBe('/rings.png')
    expect(images.image({ itemId: ids.plain, kind: 'logo' })).toBeNull()
  })

  it("is a movie's own backdrop, an episode's show's, and none where no backdrop is", () => {
    const { images } = repositories(database.get())
    const backdropOf = (id: number) => images.backdropFor(id)?.id
    expect(backdropOf(ids.inPostered)).toBe(ids.show)
    expect(backdropOf(ids.bare)).toBe(ids.show)
    expect(backdropOf(ids.movie)).toBe(ids.movie)
    expect(images.backdropFor(ids.plain)).toBeNull()
  })
})
