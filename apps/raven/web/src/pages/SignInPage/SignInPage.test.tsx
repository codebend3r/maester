import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { AuthApiError } from '@supabase/supabase-js'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AUTH_CONFIG_STATES, ApiError, MEMBER_STATUSES, AUTH_ROUTES } from '@raven/core'
import { AppRoutes } from '@/AppRoutes'
import { api } from '@/lib/api'
import { type AuthClient } from '@/lib/authClient'
import { AUTH_ERRORS } from '@/lib/authErrors'
import { AUTH_QUERY } from '@/lib/authRoutes'
import { SignInPage } from '@/pages/SignInPage/SignInPage'
import { AUTH_SESSION_STATUSES } from '@/stores/authSession'
import { fakeAccount, fakeSession } from '@/test/authClient'
import { type AuthPageOptions, renderAuthPage, where } from '@/test/authPage'
import { held } from '@/test/held'

type SignInResult = Awaited<ReturnType<AuthClient['signInWithPassword']>>
type ResendResult = Awaited<ReturnType<AuthClient['resend']>>

const signedIn = (): SignInResult => {
  const session = fakeSession()
  return { data: { user: session.user, session }, error: null }
}

const refusedSignIn = (code: string): SignInResult => ({
  data: { user: null, session: null },
  error: new AuthApiError('Words from the server', 400, code),
})

const sent = (): ResendResult => ({ data: { user: null, session: null }, error: null })

const refusedResend = (code: string): ResendResult => ({
  data: { user: null, session: null },
  error: new AuthApiError('Words from the server', 429, code),
})

const renderSignIn = (options: AuthPageOptions = {}) =>
  renderAuthPage({ path: AUTH_ROUTES.signIn, page: <SignInPage />, ...options })

const email = () => screen.getByLabelText('Email')
const password = () => screen.getByLabelText('Password')
const submit = () => screen.getByRole('button', { name: /^Sign(ing)? in/ })

const fillIn = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(email(), 'jordan@example.com')
  await user.type(password(), 'correct-horse')
}

const returnTo = (path: string) =>
  `${AUTH_ROUTES.signIn}?${new URLSearchParams({ [AUTH_QUERY.returnTo]: path })}`

