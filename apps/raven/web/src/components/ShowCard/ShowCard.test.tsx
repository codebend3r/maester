import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { ShowCard, ShowGrid } from '@/components/ShowCard/ShowCard'
import { showEntry } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('ShowCard', () => {
  it("opens the show's page, plays the next episode, and says the years and count", () => {
    const { container } = renderWithProviders(
      <ul>
        <ShowCard entry={showEntry()} />
      </ul>,
    )
    expect(screen.getByRole('link', { name: 'Severance' })).toHaveAttribute('href', '/shows/4')
    expect(screen.getByRole('link', { name: 'Play Severance S01E02' })).toHaveAttribute(
      'href',
      '/watch/12',
    )
    expect(screen.getByText('2022 to now')).toBeInTheDocument()
    expect(screen.getByText('9 episodes')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/items/4/images/poster?v=p1')
  })

  it('gives an ended show both years, and no play button once every episode is watched', () => {
    renderWithProviders(
      <ShowGrid
        shows={[
          showEntry({
            show: { ...showEntry().show, year: 2014 },
            endedYear: 2024,
            episodes: 1,
            next: null,
          }),
        ]}
      />,
    )
    expect(screen.getByText('2014 to 2024')).toBeInTheDocument()
    expect(screen.getByText('1 episode')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Play/ })).toBeNull()
  })
})
