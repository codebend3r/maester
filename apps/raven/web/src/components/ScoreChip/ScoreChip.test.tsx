import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { ScoreChip, ratingLabel } from '@/components/ScoreChip/ScoreChip'

describe('ScoreChip', () => {
  it('labels the score for a screen reader', () => {
    render(<ScoreChip rating={{ source: 'tmdb', kind: 'audience', value: 8.2, votes: 10 }} />)
    expect(screen.getByLabelText('TMDB audience score, 82%')).toBeInTheDocument()
  })
})

describe('ratingLabel', () => {
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
})
