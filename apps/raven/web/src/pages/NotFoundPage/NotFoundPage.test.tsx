import { describe, expect, it } from 'bun:test'
import { act, screen } from '@testing-library/react'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { useTheme } from '@/stores/theme'
import { renderWithProviders } from '@/test/render'

describe('NotFoundPage', () => {
  it('says nothing lives here, and leads back to the libraries or home', () => {
    renderWithProviders({ ui: <NotFoundPage />, route: '/nowhere' })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Nothing lives at this address' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/may have been removed, or the link is incomplete/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to libraries' })).toHaveAttribute(
      'href',
      '/libraries',
    )
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
  })

  it('keeps its 4, poster and 4 from a screen reader, the mark drawn for the theme', () => {
    const { container } = renderWithProviders({ ui: <NotFoundPage /> })
    const mark = container.querySelector('img')
    expect(mark?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(mark).toHaveAttribute('src', '/brand/raven-mark-on-dark.svg')
    act(() => useTheme.setState({ theme: 'patina' }))
    expect(mark).toHaveAttribute('src', '/brand/raven-mark-on-light.svg')
  })
})
