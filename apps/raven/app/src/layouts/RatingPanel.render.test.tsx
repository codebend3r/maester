import { describe, expect, it } from '@jest/globals'
import { RATING_KINDS, RATING_SOURCES } from '@raven/core'
import { render, screen } from '@testing-library/react-native'

import { RatingPanel } from '@/layouts/RatingPanel'
import { SIZES } from '@/theme/appTheme'

const RATINGS = [
  { source: RATING_SOURCES.tmdb, kind: RATING_KINDS.audience, value: 7, votes: 900 },
  { source: RATING_SOURCES.rottenTomatoes, kind: RATING_KINDS.critic, value: 7.2, votes: null },
  { source: RATING_SOURCES.metacritic, kind: RATING_KINDS.critic, value: 6, votes: null },
  { source: RATING_SOURCES.imdb, kind: RATING_KINDS.audience, value: 6.4, votes: 1200 },
] as const

describe('RatingPanel', () => {
  it('shows every score in the web panel order, each read out with its scale and meaning', async () => {
    await render(<RatingPanel ratings={RATINGS} sizes={SIZES} />)
    expect(
      screen
        .getAllByLabelText(/^(Rotten Tomatoes|IMDb|Metacritic|TMDB):/)
        .map((cell) => cell.props.accessibilityLabel),
    ).toEqual([
      'Rotten Tomatoes: 72%. Critics who reviewed it positively.',
      'IMDb: 6.4 out of 10. Average user rating.',
      'Metacritic: 60 out of 100. Weighted critic score.',
      'TMDB: 7.0 out of 10. Average user rating.',
    ])
    expect(screen.getByText('Tomatometer')).toBeTruthy()
  })

  it('draws nothing for a title with no score', async () => {
    await render(<RatingPanel ratings={[]} sizes={SIZES} />)
    expect(screen.queryByLabelText('Ratings')).toBeNull()
  })
})
