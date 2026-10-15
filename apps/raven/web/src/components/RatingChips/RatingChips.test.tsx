import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { RatingChips, ratingLabel } from '@/components/RatingChips/RatingChips'

describe('RatingChips', () => {
  it('labels each score for a screen reader', () => {
    render(<RatingChips ratings={[{ source: 'tmdb', kind: 'audience', value: 8.2, votes: 10 }]} />)
    expect(screen.getByRole('listitem', { name: 'TMDB audience score, 82%' })).toBeInTheDocument()
  })

  it('shows each source the way it scores', () => {
    expect(ratingLabel({ source: 'imdb', kind: 'audience', value: 7.5, votes: null })).toBe(
      'IMDb, 7.5 out of 10',
    )
    expect(ratingLabel({ source: 'metacritic', kind: 'critic', value: 7.4, votes: null })).toBe(
      'Metacritic, 74 out of 100',
    )
    expect(ratingLabel({ source: 'rottenTomatoes', kind: 'critic', value: 4.1, votes: null })).toBe(
      'Rotten Tomatoes critics, 41%, rotten',
    )
    expect(ratingLabel({ source: 'rottenTomatoes', kind: 'critic', value: 8.5, votes: null })).toBe(
      'Rotten Tomatoes critics, 85%, fresh',
    )
  })

  it('shows nothing without scores', () => {
    const { container } = render(<RatingChips ratings={[]} />)
    expect(container.textContent).toBe('')
  })

  it('gives every source a chip in a fixed order, saying which have no score', () => {
    render(
      <RatingChips
        ratings={[
          { source: 'tmdb', kind: 'audience', value: 7.2, votes: 1055 },
          { source: 'imdb', kind: 'audience', value: 6.3, votes: null },
          { source: 'metacritic', kind: 'critic', value: 5.4, votes: null },
        ]}
        shouldShowEverySource
      />,
    )
    expect(screen.getAllByRole('listitem').map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Rotten Tomatoes: no score',
      'IMDb, 6.3 out of 10',
      'Metacritic, 54 out of 100',
      'TMDB audience score, 72%',
    ])
  })

  it('still shows every source when there are no scores at all', () => {
    render(<RatingChips ratings={[]} shouldShowEverySource />)
    expect(screen.getAllByRole('listitem').map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Rotten Tomatoes: no score',
      'IMDb: no score',
      'Metacritic: no score',
      'TMDB: no score',
    ])
  })
})
