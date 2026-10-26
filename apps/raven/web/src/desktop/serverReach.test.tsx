import { afterEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { ApiError, AUTH_CONFIG_STATES, DESKTOP_PATHS } from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthGate } from '@/components/AuthGate/AuthGate'
import { DesktopHost } from '@/desktop/DesktopHost'
import { OFFLINE_RETRY_MS } from '@/desktop/serverReach'
import { api } from '@/lib/api'
import { useServerReach } from '@/stores/serverReach'
import { Where, where } from '@/test/authPage'
import { asDesktop } from '@/test/desktop'

type RenderHostProps = { route?: string; ui?: ReactNode }

/** The host over a fresh cache, with nothing else reading the account config unless `ui` does. */
const renderHost = ({ route = '/', ui = null }: RenderHostProps = {}) => {
  asDesktop()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        {ui}
        <DesktopHost />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { client }
}

const UNREACHABLE = new ApiError({ status: 502, message: 'Bad Gateway', isServerUnreachable: true })

type FailConfigProps = { client: QueryClient; error: Error }

const failConfig = ({ client, error }: FailConfigProps) =>
  act(() =>
    client
      .fetchQuery({
        queryKey: queryKeys.authConfig,
        queryFn: () => Promise.reject(error),
        retry: false,
      })
      .catch(() => undefined),
  )

const isOffline = () => useServerReach.getState().isOffline

describe('following whether the server can be reached', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('goes offline when the web host says the server is out of reach, or the network fails', async () => {
    const { client } = renderHost()
    await failConfig({
      client,
      error: new ApiError({ status: 502, message: 'Bad Gateway', isServerUnreachable: true }),
    })
    expect(isOffline()).toBe(true)
    act(() => useServerReach.setState({ isOffline: false }))
    await failConfig({ client, error: new TypeError('Failed to fetch') })
    expect(isOffline()).toBe(true)
  })

  it("stays as it was when the server's own answer fails, and comes back once it answers", async () => {
    const { client } = renderHost()
    await failConfig({ client, error: new ApiError({ status: 500, message: 'Broken' }) })
    expect(isOffline()).toBe(false)
    act(() => useServerReach.setState({ isOffline: true }))
    act(() => client.setQueryData(queryKeys.authConfig, { state: AUTH_CONFIG_STATES.off }))
    expect(isOffline()).toBe(false)
  })

  it('asks the server again while it is out of reach, and stops once it answers', () => {
    jest.useFakeTimers()
    useServerReach.setState({ isOffline: true })
    const { client } = renderHost()
    const refetch = jest.spyOn(client, 'refetchQueries').mockResolvedValue()
    act(() => jest.advanceTimersByTime(OFFLINE_RETRY_MS))
    expect(refetch).toHaveBeenCalledWith({ queryKey: queryKeys.authConfig, exact: true })
    act(() => useServerReach.setState({ isOffline: false }))
    act(() => jest.advanceTimersByTime(OFFLINE_RETRY_MS * 2))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('goes offline when a later read fails out of reach, and back once the server answers at all', async () => {
    const { client } = renderHost()
    act(() => client.setQueryData(queryKeys.authConfig, { state: AUTH_CONFIG_STATES.off }))
    expect(isOffline()).toBe(false)
    await failConfig({ client, error: UNREACHABLE })
    expect(isOffline()).toBe(true)
    await failConfig({ client, error: new ApiError({ status: 503, message: 'Unavailable' }) })
    expect(isOffline()).toBe(false)
  })

  it('sends a page that needs the server to Downloads, and back to it once the server answers', async () => {
    const getAuthConfig = spyOn(api, 'getAuthConfig').mockRejectedValue(UNREACHABLE)
    const { client } = renderHost({
      route: '/libraries/3?sort=year',
      ui: (
        <Routes>
          <Route element={<AuthGate />}>
            <Route path="*" element={<Where />} />
          </Route>
        </Routes>
      ),
    })
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
    act(() => client.setQueryData(queryKeys.authConfig, { state: AUTH_CONFIG_STATES.off }))
    expect(where()).toBe('/libraries/3?sort=year')
    getAuthConfig.mockRestore()
  })

  it('stays where the person went while the server was out of reach', async () => {
    useServerReach.setState({ isOffline: true })
    const { client } = renderHost({
      route: DESKTOP_PATHS.local,
      ui: (
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      ),
    })
    act(() => client.setQueryData(queryKeys.authConfig, { state: AUTH_CONFIG_STATES.off }))
    expect(isOffline()).toBe(false)
    expect(where()).toBe(DESKTOP_PATHS.local)
  })
})
