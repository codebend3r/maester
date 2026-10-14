import { describe, expect, it } from 'bun:test'
import { DEFAULT_SAGA_BACKDROP } from '@raven/core'
import { SagaDecks } from '@/components/SagaDeck/SagaDeck'
import { POSTER_SIZES } from '@/lib/posters'
import { itemSummary, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('SagaDecks', () => {
  it('fetches each poster in a deck no wider than the deck shows it', () => {
    const { container } = renderWithProviders(
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
      />,
    )
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
})
