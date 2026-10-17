import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { RouteState } from '@/components/RouteState/RouteState'
import { renderWithProviders } from '@/test/render'

describe('RouteState', () => {
  it('says why the page could not be read, with an alert icon beside it', () => {
    renderWithProviders(
      <RouteState
        state={{ state: 'error', message: 'The server did not answer' }}
        noun="page"
        shape={null}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The server did not answer')
    expect(alert.querySelector('svg')?.dataset.icon).toBe('alert')
  })

  it('stands in for the page in grey while it is read, naming it to a screen reader', () => {
    renderWithProviders(
      <RouteState state={{ state: 'loading' }} noun="history" shape={<p>Grey shapes</p>} />,
    )
    expect(screen.getByText('Opening the history')).toBeInTheDocument()
    expect(screen.getByText('Grey shapes').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('shows the page that is not there when the address names nothing', () => {
    renderWithProviders(<RouteState state={{ state: 'missing' }} noun="page" shape={null} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Nothing lives at this address' }),
    ).toBeInTheDocument()
  })
})
