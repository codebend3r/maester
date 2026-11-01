import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { mediaLabel } from '@raven/core'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@raven/ui/headless'
import { ContinueWatching, timeLeft } from '@/pages/HomePage/ContinueWatching'
import { itemDetails, itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { EPISODE_TWO, SEASON_ONE_CARD } from '@/test/tv'
import { reported } from '@/test/viewport'

const MOVIE = matchedMovie({
  id: 20,
  duration: 6000,
  position: 1500,
  item: itemSummary({ id: 40, posterVersion: 'p1', backdropVersion: 'b1' }),
})

const section = () => screen.getByRole('region', { name: 'Continue watching' })
const tiles = () => within(section()).getAllByRole('listitem')

describe('timeLeft', () => {
  it('says how long is left, in hours and minutes', () => {
    expect(timeLeft(MOVIE)).toBe('1h 15m left')
    expect(timeLeft(EPISODE_TWO)).toBe('45m left')
  })

  it('says nothing until the length is known, or once nothing is left', () => {
    expect(timeLeft(mediaItem({ duration: null, position: 30 }))).toBeNull()
    expect(timeLeft(mediaItem({ duration: 300, position: 300 }))).toBeNull()
  })
})

describe('ContinueWatching', () => {
  afterEach(cleanup)

  it('shows each video in progress as a tile under its heading, the most recent first', () => {
    renderWithProviders({
      ui: (
        <ContinueWatching
          entries={[
            { media: EPISODE_TWO, poster: SEASON_ONE_CARD },
            { media: MOVIE, poster: MOVIE.item },
          ]}
        />
      ),
    })
    expect(within(section()).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Continue watching',
    )
    expect(tiles().map((tile) => tile.textContent)).toEqual([
      'SeveranceS01E02 · Half Loop1080p45m left',
      'Busboys20261080p1h 15m left',
    ])
  })

  it('resumes the video from anywhere on the tile, and opens its page from its name', () => {
    renderWithProviders({
      ui: <ContinueWatching entries={[{ media: EPISODE_TWO, poster: SEASON_ONE_CARD }]} />,
    })
    const [tile] = tiles()
    expect(
      within(tile!).getByRole('link', { name: `Play ${mediaLabel(EPISODE_TWO)}` }),
    ).toHaveAttribute('href', '/watch/13')
    expect(within(tile!).getByRole('link', { name: mediaLabel(EPISODE_TWO) })).toHaveAttribute(
      'href',
      '/episodes/7?library=2',
    )
  })

  it("wears its show's backdrop, with the show's logo in the corner, once the show's page is read", async () => {
    const client = new QueryClient()
    client.setQueryData(
      queryKeys.item(4),
      itemDetails({ id: 4, backdropVersion: 'b9', logoVersion: 'l9' }),
    )
    const episode = {
      ...EPISODE_TWO,
      item: { ...EPISODE_TWO.item!, show: { id: 4, title: 'Severance' } },
    }
    renderWithProviders({
      ui: <ContinueWatching entries={[{ media: episode, poster: SEASON_ONE_CARD }]} />,
      client,
    })
    await reported()
    const sources = [...section().querySelectorAll('img')].map((img) => img.getAttribute('src'))
    expect(sources).toEqual([
      expect.stringContaining('/api/pictures/items/4/logo'),
      expect.stringContaining('/api/pictures/items/4/backdrop'),
    ])
    expect(section().querySelector('img[src*="/logo"]')?.getAttribute('alt')).toBe('')
  })

  it('shows a frame grab as its backdrop where the show has no art to read', async () => {
    const clip = mediaItem({
      id: 8,
      title: 'Clip',
      duration: 600,
      position: 60,
      thumbnailVersion: 3,
    })
    renderWithProviders({ ui: <ContinueWatching entries={[{ media: clip, poster: null }]} /> })
    await reported()
    const sources = [...section().querySelectorAll('img')].map((img) => img.getAttribute('src'))
    expect(sources).toEqual(['/api/media/8/thumbnail?v=3'])
  })

  it('has only the link that plays a file with no page, its name as plain words', () => {
    const clip = mediaItem({ id: 8, title: 'Clip', duration: 600, position: 60 })
    renderWithProviders({ ui: <ContinueWatching entries={[{ media: clip, poster: null }]} /> })
    expect(
      within(section())
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/watch/8'])
    expect(within(section()).getByText('Clip')).toBeInTheDocument()
  })

  it('draws no picture for a video with no art at all, only its words', () => {
    const blank = mediaItem({ id: 9, title: 'Blank', thumbnail: 'pending', position: 30 })
    renderWithProviders({ ui: <ContinueWatching entries={[{ media: blank, poster: null }]} /> })
    expect(section().querySelectorAll('img')).toHaveLength(0)
    expect(within(section()).getByText('Blank')).toBeInTheDocument()
  })

  it('marks its resolution beside the year, and leaves it out of a file not yet probed', () => {
    const unprobed = mediaItem({
      id: 8,
      title: 'Clip',
      duration: 600,
      position: 60,
      width: null,
      height: null,
    })
    renderWithProviders({
      ui: (
        <ContinueWatching
          entries={[
            { media: MOVIE, poster: MOVIE.item },
            { media: unprobed, poster: null },
          ]}
        />
      ),
    })
    const [movie, clip] = tiles()
    expect(within(movie!).getByLabelText('Video resolution: 1080p')).toHaveTextContent('1080p')
    expect(within(clip!).queryByLabelText(/^Video resolution/)).toBeNull()
  })

  it("opens the card's menu on a right click", () => {
    renderWithProviders({
      ui: <ContinueWatching entries={[{ media: MOVIE, poster: MOVIE.item }]} />,
    })
    fireEvent.contextMenu(within(section()).getByRole('link', { name: 'Play Busboys (2026)' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
