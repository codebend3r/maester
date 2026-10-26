import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { type CandidateTier, TIER_SETS } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { MatchFiles } from '@/metadata/matchFiles'
import { MatchPass } from '@/metadata/matchPass'
import { MdblistClient } from '@/metadata/mdblistClient'
import { OmdbClient } from '@/metadata/omdbClient'
import { Scores } from '@/metadata/scores'
import { TmdbClient } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { fakeTmdb } from '@/test/fakeTmdb'
import { repositories } from '@/test/repositories'

const NO_IDS = { tmdb: null, imdb: null, tvdb: null }

describe('a matching pass', () => {
  const database = testDatabase('raven-match-pass-')
  const tmdb = fakeTmdb({
    movies: [
      { id: 949, title: 'Heat', released: '1995-12-15', imdbId: 'tt0113277' },
      { id: 881, title: 'A Few Good Men', released: '1992-12-11' },
      { id: 659924, title: 'Loveland', released: '2022-03-17', alternativeTitles: ['Expired'] },
      {
        id: 1109028,
        title: 'Maria Elena e o Pote de Geleia Vencido',
        released: '2023-04-11',
        alternativeTitles: ['The Expired Jam Jar'],
      },
      { id: 848247, title: 'Expiration', released: '2022-04-07' },
      { id: 50270, title: 'Paprika', released: '1991-02-13', isHiddenFromSearch: true },
      { id: 4040, title: 'Unheard Of Delights', released: '2001-05-01', isHiddenFromSearch: true },
    ],
    shows: [
      { id: 95396, title: 'Severance', first: '2022-02-18', tvdbId: '371980', seasons: {} },
      {
        id: 90660,
        title: 'Cowboy Bebop',
        first: '2021-11-19',
        genreIds: [10759, 18],
        language: 'en',
        countries: ['US'],
        seasons: {},
      },
      {
        id: 30991,
        title: 'Cowboy Bebop',
        first: '1998-04-03',
        genreIds: [16, 10759],
        language: 'ja',
        countries: ['JP'],
        seasons: {},
      },
    ],
  })
  const pass = (prefer: readonly CandidateTier[] = TIER_SETS.any): MatchPass => {
    const config = { ...readServerConfig({}), tmdbApiToken: 'test-token' }
    const { metadata } = repositories(database.get())
    return new MatchPass({
      tmdb: new TmdbClient(config, tmdb.fetch),
      metadata,
      files: new MatchFiles(database.get(), metadata),
      scores: new Scores(
        metadata,
        new OmdbClient(config, tmdb.fetch),
        new MdblistClient(config, tmdb.fetch),
      ),
      logger: new Logger('MatchPassTest'),
      prefer,
    })
  }
  const searches = (): string[] => tmdb.state.calls.filter((url) => url.includes('/search/'))

  beforeAll(database.open)
  afterAll(database.close)

  it('leaves files unmatched, asking TMDB nothing, when a Fix match says they are none', async () => {
    const before = tmdb.state.calls.length
    await expect(
      pass().resolve({
        type: 'movie',
        fix: { kind: 'not-a-match' },
        ids: { ...NO_IDS, tmdb: '949' },
        nfoPath: null,
        titles: [{ title: 'Heat', year: 1995 }],
      }),
    ).resolves.toEqual({ kind: 'unmatched' })
    expect(tmdb.state.calls).toHaveLength(before)
  })

  it('takes a Fix match as manual, fetching the movie once', async () => {
    const resolved = await pass().resolve({
      type: 'movie',
      fix: { kind: 'tmdb', tmdbId: '949' },
      ids: NO_IDS,
      nfoPath: null,
      titles: [{ title: 'Something Else', year: null }],
    })
    expect(resolved).toMatchObject({ kind: 'matched', tmdbId: '949', match: 'manual' })
    expect(searches()).toEqual([])
  })

  it('takes the id a name gives without a search, and the one in an NFO next', async () => {
    const fromName = await pass().resolve({
      type: 'movie',
      fix: { kind: 'none' },
      ids: { ...NO_IDS, tmdb: '881' },
      nfoPath: null,
      titles: [{ title: 'Nothing Like It', year: null }],
    })
    expect(fromName).toMatchObject({ kind: 'matched', tmdbId: '881', match: 'matched' })
    const nfo = join(database.dir(), 'movie.nfo')
    await writeFile(nfo, '<movie><uniqueid type="tmdb">949</uniqueid></movie>')
    const fromNfo = await pass().resolve({
      type: 'movie',
      fix: { kind: 'none' },
      ids: NO_IDS,
      nfoPath: nfo,
      titles: [{ title: 'Nothing Like It', year: null }],
    })
    expect(fromNfo).toMatchObject({ kind: 'matched', tmdbId: '949' })
    expect(searches()).toEqual([])
  })

  it('searches each title in turn, once a pass, and takes the first sure answer', async () => {
    const one = pass()
    const ask = () =>
      one.resolve({
        type: 'show',
        fix: { kind: 'none' },
        ids: NO_IDS,
        nfoPath: null,
        titles: [
          { title: 'Severence', year: null },
          { title: 'Severance', year: null },
        ],
      })
    await expect(ask()).resolves.toMatchObject({ kind: 'matched', tmdbId: '95396' })
    const asked = searches().length
    await expect(ask()).resolves.toMatchObject({ kind: 'matched', tmdbId: '95396' })
    expect(searches()).toHaveLength(asked)
  })

  it('takes a film by a title TMDB knows it by abroad before trying the next title', async () => {
    const resolved = await pass().resolve({
      type: 'movie',
      fix: { kind: 'none' },
      ids: NO_IDS,
      nfoPath: null,
      titles: [
        { title: 'Expired', year: 2022 },
        { title: 'Expiration', year: 2022 },
      ],
    })
    expect(resolved).toMatchObject({ kind: 'matched', tmdbId: '659924' })
    expect(tmdb.state.calls.some((url) => url.includes('/movie/659924/alternative_titles'))).toBe(
      true,
    )
    expect(searches().some((url) => url.includes('query=Expiration'))).toBe(false)
  })

  it('searches with adult titles for a film TMDB leaves out, taking only its own title', async () => {
    type AskProps = { title: string; year: number }

    const ask = ({ title, year }: AskProps) =>
      pass().resolve({
        type: 'movie',
        fix: { kind: 'none' },
        ids: NO_IDS,
        nfoPath: null,
        titles: [{ title, year }],
      })
    await expect(ask({ title: 'Paprika', year: 1991 })).resolves.toMatchObject({
      kind: 'matched',
      tmdbId: '50270',
    })
    expect(
      searches().some((url) => url.includes('query=Paprika') && url.includes('include_adult=true')),
    ).toBe(true)
    await expect(ask({ title: 'Unheard Of', year: 2001 })).resolves.toEqual({ kind: 'unmatched' })
  })

  it('leaves files unmatched when nothing is found, or TMDB has no such id', async () => {
    await expect(
      pass().resolve({
        type: 'movie',
        fix: { kind: 'none' },
        ids: NO_IDS,
        nfoPath: null,
        titles: [{ title: 'Unheard Of', year: 2001 }],
      }),
    ).resolves.toEqual({ kind: 'unmatched' })
    await expect(
      pass().resolve({
        type: 'movie',
        fix: { kind: 'tmdb', tmdbId: '424242' },
        ids: NO_IDS,
        nfoPath: null,
        titles: [],
      }),
    ).resolves.toEqual({ kind: 'unmatched' })
  })

  it('stops every task after TMDB goes away, and lets a task fail on its own', async () => {
    const one = pass()
    const failed = { ran: 0 }
    await one.guard.run(async () => {
      throw new Error('one file went wrong')
    })
    expect(one.guard.isStopped).toBe(false)
    tmdb.state.down = true
    await one.guard.run(() =>
      one.resolve({
        type: 'movie',
        fix: { kind: 'none' },
        ids: NO_IDS,
        nfoPath: null,
        titles: [{ title: 'Ronin', year: 1998 }],
      }),
    )
    tmdb.state.down = false
    expect(one.guard.isStopped).toBe(true)
    await one.guard.run(async () => {
      failed.ran += 1
    })
    expect(failed.ran).toBe(0)
  })

  // Kept after the tests that expect the shared fake to have seen no search, as this one searches.
  it("prefers the results its library's type does, from the same search", async () => {
    const asked = searches().length
    const ask = (prefer: readonly CandidateTier[]) =>
      pass(prefer).resolve({
        type: 'show',
        fix: { kind: 'none' },
        ids: NO_IDS,
        nfoPath: null,
        titles: [{ title: 'Cowboy Bebop', year: null }],
      })
    await expect(ask(TIER_SETS.anime)).resolves.toMatchObject({
      kind: 'matched',
      tmdbId: '30991',
    })
    await expect(ask(TIER_SETS.any)).resolves.toMatchObject({ kind: 'matched', tmdbId: '90660' })
    expect(searches()).toHaveLength(asked + 2)
  })

  it('takes a sure AI pick only when a search finds nothing, and never over a Fix match', async () => {
    const ask = (overrides: Partial<Parameters<MatchPass['resolve']>[0]>) =>
      pass().resolve({
        type: 'show',
        fix: { kind: 'none' },
        ids: NO_IDS,
        nfoPath: null,
        titles: [{ title: 'Severance', year: null }],
        decided: '30991',
        ...overrides,
      })
    await expect(ask({})).resolves.toMatchObject({ kind: 'matched', tmdbId: '95396' })
    await expect(
      ask({ titles: [{ title: 'Nothing Like It', year: null }] }),
    ).resolves.toMatchObject({
      kind: 'matched',
      tmdbId: '30991',
      match: 'matched',
    })
    await expect(ask({ fix: { kind: 'not-a-match' } })).resolves.toEqual({ kind: 'unmatched' })
    await expect(ask({ fix: { kind: 'tmdb', tmdbId: '90660' } })).resolves.toMatchObject({
      tmdbId: '90660',
      match: 'manual',
    })
  })
})

