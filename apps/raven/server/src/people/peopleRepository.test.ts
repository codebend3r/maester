import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BLANK_ITEM, type FetchedPerson, type FetchedPersonCredit } from '@/metadata/tmdbClient'
import { PeopleRepository } from '@/people/peopleRepository'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

const credit = (
  fields: Pick<FetchedPersonCredit, 'creditId' | 'type' | 'tmdbId' | 'title' | 'position'> &
    Partial<FetchedPersonCredit>,
): FetchedPersonCredit => ({
  released: null,
  poster: null,
  genreIds: [],
  department: 'Acting',
  role: null,
  episodes: null,
  ...fields,
})

const KEANU: FetchedPerson = {
  tmdbId: '6384',
  name: 'Keanu Charles Reeves',
  photo: '/keanu-new.jpg',
  imdbId: 'nm0000206',
  birthday: '1964-09-02',
  deathday: null,
  placeOfBirth: 'Beirut, Lebanon',
  biography: 'An actor.',
  knownFor: 'Acting',
  credits: [
    credit({
      creditId: 'c1',
      type: 'movie',
      tmdbId: '603',
      title: 'The Matrix',
      released: '1999-03-31',
      poster: '/matrix.jpg',
      genreIds: [28, 878],
      role: 'Neo',
      position: 0,
    }),
    credit({
      creditId: 'c2',
      type: 'show',
      tmdbId: '603',
      title: 'A Show With The Same Id',
      role: 'Self',
      genreIds: [10767],
      episodes: 3,
      position: 1,
    }),
    credit({
      creditId: 'c3',
      type: 'movie',
      tmdbId: '245891',
      title: 'John Wick',
      department: 'Production',
      role: 'Executive Producer',
      position: 2,
    }),
  ],
}

describe("the people store's filmographies", () => {
  const database = testDatabase('raven-people-repository-')
  const people = () => new PeopleRepository(database.get())
  const state = { personId: 0, matrixId: 0 }

  beforeAll(async () => {
    await database.open()
    const { metadata } = repositories(database.get())
    state.matrixId = metadata.save({
      item: {
        ...BLANK_ITEM,
        type: 'movie',
        tmdbId: '603',
        number: null,
        title: 'The Matrix',
        credits: [{ tmdbId: '6384', name: 'Keanu Reeves', photo: null, job: 'cast', role: 'Neo' }],
      },
    })
    state.personId = metadata.credits(state.matrixId)[0]!.personId
  })

  afterAll(database.close)

  it('has no profile until a filmography is fetched, and nothing for no one', () => {
    expect(people().profile(state.personId)).toEqual({
      tmdbId: '6384',
      profile: null,
      fetchedAt: null,
    })
    expect(people().filmographyRows(state.personId)).toEqual([])
    expect(people().profile(99_999)).toBeNull()
  })

  it("keeps what TMDB says of a person, and their credits in TMDB's order with raven's items", () => {
    people().saveFilmography({
      personId: state.personId,
      person: KEANU,
      at: '2026-10-17T12:00:00.000Z',
    })
    expect(people().profile(state.personId)).toEqual({
      tmdbId: '6384',
      fetchedAt: '2026-10-17T12:00:00.000Z',
      profile: {
        imdbId: 'nm0000206',
        birthday: '1964-09-02',
        deathday: null,
        placeOfBirth: 'Beirut, Lebanon',
        biography: 'An actor.',
        knownFor: 'Acting',
      },
    })
    expect(repositories(database.get()).metadata.person(state.personId)).toMatchObject({
      name: 'Keanu Charles Reeves',
    })
    expect(repositories(database.get()).metadata.photo(state.personId)).toBe('/keanu-new.jpg')
    expect(people().filmographyRows(state.personId)).toEqual([
      {
        type: 'movie',
        tmdbId: '603',
        title: 'The Matrix',
        released: '1999-03-31',
        poster: '/matrix.jpg',
        genreIds: [28, 878],
        department: 'Acting',
        role: 'Neo',
        episodes: null,
        itemId: state.matrixId,
      },
      expect.objectContaining({ type: 'show', tmdbId: '603', genreIds: [10767], itemId: null }),
      expect.objectContaining({ title: 'John Wick', role: 'Executive Producer', itemId: null }),
    ])
  })

  it('replaces the credits it had with those of the next fetch', () => {
    people().saveFilmography({
      personId: state.personId,
      person: { ...KEANU, credits: [{ ...KEANU.credits[2]!, position: 0 }] },
      at: '2026-11-01T12:00:00.000Z',
    })
    expect(
      people()
        .filmographyRows(state.personId)
        .map((row) => row.title),
    ).toEqual(['John Wick'])
    expect(people().profile(state.personId)?.fetchedAt).toBe('2026-11-01T12:00:00.000Z')
  })

  it('stores nothing for a person cleared up while TMDB was answering', () => {
    people().saveFilmography({ personId: 99_999, person: KEANU, at: '2026-10-17T12:00:00.000Z' })
    expect(people().filmographyRows(99_999)).toEqual([])
  })
})
