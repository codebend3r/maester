import { afterEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { FilmographyCredit, FilmographyEntry, PersonDetails, PersonProfile } from '@raven/core'
import { Route, Routes, useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { lifeLine, initialsOf } from '@/pages/PersonPage/PersonHeader'
import { PersonPage, groupCredits } from '@/pages/PersonPage/PersonPage'
import { itemSummary } from '@/test/fixtures'
import { held } from '@/test/held'
import { pollFast } from '@/test/polls'
import { renderWithProviders } from '@/test/render'

const MATRIX = itemSummary({ id: 1, title: 'The Matrix', year: 1999 })
const SHOW = itemSummary({ id: 4, type: 'show', title: 'Severance', year: 2022 })

const profile = (overrides: Partial<PersonProfile> = {}): PersonProfile => ({
  imdbId: null,
  birthday: null,
  deathday: null,
  placeOfBirth: null,
  biography: null,
  knownFor: null,
  ...overrides,
})

const credit = (overrides: Partial<FilmographyCredit> = {}): FilmographyCredit => ({
  department: 'acting',
  role: null,
  episodes: null,
  isSelf: false,
  ...overrides,
})

const entry = (overrides: Partial<FilmographyEntry> = {}): FilmographyEntry => ({
  type: 'movie',
  tmdbId: '603',
  title: 'The Matrix',
  year: 1999,
  released: '1999-03-31',
  poster: null,
  credits: [credit({ role: 'Neo' })],
  item: null,
  ...overrides,
})

/** Keanu's filmography, newest first as the server lists it: an undated movie, a show, a talk show and two films. */
const ENTRIES: FilmographyEntry[] = [
  entry({
    tmdbId: '1000',
    title: 'John Wick: Chapter 5',
    year: null,
    released: null,
    poster: '/wick.jpg',
    credits: [credit({ role: 'John Wick' })],
  }),
  entry({
    type: 'show',
    tmdbId: '95396',
    title: 'Severance',
    year: 2022,
    released: '2022-02-18',
    credits: [
      credit({ department: 'directing', role: 'Director', episodes: 9 }),
      credit({ department: 'producing', role: 'Executive Producer', episodes: 19 }),
    ],
  }),
  entry({
    type: 'show',
    tmdbId: '59941',
    title: 'The Tonight Show',
    year: 2014,
    released: '2014-02-17',
    credits: [credit({ role: 'Self', episodes: 3, isSelf: true })],
  }),
  entry({
    tmdbId: '2000',
    title: 'Émile',
    year: 2003,
    released: '2003-05-01',
    credits: [credit({ department: 'writing', role: 'Screenplay' })],
  }),
  entry({ item: MATRIX }),
]

const person = (overrides: Partial<PersonDetails> = {}): PersonDetails => ({
  id: 7,
  tmdbId: '6384',
  name: 'Keanu Reeves',
  photoVersion: 'k1',
  profile: null,
  filmography: { state: 'unavailable' },
  credits: [],
  ...overrides,
})

const ready = (entries: FilmographyEntry[]): PersonDetails['filmography'] => ({
  state: 'ready',
  fetchedAt: '2026-10-17T00:00:00.000Z',
  entries,
})

/** Where the page's address is, written out so a test can read it. */
const Address = () => {
  const { search } = useLocation()
  return <output aria-label="Address">{search}</output>
}

const renderPerson = ({
  route = '/people/7',
  behind = [],
}: { route?: string; behind?: string[] } = {}) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route
          path="people/:id"
          element={
            <>
              <PersonPage />
              <Address />
            </>
          }
        />
      </Routes>
    ),
    route,
    behind,
  })

const table = () => screen.getByRole('table', { name: 'Filmography' })

/** A row's title, as its link reads before anything only a screen reader hears. */
const titleOf = (cell: HTMLElement): string =>
  within(cell).getByRole('link').childNodes[0]?.textContent ?? ''

const titles = () => within(table()).getAllByRole('rowheader').map(titleOf)

const rowOf = (title: string): HTMLElement => {
  const row = within(table())
    .getAllByRole('rowheader')
    .find((cell) => titleOf(cell).startsWith(title))
    ?.closest('tr')
  if (!row) throw new Error(`No row for ${title}`)
  return row
}

