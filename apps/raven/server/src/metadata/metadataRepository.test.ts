import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { LOCAL, localEpisode, localSeason } from '@/metadata/localItems'
import { MatchFiles } from '@/metadata/matchFiles'
import type { ExternalScore } from '@/metadata/scoreSources'
import { BLANK_ITEM, type FetchedItem, type FetchedPerson } from '@/metadata/tmdbClient'
import { PeopleRepository } from '@/people/peopleRepository'
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

describe('the libraries holding each item, and the people cleared up', () => {
  const database = testDatabase('raven-holding-each-')
  const metadata = () => repositories(database.get()).metadata
  const ids = { shows: 0, films: 0, show: 0, episode: 0, movie: 0, bare: 0 }

  /** A file in `libraryId` under `root`, as a scan leaves it. */
  const file = ({ libraryId, root, name }: { libraryId: number; root: string; name: string }) =>
    new MediaIndex(database.get()).insert({
      libraryId,
      kind: 'other',
      file: { path: `${root}/${name}`, root, size: 1, mtimeMs: 1 },
    })

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    ids.shows = libraries.create({ name: 'Shows', paths: ['/tv'], settings: { kind: 'shows' } }).id
    ids.films = libraries.create({
      name: 'Films',
      paths: ['/films'],
      settings: { kind: 'movies' },
    }).id
    const stored = metadata()
    ids.show = stored.save({ item: show })
    ids.episode =
      stored
        .saveSeason({
          showId: ids.show,
          number: 1,
          season: localSeason({ showTmdbId: '500', number: 1 }),
          episodes: [episode(1)],
        })
        .episodes.get(1) ?? 0
    const movie = (tmdbId: string): FetchedItem => ({
      ...BLANK_ITEM,
      type: 'movie',
      tmdbId,
      number: null,
      title: `Movie ${tmdbId}`,
    })
    ids.movie = stored.save({ item: movie('600') })
    ids.bare = stored.save({ item: movie('601') })
    stored.link({
      mediaIds: [file({ libraryId: ids.shows, root: '/tv', name: 'Slow Horses/S01E01.mkv' })],
      itemIds: [ids.episode],
    })
    stored.link({
      mediaIds: [
        file({ libraryId: ids.films, root: '/films', name: 'Movie 600.mkv' }),
        file({ libraryId: ids.shows, root: '/tv', name: 'Movie 600.mkv' }),
      ],
      itemIds: [ids.movie],
    })
  })

  afterAll(database.close)

  it("reaches a show through its episodes' files, and leaves out an item with none", () => {
    const holding = metadata().librariesHoldingEach([ids.show, ids.movie, ids.bare, ids.show])
    expect([...holding.keys()].toSorted()).toEqual([ids.show, ids.movie].toSorted())
    expect(holding.get(ids.show)).toEqual([ids.shows])
    expect(holding.get(ids.movie)?.toSorted()).toEqual([ids.shows, ids.films].toSorted())
    expect(metadata().librariesHoldingEach([]).size).toBe(0)
  })

  it("asks for the scores of a library's movies and shows, reaching a show through its episodes, and of nothing else", () => {
    const stored = metadata()
    const local = stored.save({
      item: {
        ...BLANK_ITEM,
        type: 'movie',
        tmdbId: `${LOCAL}700`,
        number: null,
        title: 'Home video',
      },
    })
    stored.link({
      mediaIds: [file({ libraryId: ids.shows, root: '/tv', name: 'Home video.mkv' })],
      itemIds: [local],
    })
    const filmsOnly = stored.save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: '701', number: null, title: 'Films only' },
    })
    stored.link({
      mediaIds: [file({ libraryId: ids.films, root: '/films', name: 'Films only.mkv' })],
      itemIds: [filmsOnly],
    })
    const requested = () =>
      database
        .get()
        .db.prepare<[], { library_id: number; item_id: number }>(
          'SELECT library_id, item_id FROM score_requests ORDER BY library_id, item_id',
        )
        .all()

    expect(stored.requestScores(ids.shows)).toBe(2)
    expect(requested()).toEqual(
      [
        { library_id: ids.shows, item_id: ids.show },
        { library_id: ids.shows, item_id: ids.movie },
      ].toSorted((a, b) => a.item_id - b.item_id),
    )
    expect(stored.requestsLeft(ids.shows)).toBe(2)
    expect(stored.requestsLeft(ids.films)).toBe(0)
    expect(stored.isRequested(filmsOnly)).toBe(false)
    expect(stored.requestScores(ids.shows)).toBe(0)

    stored.clearRequest(ids.movie)
    expect(stored.requestsLeft(ids.shows)).toBe(1)
    expect(stored.isRequested(ids.movie)).toBe(false)
    expect(stored.requestedTitles(10).map((title) => title.itemId)).toEqual([ids.show])

    new LibrariesRepository(database.get()).remove(ids.shows)
    expect(requested()).toEqual([])
    expect(stored.hasRequests()).toBe(false)
  })

  it('keeps a person with no credits whose filmography was fetched lately, and their credits go with them', () => {
    const stored = metadata()
    const people = new PeopleRepository(database.get())
    const gone = stored.save({
      item: {
        ...BLANK_ITEM,
        type: 'movie',
        tmdbId: '602',
        number: null,
        title: 'Gone',
        credits: [
          { tmdbId: '1', name: 'Seen Yesterday', photo: null, job: 'cast', role: null },
          { tmdbId: '2', name: 'Seen Long Ago', photo: null, job: 'cast', role: null },
          { tmdbId: '3', name: 'Never Seen', photo: null, job: 'cast', role: null },
        ],
      },
    })
    const [yesterday, longAgo, never] = stored.credits(gone).map((credit) => credit.personId)
    const person: FetchedPerson = {
      tmdbId: '1',
      name: 'Someone',
      photo: null,
      imdbId: null,
      birthday: null,
      deathday: null,
      placeOfBirth: null,
      biography: null,
      knownFor: null,
      credits: [
        {
          creditId: 'c1',
          type: 'movie',
          tmdbId: '602',
          title: 'Gone',
          released: null,
          poster: null,
          genreIds: [],
          department: 'Acting',
          role: null,
          episodes: null,
          position: 0,
        },
      ],
    }
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString()
    people.saveFilmography({ personId: yesterday!, tmdbId: '1', person, at: daysAgo(1) })
    people.saveFilmography({ personId: longAgo!, tmdbId: '2', person, at: daysAgo(200) })
    expect(people.filmographyRows(longAgo!)).toHaveLength(1)

    stored.clearUp()
    expect(stored.get(gone)).toBeNull()
    expect(people.profile(yesterday!)).not.toBeNull()
    expect(people.filmographyRows(yesterday!)).toHaveLength(1)
    expect(people.profile(longAgo!)).toBeNull()
    expect(people.filmographyRows(longAgo!)).toEqual([])
    expect(people.profile(never!)).toBeNull()
  })
})

