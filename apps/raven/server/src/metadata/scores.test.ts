import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ExternalScore, ScoreProvider, ScoreSource } from '@/metadata/scoreSources'
import { Scores } from '@/metadata/scores'
import { BLANK_ITEM } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

type Answer = ExternalScore[] | 'unknown' | Error

/** A score source that answers `answer` while `enabled`, counting down `remaining` with each call. */
const fakeSource = ({
  provider,
  answer,
  enabled = true,
  remaining = 10,
}: {
  provider: ScoreProvider
  answer: Answer
  enabled?: boolean
  remaining?: number
}) => {
  const state = { enabled, remaining, answer }
  const lookUp = vi.fn<ScoreSource['lookUp']>(async () => {
    state.remaining -= 1
    if (state.answer instanceof Error) throw state.answer
    return state.answer
  })
  const source: ScoreSource = {
    provider,
    enabled: () => state.enabled && state.remaining > 0,
    remaining: () => state.remaining,
    state: () => 'ok',
    lookUp,
  }
  return { source, lookUp }
}

const rottenTomatoes = (value: number): ExternalScore => ({
  source: 'rottenTomatoes',
  value,
  votes: null,
})

describe('asking for scores', () => {
  const database = testDatabase('raven-scores-fetch-')
  const metadata = () => repositories(database.get()).metadata
  const scores = ({ omdb, mdblist }: { omdb: ScoreSource; mdblist: ScoreSource }) =>
    new Scores(metadata(), omdb, mdblist)
  const movie = (tmdbId: string) => ({
    itemId: metadata().save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId, number: null, title: tmdbId, imdbId: 'tt1' },
    }),
    type: 'movie' as const,
    tmdbId,
    imdbId: 'tt1',
  })
  const rows = (itemId: number) =>
    database
      .get()
      .db.prepare<[number], { source: string; value: number; provider: string }>(
        `SELECT source, value, provider FROM ratings
          WHERE item_id = ? AND source <> 'tmdb' ORDER BY source`,
      )
      .all(itemId)
  const stamps = (itemId: number) =>
    database
      .get()
      .db.prepare<[number], { omdb: string | null; mdblist: string | null }>(
        'SELECT omdb_fetched_at AS omdb, mdblist_fetched_at AS mdblist FROM items WHERE id = ?',
      )
      .get(itemId)

  beforeAll(() => database.open())
  afterAll(database.close)

  it('takes what MDBList answers, and does not ask OMDb', async () => {
    const mdblist = fakeSource({ provider: 'mdblist', answer: [rottenTomatoes(9.1)] })
    const omdb = fakeSource({ provider: 'omdb', answer: [rottenTomatoes(5)] })
    const title = movie('1')
    const asking = scores({ omdb: omdb.source, mdblist: mdblist.source })

    expect(asking.primary()).toBe(mdblist.source)
    await expect(asking.fetch(title)).resolves.toBe(true)
    expect(mdblist.lookUp).toHaveBeenCalledWith({ type: 'movie', tmdbId: '1', imdbId: 'tt1' })
    expect(omdb.lookUp).not.toHaveBeenCalled()
    expect(rows(title.itemId)).toEqual([
      { source: 'rottenTomatoes', value: 9.1, provider: 'mdblist' },
    ])
  })

  it('asks OMDb for a title MDBList does not know', async () => {
    const mdblist = fakeSource({ provider: 'mdblist', answer: 'unknown' })
    const omdb = fakeSource({ provider: 'omdb', answer: [rottenTomatoes(5)] })
    const title = movie('2')

    await expect(scores({ omdb: omdb.source, mdblist: mdblist.source }).fetch(title)).resolves.toBe(
      true,
    )
    expect(omdb.lookUp).toHaveBeenCalledOnce()
    expect(rows(title.itemId)).toEqual([{ source: 'rottenTomatoes', value: 5, provider: 'omdb' }])
    expect(stamps(title.itemId)).toEqual({ omdb: expect.any(String), mdblist: expect.any(String) })
  })

  it('still answers when MDBList does not know a title and OMDb fails', async () => {
    const mdblist = fakeSource({ provider: 'mdblist', answer: 'unknown' })
    const omdb = fakeSource({ provider: 'omdb', answer: new Error('OMDb could not be reached.') })
    const title = movie('3')

    await expect(scores({ omdb: omdb.source, mdblist: mdblist.source }).fetch(title)).resolves.toBe(
      true,
    )
    expect(stamps(title.itemId)).toEqual({ omdb: null, mdblist: expect.any(String) })
  })

  it('asks OMDb first when MDBList is off or refused', async () => {
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: [rottenTomatoes(9.1)],
      enabled: false,
    })
    const omdb = fakeSource({ provider: 'omdb', answer: [rottenTomatoes(5)] })
    const title = movie('4')
    const asking = scores({ omdb: omdb.source, mdblist: mdblist.source })

    expect(asking.primary()).toBe(omdb.source)
    await expect(asking.fetch(title)).resolves.toBe(true)
    expect(mdblist.lookUp).not.toHaveBeenCalled()
    expect(rows(title.itemId)).toEqual([{ source: 'rottenTomatoes', value: 5, provider: 'omdb' }])
  })

  it('asks no one when both are spent', async () => {
    const mdblist = fakeSource({ provider: 'mdblist', answer: [], remaining: 0 })
    const omdb = fakeSource({ provider: 'omdb', answer: [], remaining: 0 })
    const asking = scores({ omdb: omdb.source, mdblist: mdblist.source })

    expect(asking.primary()).toBeNull()
    await expect(asking.fetch(movie('5'))).resolves.toBe(false)
    expect(mdblist.lookUp).not.toHaveBeenCalled()
    expect(omdb.lookUp).not.toHaveBeenCalled()
  })

  it('answers false when MDBList fails, and does not ask OMDb in its place', async () => {
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: new Error('MDBList could not be reached.'),
    })
    const omdb = fakeSource({ provider: 'omdb', answer: [rottenTomatoes(5)] })
    const title = movie('6')

    await expect(scores({ omdb: omdb.source, mdblist: mdblist.source }).fetch(title)).resolves.toBe(
      false,
    )
    expect(omdb.lookUp).not.toHaveBeenCalled()
    expect(stamps(title.itemId)).toEqual({ omdb: null, mdblist: null })
  })

  it("fills what is due from the primary source, as far as today's calls go", async () => {
    database.get().db.prepare('DELETE FROM items').run()
    const titles = ['7', '8', '9'].map(movie)
    const mdblist = fakeSource({ provider: 'mdblist', answer: [rottenTomatoes(9.1)], remaining: 2 })
    const omdb = fakeSource({ provider: 'omdb', answer: [rottenTomatoes(5)] })

    await scores({ omdb: omdb.source, mdblist: mdblist.source }).fillDue()
    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    expect(omdb.lookUp).not.toHaveBeenCalled()
    expect(titles.map((title) => stamps(title.itemId)?.mdblist != null)).toEqual([
      true,
      true,
      false,
    ])
  })
})
