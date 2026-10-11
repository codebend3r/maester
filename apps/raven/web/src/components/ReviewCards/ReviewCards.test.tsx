import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewCards, starsOf, timeAgo } from '@/components/ReviewCards/ReviewCards'
import { review } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('timeAgo and starsOf', () => {
  it('reads a time as hours, days or years ago', () => {
    const now = new Date('2026-10-11T12:00:00.000Z')
    expect(timeAgo({ at: '2026-10-11T06:00:00.000Z', now })).toMatch(/6\s?h/)
    expect(timeAgo({ at: '2026-10-08T12:00:00.000Z', now })).toMatch(/3\s?d/)
    expect(timeAgo({ at: '2024-10-11T12:00:00.000Z', now })).toMatch(/2\s?y/)
    expect(timeAgo({ at: '2026-10-11T11:59:50.000Z', now })).toBe('just now')
  })

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
