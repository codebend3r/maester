import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { AuthApiError, type AuthError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { SIGN_IN_COPY, STATUS_COPY, WREN_LOCKUP_COPY } from '@raven/wren'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import type { AuthClient } from '@/lib/authClient'
import { queryClient } from '@/lib/queryClient'
import { WREN_ROUTES } from '@/routes'
import { SignIn } from '@/screens/SignIn/SignIn'
import { useAuthSession } from '@/stores/authSession'
import { fakeAuthClient, fakeSession, readyConfig } from '@/test/authClient'
import { renderWithProviders, signedOut } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

type SignInResult = Awaited<ReturnType<AuthClient['signInWithPassword']>>

const signedInResult = (): SignInResult => {
  const session = fakeSession()
  return { data: { user: session.user, session }, error: null }
}

const refused = (error: AuthError): SignInResult => ({
  data: { user: null, session: null },
  error,
})

const HOME_MARK = 'Home is showing'

type RenderSignInProps = {
  /** What Supabase answers a sign-in with. */
  signInWithPassword?: AuthClient['signInWithPassword']
  formFactor?: FormFactor
}

/** Sign-in on a server with accounts on and nobody signed in, beside a Home to land on. */
const renderSignIn = ({
  signInWithPassword = async () => signedInResult(),
  formFactor = FORM_FACTORS.phone,
}: RenderSignInProps = {}) => {
  const calls = mock(signInWithPassword)
  const { client: auth } = fakeAuthClient({ calls: { signInWithPassword: calls } })
  // The sign-in reads the server's config from the page's own cache, as the api does.
  signedOut({ client: queryClient, auth })
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={<SignIn />} path={WREN_ROUTES.signIn} />
        <Route element={<p>{HOME_MARK}</p>} path={WREN_ROUTES.home} />
      </Routes>
    ),
    route: WREN_ROUTES.signIn,
    formFactor,
    authConfig: null,
    client: new QueryClient(),
  })
  return { calls }
}

const email = () => screen.getByLabelText(SIGN_IN_COPY.email)
const password = () => screen.getByLabelText(SIGN_IN_COPY.password)
const submit = () => screen.getByRole('button', { name: SIGN_IN_COPY.signIn })

const fillIn = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(email(), 'listener@example.com')
  await user.type(password(), 'correct-horse')
}

