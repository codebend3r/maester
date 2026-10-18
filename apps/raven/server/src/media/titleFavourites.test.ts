import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { FAVOURITE_OUTCOMES } from '@/media/favouriteOutcomes'
import { MediaIndex } from '@/media/mediaIndex'
import { TitleFavourites } from '@/media/titleFavourites'
import { localEpisode, localSeason } from '@/metadata/localItems'
import type { FetchedItem } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

const showNamed = ({ tmdbId, title }: { tmdbId: string; title: string }): FetchedItem => ({
  ...localSeason({ showTmdbId: tmdbId, number: 1 }),
  type: 'show',
  tmdbId,
  number: null,
  title,
})

describe('favourite shows and seasons', () => {
  const database = testDatabase('raven-title-favourites-')
  const state = { open: 0, season: 0, episode: 0, hidden: 0 }
  const favourites = () => {
    const { metadata } = repositories(database.get())
    return new TitleFavourites(database.get(), metadata, new LibrariesRepository(database.get()))
  }

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    const open = libraries.create({ name: 'TV', paths: ['/tv'], settings: { kind: 'shows' } }).id
    const locked = libraries.create({
      name: 'Private TV',
      paths: ['/private'],
      settings: { kind: 'shows', locked: true },
    }).id
    const { metadata } = repositories(database.get())
    const index = new MediaIndex(database.get())
    const shelve = ({
      libraryId,
      tmdbId,
      title,
    }: {
      libraryId: number
      tmdbId: string
      title: string
    }) => {
      const showId = metadata.save({ item: showNamed({ tmdbId, title }) })
      const season = metadata.saveSeason({
        showId,
        number: 1,
        season: localSeason({ showTmdbId: tmdbId, number: 1 }),
        episodes: [localEpisode({ showTmdbId: tmdbId, season: 1, number: 1, title: 'Pilot' })],
      })
      const root = libraryId === open ? '/tv' : '/private'
      const mediaId = index.insert({
        libraryId,
        kind: 'shows',
        file: { path: `${root}/${title}/S01E01.mkv`, root, size: 1, mtimeMs: 1 },
      })
      const episode = season.episodes.get(1) ?? -1
      metadata.link({ mediaIds: [mediaId], itemIds: [episode] })
      return { showId, seasonId: season.id, episode }
    }
    const andor = shelve({ libraryId: open, tmdbId: '700', title: 'Andor' })
    const hidden = shelve({ libraryId: locked, tmdbId: '701', title: 'Hidden' })
    state.open = andor.showId
    state.season = andor.seasonId
    state.episode = andor.episode
    state.hidden = hidden.showId
  })
  afterAll(() => database.close())

  it('marks and unmarks a show or season, newest first', () => {
    expect(favourites().favouriteOf(state.open)).toBe(false)
    expect(favourites().set({ itemId: state.open, favourite: true })).toBe(FAVOURITE_OUTCOMES.done)
    expect(favourites().set({ itemId: state.season, favourite: true })).toBe(
      FAVOURITE_OUTCOMES.done,
    )
    expect(favourites().favouriteOf(state.open)).toBe(true)
    expect(
      favourites()
        .list()
        .map((item) => item.id),
    ).toEqual([state.season, state.open])
    expect(favourites().set({ itemId: state.season, favourite: false })).toBe(
      FAVOURITE_OUTCOMES.done,
    )
    expect(
      favourites()
        .list()
        .map((item) => item.id),
    ).toEqual([state.open])
  })

  it('leaves an episode to its files, and says so of an id that names nothing', () => {
    expect(favourites().favouriteOf(state.episode)).toBeNull()
    expect(favourites().set({ itemId: state.episode, favourite: true })).toBe(
      FAVOURITE_OUTCOMES.missing,
    )
    expect(favourites().set({ itemId: 999_999, favourite: true })).toBe(FAVOURITE_OUTCOMES.missing)
  })

  it('never marks or lists a show only a locked library holds, but unmarks one', () => {
    expect(favourites().favouriteOf(state.hidden)).toBeNull()
    expect(favourites().set({ itemId: state.hidden, favourite: true })).toBe(
      FAVOURITE_OUTCOMES.locked,
    )
    database
      .get()
      .db.prepare('INSERT INTO item_favourites (item_id, added_at) VALUES (?, ?)')
      .run(state.hidden, new Date().toISOString())
    expect(
      favourites()
        .list()
        .map((item) => item.id),
    ).not.toContain(state.hidden)
    expect(favourites().set({ itemId: state.hidden, favourite: false })).toBe(
      FAVOURITE_OUTCOMES.done,
    )
  })
})
