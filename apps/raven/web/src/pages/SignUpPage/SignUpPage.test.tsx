import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { AuthApiError } from '@supabase/supabase-js'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AUTH_CONFIG_STATES, ApiError, MEMBER_STATUSES, AUTH_ROUTES } from '@raven/core'
import { AppRoutes } from '@/AppRoutes'
import { api } from '@/lib/api'
import { type AuthClient } from '@/lib/authClient'
import { AUTH_ERRORS } from '@/lib/authErrors'
import { checkEmailPath } from '@/lib/authRoutes'
import { SignUpPage } from '@/pages/SignUpPage/SignUpPage'
import { AUTH_SESSION_STATUSES } from '@/stores/authSession'
import { fakeAccount, fakeSession } from '@/test/authClient'
import { type AuthPageOptions, renderAuthPage, where } from '@/test/authPage'
import { held } from '@/test/held'

type SignUpResult = Awaited<ReturnType<AuthClient['signUp']>>

const created = (): SignUpResult => ({
  data: { user: fakeSession().user, session: null },
  error: null,
})

// Supabase answers a confirmed address with a user that has no identities, so
// the response gives nothing away.
const alreadyRegistered = (): SignUpResult => ({
  data: { user: { ...fakeSession().user, identities: [] }, session: null },
  error: null,
})

type RefusedSignUpProps = { code: string; message: string }

const refusedSignUp = ({ code, message }: RefusedSignUpProps): SignUpResult => ({
  data: { user: null, session: null },
  error: new AuthApiError(message, 422, code),
})

const renderSignUp = (options: AuthPageOptions = {}) =>
  renderAuthPage({ path: AUTH_ROUTES.signUp, page: <SignUpPage />, ...options })

const email = () => screen.getByLabelText('Email')
const password = () => screen.getByLabelText('Password')
const confirmation = () => screen.getByLabelText('Confirm password')
const submit = () => screen.getByRole('button', { name: /^(Create account|Creating account)/ })

type FillInProps = {
  user: ReturnType<typeof userEvent.setup>
  confirm?: string
}

const fillIn = async ({ user, confirm = 'correct-horse' }: FillInProps) => {
  await user.type(email(), 'jordan@example.com')
  await user.type(password(), 'correct-horse')
  await user.type(confirmation(), confirm)
}

