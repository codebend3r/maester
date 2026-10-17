import { describe, expect, it } from 'bun:test'
import { cleanup, screen } from '@testing-library/react'
import { DEFAULT_SAGA_BACKDROP } from '@raven/core'
import { SagaDecks } from '@/components/SagaDeck/SagaDeck'
import { POSTER_SIZES } from '@/lib/posters'
import { itemSummary, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('SagaDecks', () => {
  it('fetches each poster in a deck no wider than the deck shows it', () => {
    const { container } = renderWithProviders({
      ui: (
        <SagaDecks
          libraryId={2}
          sagas={[
            {
              tmdbId: '119',
              name: 'The Lord of the Rings Collection',
              backdrop: DEFAULT_SAGA_BACKDROP,
              media: [1, 2].map((id) =>
                matchedMovie({ id, item: itemSummary({ id: id * 10, posterVersion: `p${id}` }) }),
              ),
            },
          ]}
        />
      ),
    })
    const posters = [...container.querySelectorAll('img')]
    expect(posters.map((poster) => poster.getAttribute('srcset')?.split(', ')[0])).toEqual([
      '/api/items/10/images/poster?v=p1&w=185 185w',
      '/api/items/20/images/poster?v=p2&w=185 185w',
    ])
    expect(posters.map((poster) => poster.getAttribute('sizes'))).toEqual([
      POSTER_SIZES.deck,
      POSTER_SIZES.deck,
    ])
  })

  const saga = (watched: boolean[]) => ({
    tmdbId: '119',
    name: 'The Lord of the Rings Collection',
    backdrop: DEFAULT_SAGA_BACKDROP,
    media: watched.map((isWatched, index) =>
      matchedMovie({
        id: index + 1,
        item: itemSummary({ id: (index + 1) * 10 }),
        watched: isWatched,
      }),
    ),
  })

  it('shows the number of movies left unwatched, counted from its movies', () => {
    renderWithProviders({ ui: <SagaDecks libraryId={2} sagas={[saga([true, false, false])]} /> })
    expect(screen.getByText('2 unwatched movies')).toBeInTheDocument()
  })

  it('shows the check when every movie is watched, and nothing when none is', () => {
    renderWithProviders({ ui: <SagaDecks libraryId={2} sagas={[saga([true, true])]} /> })
    expect(screen.getByText('Watched')).toBeInTheDocument()
    cleanup()
    renderWithProviders({ ui: <SagaDecks libraryId={2} sagas={[saga([false, false])]} /> })
    expect(screen.queryByText('Watched')).toBeNull()
    expect(screen.queryByText(/unwatched/)).toBeNull()
  })
})