describe("each provider's scores", () => {
  const database = testDatabase('raven-scores-')
  const metadata = () => repositories(database.get()).metadata
  const DAY_MS = 24 * 60 * 60 * 1000
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString()

  const title = ({
    type = 'movie',
    tmdbId,
    imdbId = null,
  }: {
    type?: FetchedItem['type']
    tmdbId: string
    imdbId?: string | null
  }): number =>
    metadata().save({
      item: { ...BLANK_ITEM, type, tmdbId, number: null, title: `Title ${tmdbId}`, imdbId },
    })
  const score = ({
    source,
    value,
    votes = null,
  }: {
    source: ExternalScore['source']
    value: number
    votes?: number | null
  }): ExternalScore => ({ source, value, votes })
  const rows = (itemId: number) =>
    database
      .get()
      .db.prepare<
        [number],
        { source: string; value: number; votes: number | null; provider: string }
      >('SELECT source, value, votes, provider FROM ratings WHERE item_id = ? ORDER BY source')
      .all(itemId)
  const stamp = ({
    itemId,
    omdb = null,
    mdblist = null,
  }: {
    itemId: number
    omdb?: string | null
    mdblist?: string | null
  }) =>
    database
      .get()
      .db.prepare('UPDATE items SET omdb_fetched_at = ?, mdblist_fetched_at = ? WHERE id = ?')
      .run(omdb, mdblist, itemId)

  beforeAll(() => database.open())
  afterAll(database.close)

  it("keeps MDBList's Rotten Tomatoes score when OMDb sends none", () => {
    const id = title({ tmdbId: '900' })
    const stored = metadata()
    stored.saveScores({
      itemId: id,
      provider: 'mdblist',
      scores: [score({ source: 'rottenTomatoes', value: 9.1 })],
    })
    stored.saveScores({
      itemId: id,
      provider: 'omdb',
      scores: [score({ source: 'imdb', value: 8 })],
    })
    expect(rows(id)).toEqual([
      { source: 'imdb', value: 8, votes: null, provider: 'omdb' },
      { source: 'rottenTomatoes', value: 9.1, votes: null, provider: 'mdblist' },
    ])
  })

  it("never writes OMDb's IMDb score over MDBList's", () => {
    const id = title({ tmdbId: '901' })
    const stored = metadata()
    stored.saveScores({
      itemId: id,
      provider: 'mdblist',
      scores: [score({ source: 'imdb', value: 8.4, votes: 1200 })],
    })
    stored.saveScores({
      itemId: id,
      provider: 'omdb',
      scores: [score({ source: 'imdb', value: 8 })],
    })
    expect(rows(id)).toEqual([{ source: 'imdb', value: 8.4, votes: 1200, provider: 'mdblist' }])
  })

  it("lets OMDb write over MDBList's scores once MDBList's answer is due again, keeping those OMDb does not send", () => {
    const id = title({ tmdbId: '906' })
    const stored = metadata()
    stored.saveScores({
      itemId: id,
      provider: 'mdblist',
      scores: [
        score({ source: 'rottenTomatoes', value: 9.1 }),
        score({ source: 'metacritic', value: 8 }),
      ],
    })
    stamp({ itemId: id, mdblist: daysAgo(31) })
    stored.saveScores({
      itemId: id,
      provider: 'omdb',
      scores: [score({ source: 'rottenTomatoes', value: 5 })],
    })
    expect(rows(id)).toEqual([
      { source: 'metacritic', value: 8, votes: null, provider: 'mdblist' },
      { source: 'rottenTomatoes', value: 5, votes: null, provider: 'omdb' },
    ])
  })

  it("writes MDBList's Rotten Tomatoes score over OMDb's", () => {
    const id = title({ tmdbId: '902' })
    const stored = metadata()
    stored.saveScores({
      itemId: id,
      provider: 'omdb',
      scores: [score({ source: 'rottenTomatoes', value: 5 })],
    })
    stored.saveScores({
      itemId: id,
      provider: 'mdblist',
      scores: [score({ source: 'rottenTomatoes', value: 9.1 })],
    })
    expect(rows(id)).toEqual([
      { source: 'rottenTomatoes', value: 9.1, votes: null, provider: 'mdblist' },
    ])
  })

  it("drops the Metacritic score MDBList sent before and sends no more, and no one else's", () => {
    const id = metadata().save({
      item: {
        ...BLANK_ITEM,
        type: 'movie',
        tmdbId: '903',
        number: null,
        title: 'Title 903',
        rating: { value: 7.1, votes: 50 },
      },
    })
    const stored = metadata()
    stored.saveScores({
      itemId: id,
      provider: 'omdb',
      scores: [score({ source: 'imdb', value: 7.9 })],
    })
    stored.saveScores({
      itemId: id,
      provider: 'mdblist',
      scores: [
        score({ source: 'rottenTomatoes', value: 9.1 }),
        score({ source: 'metacritic', value: 7.3 }),
      ],
    })
    stored.saveScores({
      itemId: id,
      provider: 'mdblist',
      scores: [score({ source: 'rottenTomatoes', value: 9 })],
    })
    expect(rows(id)).toEqual([
      { source: 'imdb', value: 7.9, votes: null, provider: 'omdb' },
      { source: 'rottenTomatoes', value: 9, votes: null, provider: 'mdblist' },
      { source: 'tmdb', value: 7.1, votes: 50, provider: 'tmdb' },
    ])
  })

  it('does nothing for an item that has gone', () => {
    const id = title({ tmdbId: '904' })
    metadata().remove(id)
    expect(() =>
      metadata().saveScores({
        itemId: id,
        provider: 'mdblist',
        scores: [score({ source: 'rottenTomatoes', value: 9.1 })],
      }),
    ).not.toThrow()
    expect(rows(id)).toEqual([])
  })

  it("puts MDBList's never-asked titles lacking a critics' score first, then the never-asked, then the oldest", () => {
    database.get().db.prepare('DELETE FROM items').run()
    const stored = metadata()
    const complete = title({ tmdbId: '910' })
    stored.saveScores({
      itemId: complete,
      provider: 'omdb',
      scores: [
        score({ source: 'rottenTomatoes', value: 9 }),
        score({ source: 'metacritic', value: 8 }),
      ],
    })
    const noCritics = title({ type: 'show', tmdbId: '911' })
    const old = title({ tmdbId: '912' })
    stamp({ itemId: old, mdblist: daysAgo(35) })
    const older = title({ tmdbId: '913' })
    stamp({ itemId: older, mdblist: daysAgo(40) })
    stamp({ itemId: title({ tmdbId: '914' }), mdblist: daysAgo(1) })
    title({ tmdbId: `${LOCAL}915` })
    const season = metadata().save({
      item: { ...BLANK_ITEM, type: 'season', tmdbId: '911-1', number: 1, title: 'Season 1' },
      parentId: noCritics,
    })

    const due = stored.scoresDue({ provider: 'mdblist', before: daysAgo(30), limit: 10 })
    expect(due.map((item) => item.itemId)).toEqual([noCritics, complete, older, old])
    expect(due.map((item) => item.itemId)).not.toContain(season)
    expect(due[0]).toEqual({
      itemId: noCritics,
      type: 'show',
      tmdbId: '911',
      imdbId: null,
      isRequested: false,
    })
    expect(
      stored
        .scoresDue({ provider: 'mdblist', before: daysAgo(30), limit: 2 })
        .map((item) => item.itemId),
    ).toEqual([noCritics, complete])
  })

  it("lists OMDb's titles with an IMDb id that it and MDBList have not answered lately, or MDBList does not know, longest unasked first", () => {
    database.get().db.prepare('DELETE FROM items').run()
    const stored = metadata()
    const scoredByMdblist = (itemId: number) =>
      stored.saveScores({
        itemId,
        provider: 'mdblist',
        scores: [score({ source: 'imdb', value: 8 })],
      })
    const unknown = title({ tmdbId: '920', imdbId: 'tt920' })
    stamp({ itemId: unknown, omdb: daysAgo(40), mdblist: daysAgo(1) })
    const old = title({ tmdbId: '921', imdbId: 'tt921' })
    scoredByMdblist(old)
    stamp({ itemId: old, mdblist: daysAgo(35) })
    const older = title({ tmdbId: '922', imdbId: 'tt922' })
    stamp({ itemId: older, omdb: daysAgo(40) })
    const never = title({ tmdbId: '923', imdbId: 'tt923' })
    const known = title({ tmdbId: '924', imdbId: 'tt924' })
    scoredByMdblist(known)
    stamp({ itemId: known, omdb: daysAgo(40), mdblist: daysAgo(1) })
    const fresh = title({ tmdbId: '925', imdbId: 'tt925' })
    stamp({ itemId: fresh, omdb: daysAgo(1) })
    const noImdb = title({ tmdbId: '926' })
    const local = title({ tmdbId: `${LOCAL}927`, imdbId: 'tt927' })

    expect(
      stored
        .scoresDue({ provider: 'omdb', before: daysAgo(30), limit: 10 })
        .map((item) => [item.itemId, item.imdbId]),
    ).toEqual([
      [never, 'tt923'],
      [older, 'tt922'],
      [old, 'tt921'],
      [unknown, 'tt920'],
    ])
    const isDue = (itemId: number) =>
      (['omdb', 'mdblist'] as const).map((provider) =>
        stored.isScoreDue({ itemId, provider, before: daysAgo(30) }),
      )
    expect([unknown, old, older, never, known, fresh, noImdb, local].map(isDue)).toEqual([
      [true, false],
      [true, true],
      [true, true],
      [true, true],
      [false, false],
      [false, true],
      [false, true],
      [false, false],
    ])
  })

  it('lists a title a Refresh asked for first, and counts it due from each provider until that one answers since', () => {
    database.get().db.prepare('DELETE FROM items').run()
    const stored = metadata()
    const libraries = new LibrariesRepository(database.get())
    const { id: libraryId } = libraries.create({
      name: 'Films',
      paths: ['/films'],
      settings: { kind: 'movies' },
    })
    const never = title({ tmdbId: '930', imdbId: 'tt930' })
    const fresh = title({ tmdbId: '931', imdbId: 'tt931' })
    stamp({ itemId: fresh, omdb: daysAgo(2), mdblist: daysAgo(2) })
    stored.link({
      mediaIds: [
        new MediaIndex(database.get()).insert({
          libraryId,
          kind: 'movies',
          file: { path: '/films/931.mkv', root: '/films', size: 1, mtimeMs: 1 },
        }),
      ],
      itemIds: [fresh],
    })
    const isDue = () =>
      (['mdblist', 'omdb'] as const).map((provider) =>
        stored.isScoreDue({ itemId: fresh, provider, before: daysAgo(30) }),
      )
    expect(isDue()).toEqual([false, false])

    expect(stored.requestScores(libraryId)).toBe(1)
    libraries.startRatingsRefresh({ id: libraryId, at: daysAgo(1), total: 1 })

    expect(isDue()).toEqual([true, true])
    expect(
      stored
        .scoresDue({ provider: 'mdblist', before: daysAgo(30), limit: 10 })
        .map((item) => [item.itemId, item.isRequested]),
    ).toEqual([
      [fresh, true],
      [never, false],
    ])
    stored.saveScores({ itemId: fresh, provider: 'mdblist', scores: [] })
    expect(isDue()).toEqual([false, true])
    stored.settleRequests('omdb')
    expect(stored.requestsLeft(libraryId)).toBe(1)
    stored.saveScores({ itemId: fresh, provider: 'omdb', scores: [] })
    expect(isDue()).toEqual([false, false])
    stored.settleRequests('omdb')
    expect(stored.requestsLeft(libraryId)).toBe(0)
  })

  it("replaces an item's TMDB score alone, and drops it for none", () => {
    const stored = metadata()
    const id = stored.save({
      item: {
        ...BLANK_ITEM,
        type: 'movie',
        tmdbId: '940',
        number: null,
        title: 'Title 940',
        rating: { value: 7.1, votes: 50 },
      },
    })
    stored.saveScores({
      itemId: id,
      provider: 'omdb',
      scores: [score({ source: 'imdb', value: 8 })],
    })

    stored.saveTmdbRating({ itemId: id, rating: { value: 7.4, votes: 60 } })
    expect(rows(id)).toEqual([
      { source: 'imdb', value: 8, votes: null, provider: 'omdb' },
      { source: 'tmdb', value: 7.4, votes: 60, provider: 'tmdb' },
    ])
    stored.saveTmdbRating({ itemId: id, rating: null })
    expect(rows(id)).toEqual([{ source: 'imdb', value: 8, votes: null, provider: 'omdb' }])

    stored.remove(id)
    expect(() =>
      stored.saveTmdbRating({ itemId: id, rating: { value: 7, votes: 1 } }),
    ).not.toThrow()
    expect(rows(id)).toEqual([])
  })
})
