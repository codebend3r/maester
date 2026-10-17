import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { FavouriteMark, FavouriteWords } from '@/components/FavouriteMark/FavouriteMark'
import { mediaItem } from '@/test/fixtures'

describe('FavouriteMark', () => {
  it('shows a heart with the word Favourite for a favourite', () => {
    const { container } = render(<FavouriteMark media={mediaItem({ favourite: true })} />)
    expect(screen.getByText('Favourite')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('shows nothing for a video that is not a favourite', () => {
    const { container } = render(<FavouriteMark media={mediaItem()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('leaves the word to the card when decorative', () => {
    const { container } = render(
      <FavouriteMark media={mediaItem({ favourite: true })} tone="overlay" decorative />,
    )
    expect(screen.queryByText('Favourite')).toBeNull()
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('takes the place its container gives it', () => {
    const { container } = render(
      <FavouriteMark media={mediaItem({ favourite: true })} tone="scrim" className="corner" />,
    )
    expect(container.firstElementChild).toHaveClass('corner')
  })
})

describe('FavouriteWords', () => {
  it('says Favourite only for a favourite', () => {
    const { container, rerender } = render(<FavouriteWords media={mediaItem()} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<FavouriteWords media={mediaItem({ favourite: true })} />)
    expect(screen.getByText('Favourite')).toBeInTheDocument()
  })
})
