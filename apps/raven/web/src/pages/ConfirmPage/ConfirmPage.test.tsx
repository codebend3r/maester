import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthApiError, type Session } from '@supabase/supabase-js'
import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { type AuthConfig, AUTH_CONFIG_STATES, ApiError, MEMBER_STATUSES } from '@raven/core'
import { AppRoutes } from '@/AppRoutes'
import { api } from '@/lib/api'
import { type AuthClient } from '@/lib/authClient'
import { AUTH_ERRORS } from '@/lib/authErrors'
import { AUTH_QUERY, AUTH_ROUTES } from '@/lib/authRoutes'
import { queryKeys } from '@/lib/queryClient'
import { CONFIRM_TYPES, ConfirmPage } from '@/pages/ConfirmPage/ConfirmPage'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import {
  ACCOUNT_ID,
  fakeAccount,
  fakeAuthClient,
  fakeSession,
  readyConfig,
} from '@/test/authClient'
import { Where, renderAuthPage, where } from '@/test/authPage'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const TOKEN_HASH = 'pkce_0123456789abcdef'

type VerifyParams = Parameters<AuthClient['verifyOtp']>[0]
type VerifyResult = Awaited<ReturnType<AuthClient['verifyOtp']>>
type Emit = (session: Session) => void

const confirmed = (session: Session): VerifyResult => ({
  data: { user: session.user, session },
  error: null,
})

const refused = (code: string): VerifyResult => ({
  data: { user: null, session: null },
  error: new AuthApiError('Words from the server', 403, code),
})

const linkTo = ({ type, tokenHash = TOKEN_HASH }: { type: string; tokenHash?: string }) =>
  `${AUTH_ROUTES.confirm}?${new URLSearchParams({
    [AUTH_QUERY.tokenHash]: tokenHash,
    [AUTH_QUERY.type]: type,
  })}`

/**
 * Supabase tells its listeners about the new session before `verifyOtp`
 * resolves; `signedIn` does the same, so a test can see what the page does
 * when it does not (`verified`, which leaves the store as it was).
 */
const signedIn =
  (session: Session = fakeSession()) =>
  async ({ emit }: { emit: Emit }) => {
    emit(session)
    return confirmed(session)
  }

const verified =
  (session: Session = fakeSession()) =>
  async () =>
    confirmed(session)

const renderConfirm = async ({
  route,
  verify,
  authConfig = readyConfig,
  session = null,
}: {
  route: string
  verify: (call: { params: VerifyParams; emit: Emit }) => Promise<VerifyResult>
  authConfig?: AuthConfig
  session?: Session | null
}) => {
  const verifyOtp = mock(async (params: VerifyParams) =>
    verify({
      params,
      emit: (next) => fake.emit({ event: 'SIGNED_IN', session: next }),
    }),
  )
  const fake = fakeAuthClient({ session, calls: { verifyOtp } })
  if (authConfig.state === AUTH_CONFIG_STATES.ready) {
    useAuthSession.getState().start({ config: readyConfig, createClient: () => fake.client })
    await waitFor(() => expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready))
  }
  const rendered = renderWithProviders({
    authConfig,
    route,
    ui: (
      <>
        <Where />
        <Routes>
          <Route path={AUTH_ROUTES.confirm} element={<ConfirmPage />} />
          <Route path="*" element={null} />
        </Routes>
      </>
    ),
  })
  return { ...rendered, verifyOtp, fake }
}

const expired = () =>
  screen.getByRole('heading', { level: 1, name: 'This link has expired or was already used' })

