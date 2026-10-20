import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { FAVOURITE_OUTCOMES } from '@/media/favouriteOutcomes'
import { MediaIndex } from '@/media/mediaIndex'
import { TitleFavourites } from '@/media/titleFavourites'
import { localEpisode, localSeason } from '@/metadata/localItems'
import type { FetchedItem } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

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
    expect(favourites().favouriteOf({ itemId: state.open, account: TEST_ACCOUNTS.a })).toBe(false)
    expect(
      favourites().set({ itemId: state.open, favourite: true, account: TEST_ACCOUNTS.a }),
    ).toBe(FAVOURITE_OUTCOMES.done)
    expect(
      favourites().set({ itemId: state.season, favourite: true, account: TEST_ACCOUNTS.a }),
    ).toBe(FAVOURITE_OUTCOMES.done)
    expect(favourites().favouriteOf({ itemId: state.open, account: TEST_ACCOUNTS.a })).toBe(true)
    expect(
      favourites()
        .list({ account: TEST_ACCOUNTS.a })
        .map((item) => item.id),
    ).toEqual([state.season, state.open])
    expect(
      favourites().set({ itemId: state.season, favourite: false, account: TEST_ACCOUNTS.a }),
    ).toBe(FAVOURITE_OUTCOMES.done)
    expect(
      favourites()
        .list({ account: TEST_ACCOUNTS.a })
        .map((item) => item.id),
    ).toEqual([state.open])
  })

  it('leaves an episode to its files, and says so of an id that names nothing', () => {
    expect(favourites().favouriteOf({ itemId: state.episode, account: TEST_ACCOUNTS.a })).toBeNull()
    expect(
      favourites().set({ itemId: state.episode, favourite: true, account: TEST_ACCOUNTS.a }),
    ).toBe(FAVOURITE_OUTCOMES.missing)
    expect(favourites().set({ itemId: 999_999, favourite: true, account: TEST_ACCOUNTS.a })).toBe(
      FAVOURITE_OUTCOMES.missing,
    )
  })

  it('never marks or lists a show only a locked library holds, but unmarks one', () => {
    expect(favourites().favouriteOf({ itemId: state.hidden, account: TEST_ACCOUNTS.a })).toBeNull()
    expect(
      favourites().set({ itemId: state.hidden, favourite: true, account: TEST_ACCOUNTS.a }),
    ).toBe(FAVOURITE_OUTCOMES.locked)
    database
      .get()
      .db.prepare('INSERT INTO item_favourites (account_id, item_id, added_at) VALUES (?, ?, ?)')
      .run(TEST_ACCOUNTS.a, state.hidden, new Date().toISOString())
    expect(
      favourites()
        .list({ account: TEST_ACCOUNTS.a })
        .map((item) => item.id),
    ).not.toContain(state.hidden)
    expect(
      favourites().set({ itemId: state.hidden, favourite: false, account: TEST_ACCOUNTS.a }),
    ).toBe(FAVOURITE_OUTCOMES.done)
  })

  it('keeps one account’s favourite shows and seasons from another', () => {
    favourites().set({ itemId: state.season, favourite: true, account: TEST_ACCOUNTS.a })
    expect(favourites().favouriteOf({ itemId: state.season, account: TEST_ACCOUNTS.b })).toBe(false)
    expect(favourites().list({ account: TEST_ACCOUNTS.b })).toEqual([])
    favourites().set({ itemId: state.open, favourite: true, account: TEST_ACCOUNTS.b })
    favourites().set({ itemId: state.season, favourite: false, account: TEST_ACCOUNTS.b })
    expect(
      favourites()
        .list({ account: TEST_ACCOUNTS.a })
        .map((item) => item.id),
    ).toEqual([state.season, state.open])
    expect(
      favourites()
        .list({ account: TEST_ACCOUNTS.b })
        .map((item) => item.id),
    ).toEqual([state.open])
  })
})
