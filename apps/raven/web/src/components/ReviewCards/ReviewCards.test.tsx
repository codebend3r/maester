import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewCards, starsOf } from '@/components/ReviewCards/ReviewCards'
import { review } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('starsOf', () => {
  it('turns a score out of 10 into stars out of 5, halves allowed', () => {
    expect(starsOf(8)).toBe(4)
    expect(starsOf(7)).toBe(3.5)
    expect(starsOf(10)).toBe(5)
  })
})

describe('ReviewCards', () => {
  it('shows each review with its author, stars and four lines, and the whole thing as text on Read', async () => {
    renderWithProviders(
      <ReviewCards
        reviews={[
          review({
            id: 1,
            author: 'Mallory',
            rating: 7,
            content: 'First paragraph with <b>tags</b>.\n\nSecond paragraph.',
          }),
          review({ id: 2, author: 'Nobody Here', rating: null, avatarVersion: null }),
        ]}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Reviews from TMDB members' })).toBeInTheDocument()
    expect(screen.getByText('Mallory')).toBeInTheDocument()
    expect(screen.getByText('3.5 out of 5 stars')).toBeInTheDocument()
    expect(screen.getByText('NH')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Read' })[0] ?? document.body)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/First paragraph with <b>tags<\/b>\./)).toBeInTheDocument()
    expect(within(dialog).getByText(/Second paragraph\./)).toBeInTheDocument()
    expect(dialog.querySelector('b')).toBeNull()
    expect(within(dialog).getByRole('link', { name: 'Read on TMDB' })).toHaveAttribute(
      'href',
      'https://www.themoviedb.org/review/abc',
    )
  })

  it('shows nothing without reviews', () => {
    const { container } = renderWithProviders(<ReviewCards reviews={[]} />)
    expect(container.textContent).toBe('')
  })
})
