import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type AuthConfig, AUTH_CONFIG_STATES } from '@raven/core'
import { useMediaOrigin } from '@raven/ui'
import { render, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MediaOriginProbe, useReprobe } from '@/components/MediaOriginProbe/MediaOriginProbe'
import { api } from '@/lib/api'
import { queryKeys } from '@raven/ui/headless'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { SIGNED_IN, fakeAccount, readyConfig } from '@/test/authClient'
import { asDesktop } from '@/test/desktop'

afterEach(() => useMediaOrigin.setState({ pick: null, isProbing: false }))

const clientWith = ({ config }: { config: AuthConfig }) => {
  const client = new QueryClient()
  client.setQueryData(queryKeys.authConfig, config)
  return client
}

const wrapperOf =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MediaOriginProbe>{children}</MediaOriginProbe>
    </QueryClientProvider>
  )

const accountsOff = () => clientWith({ config: { state: AUTH_CONFIG_STATES.off } })

describe('MediaOriginProbe', () => {
  it('asks for the media origins as it mounts', () => {
    const origins = spyOn(api, 'getMediaOrigins').mockImplementation(() => new Promise(() => {}))
    render(
      <QueryClientProvider client={accountsOff()}>
        <MediaOriginProbe>
          <p>The app</p>
        </MediaOriginProbe>
      </QueryClientProvider>,
    )
    expect(origins).toHaveBeenCalledTimes(1)
    origins.mockRestore()
  })

  it('asks for nothing inside Raven, whose mpv finds its own way to the server', () => {
    const origins = spyOn(api, 'getMediaOrigins').mockImplementation(() => new Promise(() => {}))
    asDesktop()
    const { getByText } = render(
      <QueryClientProvider client={accountsOff()}>
        <MediaOriginProbe>
          <p>The app</p>
        </MediaOriginProbe>
      </QueryClientProvider>,
    )
    expect(getByText('The app')).toBeInTheDocument()
    expect(origins).not.toHaveBeenCalled()
    origins.mockRestore()
  })

  it('hands reprobe to what plays media beneath it', () => {
    const origins = spyOn(api, 'getMediaOrigins').mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useReprobe(), { wrapper: wrapperOf(accountsOff()) })
    expect(typeof result.current).toBe('function')
    origins.mockRestore()
  })

  it('draws the app and asks for nothing while nobody is signed in', () => {
    const origins = spyOn(api, 'getMediaOrigins').mockImplementation(() => new Promise(() => {}))
    const { getByText } = render(
      <QueryClientProvider client={clientWith({ config: readyConfig })}>
        <MediaOriginProbe>
          <p>The sign-in page</p>
        </MediaOriginProbe>
      </QueryClientProvider>,
    )
    expect(getByText('The sign-in page')).toBeInTheDocument()
    expect(origins).not.toHaveBeenCalled()
    origins.mockRestore()
  })

  it('asks once an account is approved', () => {
    const origins = spyOn(api, 'getMediaOrigins').mockImplementation(() => new Promise(() => {}))
    const client = clientWith({ config: readyConfig })
    const account = fakeAccount()
    client.setQueryData(queryKeys.account(account.id), account)
    client.setQueryDefaults(queryKeys.account(account.id), { staleTime: Infinity })
    useAuthSession.setState({
      status: AUTH_SESSION_STATUSES.ready,
      session: { ...SIGNED_IN, userId: account.id },
    })
    render(
      <QueryClientProvider client={client}>
        <MediaOriginProbe>
          <p>The app</p>
        </MediaOriginProbe>
      </QueryClientProvider>,
    )
    expect(origins).toHaveBeenCalledTimes(1)
    origins.mockRestore()
  })

  it('fails loudly for a player with no probe around it', () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useReprobe())).toThrow('MediaOriginProbe')
    quiet.mockRestore()
  })
})
