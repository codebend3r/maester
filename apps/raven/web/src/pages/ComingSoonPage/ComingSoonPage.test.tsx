import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import {
  ITEM_TYPES,
  type MatchItemType,
  REQUEST_STATUSES,
  type Upcoming,
  type UpcomingTitle,
} from '@raven/core'
import { api } from '@/lib/api'
import { ComingSoonPage } from '@/pages/ComingSoonPage/ComingSoonPage'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const getUpcoming = spyOn(api, 'getUpcoming')
const listRequests = spyOn(api, 'listRequests')
const getRequestHolding = spyOn(api, 'getRequestHolding')

type TitleProps = { type: MatchItemType; id: number; name: string }

const title = ({ type, id, name }: TitleProps): UpcomingTitle => ({
  type,
  tmdbId: String(id),
  title: name,
  released: '2026-12-25',
  poster: `/poster${id}.jpg`,
})

const open = (upcoming: Upcoming) => {
  getUpcoming.mockImplementation(async () => upcoming)
  renderWithProviders({ ui: <ComingSoonPage /> })
}

const shelf = (name: string): HTMLElement => screen.getByRole('region', { name })

describe('ComingSoonPage', () => {
  afterEach(() => {
    cleanup()
    getUpcoming.mockReset()
    listRequests.mockReset()
    getRequestHolding.mockReset()
  })

  it('shelves the movies, the shows and the documentaries, each card opening its own page', async () => {
    open({
      movies: [
        title({ type: ITEM_TYPES.movie, id: 1, name: 'Dune: Part Three' }),
        title({ type: ITEM_TYPES.movie, id: 2, name: 'The Batman Part II' }),
      ],
      shows: [title({ type: ITEM_TYPES.show, id: 3, name: 'Blade Runner 2099' })],
      documentaries: [
        title({ type: ITEM_TYPES.movie, id: 4, name: 'Ocean' }),
        title({ type: ITEM_TYPES.show, id: 5, name: 'Planet Earth IV' }),
      ],
    })
    expect(
      await screen.findByRole('heading', { name: 'Coming soon', level: 1 }),
    ).toBeInTheDocument()
    const movies = within(await screen.findByRole('region', { name: 'Upcoming movies' }))
    expect(movies.getAllByRole('listitem')).toHaveLength(2)
    const dune = movies.getByRole('link', { name: 'Dune: Part Three' })
    expect(dune).toHaveAttribute('href', '/coming-soon/movie/1')
    expect(dune.querySelector('img')).toHaveAttribute(
      'src',
      api.tmdbPosterSources('/poster1.jpg').src,
    )
    expect(
      within(shelf('Upcoming TV shows')).getByRole('link', { name: 'Blade Runner 2099' }),
    ).toHaveAttribute('href', '/coming-soon/show/3')
  })

  it("links each shelf's heading to the shelf's own page", async () => {
    open({ movies: [], shows: [], documentaries: [] })
    const headingLink = (name: string) =>
      within(screen.getByRole('heading', { name, level: 2 })).getByRole('link', { name })
    await screen.findByRole('region', { name: 'Upcoming movies' })
    expect(headingLink('Upcoming movies')).toHaveAttribute('href', '/coming-soon/movies')
    expect(headingLink('Upcoming TV shows')).toHaveAttribute('href', '/coming-soon/shows')
    expect(headingLink('Upcoming documentaries')).toHaveAttribute(
      'href',
      '/coming-soon/documentaries',
    )
  })

  it('says which kind each documentary is, and no kind on the other shelves', async () => {
    open({
      movies: [title({ type: ITEM_TYPES.movie, id: 1, name: 'Dune: Part Three' })],
      shows: [],
      documentaries: [
        title({ type: ITEM_TYPES.movie, id: 4, name: 'Ocean' }),
        title({ type: ITEM_TYPES.show, id: 5, name: 'Planet Earth IV' }),
      ],
    })
    const [ocean, planet] = within(
      await screen.findByRole('region', { name: 'Upcoming documentaries' }),
    ).getAllByRole('listitem')
    expect(within(ocean!).getByText('Movie')).toBeInTheDocument()
    expect(within(planet!).getByText('TV show')).toBeInTheDocument()
    expect(within(shelf('Upcoming movies')).queryByText('Movie')).toBeNull()
    expect(
      within(shelf('Upcoming TV shows')).getByText('Nothing announced yet.'),
    ).toBeInTheDocument()
  })

  it('says so while it reads, and when the server cannot reach TMDB', async () => {
    getUpcoming.mockImplementation(() => held<Upcoming>().promise)
    renderWithProviders({ ui: <ComingSoonPage /> })
    expect(await screen.findAllByText('Finding what is coming soon')).toHaveLength(3)
    cleanup()
    getUpcoming.mockImplementation(async () => {
      throw new Error('Set TMDB_API_TOKEN to see what is coming soon.')
    })
    renderWithProviders({ ui: <ComingSoonPage /> })
    expect(await screen.findByRole('alert')).toHaveTextContent('Set TMDB_API_TOKEN')
    expect(screen.queryByRole('region', { name: 'Upcoming movies' })).toBeNull()
  })

  it("shows where a title's request stands on its card", async () => {
    listRequests.mockImplementation(async () => ({
      requests: [
        {
          type: ITEM_TYPES.movie,
          tmdbId: '1',
          title: 'Dune: Part Three',
          status: REQUEST_STATUSES.willDownload,
          requestedAt: '2026-11-12T10:00:00.000Z',
          isMine: false,
        },
      ],
      budget: { limit: 10, left: 10, nextAt: null },
      kinds: { movie: true, show: true },
    }))
    open({
      movies: [
        title({ type: ITEM_TYPES.movie, id: 1, name: 'Dune: Part Three' }),
        title({ type: ITEM_TYPES.movie, id: 2, name: 'The Batman Part II' }),
      ],
      shows: [],
      documentaries: [],
    })
    const [dune, batman] = within(
      await screen.findByRole('region', { name: 'Upcoming movies' }),
    ).getAllByRole('listitem')
    expect(await within(dune!).findByText('Will download soon')).toBeInTheDocument()
    expect(within(batman!).queryByText('Will download soon')).toBeNull()
    expect(within(dune!).getByText('Requested')).toBeInTheDocument()
  })

  it('puts a green check on a title its downloader holds already, and none on the rest', async () => {
    getRequestHolding.mockImplementation(async ({ tmdbId }) => ({
      status: tmdbId === '2' ? REQUEST_STATUSES.willDownload : null,
    }))
    open({
      movies: [
        title({ type: ITEM_TYPES.movie, id: 1, name: 'Dune: Part Three' }),
        title({ type: ITEM_TYPES.movie, id: 2, name: 'Focker-in-Law' }),
      ],
      shows: [],
      documentaries: [],
    })
    const [dune, focker] = within(
      await screen.findByRole('region', { name: 'Upcoming movies' }),
    ).getAllByRole('listitem')
    expect(await within(focker!).findByText('Requested')).toBeInTheDocument()
    expect(within(dune!).queryByText('Requested')).toBeNull()
  })
})