describe('ConfirmPage', () => {
  const getMe = spyOn(api, 'getMe')

  afterEach(() => {
    getMe.mockReset()
    window.history.replaceState(null, '', '/')
  })

  describe.each([
    [CONFIRM_TYPES.email, '/'],
    [CONFIRM_TYPES.recovery, AUTH_ROUTES.reset],
  ])('a %s link that works', (type, destination) => {
    it('spends the token once, with the URL already clean, and leaves once the session is in the store', async () => {
      getMe.mockResolvedValue(fakeAccount())
      const seen: (string | null)[] = []
      const { verifyOtp } = await renderConfirm({
        route: linkTo({ type }),
        verify: async (call) => {
          seen.push(where())
          return signedIn(fakeSession({ userId: ACCOUNT_ID }))(call)
        },
      })

      await waitFor(() => expect(where()).toBe(destination))
      expect(verifyOtp).toHaveBeenCalledTimes(1)
      expect(verifyOtp.mock.calls[0]?.[0]).toEqual({ token_hash: TOKEN_HASH, type })
      expect(seen).toEqual([AUTH_ROUTES.confirm])
      expect(useAuthSession.getState().session?.userId).toBe(ACCOUNT_ID)
    })

    it('waits for the session to reach the store before leaving, so the gate never sees a signed out visitor', async () => {
      getMe.mockResolvedValue(fakeAccount())
      const { fake } = await renderConfirm({
        route: linkTo({ type }),
        verify: verified(),
      })

      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('One moment'))
      expect(where()).toBe(AUTH_ROUTES.confirm)
      expect(useAuthSession.getState().session).toBeNull()

      act(() => fake.emit({ event: 'SIGNED_IN', session: fakeSession() }))

      await waitFor(() => expect(where()).toBe(destination))
    })
  })

  describe.each([
    [CONFIRM_TYPES.email, AUTH_ROUTES.checkEmail, 'Send a new confirmation link'],
    [CONFIRM_TYPES.recovery, AUTH_ROUTES.forgot, 'Send a new reset link'],
  ])('a %s link that does not work', (type, resend, label) => {
    it.each([
      ['expired', async () => refused(AUTH_ERRORS.otpExpired)],
      ['already used or any other refusal', async () => refused('validation_failed')],
      [
        'unreachable',
        async (): Promise<VerifyResult> => {
          throw new TypeError('Failed to fetch')
        },
      ],
    ])(
      'says so, with the URL clean and a way to ask again, when it is %s',
      async (_name, answer) => {
        const seen: (string | null)[] = []
        const { verifyOtp } = await renderConfirm({
          route: linkTo({ type }),
          verify: async () => {
            seen.push(where())
            return answer()
          },
        })

        expect(
          await screen.findByRole('heading', { level: 1, name: /expired or was already used/ }),
        ).toBeInTheDocument()
        expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', resend)
        expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
          'href',
          AUTH_ROUTES.signIn,
        )
        expect(verifyOtp).toHaveBeenCalledTimes(1)
        expect(seen).toEqual([AUTH_ROUTES.confirm])
        expect(where()).toBe(AUTH_ROUTES.confirm)
        expect(useAuthSession.getState().session).toBeNull()
      },
    )

    it('says so when the answer carries no session', async () => {
      await renderConfirm({
        route: linkTo({ type }),
        verify: async () => ({ data: { user: null, session: null }, error: null }),
      })

      expect(await screen.findByRole('link', { name: label })).toBeInTheDocument()
    })

    it('shows the error and no way to resend when the token is missing, without spending anything', async () => {
      const { verifyOtp } = await renderConfirm({
        route: linkTo({ type, tokenHash: '' }),
        verify: verified(),
      })

      expect(expired()).toBeInTheDocument()
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', resend)
      expect(verifyOtp).not.toHaveBeenCalled()
      expect(where()).toBe(AUTH_ROUTES.confirm)
    })
  })

  it.each([
    ['an unknown type', linkTo({ type: 'magiclink' })],
    ['a type that is not allowed here', linkTo({ type: 'email_change' })],
    ['an empty type', linkTo({ type: '' })],
    ['no type', `${AUTH_ROUTES.confirm}?${AUTH_QUERY.tokenHash}=${TOKEN_HASH}`],
    ['no token', `${AUTH_ROUTES.confirm}?${AUTH_QUERY.type}=${CONFIRM_TYPES.email}`],
  ])('shows the error and spends nothing for %s', async (_name, route) => {
    const { verifyOtp } = await renderConfirm({ route, verify: verified() })

    expect(expired()).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
      'href',
      AUTH_ROUTES.signIn,
    )
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(where()).toBe(AUTH_ROUTES.confirm)
  })

  it.each([
    ['an unknown type', linkTo({ type: 'magiclink' })],
    ['no parameters', AUTH_ROUTES.confirm],
  ])('offers only sign in for %s', async (_name, route) => {
    await renderConfirm({ route, verify: verified() })

    expect(screen.queryByRole('link', { name: /Send a new/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument()
  })

  it('shows the error, not a spinner, on a second visit with no parameters', async () => {
    const { verifyOtp } = await renderConfirm({ route: AUTH_ROUTES.confirm, verify: verified() })

    expect(expired()).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Confirming your link' })).toBeNull()
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(where()).toBe(AUTH_ROUTES.confirm)
  })

  it('shows that it is working while the token is checked', async () => {
    const pending = held<VerifyResult>()
    await renderConfirm({
      route: linkTo({ type: CONFIRM_TYPES.email }),
      verify: () => pending.promise,
    })

    expect(screen.getByRole('heading', { level: 1, name: 'Confirming your link' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('One moment')

    await act(async () => pending.answer(refused(AUTH_ERRORS.otpExpired)))
    expect(
      await screen.findByRole('heading', { name: /expired or was already used/ }),
    ).toBeVisible()
  })

  it('spends the token once under StrictMode, which runs every effect twice', async () => {
    getMe.mockResolvedValue(fakeAccount())
    const verifyOtp = mock(async (_params: VerifyParams) => refused(AUTH_ERRORS.otpExpired))
    const fake = fakeAuthClient({ calls: { verifyOtp } })
    useAuthSession.setState({
      client: fake.client,
      status: AUTH_SESSION_STATUSES.ready,
      session: null,
    })

    renderWithProviders({
      authConfig: readyConfig,
      route: linkTo({ type: CONFIRM_TYPES.email }),
      ui: (
        <StrictMode>
          <Where />
          <Routes>
            <Route path={AUTH_ROUTES.confirm} element={<ConfirmPage />} />
          </Routes>
        </StrictMode>
      ),
    })

    expect(
      await screen.findByRole('heading', { name: /expired or was already used/ }),
    ).toBeVisible()
    expect(verifyOtp).toHaveBeenCalledTimes(1)
    expect(where()).toBe(AUTH_ROUTES.confirm)
  })

  it('clears the URL at once and spends the token when the client arrives', async () => {
    const verifyOtp = mock(async (_params: VerifyParams) => confirmed(fakeSession()))
    const fake = fakeAuthClient({ calls: { verifyOtp } })
    useAuthSession.setState({ client: null, status: AUTH_SESSION_STATUSES.ready, session: null })
    getMe.mockResolvedValue(fakeAccount())
    renderWithProviders({
      authConfig: readyConfig,
      route: linkTo({ type: CONFIRM_TYPES.email }),
      ui: (
        <>
          <Where />
          <Routes>
            <Route path={AUTH_ROUTES.confirm} element={<ConfirmPage />} />
          </Routes>
        </>
      ),
    })

    await waitFor(() => expect(where()).toBe(AUTH_ROUTES.confirm))
    expect(verifyOtp).not.toHaveBeenCalled()

    act(() => useAuthSession.setState({ client: fake.client }))

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1))
    expect(verifyOtp.mock.calls[0]?.[0]).toEqual({
      token_hash: TOKEN_HASH,
      type: CONFIRM_TYPES.email,
    })
  })

  it('has the token out of window.location before verifyOtp is called', async () => {
    window.history.replaceState(null, '', linkTo({ type: CONFIRM_TYPES.email }))
    const seen: string[] = []
    const verifyOtp = mock(async (_params: VerifyParams) => {
      seen.push(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      return refused(AUTH_ERRORS.otpExpired)
    })
    const fake = fakeAuthClient({ calls: { verifyOtp } })
    useAuthSession.setState({
      client: fake.client,
      status: AUTH_SESSION_STATUSES.ready,
      session: null,
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(queryKeys.authConfig, readyConfig)

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ConfirmPage />
        </BrowserRouter>
      </QueryClientProvider>,
    )

    expect(
      await screen.findByRole('heading', { name: /expired or was already used/ }),
    ).toBeVisible()
    expect(seen).toEqual([AUTH_ROUTES.confirm])
    expect(window.location.search).toBe('')
  })

  describe('a visitor who is already signed in', () => {
    it('stays on the page until the token is spent, then goes where the link leads', async () => {
      getMe.mockResolvedValue(fakeAccount())
      const pending = held<VerifyResult>()
      await renderConfirm({
        route: linkTo({ type: CONFIRM_TYPES.recovery }),
        session: fakeSession(),
        verify: ({ emit }) => {
          void pending.promise.then((result) => result.data.session && emit(result.data.session))
          return pending.promise
        },
      })

      await waitFor(() => expect(getMe).toHaveBeenCalled())
      expect(screen.getByRole('heading', { name: 'Confirming your link' })).toBeVisible()
      expect(where()).toBe(AUTH_ROUTES.confirm)

      await act(async () => pending.answer(confirmed(fakeSession())))

      await waitFor(() => expect(where()).toBe(AUTH_ROUTES.reset))
    })

    it.each([
      ['approved', MEMBER_STATUSES.approved],
      ['pending', MEMBER_STATUSES.pending],
      ['revoked', MEMBER_STATUSES.revoked],
    ])('sees the error for a link that fails, not a redirect, when %s', async (_name, status) => {
      getMe.mockResolvedValue(fakeAccount({ status }))
      await renderConfirm({
        route: linkTo({ type: CONFIRM_TYPES.email }),
        session: fakeSession(),
        verify: async () => refused(AUTH_ERRORS.otpExpired),
      })

      expect(
        await screen.findByRole('heading', { name: /expired or was already used/ }),
      ).toBeVisible()
      expect(where()).toBe(AUTH_ROUTES.confirm)
    })
  })

  describe('what the server says about accounts', () => {
    it('sends a visitor home while accounts are off', async () => {
      const { verifyOtp } = await renderConfirm({
        route: linkTo({ type: CONFIRM_TYPES.email }),
        authConfig: { state: AUTH_CONFIG_STATES.off },
        verify: verified(),
      })

      await waitFor(() => expect(where()).toBe('/'))
      expect(verifyOtp).not.toHaveBeenCalled()
    })

    it('shows a notice while accounts cannot be reached', async () => {
      await renderConfirm({
        route: linkTo({ type: CONFIRM_TYPES.email }),
        authConfig: { state: AUTH_CONFIG_STATES.unavailable },
        verify: verified(),
      })

      expect(
        screen.getByRole('heading', { level: 1, name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
      expect(where()).toBe(AUTH_ROUTES.confirm)
    })

    it('shows the notice when the account cannot be read', async () => {
      getMe.mockRejectedValue(new ApiError({ status: 503, message: 'Unavailable' }))
      await renderConfirm({
        route: AUTH_ROUTES.confirm,
        session: fakeSession(),
        verify: verified(),
      })

      expect(
        await screen.findByRole('heading', { name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
    })
  })

  it('takes the whole screen at /auth/confirm, outside the gate and the browsing frame', () => {
    renderAuthPage({ path: '*', page: <AppRoutes />, route: AUTH_ROUTES.confirm })

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('main')).toContainElement(expired())
  })
})
