import { describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CastRow, castMembers } from '@/components/CastRow/CastRow'
import { itemDetails } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('castMembers', () => {
  it('lists someone who acts and directs once, with both roles', () => {
    expect(castMembers(itemDetails().credits).map((member) => [member.name, member.roles])).toEqual(
      [
        ['Mark Kimball', ['Rudy', 'Director']],
        ['Ana Ortiz', ['Lena']],
        ['Jo Park', ['Screenplay']],
      ],
    )
  })
})

describe('CastRow', () => {
  it('shows photos where TMDB has them and initials where it does not', () => {
    const { container } = renderWithProviders({ ui: <CastRow credits={itemDetails().credits} /> })
    expect(screen.getByRole('heading', { name: 'Cast & Crew' })).toBeInTheDocument()
    expect(screen.getByText('Rudy / Director')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/pictures/people/1/k1')
    expect(screen.getByRole('link', { name: /Mark Kimball/ })).toHaveAttribute('href', '/people/1')
    expect(screen.getByText('AO')).toBeInTheDocument()
  })

  it('scrolls a page at a time from its buttons, and takes focus to scroll by keyboard', async () => {
    renderWithProviders({ ui: <CastRow credits={itemDetails().credits} /> })
    const row = screen.getByRole('list', { name: 'Cast & Crew' })
    Object.defineProperty(row, 'clientWidth', { value: 800 })
    const scrolled: number[] = []
    spyOn(row, 'scrollBy').mockImplementation((options?: ScrollToOptions | number) => {
      if (typeof options === 'object') scrolled.push(options.left ?? 0)
    })
    await userEvent.click(screen.getByRole('button', { name: 'Later in the cast' }))
    await userEvent.click(screen.getByRole('button', { name: 'Earlier in the cast' }))
    expect(scrolled).toEqual([720, -720])
    expect(row).toHaveAttribute('tabindex', '0')
  })

  it('shows nothing without credits', () => {
    const { container } = renderWithProviders({ ui: <CastRow credits={[]} /> })
    expect(container.textContent).toBe('')
  })
})