describe('looking up the other titles of a show', () => {
  const database = testDatabase('raven-match-pass-aliases-')
  type ShowProps = {
    id: number
    title: string
    alternativeTitles?: string[]
  }

  const show = ({ id, title, alternativeTitles = [] }: ShowProps) => ({
    id,
    title,
    first: '1970-01-01',
    alternativeTitles,
    seasons: {},
  })
  // TMDB lists the show Archie is known by in Britain sixth, after five
  // shows with Archie somewhere in their names.
  const tmdb = fakeTmdb({
    movies: [],
    shows: [
      show({ id: 23560, title: 'Educating Archie' }),
      show({ id: 329191, title: 'Afterlife with Archie' }),
      show({ id: 3747, title: "Archie's Weird Mysteries" }),
      show({ id: 22010, title: 'The Archie Comedy Hour' }),
      show({ id: 4277, title: "Archie Bunker's Place" }),
      show({
        id: 207759,
        title: 'Archie: The Man Who Became Cary Grant',
        alternativeTitles: ['Archie'],
      }),
    ],
  })

  beforeAll(database.open)
  afterAll(database.close)

  it('looks first at the results whose titles start with the name, so a sixth result is not missed', async () => {
    const config = { ...readServerConfig({}), tmdbApiToken: 'test-token' }
    const { metadata } = repositories(database.get())
    const pass = new MatchPass({
      tmdb: new TmdbClient(config, tmdb.fetch),
      metadata,
      files: new MatchFiles(database.get(), metadata),
      scores: new Scores(
        metadata,
        new OmdbClient(config, tmdb.fetch),
        new MdblistClient(config, tmdb.fetch),
      ),
      logger: new Logger('MatchPassTest'),
      prefer: TIER_SETS.any,
    })
    const resolved = await pass.resolve({
      type: 'show',
      fix: { kind: 'none' },
      ids: NO_IDS,
      nfoPath: null,
      titles: [{ title: 'Archie', year: null }],
    })
    expect(resolved).toMatchObject({ kind: 'matched', tmdbId: '207759', match: 'matched' })
  })
})

