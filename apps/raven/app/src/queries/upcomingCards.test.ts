import { describe, expect, it } from 'bun:test'

import {
  CREDIT_JOBS,
  ITEM_TYPES,
  REQUEST_STATES,
  REQUEST_STATUSES,
  type TitleRequest,
  type TitleRequests,
  UPCOMING_KINDS,
  type Upcoming,
  type UpcomingDetails,
  createApiClient,
} from '@raven/core'

import { COMING_SOON_COPY, COMING_SOON_PAGES } from '@/queries/comingSoonCopy'
import { requestControlOf } from '@/queries/requestControl'
import {
  everyoneSectionsOf,
  requestSectionsOf,
  upcomingPageOf,
  upcomingSectionsOf,
} from '@/queries/upcomingCards'
import { ROUTE_TARGETS, itemTarget } from '@/routes'

const ORIGIN = 'https://raven.test'

const pictures = {
  api: createApiClient({ baseUrl: ORIGIN, fetch: async () => Promise.reject(new Error('unused')) }),
  headersFor: () => ({}),
}

const DUNE = {
  type: ITEM_TYPES.movie,
  tmdbId: '693134',
  title: 'Dune: Part Three',
  released: '2026-12-18',
  poster: '/dune.jpg',
} as const

const SILO = {
  type: ITEM_TYPES.show,
  tmdbId: '125988',
  title: 'Silo',
  released: '2027-01-15',
  poster: '/silo.jpg',
} as const

const UPCOMING: Upcoming = { movies: [DUNE], shows: [], documentaries: [SILO] }

const requestOf = (request: Partial<TitleRequest>): TitleRequest => ({
  type: DUNE.type,
  tmdbId: DUNE.tmdbId,
  title: DUNE.title,
  status: REQUEST_STATUSES.searching,
  requestedAt: '2026-11-20T15:00:00.000Z',
  isMine: true,
  ...request,
})

const listOf = (list: Partial<TitleRequests>): TitleRequests => ({
  requests: [],
  budget: { limit: 5, left: 3, nextAt: null },
  kinds: { movie: true, show: true },
  ...list,
})

const DETAILS: UpcomingDetails = {
  ...DUNE,
  backdrop: '/dune-wide.jpg',
  summary: 'Paul walks the golden path.',
  tagline: 'The end begins.',
  genres: ['Science Fiction'],
  runtime: 165,
  kind: UPCOMING_KINDS.movie,
  credits: [
    {
      personId: 1,
      name: 'Denis Villeneuve',
      job: CREDIT_JOBS.director,
      role: null,
      photoVersion: null,
    },
    { personId: 2, name: 'Zendaya', job: CREDIT_JOBS.cast, role: 'Chani', photoVersion: null },
  ],
}

describe('upcomingSectionsOf', () => {
  it('shelves what is announced under the web headings, and leaves an empty shelf out', () => {
    const sections = upcomingSectionsOf({ upcoming: UPCOMING, list: undefined, ...pictures })
    expect(sections.map(({ title }) => title)).toEqual([
      COMING_SOON_COPY.shelves.movies,
      COMING_SOON_COPY.shelves.documentaries,
    ])
    const [movies] = sections
    expect(movies?.cards[0]).toMatchObject({
      title: DUNE.title,
      picture: { uri: expect.stringContaining('/api/images/poster/dune.jpg') },
      target: { kind: ROUTE_TARGETS.upcoming, title: { type: DUNE.type, tmdbId: DUNE.tmdbId } },
    })
  })

  it('names the kind only on a shelf that holds movies and shows, and says where a request stands', () => {
    const list = listOf({ requests: [requestOf({})] })
    const [movies, documentaries] = upcomingSectionsOf({ upcoming: UPCOMING, list, ...pictures })
    expect(movies?.cards[0]?.line).toContain(COMING_SOON_COPY.statuses.searching.label)
    expect(movies?.cards[0]?.line).not.toContain(COMING_SOON_COPY.kinds.movie)
    expect(documentaries?.cards[0]?.line).toContain(COMING_SOON_COPY.kinds.show)
  })
})

describe('requestSectionsOf', () => {
  const pending = requestOf({})
  const added = requestOf({
    tmdbId: SILO.tmdbId,
    type: SILO.type,
    title: SILO.title,
    libraryItemId: 40,
  })
  const list = listOf({ requests: [pending, added] })
  const details = new Map([[`${DUNE.type}:${DUNE.tmdbId}`, DETAILS]])

  it('keeps a request on its way under Pending, with its poster from its own details', () => {
    const [section] = requestSectionsOf({
      page: COMING_SOON_PAGES.pending,
      list,
      details,
      ...pictures,
    })
    expect(section?.cards.map(({ title }) => title)).toEqual([DUNE.title])
    expect(section?.cards[0]?.picture?.uri).toContain('/api/images/poster/dune.jpg')
    expect(section?.cards[0]?.line).toContain(COMING_SOON_COPY.statuses.searching.label)
  })

  it('opens a request a library holds on its page there', () => {
    const [section] = requestSectionsOf({
      page: COMING_SOON_PAGES.added,
      list,
      details,
      ...pictures,
    })
    expect(section?.cards[0]).toMatchObject({ title: SILO.title, target: itemTarget(40) })
    expect(section?.cards[0]?.line).toContain(COMING_SOON_COPY.requests.inLibrary)
  })

  it('holds no section with nothing requested', () => {
    expect(
      requestSectionsOf({
        page: COMING_SOON_PAGES.pending,
        list: listOf({}),
        details,
        ...pictures,
      }),
    ).toEqual([])
  })
})