describe('SignUpPage', () => {
  const getMe = spyOn(api, 'getMe')
  const getAuthConfig = spyOn(api, 'getAuthConfig')

  afterEach(() => {
    getMe.mockReset()
    getAuthConfig.mockReset()
  })

  it('asks for an email and a password twice, and explains what happens next', () => {
    renderSignUp()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeInTheDocument()
    expect(email()).toHaveAttribute('type', 'email')
    expect(email()).toHaveAttribute('autocomplete', 'username')
    expect(password()).toHaveAttribute('type', 'password')
    expect(password()).toHaveAttribute('autocomplete', 'new-password')
    expect(confirmation()).toHaveAttribute('type', 'password')
    expect(confirmation()).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByText(/link to confirm your address/)).toBeInTheDocument()
    expect(screen.getByText(/approves each new account/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      AUTH_ROUTES.signIn,
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows both passwords with Show and hides them again with Hide', async () => {
    const user = userEvent.setup()
    renderSignUp()

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password()).toHaveAttribute('type', 'text')
    expect(confirmation()).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password()).toHaveAttribute('type', 'password')
    expect(confirmation()).toHaveAttribute('type', 'password')
  })

  it('does not sign up while the two passwords differ, and says so on the confirmation', async () => {
    const user = userEvent.setup()
    const signUp = mock(async () => created())
    renderSignUp({ calls: { signUp } })
    await fillIn({ user, confirm: 'correct-horsE' })

    await user.click(submit())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The passwords do not match.')
    expect(confirmation()).toHaveAttribute('aria-invalid', 'true')
    expect(confirmation()).toHaveAccessibleDescription('The passwords do not match.')
    expect(password()).toHaveAttribute('aria-invalid', 'false')
    expect(signUp).not.toHaveBeenCalled()
    expect(where()).toBe(AUTH_ROUTES.signUp)
  })

  it('drops the mismatch message once the passwords agree, and signs up', async () => {
    const user = userEvent.setup()
    const signUp = mock(async (_credentials: Parameters<AuthClient['signUp']>[0]) => created())
    renderSignUp({ calls: { signUp } })
    await fillIn({ user, confirm: 'correct-horsE' })
    await user.click(submit())
    await screen.findByRole('alert')

    await user.clear(confirmation())
    await user.type(confirmation(), 'correct-horse')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(submit())

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
  })

  it('asks Supabase to send the link to raven’s confirm route, then goes to check email', async () => {
    const user = userEvent.setup()
    const attempt = held<SignUpResult>()
    const signUp = mock((_credentials: Parameters<AuthClient['signUp']>[0]) => attempt.promise)
    renderSignUp({ calls: { signUp } })
    await fillIn({ user })
    await user.click(submit())

    expect(submit()).toHaveTextContent('Creating account…')
    expect(submit()).toBeDisabled()
    expect(signUp).toHaveBeenCalledTimes(1)
    expect(signUp.mock.calls[0]?.[0]).toEqual({
      email: 'jordan@example.com',
      password: 'correct-horse',
      options: { emailRedirectTo: 'http://localhost:8484/auth/confirm' },
    })

    attempt.answer(created())
    await waitFor(() => expect(where()).toBe(checkEmailPath({ email: 'jordan@example.com' })))
  })

  it('goes to the same place for an address that already has an account', async () => {
    const user = userEvent.setup()
    renderSignUp({ calls: { signUp: async () => alreadyRegistered() } })
    await fillIn({ user })
    await user.click(submit())

    await waitFor(() => expect(where()).toBe(checkEmailPath({ email: 'jordan@example.com' })))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('goes there too when the server names the existing account', async () => {
    const user = userEvent.setup()
    renderSignUp({
      calls: {
        signUp: async () =>
          refusedSignUp({
            code: AUTH_ERRORS.userAlreadyExists,
            message: 'User already registered',
          }),
      },
    })
    await fillIn({ user })
    await user.click(submit())

    await waitFor(() => expect(where()).toBe(checkEmailPath({ email: 'jordan@example.com' })))
  })

  it('shows the server’s words for a weak password, marking the password as the field to fix', async () => {
    const user = userEvent.setup()
    renderSignUp({
      calls: {
        signUp: async () =>
          refusedSignUp({
            code: AUTH_ERRORS.weakPassword,
            message: 'Password should be at least 12 characters.',
          }),
      },
    })
    await fillIn({ user })
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Password should be at least 12 characters.',
    )
    expect(password()).toHaveAttribute('aria-invalid', 'true')
    expect(password()).toHaveAccessibleDescription('Password should be at least 12 characters.')
    expect(submit()).toBeEnabled()
  })

  it('drops a weak password refusal once the password changes, since it described the old one', async () => {
    const user = userEvent.setup()
    renderSignUp({
      calls: {
        signUp: async () =>
          refusedSignUp({
            code: AUTH_ERRORS.weakPassword,
            message: 'Password should be at least 12 characters.',
          }),
      },
    })
    await fillIn({ user })
    await user.click(submit())
    await screen.findByRole('alert')

    await user.type(password(), '-battery')

    expect(screen.queryByText('Password should be at least 12 characters.')).toBeNull()
    expect(password()).toHaveAttribute('aria-invalid', 'false')
  })

  it('asks to wait when the server limits the emails', async () => {
    const user = userEvent.setup()
    renderSignUp({
      calls: {
        signUp: async () =>
          refusedSignUp({ code: AUTH_ERRORS.overEmailSendRateLimit, message: 'Too many emails' }),
      },
    })
    await fillIn({ user })
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a moment before asking again.')
    expect(screen.queryByText('Too many emails')).toBeNull()
  })

  it.each([
    [
      'an unknown error code',
      async () => refusedSignUp({ code: 'something_new', message: 'Words' }),
    ],
    [
      'a request that never arrived',
      async (): Promise<SignUpResult> => {
        throw new TypeError('Failed to fetch')
      },
    ],
  ])('says sign up failed for %s', async (_name, signUp) => {
    const user = userEvent.setup()
    renderSignUp({ calls: { signUp } })
    await fillIn({ user })
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign up failed. Try again.')
    expect(screen.queryByText('Words')).toBeNull()
  })

  it('clears the alert when it tries again', async () => {
    const user = userEvent.setup()
    const second = held<SignUpResult>()
    const signUp = mock(() =>
      signUp.mock.calls.length === 1
        ? Promise.resolve(refusedSignUp({ code: 'something_new', message: 'Words' }))
        : second.promise,
    )
    renderSignUp({ calls: { signUp } })
    await fillIn({ user })
    await user.click(submit())
    await screen.findByRole('alert')

    await user.click(submit())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(submit()).toHaveTextContent('Creating account…')
  })

  describe('what the server says about accounts', () => {
    it('shows a notice instead of the form while accounts cannot be reached', () => {
      renderSignUp({ authConfig: { state: AUTH_CONFIG_STATES.unavailable } })

      expect(
        screen.getByRole('heading', { level: 1, name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('Email')).toBeNull()
    })

    it('sends a visitor home while accounts are off', async () => {
      renderSignUp({ authConfig: { state: AUTH_CONFIG_STATES.off } })

      await waitFor(() => expect(where()).toBe('/'))
    })

    it('waits while the config or the stored session is read', () => {
      renderSignUp({ status: AUTH_SESSION_STATUSES.booting })

      expect(screen.getByRole('status')).toHaveTextContent('Loading')
      expect(screen.queryByLabelText('Email')).toBeNull()
    })

    it('sends an approved visitor already signed in home', async () => {
      getMe.mockResolvedValue(fakeAccount())
      renderSignUp({ isSignedIn: true })

      await waitFor(() => expect(where()).toBe('/'))
    })

    it('sends a visitor signed in without approval to the pending screen', async () => {
      getMe.mockResolvedValue(fakeAccount({ status: MEMBER_STATUSES.pending }))
      renderSignUp({ isSignedIn: true })

      await waitFor(() => expect(where()).toBe(AUTH_ROUTES.pending))
    })

    it('shows the notice when the account cannot be read', async () => {
      getMe.mockRejectedValue(new ApiError({ status: 503, message: 'Unavailable' }))
      renderSignUp({ isSignedIn: true })

      expect(
        await screen.findByRole('heading', { name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
    })
  })

  it('takes the whole screen at /sign-up, outside the browsing frame', () => {
    renderAuthPage({ path: '*', page: <AppRoutes />, route: AUTH_ROUTES.signUp })

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }))
    expect(email()).toBeInTheDocument()
  })
})