describe('looking up the other titles of a show known only by an alternative', () => {
  const database = testDatabase('raven-match-pass-alias-only-')
  type ShowProps = {
    id: number
    title: string
    alternativeTitles?: string[]
  }

  const show = ({ id, title, alternativeTitles = [] }: ShowProps) => ({
    id,
    title,
    first: '1970-01-01',
    alternativeTitles,
    seasons: {},
  })
  // TMDB finds Loveland by its alternative title "Expired", but lists it after
  // five shows with Expired mid-title.
  const tmdb = fakeTmdb({
    movies: [],
    shows: [
      show({ id: 1, title: 'The Expired Files' }),
      show({ id: 2, title: 'Not Expired Yet' }),
      show({ id: 3, title: 'Expired Dreams of Spring' }),
      show({ id: 4, title: 'Long Expired' }),
      show({ id: 5, title: 'Fully Expired Goods' }),
      show({ id: 6, title: 'Loveland', alternativeTitles: ['Expired'] }),
    ],
  })

  beforeAll(database.open)
  afterAll(database.close)

  it('looks at a result that does not contain the name before those that hold it mid-title', async () => {
    const config = { ...readServerConfig({}), tmdbApiToken: 'test-token' }
    const { metadata } = repositories(database.get())
    const pass = new MatchPass({
      tmdb: new TmdbClient(config, tmdb.fetch),
      metadata,
      files: new MatchFiles(database.get(), metadata),
      scores: new Scores(
        metadata,
        new OmdbClient(config, tmdb.fetch),
        new MdblistClient(config, tmdb.fetch),
      ),
      logger: new Logger('MatchPassTest'),
      prefer: TIER_SETS.any,
    })
    const resolved = await pass.resolve({
      type: 'show',
      fix: { kind: 'none' },
      ids: NO_IDS,
      nfoPath: null,
      titles: [{ title: 'Expired', year: null }],
    })
    expect(resolved).toMatchObject({ kind: 'matched', tmdbId: '6', match: 'matched' })
  })
})
