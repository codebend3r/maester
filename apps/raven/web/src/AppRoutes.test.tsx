import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import { AUTH_PATHS, AUTH_ROUTES, DESKTOP_PATHS, DESKTOP_REQUESTS } from '@raven/core'
import { AppRoutes } from '@/AppRoutes'
import { api } from '@/lib/api'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { fakeAuthClient, readyConfig } from '@/test/authClient'
import { asDesktop, downloadsMain, sentOfType } from '@/test/desktop'
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

describe('AppRoutes inside Raven', () => {
  const list = spyOn(api, 'listLibraries')

  afterEach(() => list.mockReset())

  it('opens Downloads and On this Mac, which a browser does not have', async () => {
    list.mockImplementation(async () => [])
    const client = downloadsMain()
    asDesktop(client)
    renderWithProviders({ ui: <AppRoutes />, route: DESKTOP_PATHS.downloads })
    expect(await screen.findByRole('heading', { level: 1, name: 'Downloads' })).toBeInTheDocument()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.ready })).toHaveLength(1)
  })

  it('has no Downloads page in a browser', async () => {
    list.mockImplementation(async () => [])
    renderWithProviders({ ui: <AppRoutes />, route: DESKTOP_PATHS.local })
    expect(
      await screen.findByRole('heading', { name: 'Nothing lives at this address' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'On this Mac' })).toBeNull()
  })
})