describe('SignIn', () => {
  const getAuthConfig = spyOn(api, 'getAuthConfig')

  afterEach(() => {
    cleanup()
    getAuthConfig.mockReset()
  })

  it('asks for the raven account, email and password alone, under the mark on the narrow layout', () => {
    renderSignIn()

    expect(
      screen.getByRole('heading', { level: 1, name: SIGN_IN_COPY.welcome }),
    ).toBeInTheDocument()
    expect(screen.getByText(SIGN_IN_COPY.note)).toBeInTheDocument()
    expect(email()).toHaveAttribute('type', 'email')
    expect(email()).toHaveAttribute('autocomplete', 'email')
    expect(email()).toHaveAttribute('placeholder', SIGN_IN_COPY.emailPlaceholder)
    expect(password()).toHaveAttribute('type', 'password')
    expect(password()).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByText(STATUS_COPY.connected(STATUS_COPY.raven))).toBeInTheDocument()
    expect(screen.getByText(SIGN_IN_COPY.family)).toBeInTheDocument()
    expect(screen.queryByText(SIGN_IN_COPY.tagline)).toBeNull()
  })

  it("sets the form beside the brand's half on the wide layout, with its lockup and tagline", () => {
    renderSignIn({ formFactor: FORM_FACTORS.tablet })

    expect(screen.getByRole('heading', { level: 1, name: SIGN_IN_COPY.title })).toBeInTheDocument()
    expect(screen.getByText(SIGN_IN_COPY.tabletNote)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: WREN_LOCKUP_COPY.name })).toBeInTheDocument()
    expect(screen.getByText(SIGN_IN_COPY.tagline)).toBeInTheDocument()
    expect(screen.queryByText(SIGN_IN_COPY.welcome)).toBeNull()
    expect(screen.queryByText(SIGN_IN_COPY.family)).toBeNull()
  })

  it('shows and hides the password', async () => {
    const user = userEvent.setup()
    renderSignIn()

    await user.click(screen.getByRole('button', { name: SIGN_IN_COPY.showPassword }))
    expect(password()).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: SIGN_IN_COPY.hidePassword }))
    expect(password()).toHaveAttribute('type', 'password')
  })

  it('marks each field left empty under the banner, and asks Supabase nothing', async () => {
    const user = userEvent.setup()
    const { calls } = renderSignIn()

    await user.click(submit())

    expect(screen.getByRole('alert')).toHaveTextContent(SIGN_IN_COPY.badAccount)
    expect(email()).toHaveAccessibleDescription(SIGN_IN_COPY.enterEmail)
    expect(password()).toHaveAccessibleDescription(SIGN_IN_COPY.enterPassword)
    expect(email()).toBeInvalid()
    expect(calls).not.toHaveBeenCalled()

    await user.type(email(), 'listener@example.com')
    expect(screen.queryByText(SIGN_IN_COPY.enterEmail)).toBeNull()
    expect(screen.getByText(SIGN_IN_COPY.enterPassword)).toBeInTheDocument()
  })

  it('says a wrong email or password in the banner alone', async () => {
    const user = userEvent.setup()
    renderSignIn({
      signInWithPassword: async () =>
        refused(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')),
    })

    await fillIn(user)
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_COPY.wrongAccount)
    expect(email()).toBeValid()
    expect(screen.queryByText(HOME_MARK)).toBeNull()
  })

  it("says raven cannot be reached when Supabase does not answer, and the server's chip says so too", async () => {
    const user = userEvent.setup()
    renderSignIn({
      signInWithPassword: async () => refused(new AuthRetryableFetchError('Failed to fetch', 0)),
    })

    await fillIn(user)
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_COPY.unreachable)
    expect(screen.getByText(STATUS_COPY.unreachable(STATUS_COPY.raven))).toBeInTheDocument()
  })

  it("says raven cannot be reached when the server's word on accounts never comes", async () => {
    const user = userEvent.setup()
    renderSignIn()
    queryClient.clear()
    useAuthSession.setState(useAuthSession.getInitialState(), true)
    getAuthConfig.mockRejectedValue(new TypeError('Failed to fetch'))

    await fillIn(user)
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_COPY.unreachable)
  })

  it("keeps any other refusal in the service's own words", async () => {
    const user = userEvent.setup()
    renderSignIn({
      signInWithPassword: async () =>
        refused(new AuthApiError('Email not confirmed', 400, 'email_not_confirmed')),
    })

    await fillIn(user)
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent('Email not confirmed')
  })

  it('signs in with the trimmed email on Enter, and lands on Home signed in', async () => {
    const user = userEvent.setup()
    const { calls } = renderSignIn()

    await user.type(email(), '  listener@example.com ')
    await user.type(password(), 'correct-horse{Enter}')

    expect(await screen.findByText(HOME_MARK)).toBeInTheDocument()
    expect(calls).toHaveBeenCalledWith({
      email: 'listener@example.com',
      password: 'correct-horse',
    })
    await waitFor(() =>
      expect(useAuthSession.getState().session?.userId ?? null).toBe(fakeSession().user.id),
    )
  })

  it('reads the config again for a sign-in pressed once raven is back in reach', async () => {
    const user = userEvent.setup()
    renderSignIn()
    queryClient.clear()
    getAuthConfig.mockResolvedValue(readyConfig)

    await fillIn(user)
    await user.click(submit())

    expect(await screen.findByText(HOME_MARK)).toBeInTheDocument()
  })
})
