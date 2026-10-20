import { afterEach, describe, expect, it, jest, mock, spyOn } from 'bun:test'
import { AuthApiError } from '@supabase/supabase-js'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AUTH_CONFIG_STATES, ApiError, MEMBER_STATUSES, AUTH_ROUTES } from '@raven/core'
import { AppRoutes } from '@/AppRoutes'
import { api } from '@/lib/api'
import { type AuthClient } from '@/lib/authClient'
import { AUTH_ERRORS } from '@/lib/authErrors'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage/ForgotPasswordPage'
import { AUTH_SESSION_STATUSES } from '@/stores/authSession'
import { fakeAccount } from '@/test/authClient'
import { type AuthPageOptions, passSeconds, renderAuthPage, where } from '@/test/authPage'
import { held } from '@/test/held'

type ResetResult = Awaited<ReturnType<AuthClient['resetPasswordForEmail']>>

const sent = (): ResetResult => ({ data: {}, error: null })

const refused = ({ code, status }: { code: string; status: number }): ResetResult => ({
  data: null,
  error: new AuthApiError('Words from the server', status, code),
})

const SENT_MESSAGE = 'If that address has an account, a link is on its way.'

const renderForgot = (options: AuthPageOptions = {}) =>
  renderAuthPage({ path: AUTH_ROUTES.forgot, page: <ForgotPasswordPage />, ...options })

const email = () => screen.getByLabelText('Email')
const submit = () => screen.getByRole('button', { name: /^(Send|Sending)/ })

describe('ForgotPasswordPage', () => {
  const getMe = spyOn(api, 'getMe')

  afterEach(() => {
    getMe.mockReset()
    jest.useRealTimers()
  })

  it('asks for an email, with a way back to sign in', () => {
    renderForgot()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Reset your password' }),
    ).toBeInTheDocument()
    expect(email()).toHaveAttribute('type', 'email')
    expect(email()).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
      'href',
      AUTH_ROUTES.signIn,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('asks Supabase to send the link to raven’s confirm route, then says it is on its way', async () => {
    const user = userEvent.setup()
    const attempt = held<ResetResult>()
    const resetPasswordForEmail = mock(
      (_email: string, _options?: Parameters<AuthClient['resetPasswordForEmail']>[1]) =>
        attempt.promise,
    )
    renderForgot({ calls: { resetPasswordForEmail } })
    await user.type(email(), ' jordan@example.com ')

    await user.click(submit())

    expect(submit()).toHaveTextContent('Sending…')
    expect(submit()).toBeDisabled()
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1)
    expect(resetPasswordForEmail.mock.calls[0]).toEqual([
      'jordan@example.com',
      { redirectTo: 'http://localhost:8484/auth/confirm' },
    ])

    await act(async () => attempt.answer(sent()))
    expect(await screen.findByRole('status')).toHaveTextContent(SENT_MESSAGE)
  })

  it.each([
    ['a known address', async () => sent()],
    ['an unknown address', async () => sent()],
    [
      'a user the server will not name',
      async () => refused({ code: 'user_not_found', status: 400 }),
    ],
    ['an unknown error code', async () => refused({ code: 'something_new', status: 500 })],
    [
      'a request that never arrived',
      async (): Promise<ResetResult> => {
        throw new TypeError('Failed to fetch')
      },
    ],
  ])('says the same thing for %s', async (_name, resetPasswordForEmail) => {
    const user = userEvent.setup()
    renderForgot({ calls: { resetPasswordForEmail } })
    await user.type(email(), 'jordan@example.com')

    await user.click(submit())

    const message = await screen.findByRole('status')
    expect(message).toHaveTextContent(SENT_MESSAGE)
    expect(message.textContent).toBe(SENT_MESSAGE)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Words from the server')).toBeNull()
  })

  it('asks to wait when the server limits the emails, and leaves the button free', async () => {
    const user = userEvent.setup()
    renderForgot({
      calls: {
        resetPasswordForEmail: async () =>
          refused({ code: AUTH_ERRORS.overEmailSendRateLimit, status: 429 }),
      },
    })
    await user.type(email(), 'jordan@example.com')

    await user.click(submit())

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Wait a moment before asking again.',
    )
    expect(submit()).toBeEnabled()
    expect(submit()).toHaveTextContent('Send reset link')
  })

  it('holds the button for 60 seconds with a countdown after sending, then frees it', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    renderForgot({ calls: { resetPasswordForEmail: async () => sent() } })
    await user.type(email(), 'jordan@example.com')

    await user.click(submit())
    await screen.findByRole('status')

    expect(submit()).toBeDisabled()
    expect(submit()).toHaveTextContent('Send again in 60s')

    passSeconds(60)
    expect(submit()).toBeEnabled()
    expect(submit()).toHaveTextContent('Send reset link')
  })

  describe('what the server says about accounts', () => {
    it('shows a notice instead of the form while accounts cannot be reached', () => {
      renderForgot({ authConfig: { state: AUTH_CONFIG_STATES.unavailable } })

      expect(
        screen.getByRole('heading', { level: 1, name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('Email')).toBeNull()
    })

    it('sends a visitor home while accounts are off', async () => {
      renderForgot({ authConfig: { state: AUTH_CONFIG_STATES.off } })

      await waitFor(() => expect(where()).toBe('/'))
    })

    it('waits while the config or the stored session is read', () => {
      renderForgot({ status: AUTH_SESSION_STATUSES.booting })

      expect(screen.getByRole('status')).toHaveTextContent('Checking your account')
      expect(screen.queryByLabelText('Email')).toBeNull()
    })

    it('sends an approved visitor already signed in home', async () => {
      getMe.mockResolvedValue(fakeAccount())
      renderForgot({ isSignedIn: true })

      await waitFor(() => expect(where()).toBe('/'))
    })

    it('sends a visitor signed in without approval to the pending screen', async () => {
      getMe.mockResolvedValue(fakeAccount({ status: MEMBER_STATUSES.pending }))
      renderForgot({ isSignedIn: true })

      await waitFor(() => expect(where()).toBe(AUTH_ROUTES.pending))
    })

    it('shows the notice when the account cannot be read', async () => {
      getMe.mockRejectedValue(new ApiError({ status: 503, message: 'Unavailable' }))
      renderForgot({ isSignedIn: true })

      expect(
        await screen.findByRole('heading', { name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
    })
  })

  it('takes the whole screen at /forgot-password, outside the browsing frame', () => {
    renderAuthPage({ path: '*', page: <AppRoutes />, route: AUTH_ROUTES.forgot })

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }))
    expect(email()).toBeInTheDocument()
  })
})