/** The page's own header, apart from TMDB's mark at its foot. */
const header = (): HTMLElement => {
  const found = screen.getByRole('heading', { level: 1 }).closest('header')
  if (!found) throw new Error('No header')
  return found
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('groupCredits', () => {
  it('groups by job, keeping an item once per group', () => {
    const groups = groupCredits([
      { item: MATRIX, job: 'cast', role: 'Neo' },
      { item: MATRIX, job: 'producer', role: 'Producer' },
      { item: SHOW, job: 'guest', role: 'Himself' },
      { item: SHOW, job: 'cast', role: 'Himself' },
    ])
    expect(groups.map((group) => [group.title, group.credits.length])).toEqual([
      ['Acting', 2],
      ['Producing', 1],
    ])
  })
})

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Rebecca Ferguson')).toBe('RF')
    expect(initialsOf('guillermo  del Toro')).toBe('GD')
    expect(initialsOf('Zendaya')).toBe('Z')
  })
})

describe('lifeLine', () => {
  const today = '2026-10-17'

  it('leaves out what TMDB does not say', () => {
    expect(lifeLine({ profile: null, today })).toBeNull()
    expect(lifeLine({ profile: profile(), today })).toBeNull()
    expect(lifeLine({ profile: profile({ birthday: '1964' }), today })).toBeNull()
    expect(lifeLine({ profile: profile({ birthday: '1964-09-02' }), today })).toBe(
      'Born September 2, 1964 · 62 years old',
    )
  })

  it('counts one year as one, and no age from a birthday after today', () => {
    expect(lifeLine({ profile: profile({ birthday: '2025-01-01' }), today })).toBe(
      'Born January 1, 2025 · 1 year old',
    )
    expect(lifeLine({ profile: profile({ birthday: '2027-01-01' }), today })).toBe(
      'Born January 1, 2027',
    )
  })

  it('says when they died, and leaves the day out when it cannot be read', () => {
    expect(
      lifeLine({ profile: profile({ birthday: '1930-08-25', deathday: '2020-10-31' }), today }),
    ).toBe('Born August 25, 1930 · Died October 31, 2020, aged 90')
    expect(
      lifeLine({ profile: profile({ birthday: '1930-08-25', deathday: '1920-01-01' }), today }),
    ).toBe('Born August 25, 1930 · Died January 1, 1920')
    expect(
      lifeLine({ profile: profile({ birthday: '1930-08-25', deathday: 'soon' }), today }),
    ).toBe('Born August 25, 1930')
  })
})

