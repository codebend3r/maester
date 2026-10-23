import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  type AuthConfig,
  ApiError,
  AUTH_CONFIG_STATES,
  AUTH_REFUSALS,
  MEMBER_STATUSES,
  AUTH_ROUTES,
} from '@raven/core'
import { AuthGate } from '@/components/AuthGate/AuthGate'
import { api } from '@/lib/api'
import { queryKeys } from '@raven/ui/headless'
import { queryClient } from '@/lib/queryClient'
import { signOut } from '@/lib/session'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { SIGNED_IN, fakeAccount, fakeAuthClient, fakeSession, readyConfig } from '@/test/authClient'
import { Where } from '@/test/authPage'
import { renderWithProviders } from '@/test/render'

const renderGate = ({
  authConfig = readyConfig,
  isSignedIn = true,
  route = '/libraries/3?x=1',
}: {
  authConfig?: AuthConfig | null
  isSignedIn?: boolean
  route?: string
} = {}) => {
  useAuthSession.setState({
    status: AUTH_SESSION_STATUSES.ready,
    session: isSignedIn ? SIGNED_IN : null,
  })
  return renderWithProviders({
    authConfig,
    route,
    ui: (
      <Routes>
        <Route element={<AuthGate />}>
          <Route path="*" element={<p>Library</p>} />
        </Route>
        <Route path={AUTH_ROUTES.signIn} element={<Where />} />
        <Route path={AUTH_ROUTES.pending} element={<Where />} />
      </Routes>
    ),
  })
}

const refused = ({ status, reason }: { status: number; reason: ApiError['refusal'] }) =>
  new ApiError({ status, message: 'Refused', refusal: reason })

describe('AuthGate', () => {
  const getMe = spyOn(api, 'getMe')
  const getAuthConfig = spyOn(api, 'getAuthConfig')

  afterEach(() => {
    getMe.mockReset()
    getAuthConfig.mockReset()
    queryClient.clear()
  })

  it('shows a loading screen until the account is read', () => {
    getMe.mockImplementation(() => new Promise(() => undefined))
    renderGate()
    expect(screen.getByRole('status')).toHaveTextContent('Checking your account')
    expect(screen.queryByText('Library')).toBeNull()
  })

  it('shows the loading screen while the stored session is read', () => {
    getMe.mockImplementation(() => new Promise(() => undefined))
    renderGate()
    act(() => useAuthSession.setState({ status: AUTH_SESSION_STATUSES.booting, session: null }))
    expect(screen.queryByText('Library')).toBeNull()
  })

  it('shows the page for an approved account', async () => {
    getMe.mockResolvedValue(fakeAccount())
    renderGate()
    expect(await screen.findByText('Library')).toBeInTheDocument()
  })

  it('shows the page without asking for an account while accounts are off', () => {
    renderGate({ authConfig: { state: AUTH_CONFIG_STATES.off }, isSignedIn: false })
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(getMe).not.toHaveBeenCalled()
  })

  it('shows a panel, not the page, while accounts cannot be reached', async () => {
    const user = userEvent.setup()
    getAuthConfig.mockResolvedValue(readyConfig)
    getMe.mockResolvedValue(fakeAccount())
    renderGate({ authConfig: { state: AUTH_CONFIG_STATES.unavailable }, isSignedIn: false })

    expect(
      screen.getByRole('heading', { name: 'raven is temporarily unavailable' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('raven could not reach its accounts. Try again in a moment.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Library')).toBeNull()
    expect(getMe).not.toHaveBeenCalled()

    act(() => useAuthSession.setState({ session: SIGNED_IN }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Library')).toBeInTheDocument()
    expect(getAuthConfig).toHaveBeenCalledTimes(1)
  })

  it('sends a signed out visitor to sign in, remembering where they were', async () => {
    renderGate({ isSignedIn: false })
    expect(await screen.findByTestId('where')).toHaveTextContent(
      '/sign-in?return_to=%2Flibraries%2F3%3Fx%3D1',
    )
    expect(getMe).not.toHaveBeenCalled()
  })

  it('sends a visitor whose session the server refuses to sign in', async () => {
    getMe.mockRejectedValue(
      refused({
        status: 401,
        reason: { reason: AUTH_REFUSALS.signedOut, message: 'Sign in to continue.' },
      }),
    )
    renderGate()
    expect(await screen.findByTestId('where')).toHaveTextContent('/sign-in?return_to=')
  })

  it('sends a pending account to the pending screen', async () => {
    getMe.mockResolvedValue(fakeAccount({ status: MEMBER_STATUSES.pending }))
    renderGate()
    expect(await screen.findByTestId('where')).toHaveTextContent(AUTH_ROUTES.pending)
  })

  it('sends an account with no membership yet to the pending screen', async () => {
    getMe.mockRejectedValue(
      refused({
        status: 403,
        reason: { reason: AUTH_REFUSALS.pending, message: 'Your account is awaiting approval.' },
      }),
    )
    renderGate()
    expect(await screen.findByTestId('where')).toHaveTextContent(AUTH_ROUTES.pending)
  })

  it('sends a removed account to the pending screen', async () => {
    getMe.mockRejectedValue(
      refused({
        status: 403,
        reason: { reason: AUTH_REFUSALS.revoked, message: 'Your access has been removed.' },
      }),
    )
    renderGate()
    expect(await screen.findByTestId('where')).toHaveTextContent(AUTH_ROUTES.pending)
  })

  it('offers to try again on a 503, without leaving the page or signing out', async () => {
    const user = userEvent.setup()
    getMe.mockRejectedValueOnce(
      refused({
        status: 503,
        reason: { reason: AUTH_REFUSALS.unavailable, message: 'Accounts are unavailable.' },
      }),
    )
    renderGate()

    expect(
      await screen.findByRole('heading', { name: 'Account access is temporarily unavailable' }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('where')).toBeNull()
    expect(useAuthSession.getState().session).not.toBeNull()

    getAuthConfig.mockResolvedValue(readyConfig)
    getMe.mockResolvedValue(fakeAccount())
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Library')).toBeInTheDocument()
  })

  it('offers to try again when the network fails', async () => {
    getMe.mockRejectedValue(new TypeError('Failed to fetch'))
    renderGate()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('where')).toBeNull())
  })

  it('goes to sign in after Sign out although the gate reads what the sign out empties', async () => {
    const user = userEvent.setup()
    getMe.mockResolvedValue(fakeAccount())
    getAuthConfig.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(readyConfig), 30)),
    )
    const fake = fakeAuthClient({
      session: fakeSession(),
      calls: {
        signOut: async () => {
          fake.emit({ event: 'SIGNED_OUT', session: null })
          // Supabase answers after its listeners ran, long enough for the page to render.
          await new Promise((resolve) => setTimeout(resolve, 10))
          return { error: null }
        },
      },
    })
    useAuthSession.setState({ client: null, session: null, status: AUTH_SESSION_STATUSES.booting })
    useAuthSession.getState().start({ config: readyConfig, createClient: () => fake.client })
    const LeaveButton = () => {
      const client = useQueryClient()
      return <button onClick={() => signOut({ queryClient: client })}>Leave</button>
    }
    queryClient.setQueryData(queryKeys.authConfig, readyConfig)
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/libraries/3']}>
          <Routes>
            <Route element={<AuthGate />}>
              <Route path="*" element={<LeaveButton />} />
            </Route>
            <Route path={AUTH_ROUTES.signIn} element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Leave' }))

    expect(await screen.findByTestId('where')).toHaveTextContent(AUTH_ROUTES.signIn)
  })
})
