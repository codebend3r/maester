import { describe, expect, it } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import { RatingBadge, RatingChip, RatingPanel } from '@/components/RatingPanel/RatingPanel'

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

  it('names the source and its meaning in a visual tooltip, and the label under the score', () => {
    render(
      <RatingPanel
        ratings={[{ source: 'rottenTomatoes', kind: 'critic', value: 9.2, votes: null }]}
      />,
    )
    const item = screen.getByRole('listitem')
    const meaning = within(item).getByText('Critics who reviewed it positively')
    expect(meaning.parentElement).toHaveTextContent(
      'Rotten TomatoesCritics who reviewed it positively',
    )
    expect(meaning.parentElement).toHaveAttribute('aria-hidden', 'true')
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

describe('RatingChip', () => {
  const ALL = [
    { source: 'metacritic', kind: 'critic', value: 5.8, votes: null },
    { source: 'tmdb', kind: 'audience', value: 7.3, votes: 100 },
    { source: 'rottenTomatoes', kind: 'critic', value: 9.2, votes: null },
    { source: 'imdb', kind: 'audience', value: 7.2, votes: null },
  ] as const

  it('is one chip that reads every score to a screen reader, in the panel order', () => {
    render(<RatingChip ratings={ALL} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Ratings: Rotten Tomatoes 92%, IMDb 7.2 out of 10, Metacritic 58 out of 100, TMDB 7.3 out of 10',
    )
  })

  it('leads with TMDB, else the first it has, and counts the rest', () => {
    const { container, rerender } = render(<RatingChip ratings={ALL} />)
    expect(container.textContent).toContain('+3')
    rerender(<RatingChip ratings={ALL.filter((rating) => rating.source !== 'tmdb')} />)
    expect(container.textContent).toContain('+2')
  })

  it('lists each score in the popover, and has none for a single score', () => {
    const { container, rerender } = render(<RatingChip ratings={ALL} />)
    expect(container.querySelectorAll('ul > li')).toHaveLength(4)
    rerender(<RatingChip ratings={ALL.slice(1, 2)} />)
    expect(container.querySelector('ul')).toBeNull()
    expect(container.textContent).not.toContain('+')
  })

  it('renders nothing without scores', () => {
    const { container } = render(<RatingChip ratings={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('RatingBadge', () => {
  const rating = { source: 'rottenTomatoes', kind: 'critic', value: 9.2, votes: null } as const

  it('names the source and its scale by default', () => {
    const { container } = render(<RatingBadge rating={rating} />)
    expect(container.textContent).toContain('Tomatometer')
  })

  it('keeps only the score when bare, still naming the source for a screen reader', () => {
    const { container } = render(<RatingBadge rating={rating} isBare />)
    expect(container.textContent).toBe('Rotten Tomatoes: 92%92')
    expect(container.textContent).not.toMatch(/tomatometer/i)
  })
})