describe('everyoneSectionsOf', () => {
  it('names the account that asked, and the downloader where nobody did', () => {
    const [section] = everyoneSectionsOf({
      requests: [
        { ...requestOf({}), requestedBy: 'account-1' },
        {
          ...requestOf({ tmdbId: SILO.tmdbId, type: SILO.type, title: SILO.title }),
          requestedBy: null,
        },
      ],
      names: new Map([['account-1', 'ada@example.com']]),
    })
    expect(section?.cards[0]?.line).toContain('ada@example.com')
    expect(section?.cards[1]?.line).toContain(COMING_SOON_COPY.everyone.downloaders.show)
  })
})

describe('upcomingPageOf', () => {
  it("lays the title out as an item's page: facts, directors, cast and the request's notes", () => {
    const page = upcomingPageOf({ details: DETAILS, notes: ['A note'], ...pictures })
    expect(page.hero).toMatchObject({
      title: DUNE.title,
      byline: COMING_SOON_COPY.directedBy('Denis Villeneuve'),
      tagline: DETAILS.tagline,
      summary: DETAILS.summary,
      notes: ['A note'],
    })
    expect(page.hero.facts).toEqual(
      expect.arrayContaining([
        COMING_SOON_COPY.upcomingKinds.movie,
        COMING_SOON_COPY.minutes(165),
        'Science Fiction',
      ]),
    )
    expect(page.hero.backdrop?.uri).toContain('/api/images/backdrop/dune-wide.jpg')
    expect(page.cast.map(({ name }) => name)).toEqual(['Zendaya'])
  })
})

describe('requestControlOf', () => {
  const ask = { type: DUNE.type, tmdbId: DUNE.tmdbId }
  const who = { ownEmail: 'me@example.com', everyone: undefined, names: new Map<string, string>() }
  const base = { ask, holding: { status: null }, isReading: false, failure: null, ...who }

  it('shows nothing while the requests or the downloader are read', () => {
    expect(requestControlOf({ ...base, list: undefined }).state).toBe(REQUEST_STATES.loading)
    expect(requestControlOf({ ...base, list: listOf({}), isReading: true }).state).toBe(
      REQUEST_STATES.loading,
    )
  })

  it('offers the button with what is left today', () => {
    const control = requestControlOf({ ...base, list: listOf({}) })
    expect(control.state).toBe(REQUEST_STATES.open)
    expect(control.notes).toEqual(['3 of 5 requests left today', COMING_SOON_COPY.request.explain])
  })

  it('says why an ask did not go through', () => {
    const control = requestControlOf({ ...base, list: listOf({}), failure: 'Radarr is down' })
    expect(control.notes.at(-1)).toBe(`${COMING_SOON_COPY.request.failed} Radarr is down`)
  })

  it('says where a request stands, what that means and that the viewer asked', () => {
    const control = requestControlOf({ ...base, list: listOf({ requests: [requestOf({})] }) })
    expect(control.state).toBe(REQUEST_STATES.requested)
    expect(control.notes[0]).toBe(
      `${COMING_SOON_COPY.statuses.searching.label}: ${COMING_SOON_COPY.statuses.searching.line}`,
    )
    expect(control.notes[1]).toContain('Requested by me@example.com on ')
  })

  it('names the downloader for a title it holds with nobody asking', () => {
    const control = requestControlOf({
      ...base,
      list: listOf({}),
      holding: { status: REQUEST_STATUSES.downloading },
    })
    expect(control.state).toBe(REQUEST_STATES.requested)
    expect(control.notes[1]).toBe(COMING_SOON_COPY.request.requestedBy('Radarr'))
  })

  it('says requests of the kind are off, and when the budget is spent', () => {
    expect(
      requestControlOf({ ...base, list: listOf({ kinds: { movie: false, show: true } }) }),
    ).toEqual({ state: REQUEST_STATES.off, notes: [COMING_SOON_COPY.request.off.movie] })
    const spent = requestControlOf({
      ...base,
      list: listOf({ budget: { limit: 5, left: 0, nextAt: null } }),
    })
    expect(spent).toEqual({
      state: REQUEST_STATES.spent,
      notes: [COMING_SOON_COPY.request.spent(5)],
    })
  })
})
