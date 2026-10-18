import { afterEach, describe, expect, it, jest, mock, spyOn } from 'bun:test'
import { AuthApiError } from '@supabase/supabase-js'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { type AuthConfig, AUTH_CONFIG_STATES, AUTH_COOKIE } from '@raven/core'
import { AppRoutes } from '@/AppRoutes'
import { AUTH_ERRORS, type AuthClient } from '@/lib/authClient'
import { AUTH_ROUTES, checkEmailPath } from '@/lib/authRoutes'
import { CheckEmailPage } from '@/pages/CheckEmailPage/CheckEmailPage'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { fakeAuthClient } from '@/test/authClient'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const ready: AuthConfig = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_test',
  webUrl: 'http://localhost:8484',
  cookieName: AUTH_COOKIE,
}

type ResendResult = Awaited<ReturnType<AuthClient['resend']>>

const sent = (): ResendResult => ({ data: { user: null, session: null }, error: null })

const refusedResend = (code: string): ResendResult => ({
  data: { user: null, session: null },
  error: new AuthApiError('Words from the server', 429, code),
})

const Where = () => {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{`${pathname}${search}`}</p>
}

const ADDRESS = 'jordan@example.com'

const renderCheckEmail = ({
  calls = {},
  route = checkEmailPath({ email: ADDRESS }),
  authConfig = ready,
}: { calls?: Partial<AuthClient>; route?: string; authConfig?: AuthConfig } = {}) => {
  const fake = fakeAuthClient({ calls })
  useAuthSession.setState({
    client: fake.client,
    status: AUTH_SESSION_STATUSES.ready,
    session: null,
  })
  return renderWithProviders({
    authConfig,
    route,
    ui: (
      <Routes>
        <Route path={AUTH_ROUTES.checkEmail} element={<CheckEmailPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    ),
  })
}

// The countdown arms a timer per second, so each second is its own step.
const passSeconds = (seconds: number) =>
  Array.from({ length: seconds }).forEach(() => act(() => jest.advanceTimersByTime(1000)))

const resendButton = () => screen.getByRole('button', { name: /^Resend/ })

describe('CheckEmailPage', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('names the address the link went to, with a way back to sign in', () => {
    renderCheckEmail()

    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText(ADDRESS)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
      'href',
      AUTH_ROUTES.signIn,
    )
    expect(resendButton()).toBeEnabled()
    expect(resendButton()).toHaveTextContent('Resend')
  })

  it('says to check spam and that the owner approves accounts by hand', () => {
    renderCheckEmail()

    expect(screen.getByText(/spam/)).toBeInTheDocument()
    expect(screen.getByText(/approves each new account/)).toBeInTheDocument()
  })

  it.each([
    ['no address', AUTH_ROUTES.checkEmail],
    ['an empty address', `${AUTH_ROUTES.checkEmail}?email=`],
    ['a blank address', `${AUTH_ROUTES.checkEmail}?email=%20%20`],
  ])('shows a neutral message and no resend for %s', (_name, route) => {
    renderCheckEmail({ route })

    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText(/link to confirm your address/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Resend/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      AUTH_ROUTES.signIn,
    )
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      AUTH_ROUTES.signUp,
    )
  })

  it('resends to the address, holds the button for 60 seconds with a countdown, then frees it', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    const resend = mock((_credentials: Parameters<AuthClient['resend']>[0]) =>
      Promise.resolve(sent()),
    )
    renderCheckEmail({ calls: { resend } })

    await user.click(resendButton())

    expect(resend).toHaveBeenCalledTimes(1)
    expect(resend.mock.calls[0]?.[0]).toEqual({ type: 'signup', email: ADDRESS })
    expect(await screen.findByRole('status')).toHaveTextContent('Email sent.')
    expect(resendButton()).toBeDisabled()
    expect(resendButton()).toHaveTextContent('Resend in 60s')

    passSeconds(1)
    expect(resendButton()).toHaveTextContent('Resend in 59s')

    passSeconds(58)
    expect(resendButton()).toBeDisabled()
    expect(resendButton()).toHaveTextContent('Resend in 1s')

    passSeconds(1)
    expect(resendButton()).toBeEnabled()
    expect(resendButton()).toHaveTextContent(/^Resend$/)
  })

  it('holds the button while it resends', async () => {
    const user = userEvent.setup()
    const pending = held<ResendResult>()
    renderCheckEmail({ calls: { resend: () => pending.promise } })

    await user.click(resendButton())
    expect(resendButton()).toBeDisabled()

    await act(async () => pending.answer(sent()))
    expect(await screen.findByRole('status')).toHaveTextContent('Email sent.')
  })

  it('asks to wait when the server limits the emails, and leaves the button free', async () => {
    const user = userEvent.setup()
    renderCheckEmail({
      calls: { resend: async () => refusedResend(AUTH_ERRORS.overEmailSendRateLimit) },
    })

    await user.click(resendButton())

    expect(await screen.findByText('Wait a moment before asking again.')).toBeInTheDocument()
    expect(resendButton()).toBeEnabled()
  })

  it('says when the email could not be sent', async () => {
    const user = userEvent.setup()
    renderCheckEmail({
      calls: {
        resend: async () => {
          throw new TypeError('Failed to fetch')
        },
      },
    })

    await user.click(resendButton())

    expect(await screen.findByText('Could not resend. Try again.')).toBeInTheDocument()
    expect(resendButton()).toBeEnabled()
  })

  it('stops counting when the page goes away', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    const { unmount } = renderCheckEmail({ calls: { resend: async () => sent() } })
    await user.click(resendButton())
    await screen.findByRole('status')
    const clear = spyOn(globalThis, 'clearTimeout')

    unmount()

    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })

  it('sends a visitor home while accounts are off', async () => {
    renderCheckEmail({ authConfig: { state: AUTH_CONFIG_STATES.off } })

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it('takes the whole screen at /check-email, outside the browsing frame', () => {
    const { client } = fakeAuthClient()
    useAuthSession.setState({ client, status: AUTH_SESSION_STATUSES.ready, session: null })
    renderWithProviders({
      ui: <AppRoutes />,
      route: checkEmailPath({ email: ADDRESS }),
      authConfig: ready,
    })

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }))
  })
})
