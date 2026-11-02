import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BINGE_LIMIT } from '@raven/core'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { BINGE_OUTCOMES } from '@/media/bingeOutcomes'
import { BingeShows } from '@/media/bingeShows'
import { MediaIndex } from '@/media/mediaIndex'
import { localEpisode, localSeason } from '@/metadata/localItems'
import type { FetchedItem } from '@/metadata/tmdbShapes'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

type ShowNamedProps = { tmdbId: string; title: string }

const showNamed = ({ tmdbId, title }: ShowNamedProps): FetchedItem => ({
  ...localSeason({ showTmdbId: tmdbId, number: 1 }),
  type: 'show',
  tmdbId,
  number: null,
  title,
})

describe('binge shows', () => {
  const database = testDatabase('raven-binge-shows-')
  const state = { open: [] as number[], hidden: 0, episode: 0 }
  const binge = () => {
    const { metadata } = repositories(database.get())
    return new BingeShows(database.get(), metadata, new LibrariesRepository(database.get()))
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
    type ShelveProps = { libraryId: number; tmdbId: string; title: string }

    const shelve = ({ libraryId, tmdbId, title }: ShelveProps) => {
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
      return { showId, episode }
    }
    const titles = ['Andor', 'Severance', 'Shogun', 'Fallout']
    state.open = titles.map(
      (title, position) => shelve({ libraryId: open, tmdbId: `${800 + position}`, title }).showId,
    )
    const hidden = shelve({ libraryId: locked, tmdbId: '899', title: 'Hidden' })
    state.hidden = hidden.showId
    state.episode = shelve({ libraryId: open, tmdbId: '898', title: 'Other' }).episode
  })
  afterAll(() => database.close())

  it('lists the newest first, and keeps one account’s list from another', () => {
    const [a, b, c] = state.open
    const account = TEST_ACCOUNTS.a
    expect(binge().set({ itemId: a ?? -1, binge: true, account })).toBe(BINGE_OUTCOMES.done)
    expect(binge().set({ itemId: b ?? -1, binge: true, account })).toBe(BINGE_OUTCOMES.done)
    expect(binge().state({ account }).ids).toEqual([b, a])
    expect(binge().state({ account: TEST_ACCOUNTS.b }).ids).toEqual([])
    expect(binge().set({ itemId: c ?? -1, binge: true, account: TEST_ACCOUNTS.b })).toBe(
      BINGE_OUTCOMES.done,
    )
    expect(binge().state({ account }).ids).toEqual([b, a])
    expect(binge().state({ account: TEST_ACCOUNTS.b }).ids).toEqual([c])
  })

  it('refuses a show past the limit, but not one already on the list', () => {
    const account = TEST_ACCOUNTS.a
    const [a, b, c, d] = state.open
    expect(BINGE_LIMIT).toBe(3)
    expect(binge().set({ itemId: c ?? -1, binge: true, account })).toBe(BINGE_OUTCOMES.done)
    expect(binge().set({ itemId: d ?? -1, binge: true, account })).toBe(BINGE_OUTCOMES.full)
    expect(binge().set({ itemId: a ?? -1, binge: true, account })).toBe(BINGE_OUTCOMES.done)
    expect(binge().state({ account }).ids).toHaveLength(3)
    expect(binge().set({ itemId: b ?? -1, binge: false, account })).toBe(BINGE_OUTCOMES.done)
    expect(binge().set({ itemId: d ?? -1, binge: true, account })).toBe(BINGE_OUTCOMES.done)
  })

  it('takes only a show a library that is not locked holds', () => {
    const account = TEST_ACCOUNTS.b
    expect(binge().set({ itemId: state.hidden, binge: true, account })).toBe(BINGE_OUTCOMES.locked)
    expect(binge().set({ itemId: state.episode, binge: true, account })).toBe(
      BINGE_OUTCOMES.missing,
    )
    expect(binge().set({ itemId: 999_999, binge: true, account })).toBe(BINGE_OUTCOMES.missing)
    expect(binge().set({ itemId: 999_999, binge: false, account })).toBe(BINGE_OUTCOMES.done)
  })

  it('remembers the tip was dismissed, per account', () => {
    const account = '30000000-0000-4000-8000-000000000003'
    expect(binge().state({ account }).hasSeenTip).toBe(false)
    binge().dismissTip({ account })
    binge().dismissTip({ account })
    expect(binge().state({ account }).hasSeenTip).toBe(true)
    expect(binge().state({ account: '30000000-0000-4000-8000-000000000004' }).hasSeenTip).toBe(
      false,
    )
  })
})