describe('SignInPage', () => {
  const getMe = spyOn(api, 'getMe')
  const getAuthConfig = spyOn(api, 'getAuthConfig')

  afterEach(() => {
    getMe.mockReset()
    getAuthConfig.mockReset()
  })

  it('asks for an email and a password, with links to the other auth pages', () => {
    renderSignIn()

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByText('Sign in to watch on localhost')).toBeInTheDocument()
    expect(email()).toHaveAttribute('type', 'email')
    expect(email()).toHaveAttribute('autocomplete', 'username')
    expect(password()).toHaveAttribute('type', 'password')
    expect(password()).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.queryByLabelText('Server')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      AUTH_ROUTES.forgot,
    )
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      AUTH_ROUTES.signUp,
    )
    expect(submit()).toHaveTextContent('Sign in')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the password with Show and hides it again with Hide', async () => {
    const user = userEvent.setup()
    renderSignIn()
    await user.type(password(), 'correct-horse')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password()).toHaveAttribute('type', 'text')
    expect(password()).toHaveValue('correct-horse')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password()).toHaveAttribute('type', 'password')
  })

  it('takes the fields in order from the keyboard', async () => {
    const user = userEvent.setup()
    renderSignIn()
    const order = [
      email(),
      password(),
      screen.getByRole('button', { name: 'Show password' }),
      screen.getByRole('link', { name: 'Forgot password?' }),
      submit(),
      screen.getByRole('link', { name: 'Create an account' }),
    ]
    await order.reduce(async (previous, field) => {
      await previous
      await user.tab()
      expect(field).toHaveFocus()
    }, Promise.resolve())
  })

  it('reads Signing in… while it signs in, then goes to the return path', async () => {
    const user = userEvent.setup()
    const attempt = held<SignInResult>()
    const signInWithPassword = mock((_credentials: { email: string; password: string }) => {
      return attempt.promise
    })
    renderSignIn({
      calls: { signInWithPassword },
      route: returnTo('/libraries/3?x=1'),
    })
    await fillIn(user)
    await user.click(submit())

    expect(submit()).toHaveTextContent('Signing in…')
    expect(submit()).toBeDisabled()
    expect(signInWithPassword).toHaveBeenCalledTimes(1)
    expect(signInWithPassword.mock.calls[0]?.[0]).toEqual({
      email: 'jordan@example.com',
      password: 'correct-horse',
    })

    attempt.answer(signedIn())
    await waitFor(() => expect(where()).toBe('/libraries/3?x=1'))
  })

  it.each([
    ['no return path', AUTH_ROUTES.signIn],
    ['a protocol-relative return path', returnTo('//evil.example')],
    ['an absolute return URL', returnTo('https://evil.example')],
  ])('goes home after %s', async (_name, route) => {
    const user = userEvent.setup()
    renderSignIn({ calls: { signInWithPassword: async () => signedIn() }, route })
    await fillIn(user)
    await user.click(submit())

    await waitFor(() => expect(where()).toBe('/'))
  })

  it('says the email or password is wrong, marking the password as the field to fix', async () => {
    const user = userEvent.setup()
    renderSignIn({
      calls: { signInWithPassword: async () => refusedSignIn(AUTH_ERRORS.invalidCredentials) },
    })
    await fillIn(user)
    await user.click(submit())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email or password is wrong.')
    expect(password()).toHaveAttribute('aria-invalid', 'true')
    expect(password()).toHaveAccessibleDescription('Email or password is wrong.')
    expect(password().parentElement).toHaveClass('invalid')
    expect(submit()).toHaveTextContent('Sign in')
    expect(submit()).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Resend confirmation email' })).toBeNull()
  })

  it.each([
    ['an unknown error code', async () => refusedSignIn('something_new')],
    [
      'a request that never arrived',
      async (): Promise<SignInResult> => {
        throw new TypeError('Failed to fetch')
      },
    ],
  ])('says sign in failed for %s', async (_name, signInWithPassword) => {
    const user = userEvent.setup()
    renderSignIn({ calls: { signInWithPassword } })
    await fillIn(user)
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in failed. Try again.')
    expect(password()).toHaveAttribute('aria-invalid', 'true')
    expect(password()).toHaveAccessibleDescription('Sign in failed. Try again.')
  })

  it('clears the alert when it tries again', async () => {
    const user = userEvent.setup()
    const second = held<SignInResult>()
    const signInWithPassword = mock(() =>
      signInWithPassword.mock.calls.length === 1
        ? Promise.resolve(refusedSignIn(AUTH_ERRORS.invalidCredentials))
        : second.promise,
    )
    renderSignIn({ calls: { signInWithPassword } })
    await fillIn(user)
    await user.click(submit())
    await screen.findByRole('alert')

    await user.click(submit())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(password()).toHaveAttribute('aria-invalid', 'false')
    expect(submit()).toHaveTextContent('Signing in…')
  })

  describe('an email not yet confirmed', () => {
    const renderUnconfirmed = async ({ resend }: { resend?: AuthClient['resend'] }) => {
      const user = userEvent.setup()
      renderSignIn({
        calls: {
          signInWithPassword: async () => refusedSignIn(AUTH_ERRORS.emailNotConfirmed),
          ...(resend ? { resend } : {}),
        },
      })
      await fillIn(user)
      await user.click(submit())
      await screen.findByRole('alert')
      return user
    }

    it('says so, and offers to resend and to check the inbox', async () => {
      await renderUnconfirmed({})

      expect(screen.getByRole('alert')).toHaveTextContent('Confirm your email to sign in.')
      expect(password()).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('button', { name: 'Resend confirmation email' })).toBeEnabled()
      const link = screen.getByRole('link', { name: 'Check your email' })
      expect(link).toHaveAttribute(
        'href',
        `${AUTH_ROUTES.checkEmail}?${AUTH_QUERY.email}=jordan%40example.com`,
      )
    })

    it('resends the confirmation email to the address typed', async () => {
      const resend = mock((_credentials: Parameters<AuthClient['resend']>[0]) =>
        Promise.resolve(sent()),
      )
      const user = await renderUnconfirmed({ resend })

      await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Confirmation email sent.')
      expect(resend).toHaveBeenCalledTimes(1)
      expect(resend.mock.calls[0]?.[0]).toEqual({ type: 'signup', email: 'jordan@example.com' })
    })

    it('holds the button while it resends', async () => {
      const pending = held<ResendResult>()
      const user = await renderUnconfirmed({ resend: () => pending.promise })

      await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }))
      expect(screen.getByRole('button', { name: 'Resend confirmation email' })).toBeDisabled()

      pending.answer(sent())
      await screen.findByRole('status')
      expect(screen.getByRole('button', { name: 'Resend confirmation email' })).toBeEnabled()
    })

    it('asks to wait when the server limits the emails', async () => {
      const user = await renderUnconfirmed({
        resend: async () => refusedResend(AUTH_ERRORS.overEmailSendRateLimit),
      })

      await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }))

      expect(await screen.findByText('Wait a moment before asking again.')).toBeInTheDocument()
    })

    it('says when the email could not be sent', async () => {
      const user = await renderUnconfirmed({
        resend: async () => {
          throw new TypeError('Failed to fetch')
        },
      })

      await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }))

      expect(await screen.findByText('Could not resend. Try again.')).toBeInTheDocument()
    })

    it('forgets the resend when it tries to sign in again', async () => {
      const user = await renderUnconfirmed({ resend: async () => sent() })
      await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }))
      await screen.findByRole('status')

      await user.click(submit())

      await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    })
  })

  describe('what the server says about accounts', () => {
    it('shows a notice instead of the form while accounts cannot be reached', () => {
      renderSignIn({ authConfig: { state: AUTH_CONFIG_STATES.unavailable } })

      expect(
        screen.getByRole('heading', { level: 1, name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('Email')).toBeNull()
      expect(screen.queryByRole('button', { name: /^Sign(ing)? in/ })).toBeNull()
    })

    it('shows the same notice when the config cannot be read', async () => {
      getAuthConfig.mockRejectedValue(new Error('offline'))
      renderSignIn({ authConfig: null })

      expect(
        await screen.findByRole('heading', { name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
    })

    it('sends a visitor home while accounts are off', async () => {
      renderSignIn({ authConfig: { state: AUTH_CONFIG_STATES.off } })

      await waitFor(() => expect(where()).toBe('/'))
    })

    it('waits while the config or the stored session is read', () => {
      renderSignIn({ status: AUTH_SESSION_STATUSES.booting })

      expect(screen.getByRole('status')).toHaveTextContent('Loading')
      expect(screen.queryByLabelText('Email')).toBeNull()
    })

    it('sends an approved visitor already signed in to the return path', async () => {
      getMe.mockResolvedValue(fakeAccount())
      renderSignIn({ isSignedIn: true, route: returnTo('/favourites') })

      await waitFor(() => expect(where()).toBe('/favourites'))
    })

    it('sends a visitor signed in without approval to the pending screen', async () => {
      getMe.mockResolvedValue(fakeAccount({ status: MEMBER_STATUSES.pending }))
      renderSignIn({ isSignedIn: true })

      await waitFor(() => expect(where()).toBe(AUTH_ROUTES.pending))
    })

    it('shows the notice when the account cannot be read', async () => {
      getMe.mockRejectedValue(new ApiError({ status: 503, message: 'Unavailable' }))
      renderSignIn({ isSignedIn: true })

      expect(
        await screen.findByRole('heading', { name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
    })
  })

  it('takes the whole screen at /sign-in, outside the browsing frame', () => {
    renderAuthPage({ path: '*', page: <AppRoutes />, route: AUTH_ROUTES.signIn })

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }))
    expect(email()).toBeInTheDocument()
  })
})
