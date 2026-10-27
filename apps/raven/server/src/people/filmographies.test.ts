import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TmdbError } from '@/metadata/tmdbClient'
import { BLANK_ITEM, type FetchedPerson } from '@/metadata/tmdbShapes'
import {
  DEADLINE_MS,
  FAILURE_MEMORY_MS,
  FRESH_DAYS,
  Filmographies,
  MOST_WAITING,
} from '@/people/filmographies'
import { testDatabase } from '@/test/database'
import { peopleRepositoryOf, repositories } from '@/test/repositories'

const DAY_MS = 24 * 60 * 60 * 1000

const PERSON: FetchedPerson = {
  tmdbId: '6384',
  name: 'Keanu Reeves',
  photo: '/keanu.jpg',
  imdbId: 'nm0000206',
  birthday: '1964-09-02',
  deathday: null,
  placeOfBirth: 'Beirut, Lebanon',
  biography: 'An actor.',
  knownFor: 'Acting',
  credits: [
    {
      creditId: 'keanu-matrix',
      type: 'movie',
      tmdbId: '603',
      title: 'The Matrix',
      released: '1999-03-31',
      poster: '/matrix.jpg',
      genreIds: [28, 878],
      department: 'Acting',
      role: 'Neo',
      episodes: null,
      position: 0,
    },
  ],
}

/** TMDB as `Filmographies` sees it: on or off, failing or not, and held when a test says. */
const stubTmdb = () => {
  const state: { enabled: boolean; calls: number; error: Error | null; until: Promise<void> } = {
    enabled: true,
    calls: 0,
    error: null,
    until: Promise.resolve(),
  }
  const client = {
    get enabled(): boolean {
      return state.enabled
    },
    person: async (tmdbId: string): Promise<FetchedPerson> => {
      state.calls += 1
      await state.until
      if (state.error) throw state.error
      return { ...PERSON, tmdbId }
    },
  }
  /** Keeps every call waiting until the function it answers with is called. */
  const hold = (): (() => void) => {
    const gate = { open: () => {} }
    state.until = new Promise((resolve) => {
      gate.open = resolve
    })
    return () => gate.open()
  }
  return { client, state, hold }
}

