import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { WatchedMark, WatchedWords } from '@/components/WatchedMark/WatchedMark'

describe('WatchedMark', () => {
  it('shows a check with the words Watched for a watched video', () => {
    const { container } = render(<WatchedMark watched />)
    expect(screen.getByText('Watched')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('shows nothing for an unwatched video', () => {
    const { container } = render(<WatchedMark watched={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('leaves the words to the card when decorative', () => {
    const { container } = render(<WatchedMark watched decorative />)
    expect(screen.queryByText('Watched')).toBeNull()
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('takes the place its container gives it', () => {
    const { container } = render(<WatchedMark watched className="corner" />)
    expect(container.firstElementChild).toHaveClass('corner')
  })
})

describe('WatchedWords', () => {
  it('says Watched only for a watched video', () => {
    const { container, rerender } = render(<WatchedWords watched={false} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<WatchedWords watched />)
    expect(screen.getByText('Watched')).toBeInTheDocument()
  })
})
