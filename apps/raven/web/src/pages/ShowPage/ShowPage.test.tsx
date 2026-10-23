import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePlayerPrefs } from '@raven/ui/headless'
import type { AdminLock, ItemDetails } from '@raven/core'
import { Route, Routes, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { POSTER_SIZES } from '@/lib/posters'
import { ShowPage } from '@/pages/ShowPage/ShowPage'
import { itemDetails, library } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { EPISODE_ONE, EPISODE_TWO, SEASON_ONE_SUMMARY, SEVERANCE } from '@/test/tv'

const Watching = () => <p>Watching {useParams().id}</p>
const Elsewhere = () => <p>Show {useParams().id}</p>

describe('ShowPage', () => {
  const spies = {
    item: spyOn(api, 'getItem'),
    next: spyOn(api, 'nextEpisode'),
    random: spyOn(api, 'shuffleEpisodes'),
    search: spyOn(api, 'searchMatches'),
    setItemMatch: spyOn(api, 'setItemMatch'),
  }

  const open = ({
    details = SEVERANCE,
    adminLock,
  }: {
    details?: ItemDetails
    adminLock?: AdminLock
  } = {}) => {
    spies.item.mockImplementation(async () => details)
    spies.next.mockImplementation(async () => EPISODE_TWO)
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="shows/:id" element={<ShowPage />} />
          <Route path="watch/:id" element={<Watching />} />
          <Route path="elsewhere/:id" element={<Elsewhere />} />
        </Routes>
      ),
      route: '/shows/4',
      adminLock,
    })
  }

  afterEach(() => {
    spies.item.mockReset()
    spies.next.mockReset()
    spies.random.mockReset()
    spies.search.mockReset()
    spies.setItemMatch.mockReset()
  })

  it('shows the creator, years, network, genres and a Play for the next episode', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Severance' })).toBeInTheDocument()
    expect(screen.getByText('Created by Dan Erickson')).toBeInTheDocument()
    expect(screen.getByText('2022 to now')).toBeInTheDocument()
    expect(screen.getByText('Apple TV+')).toBeInTheDocument()
    expect(screen.getByText('TV-MA')).toBeInTheDocument()
    expect(screen.queryByText('Thriller')).toBeNull()
    expect(await screen.findByRole('link', { name: 'Play S01E02' })).toHaveAttribute(
      'href',
      '/watch/13',
    )
  })

  it("shows the title as the show's logo", async () => {
    open({ details: { ...SEVERANCE, logoVersion: 'abc' } })
    const heading = await screen.findByRole('heading', { level: 1, name: 'Severance' })
    expect(heading.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/api/pictures/items/4/logo'),
    )
  })

  it('marks the show a favourite from its heart, before the server answers', async () => {
    const answer = Promise.withResolvers<ItemDetails>()
    const mark = spyOn(api, 'setItemFavourite').mockImplementation(() => answer.promise)
    open({ details: { ...SEVERANCE, favourite: false } })
    const heart = await screen.findByRole('button', { name: 'Favourite' })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(heart)
    expect(mark.mock.calls).toEqual([[{ id: 4, favourite: true }]])
    expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    answer.resolve({ ...SEVERANCE, favourite: true })
    mark.mockRestore()
  })

  it('has no heart for a show only a locked library holds', async () => {
    open({ details: { ...SEVERANCE, favourite: null } })
    await screen.findByRole('heading', { level: 1, name: 'Severance' })
    expect(screen.queryByRole('button', { name: 'Favourite' })).toBeNull()
  })

  it('plays a random episode of the show on Shuffle', async () => {
    spies.random.mockImplementation(async () => [EPISODE_ONE])
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Shuffle' }))
    expect(await screen.findByText('Watching 12')).toBeInTheDocument()
    expect(spies.random.mock.calls).toEqual([[4]])
  })

  it('offers no Shuffle for a show with no episodes on disk', async () => {
    open({ details: { ...SEVERANCE, children: [] } })
    await screen.findByRole('heading', { level: 1, name: 'Severance' })
    expect(screen.queryByRole('button', { name: 'Shuffle' })).toBeNull()
  })

  it('says it is a show, and names its library on the way back', async () => {
    spies.item.mockImplementation(async () => SEVERANCE)
    spies.next.mockImplementation(async () => EPISODE_TWO)
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="shows/:id" element={<ShowPage />} />
        </Routes>
      ),
      route: '/shows/4',
      libraries: [library({ id: EPISODE_TWO.libraryId, name: 'Series' })],
    })
    expect(await screen.findByRole('link', { name: 'Series' })).toHaveAttribute(
      'href',
      `/libraries/${EPISODE_TWO.libraryId}`,
    )
    expect(screen.getByText('Show')).toBeInTheDocument()
  })

  it('leaves Edit images, Edit metadata and Fix match out while the admin lock is on', async () => {
    open({ adminLock: { state: 'on', available: true } })
    expect(await screen.findByRole('link', { name: 'Play S01E02' })).toBeInTheDocument()
    expect(
      screen.queryAllByRole('button', { name: /^(Edit images|Edit metadata|Fix match)$/ }),
    ).toEqual([])
  })

  it('opens Edit images for the show', async () => {
    const images = spyOn(api, 'getItemImages').mockImplementation(async () => ({
      poster: [],
      backdrop: [],
      logo: [],
    }))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit images' }))
    expect(await screen.findByRole('heading', { name: 'Edit images' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Linked files' })).toBeNull()
    expect(images).toHaveBeenCalled()
    images.mockRestore()
  })

  it('lists the seasons on disk with their episode counts', async () => {
    open()
    const season = await screen.findByRole('link', { name: /Season 1/ })
    expect(season).toHaveAttribute('href', '/shows/4/seasons/1')
    expect(await screen.findByText('2 episodes')).toBeInTheDocument()
    expect(spies.item.mock.calls.map(([id]) => id)).toEqual([4])
  })

  it("fetches a season's poster no wider than its row shows it, and the show's own big", async () => {
    open()
    const season = (await screen.findByRole('link', { name: /Season 1/ })).querySelector('img')
    expect(season?.getAttribute('srcset')?.split(', ')).toEqual([
      '/api/pictures/items/5/poster/p5?w=185 185w',
      '/api/pictures/items/5/poster/p5?w=342 342w',
      '/api/pictures/items/5/poster/p5 500w',
    ])
    expect(season).toHaveAttribute('sizes', POSTER_SIZES.season)
    const own = document.querySelector('img[src="/api/pictures/items/4/poster/s4"]')
    expect(own).toBeInTheDocument()
    expect(own).not.toHaveAttribute('srcset')
  })

  it('re-points the whole show from Fix match', async () => {
    spies.search.mockImplementation(async () => [
      { tmdbId: '60622', title: 'Fargo', year: 2014, overview: null, poster: null, confidence: 90 },
    ])
    const moved: Array<{ itemId: number; tmdbId: string }> = []
    spies.setItemMatch.mockImplementation(async (request) => {
      moved.push(request)
      return itemDetails({ ...SEVERANCE, id: 9, title: 'Fargo' })
    })
    open()
    // Once the next episode is in, the page knows the show's library.
    await screen.findByRole('link', { name: 'Play S01E02' })
    await userEvent.click(await screen.findByRole('button', { name: 'Fix match' }))
    expect(screen.getByRole('searchbox', { name: 'Title' })).toHaveValue('Severance')
    expect(screen.queryByRole('button', { name: 'Not a show' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Fargo (2014)' }))
    expect(moved).toEqual([{ itemId: 4, tmdbId: '60622' }])
    expect(spies.search.mock.calls[0]?.[0]).toMatchObject({
      type: 'show',
      query: 'Severance',
      libraryId: EPISODE_TWO.libraryId,
      subject: { kind: 'item', id: 4 },
    })
  })

  it('says the show was matched by AI, and says so in Fix match too', async () => {
    const reason = "Season 1's episode titles match TMDB's."
    open({ details: { ...SEVERANCE, aiMatch: { reason } } })
    const note = await screen.findByText('Matched by AI.')
    expect(note.closest('p')).toHaveTextContent(`Matched by AI. ${reason}`)
    spies.search.mockImplementation(async () => [])
    await userEvent.click(screen.getByRole('button', { name: 'Fix match' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(`Matched by AI. ${reason}`)
  })

  const withSeasons = (counts: Array<[number, number]>): ItemDetails => ({
    ...SEVERANCE,
    children: counts.map(([watchedCount, episodeCount], index) => ({
      ...SEASON_ONE_SUMMARY,
      id: 5 + index,
      season: index + 1,
      title: `Season ${index + 1}`,
      watchedCount,
      episodeCount,
    })),
  })

  it('shows how many episodes of a season are left unwatched', async () => {
    open({ details: withSeasons([[1, 3]]) })
    expect(await screen.findByText('2 unwatched episodes')).toBeInTheDocument()
  })

  it('reads as partly pressed when some episodes are watched', async () => {
    open({
      details: withSeasons([
        [3, 3],
        [0, 2],
      ]),
    })
    expect(await screen.findByRole('button', { name: 'Watched' })).toHaveAttribute(
      'aria-pressed',
      'mixed',
    )
  })

  it('reads as pressed when all are watched, and unpressed when none is', async () => {
    open({ details: withSeasons([[3, 3]]) })
    expect(await screen.findByRole('button', { name: 'Watched' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    cleanup()
    open({ details: withSeasons([[0, 3]]) })
    expect(await screen.findByRole('button', { name: 'Watched' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('marks everything watched from a partly watched show, then everything unwatched', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    open({ details: withSeasons([[1, 3]]) })
    await userEvent.click(await screen.findByRole('button', { name: 'Watched' }))
    cleanup()
    open({ details: withSeasons([[3, 3]]) })
    await userEvent.click(await screen.findByRole('button', { name: 'Watched' }))
    set.mockRestore()
    const targets = [{ kind: 'item', id: 4, libraryId: null }]
    expect(calls).toEqual([
      { watched: true, targets },
      { watched: false, targets },
    ])
  })

  it('selects its season cards from a Select button, and marks them by item with no library', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('link', { name: /Season 1/ }))
    expect(screen.queryByText(/^Show /)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mark unwatched' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    set.mockRestore()
    expect(calls).toEqual([{ watched: false, targets: [{ kind: 'item', id: 5, libraryId: null }] }])
  })

  describe('Download to raven player', () => {
    const handoff = spyOn(ravenPlayer, 'open').mockImplementation(() => {})

    afterEach(() => {
      handoff.mockClear()
    })

    it('is left out while this browser does not open videos in raven player', async () => {
      open()
      await screen.findByRole('heading', { name: 'Severance' })
      expect(screen.queryByRole('button', { name: 'Download to raven player' })).toBeNull()
    })

    it('hands the show to raven player', async () => {
      usePlayerPrefs.setState({ opensInRavenPlayer: true })
      open()
      await userEvent.click(await screen.findByRole('button', { name: 'Download to raven player' }))
      expect(handoff).toHaveBeenCalledTimes(1)
      expect(handoff).toHaveBeenCalledWith(
        `raven://download?server=${encodeURIComponent(window.location.origin)}&item=4`,
      )
    })
  })
})