describe("a person's filmography from TMDB", () => {
  const database = testDatabase('raven-filmographies-')
  const people = () => peopleRepositoryOf(database.get())
  const counter = { next: 0 }

  /** A person with one credit, as matching leaves them, whose filmography is yet to be fetched. */
  const newPerson = (): number => {
    counter.next += 1
    const { metadata } = repositories(database.get())
    const itemId = metadata.save({
      item: {
        ...BLANK_ITEM,
        type: 'movie',
        tmdbId: `${900 + counter.next}`,
        number: null,
        title: 'A Film',
        credits: [
          {
            tmdbId: `${100 + counter.next}`,
            name: 'Someone',
            photo: null,
            job: 'cast',
            role: 'Lead',
          },
        ],
      },
    })
    return metadata.credits(itemId)[0]!.personId
  }

  const setUp = () => {
    const tmdb = stubTmdb()
    const filmographies = new Filmographies(
      tmdb.client,
      people(),
      repositories(database.get()).metadata,
    )
    /** What a page would say of the filmography. */
    const stateOf = (personId: number) =>
      filmographies.read({ personId, sees: () => true, localCredits: [] }).state
    return { tmdb, filmographies, stateOf, personId: newPerson() }
  }

  beforeAll(database.open)
  afterAll(database.close)
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is ready once fetched, with what TMDB says of them, and not asked again while fresh', async () => {
    const { tmdb, filmographies, stateOf, personId } = setUp()
    expect(stateOf(personId)).toBe('unavailable')
    await filmographies.ensure({ personId })
    expect(stateOf(personId)).toBe('ready')
    expect(people().profile(personId)).toMatchObject({
      profile: { imdbId: 'nm0000206', birthday: '1964-09-02', knownFor: 'Acting' },
      fetchedAt: expect.any(String),
    })
    expect(filmographies.read({ personId, sees: () => true, localCredits: [] })).toMatchObject({
      state: 'ready',
      entries: [{ title: 'The Matrix', item: null }],
    })
    await filmographies.ensure({ personId })
    expect(tmdb.state.calls).toBe(1)
  })

  it('is pending while TMDB takes longer than the deadline, and ready once it answers', async () => {
    vi.useFakeTimers()
    const { tmdb, filmographies, stateOf, personId } = setUp()
    const letGo = tmdb.hold()
    const ensuring = filmographies.ensure({ personId })
    await vi.advanceTimersByTimeAsync(DEADLINE_MS)
    await ensuring
    expect(stateOf(personId)).toBe('pending')
    expect(filmographies.read({ personId, sees: () => true, localCredits: [] })).toEqual({
      state: 'pending',
    })
    letGo()
    // A page asking again waits on the same fetch.
    await filmographies.ensure({ personId })
    expect(stateOf(personId)).toBe('ready')
    expect(tmdb.state.calls).toBe(1)
  })

  it('is unavailable with TMDB off, and asks it nothing', async () => {
    const { tmdb, filmographies, stateOf, personId } = setUp()
    tmdb.state.enabled = false
    await filmographies.ensure({ personId })
    expect(stateOf(personId)).toBe('unavailable')
    expect(tmdb.state.calls).toBe(0)
  })

  it('is unavailable when TMDB fails, and asks again only once ten minutes have passed', async () => {
    vi.useFakeTimers()
    const { tmdb, filmographies, stateOf, personId } = setUp()
    tmdb.state.error = new TmdbError({ kind: 'unavailable', message: 'TMDB could not be reached.' })
    await filmographies.ensure({ personId })
    expect(stateOf(personId)).toBe('unavailable')
    vi.advanceTimersByTime(FAILURE_MEMORY_MS - 1)
    await filmographies.ensure({ personId })
    expect(tmdb.state.calls).toBe(1)
    expect(stateOf(personId)).toBe('unavailable')

    tmdb.state.error = null
    vi.advanceTimersByTime(1)
    await filmographies.ensure({ personId })
    expect(tmdb.state.calls).toBe(2)
    expect(stateOf(personId)).toBe('ready')
  })

  it('serves a stale filmography at once, and fetches it again behind it', async () => {
    vi.useFakeTimers()
    const { tmdb, filmographies, stateOf, personId } = setUp()
    await filmographies.ensure({ personId })
    const fetchedAt = people().profile(personId)?.fetchedAt
    vi.advanceTimersByTime(FRESH_DAYS * DAY_MS)
    const letGo = tmdb.hold()
    // Were it to wait for TMDB, no deadline would ever come under fake timers.
    await filmographies.ensure({ personId })
    expect(tmdb.state.calls).toBe(2)
    expect(stateOf(personId)).toBe('ready')
    expect(people().profile(personId)?.fetchedAt).toBe(fetchedAt)
    letGo()
    await vi.waitFor(() => expect(people().profile(personId)?.fetchedAt).not.toBe(fetchedAt))
    await filmographies.ensure({ personId })
    expect(tmdb.state.calls).toBe(2)
  })

  it('asks TMDB once for two views at the same time', async () => {
    const { tmdb, filmographies, stateOf, personId } = setUp()
    const letGo = tmdb.hold()
    const both = Promise.all([
      filmographies.ensure({ personId }),
      filmographies.ensure({ personId }),
    ])
    letGo()
    await both
    expect(tmdb.state.calls).toBe(1)
    expect(stateOf(personId)).toBe('ready')
  })

  it('fetches two people at once, and the next when one is done', async () => {
    vi.useFakeTimers()
    const { tmdb, filmographies, stateOf } = setUp()
    const personIds = [newPerson(), newPerson(), newPerson()]
    const letGo = tmdb.hold()
    const ensuring = Promise.all(personIds.map((personId) => filmographies.ensure({ personId })))
    await vi.advanceTimersByTimeAsync(DEADLINE_MS)
    await ensuring
    expect(tmdb.state.calls).toBe(2)
    expect(personIds.map(stateOf)).toEqual(['pending', 'pending', 'pending'])
    letGo()
    await vi.waitFor(() => expect(personIds.map(stateOf)).toEqual(['ready', 'ready', 'ready']))
    expect(tmdb.state.calls).toBe(3)
  })

  it('turns a person away as pending once twenty wait their turn, and fetches them when asked again', async () => {
    vi.useFakeTimers()
    const { tmdb, filmographies, stateOf } = setUp()
    const waiting = Array.from({ length: 2 + MOST_WAITING }, newPerson)
    const turnedAway = newPerson()
    const letGo = tmdb.hold()
    const ensuring = Promise.all(waiting.map((personId) => filmographies.ensure({ personId })))
    await vi.advanceTimersByTimeAsync(DEADLINE_MS)
    await ensuring
    expect(waiting.map(stateOf).every((state) => state === 'pending')).toBe(true)

    // It answers at once, with no deadline to wait out, and the page is told to ask again.
    const { isTurnedAway } = await filmographies.ensure({ personId: turnedAway })
    expect(isTurnedAway).toBe(true)
    expect(
      filmographies.read({ personId: turnedAway, sees: () => true, localCredits: [], isTurnedAway })
        .state,
    ).toBe('pending')
    expect(tmdb.state.calls).toBe(2)

    letGo()
    await vi.waitFor(() =>
      expect(waiting.map(stateOf).every((state) => state === 'ready')).toBe(true),
    )
    expect(await filmographies.ensure({ personId: turnedAway })).toEqual({ isTurnedAway: false })
    expect(stateOf(turnedAway)).toBe('ready')
    expect(tmdb.state.calls).toBe(3 + MOST_WAITING)
  })
})
