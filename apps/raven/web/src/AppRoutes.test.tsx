import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import { AUTH_PATHS, AUTH_ROUTES } from '@raven/core'
import { AppRoutes } from '@/AppRoutes'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { fakeAuthClient, readyConfig } from '@/test/authClient'
import { renderWithProviders } from '@/test/render'

describe('AppRoutes signed out', () => {
  const fetch = spyOn(window, 'fetch')

  afterEach(() => fetch.mockReset())

  it('asks the server for its accounts config and nothing else on the sign-in page', async () => {
    fetch.mockImplementation(
      Object.assign(async () => Response.json(readyConfig), { preconnect: () => undefined }),
    )
    useAuthSession.setState({
      client: fakeAuthClient().client,
      status: AUTH_SESSION_STATUSES.ready,
      session: null,
    })
    renderWithProviders({
      ui: <AppRoutes />,
      route: AUTH_ROUTES.signIn,
      authConfig: null,
      playback: null,
      display: null,
      adminLock: null,
    })

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([AUTH_PATHS.config])
  })
})