describe('PersonPage', () => {
  const spy = spyOn(api, 'getPerson')
  afterEach(() => {
    cleanup()
    spy.mockReset()
    setSystemTime()
  })

  describe('who they are', () => {
    it('says when and where a living person was born and how old they are now', async () => {
      setSystemTime(new Date(2026, 9, 17, 12))
      spy.mockImplementation(async () =>
        person({
          name: 'Jenna Ortega',
          profile: profile({
            birthday: '2000-11-21',
            placeOfBirth: 'Santa Monica, California, USA',
            knownFor: 'Acting',
            imdbId: 'nm4911194',
          }),
          filmography: ready(ENTRIES),
        }),
      )
      renderPerson()
      expect(
        await screen.findByText(
          'Born November 21, 2000 in Santa Monica, California, USA · 25 years old',
        ),
      ).toBeInTheDocument()
      expect(screen.getByText('Acting · 1 title on raven')).toBeInTheDocument()
      expect(within(header()).getByRole('link', { name: 'IMDb' })).toHaveAttribute(
        'href',
        'https://www.imdb.com/name/nm4911194/',
      )
      const tmdb = within(header()).getByRole('link', { name: 'TMDB' })
      expect(tmdb).toHaveAttribute('href', 'https://www.themoviedb.org/person/6384')
      expect(tmdb).toHaveAttribute('target', '_blank')
      expect(tmdb).toHaveAttribute('rel', 'noreferrer')
    })

    it('says when a person died and how old they were', async () => {
      spy.mockImplementation(async () =>
        person({
          name: 'Sean Connery',
          profile: profile({
            birthday: '1930-08-25',
            deathday: '2020-10-31',
            placeOfBirth: 'Edinburgh, Scotland, UK',
          }),
          filmography: ready(ENTRIES),
        }),
      )
      renderPerson()
      expect(
        await screen.findByText(
          'Born August 25, 1930 in Edinburgh, Scotland, UK · Died October 31, 2020, aged 90',
        ),
      ).toBeInTheDocument()
      expect(screen.getByText('1 title on raven')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'IMDb' })).toBeNull()
    })

    it('opens a biography that four lines clip with More, and closes it with Less', async () => {
      const heights = { scrollHeight: 240, clientHeight: 104 }
      Object.entries(heights).forEach(([name, value]) =>
        Object.defineProperty(HTMLParagraphElement.prototype, name, {
          configurable: true,
          get: () => value,
        }),
      )
      try {
        spy.mockImplementation(async () =>
          person({
            profile: profile({ biography: 'Keanu Charles Reeves is a Canadian actor.' }),
            filmography: ready(ENTRIES),
          }),
        )
        renderPerson()
        const more = await screen.findByRole('button', { name: 'More' })
        expect(more).toHaveAttribute('aria-expanded', 'false')
        fireEvent.click(more)
        expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute(
          'aria-expanded',
          'true',
        )
      } finally {
        Object.keys(heights).forEach((name) =>
          Reflect.deleteProperty(HTMLParagraphElement.prototype, name),
        )
      }
    })

    it('offers no More for a biography that fits', async () => {
      spy.mockImplementation(async () =>
        person({ profile: profile({ biography: 'Short.' }), filmography: ready(ENTRIES) }),
      )
      renderPerson()
      expect(await screen.findByText('Short.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    })
  })

  describe('the filmography', () => {
    it('lists every title but appearances as themselves, the newest first', async () => {
      spy.mockImplementation(async () => person({ filmography: ready(ENTRIES) }))
      renderPerson()
      await screen.findByRole('table', { name: 'Filmography' })
      expect(titles()).toEqual(['John Wick: Chapter 5', 'Severance', 'Émile', 'The Matrix'])
      expect(within(rowOf('John Wick')).getByText('TBA')).toBeInTheDocument()
      const severance = rowOf('Severance')
      expect(within(severance).getByText('Director · Executive Producer')).toBeInTheDocument()
      expect(within(severance).getByText('19 episodes')).toBeInTheDocument()
      expect(within(severance).getByText('Directing · Producing')).toBeInTheDocument()
      expect(within(severance).getByText('TV')).toBeInTheDocument()
      expect(within(rowOf('The Matrix')).getByText('Movie')).toBeInTheDocument()
    })

    it("marks what raven holds with a link to its page, and links the rest to TMDB's", async () => {
      spy.mockImplementation(async () => person({ filmography: ready(ENTRIES) }))
      renderPerson()
      await screen.findByRole('table', { name: 'Filmography' })
      const matrix = rowOf('The Matrix')
      expect(within(matrix).getByRole('link', { name: 'The Matrix on raven' })).toHaveAttribute(
        'href',
        '/movies/1',
      )
      expect(within(matrix).getByRole('link', { name: 'The Matrix' })).toHaveAttribute(
        'href',
        '/movies/1',
      )
      const severance = rowOf('Severance')
      expect(within(severance).getByText('Not on raven')).toBeInTheDocument()
      const tmdb = within(severance).getByRole('link', { name: 'Severance on TMDB' })
      expect(tmdb).toHaveAttribute('href', 'https://www.themoviedb.org/tv/95396')
      expect(tmdb).toHaveAttribute('target', '_blank')
      expect(tmdb).toHaveAttribute('rel', 'noreferrer')
      expect(within(rowOf('Émile')).getByRole('link', { name: 'Émile on TMDB' })).toHaveAttribute(
        'href',
        'https://www.themoviedb.org/movie/2000',
      )
    })

    it("shows raven's poster for its titles, TMDB's for the rest, else the first letter", async () => {
      spy.mockImplementation(async () => person({ filmography: ready(ENTRIES) }))
      renderPerson()
      await screen.findByRole('table', { name: 'Filmography' })
      const own = rowOf('The Matrix').querySelector('img')
      expect(own).toHaveAttribute('src', `/api/items/1/images/poster?v=${MATRIX.posterVersion}`)
      expect(own).toHaveAttribute('sizes', POSTER_SIZES.list)
      const tmdb = rowOf('John Wick').querySelector('img')
      expect(tmdb).toHaveAttribute('src', '/api/images/poster/wick.jpg?w=342')
      expect(tmdb?.getAttribute('srcset')).toContain('/api/images/poster/wick.jpg 500w')
      expect(tmdb).toHaveAttribute('sizes', POSTER_SIZES.list)
      if (tmdb) fireEvent.error(tmdb)
      expect(rowOf('John Wick').querySelector('img')).toBeNull()
      expect(within(rowOf('John Wick')).getByText('J')).toBeInTheDocument()
      expect(rowOf('Severance').querySelector('img')).toBeNull()
    })

    it('counts each tab, hides one with nothing, and narrows to a tab in the address', async () => {
      spy.mockImplementation(async () => person({ filmography: ready(ENTRIES) }))
      renderPerson({ route: '/people/7?q=a' })
      const tabs = within(await screen.findByRole('navigation', { name: 'Credits' }))
      expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual([
        'All4',
        'Acting2',
        'Directing1',
        'Writing1',
        'Producing1',
      ])
      expect(tabs.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
      const acting = tabs.getByRole('link', { name: 'Acting' })
      expect(acting).toHaveAttribute('href', '/people/7?q=a&credits=acting')
      fireEvent.click(acting)
      await waitFor(() => expect(titles()).toEqual(['John Wick: Chapter 5', 'The Matrix']))
      expect(tabs.getByRole('link', { name: 'Acting' })).toHaveAttribute('aria-current', 'page')
      expect(screen.queryByRole('columnheader', { name: 'Department' })).toBeNull()
      fireEvent.click(tabs.getByRole('link', { name: 'All' }))
      await waitFor(() => expect(screen.getByLabelText('Address')).toHaveTextContent(/^\?q=a$/))
      expect(screen.getByRole('columnheader', { name: 'Department' })).toBeInTheDocument()
    })

    it('hides a tab with nothing on it, and lists All for an address asking for one', async () => {
      spy.mockImplementation(async () =>
        person({ filmography: ready(ENTRIES.filter((each) => each.title !== 'Severance')) }),
      )
      renderPerson({ route: '/people/7?credits=producing' })
      const tabs = within(await screen.findByRole('navigation', { name: 'Credits' }))
      expect(tabs.queryByRole('link', { name: 'Producing' })).toBeNull()
      expect(tabs.queryByRole('link', { name: 'Directing' })).toBeNull()
      expect(tabs.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
      expect(titles()).toEqual(['John Wick: Chapter 5', 'Émile', 'The Matrix'])
    })

    it('searches titles and roles once typing stops, accents aside', async () => {
      spy.mockImplementation(async () => person({ filmography: ready(ENTRIES) }))
      renderPerson()
      const box = await screen.findByRole('searchbox', { name: 'Search titles' })
      expect(box).toHaveAttribute('placeholder', 'Search titles')
      fireEvent.change(box, { target: { value: 'emile' } })
      await waitFor(() => expect(titles()).toEqual(['Émile']))
      fireEvent.change(box, { target: { value: 'neo' } })
      fireEvent.keyDown(box, { key: 'Enter' })
      expect(titles()).toEqual(['The Matrix'])
      await waitFor(() => expect(screen.getByLabelText('Address')).toHaveTextContent('?q=neo'))
      fireEvent.change(box, { target: { value: 'Speed' } })
      fireEvent.keyDown(box, { key: 'Enter' })
      expect(screen.getByText('No titles match "Speed".')).toBeInTheDocument()
      expect(screen.queryByRole('table', { name: 'Filmography' })).toBeNull()
    })

    it('shows appearances as themselves only once asked to', async () => {
      spy.mockImplementation(async () => person({ filmography: ready(ENTRIES) }))
      renderPerson()
      const toggle = await screen.findByRole('checkbox', { name: 'Show appearances as themselves' })
      expect(toggle).not.toBeChecked()
      expect(titles()).not.toContain('The Tonight Show')
      fireEvent.click(toggle)
      expect(titles()).toContain('The Tonight Show')
      expect(within(rowOf('The Tonight Show')).getByText('3 episodes')).toBeInTheDocument()
      expect(
        within(screen.getByRole('navigation', { name: 'Credits' })).getByRole('link', {
          name: 'Acting',
        }).textContent,
      ).toBe('Acting3')
    })

    it('offers the toggle for a self credit beside other work on a title', async () => {
      spy.mockImplementation(async () =>
        person({
          filmography: ready([
            entry({
              credits: [
                credit({ role: 'Self', isSelf: true }),
                credit({ department: 'producing', role: 'Executive Producer' }),
              ],
            }),
          ]),
        }),
      )
      renderPerson()
      expect(
        await screen.findByRole('checkbox', { name: 'Show appearances as themselves' }),
      ).toBeInTheDocument()
      expect(within(rowOf('The Matrix')).getByText('Executive Producer')).toBeInTheDocument()
    })

    it('shows someone with nothing but appearances as themselves, with no toggle', async () => {
      spy.mockImplementation(async () =>
        person({
          filmography: ready([entry({ credits: [credit({ role: 'Host', isSelf: true })] })]),
        }),
      )
      renderPerson()
      await screen.findByRole('table', { name: 'Filmography' })
      expect(titles()).toEqual(['The Matrix'])
      expect(screen.queryByRole('checkbox')).toBeNull()
    })

    it('sorts by title, by year and by whether raven holds it, and back', async () => {
      spy.mockImplementation(async () => person({ filmography: ready(ENTRIES) }))
      renderPerson()
      await screen.findByRole('table', { name: 'Filmography' })
      const sortBy = (name: string) =>
        fireEvent.click(
          within(screen.getByRole('columnheader', { name })).getByRole('button', { name }),
        )
      sortBy('Title')
      expect(titles()).toEqual(['Émile', 'John Wick: Chapter 5', 'The Matrix', 'Severance'])
      sortBy('Year')
      expect(titles()).toEqual(['John Wick: Chapter 5', 'Severance', 'Émile', 'The Matrix'])
      sortBy('Year')
      expect(titles()).toEqual(['The Matrix', 'Émile', 'Severance', 'John Wick: Chapter 5'])
      sortBy('On raven')
      expect(titles()[0]).toBe('The Matrix')
      expect(screen.getByRole('columnheader', { name: 'On raven' })).toHaveAttribute(
        'aria-sort',
        'descending',
      )
    })

    it('says when TMDB lists nothing for them', async () => {
      spy.mockImplementation(async () => person({ filmography: ready([]) }))
      renderPerson({ route: '/people/7?q=matrix' })
      expect(await screen.findByText('TMDB lists no titles for Keanu Reeves.')).toBeInTheDocument()
      expect(screen.queryByRole('searchbox')).toBeNull()
    })
  })

  describe('while the filmography is on its way', () => {
    it('stands rows in for it, labelled, under the credits raven holds', async () => {
      spy.mockImplementation(async () =>
        person({
          filmography: { state: 'pending' },
          credits: [{ item: MATRIX, job: 'cast', role: 'Neo' }],
        }),
      )
      renderPerson()
      expect(await screen.findByText("Fetching Keanu Reeves's filmography")).toBeInTheDocument()
      expect(screen.getByText('In your libraries · 1 credit')).toBeInTheDocument()
      expect(screen.queryByRole('table')).toBeNull()
    })

    it('asks again one ask at a time, and stops once it is in', async () => {
      pollFast()
      const second = held<PersonDetails>()
      spy.mockImplementationOnce(async () => person({ filmography: { state: 'pending' } }))
      spy.mockImplementationOnce(() => second.promise)
      spy.mockImplementation(async () => person({ filmography: ready(ENTRIES) }))
      renderPerson()
      await screen.findByText("Fetching Keanu Reeves's filmography")
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
      // A poll comes round every 15 ms here; none starts while the second ask is out.
      await wait(100)
      expect(spy).toHaveBeenCalledTimes(2)
      await act(async () => second.answer(person({ filmography: { state: 'pending' } })))
      await screen.findByRole('table', { name: 'Filmography' })
      expect(spy).toHaveBeenCalledTimes(3)
      await wait(100)
      expect(spy).toHaveBeenCalledTimes(3)
    })
  })

  describe('when TMDB has no filmography to give', () => {
    it("says so, then lists what raven holds of a person's, grouped by job, and asks no more", async () => {
      pollFast()
      spy.mockImplementation(async () =>
        person({
          credits: [
            { item: MATRIX, job: 'cast', role: 'Neo' },
            { item: SHOW, job: 'director', role: 'Director' },
          ],
        }),
      )
      renderPerson()
      expect(
        await screen.findByText('TMDB could not be reached, so this lists only what raven holds.'),
      ).toBeInTheDocument()
      const acting = screen.getByRole('region', { name: 'Acting' })
      expect(within(acting).getByRole('link', { name: /The Matrix/ })).toHaveAttribute(
        'href',
        '/movies/1',
      )
      expect(within(acting).getByText('Neo')).toBeInTheDocument()
      const directing = screen.getByRole('region', { name: 'Directing' })
      expect(within(directing).getByRole('link', { name: /Severance/ })).toHaveAttribute(
        'href',
        '/shows/4',
      )
      const poster = acting.querySelector('img')
      expect(poster).toHaveAttribute('src', `/api/items/1/images/poster?v=${MATRIX.posterVersion}`)
      expect(poster?.getAttribute('srcset')?.split(', ')).toEqual([
        `/api/items/1/images/poster?v=${MATRIX.posterVersion}&w=185 185w`,
        `/api/items/1/images/poster?v=${MATRIX.posterVersion}&w=342 342w`,
        `/api/items/1/images/poster?v=${MATRIX.posterVersion} 500w`,
      ])
      expect(poster).toHaveAttribute('sizes', POSTER_SIZES.grid)
      expect(screen.queryByRole('table')).toBeNull()
      await wait(100)
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it("counts their credits over their name, and each group's titles by its heading", async () => {
      spy.mockImplementation(async () =>
        person({
          credits: [
            { item: MATRIX, job: 'cast', role: 'Neo' },
            { item: SHOW, job: 'guest', role: 'Himself' },
            { item: SHOW, job: 'director', role: 'Director' },
          ],
        }),
      )
      renderPerson()
      expect(await screen.findByText('In your libraries · 3 credits')).toBeInTheDocument()
      expect(
        within(screen.getByRole('region', { name: 'Acting' })).getByText('2 titles'),
      ).toBeInTheDocument()
      expect(
        within(screen.getByRole('region', { name: 'Directing' })).getByText('1 title'),
      ).toBeInTheDocument()
    })

    it('shows their initials where they have no photo, and says when nothing credits them', async () => {
      spy.mockImplementation(async () =>
        person({ id: 8, tmdbId: '800', name: 'Bertha Navarro', photoVersion: null }),
      )
      const { container } = renderPerson({ route: '/people/8' })
      expect(
        await screen.findByText('Nothing in raven credits Bertha Navarro yet.'),
      ).toBeInTheDocument()
      expect(screen.getByText('BN')).toHaveAttribute('aria-hidden', 'true')
      expect(container.querySelector('header img')).toBeNull()
      expect(screen.queryByText(/In your libraries/)).toBeNull()
    })
  })

  it('steps back to the page it came from, else links home', async () => {
    spy.mockImplementation(async () => person({ photoVersion: null }))
    renderPerson({ behind: ['/movies/1'] })
    await screen.findByRole('heading', { level: 1, name: 'Keanu Reeves' })
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull()
    cleanup()
    renderPerson()
    await screen.findByRole('heading', { level: 1, name: 'Keanu Reeves' })
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })
})
