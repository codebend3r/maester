import { describe, expect, it } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import { RatingPanel } from '@/components/RatingPanel/RatingPanel'

describe('RatingPanel', () => {
  it('reads each score with its source and what it means', () => {
    render(
      <RatingPanel
        ratings={[
          { source: 'rottenTomatoes', kind: 'critic', value: 9.2, votes: null },
          { source: 'imdb', kind: 'audience', value: 8.5, votes: null },
          { source: 'metacritic', kind: 'critic', value: 7.9, votes: null },
          { source: 'tmdb', kind: 'audience', value: 8.2, votes: 1840 },
        ]}
      />,
    )
    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Rotten Tomatoes: 92%. Critics who reviewed it positively.',
      'IMDb: 8.5 out of 10. Average user rating.',
      'Metacritic: 79 out of 100. Weighted critic score.',
      'TMDB: 8.2 out of 10. Average user rating.',
    ])
  })

  it('lists the sources in a fixed order whatever order they arrive in', () => {
    render(
      <RatingPanel
        ratings={[
          { source: 'tmdb', kind: 'audience', value: 7.2, votes: 1055 },
          { source: 'metacritic', kind: 'critic', value: 5.4, votes: null },
        ]}
      />,
    )
    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Metacritic: 54 out of 100. Weighted critic score.',
      'TMDB: 7.2 out of 10. Average user rating.',
    ])
  })

  it('names the source and its meaning in a tooltip, and the label under the score', () => {
    render(
      <RatingPanel
        ratings={[{ source: 'rottenTomatoes', kind: 'critic', value: 9.2, votes: null }]}
      />,
    )
    const item = screen.getByRole('listitem')
    const tooltip = within(item).getByRole('tooltip', { hidden: true })
    expect(tooltip).toHaveTextContent('Rotten TomatoesCritics who reviewed it positively')
    expect(item).toHaveTextContent('Tomatometer')
  })

  it('can be reached from the keyboard', () => {
    render(
      <RatingPanel ratings={[{ source: 'imdb', kind: 'audience', value: 8.5, votes: null }]} />,
    )
    expect(screen.getByRole('listitem')).toHaveAttribute('tabindex', '0')
  })

  it('leaves out a source with no score, and shows nothing without any', () => {
    const { container } = render(<RatingPanel ratings={[]} />)
    expect(container.textContent).toBe('')
  })
})
