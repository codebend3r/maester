import { describe, expect, it } from 'bun:test'
import { cleanup, screen } from '@testing-library/react'
import { RouteView } from '@/components/RouteState/RouteState'
import { renderWithProviders } from '@/test/render'

describe('RouteView', () => {
  it('says why the page could not be read, with an alert icon beside it', () => {
    renderWithProviders({
      ui: (
        <RouteView
          page={{ state: 'error', message: 'The server did not answer' }}
          noun="page"
          shape={null}
        >
          {() => null}
        </RouteView>
      ),
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The server did not answer')
    expect(alert.querySelector('svg')?.dataset.icon).toBe('alert')
  })

  it('offers a way back above the failure where the app has been browsed, and none on a first visit', () => {
    const failed = (
      <RouteView page={{ state: 'error', message: 'Down' }} noun="page" shape={null}>
        {() => null}
      </RouteView>
    )
    renderWithProviders({ ui: failed, route: '/people/7', behind: ['/'] })
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    cleanup()
    renderWithProviders({ ui: failed, route: '/people/7' })
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.queryAllByRole('link')).toEqual([])
  })

  it('stands in for the page in grey while it is read, naming it to a screen reader', () => {
    renderWithProviders({
      ui: (
        <RouteView page={{ state: 'loading' }} noun="history" shape={<p>Grey shapes</p>}>
          {() => null}
        </RouteView>
      ),
    })
    expect(screen.getByText('Opening the history')).toBeInTheDocument()
    expect(screen.getByText('Grey shapes').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('shows the page that is not there when the address names nothing', () => {
    renderWithProviders({
      ui: (
        <RouteView page={{ state: 'missing' }} noun="page" shape={null}>
          {() => null}
        </RouteView>
      ),
    })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Nothing lives at this address' }),
    ).toBeInTheDocument()
  })

  it('makes the page of what the address names once it is read', () => {
    renderWithProviders({
      ui: (
        <RouteView page={{ state: 'ready', data: 'Dune' }} noun="movie" shape={null}>
          {(title) => <h1>{title}</h1>}
        </RouteView>
      ),
    })
    expect(screen.getByRole('heading', { level: 1, name: 'Dune' })).toBeInTheDocument()
  })
})
