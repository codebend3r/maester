import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { WatchedCount, WatchedCountWords } from '@/components/WatchedCount/WatchedCount'

describe('WatchedCount', () => {
  it('shows the check when everything is watched', () => {
    const { container } = render(<WatchedCount watched={9} total={9} />)
    expect(screen.getByText('Watched')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('shows the number left, with its words, when some is', () => {
    render(<WatchedCount watched={3} total={9} />)
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('6 unwatched episodes')).toBeInTheDocument()
  })

  it('says one unwatched episode in the singular', () => {
    render(<WatchedCount watched={8} total={9} />)
    expect(screen.getByText('1 unwatched episode')).toBeInTheDocument()
  })

  it('names the movies of a saga', () => {
    render(<WatchedCount watched={1} total={3} unit="movie" />)
    expect(screen.getByText('2 unwatched movies')).toBeInTheDocument()
  })

  it('shows nothing when none is watched', () => {
    const { container } = render(<WatchedCount watched={0} total={9} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing for an empty show', () => {
    const { container } = render(<WatchedCount watched={0} total={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('leaves the words to the card when decorative', () => {
    const { container } = render(<WatchedCount watched={3} total={9} decorative />)
    expect(screen.queryByText('6 unwatched episodes')).toBeNull()
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('WatchedCountWords', () => {
  it('says the same words alone, and nothing when none is watched', () => {
    const { container, rerender } = render(<WatchedCountWords watched={0} total={9} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<WatchedCountWords watched={9} total={9} />)
    expect(screen.getByText('Watched')).toBeInTheDocument()
  })
})
