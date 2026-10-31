import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, screen, within } from '@testing-library/react'
import {
  ApiError,
  AUTH_CONFIG_STATES,
  AUTH_PATHS,
  AUTH_ROUTES,
  DESKTOP_PATHS,
  DESKTOP_REQUESTS,
} from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { AppRoutes } from '@/AppRoutes'
import { api } from '@/lib/api'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { fakeAuthClient, readyConfig } from '@/test/authClient'
import { asDesktop, downloadsMain, sentOfType } from '@/test/desktop'
import { albumDetails, musicLibrary } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { useServerReach } from '@/stores/serverReach'

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

  it('keeps the music mode while the server is out of reach, and goes back once it answers', async () => {
    list.mockImplementation(async () => [musicLibrary()])
    const getAlbum = spyOn(api, 'getAlbum').mockResolvedValue(albumDetails())
    const getAuthConfig = spyOn(api, 'getAuthConfig').mockRejectedValue(
      new ApiError({ status: 502, message: 'Bad Gateway', isServerUnreachable: true }),
    )
    try {
      asDesktop(downloadsMain())
      const { client } = renderWithProviders({
        ui: <AppRoutes />,
        route: '/music/albums/7',
        authConfig: null,
      })
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Downloads' }),
      ).toBeInTheDocument()
      const music = screen.getByRole('navigation', { name: 'Music' })
      expect(within(music).getByRole('link', { name: 'Downloads' })).toHaveAttribute(
        'aria-current',
        'page',
      )
      act(() => client.setQueryData(queryKeys.authConfig, { state: AUTH_CONFIG_STATES.off }))
      expect(
        await screen.findByRole('heading', { level: 1, name: 'OK Computer' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('navigation', { name: 'Music' })).toBeInTheDocument()
    } finally {
      cleanup()
      getAuthConfig.mockRestore()
      getAlbum.mockRestore()
      useServerReach.setState({ isOffline: false })
    }
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
