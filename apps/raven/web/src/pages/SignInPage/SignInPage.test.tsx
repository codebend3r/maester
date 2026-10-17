import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import {
  type SignIn,
  type SignInDetails,
  SignInPage,
  signInUnavailable,
} from '@/pages/SignInPage/SignInPage'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const renderSignIn = (onSignIn: SignIn) =>
  renderWithProviders(
    <Routes>
      <Route path="/sign-in" element={<SignInPage onSignIn={onSignIn} />} />
      <Route path="/" element={<p>home</p>} />
    </Routes>,
    { route: '/sign-in' },
  )

const server = () => screen.getByLabelText('Server')
const name = () => screen.getByLabelText('Name')
const password = () => screen.getByLabelText('Password')
const submit = () => screen.getByRole('button', { name: /^Sign(ing)? in/ })

const fillIn = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(name(), 'jordan')
  await user.type(password(), 'correct-horse')
}

describe('SignInPage', () => {
  it('asks for the server, filled in with this one, then the name and the password', () => {
    renderSignIn(signInUnavailable)

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByText('Sign in to watch on localhost')).toBeInTheDocument()
    expect(server()).toHaveValue('http://localhost:8484')
    expect(server()).toHaveAttribute('type', 'url')
    expect(server()).toHaveAttribute('autocomplete', 'url')
    expect(server()).toHaveAccessibleDescription('This page came from this server, so it answers.')
    expect(name()).toHaveAttribute('autocomplete', 'username')
    expect(password()).toHaveAttribute('type', 'password')
    expect(password()).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('checkbox', { name: 'Keep me signed in on this device' })).toBeChecked()
    expect(submit()).toHaveTextContent('Sign in')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names the host of a server typed in, and leaves it unchecked', async () => {
    const user = userEvent.setup()
    renderSignIn(signInUnavailable)
    await user.clear(server())
    await user.type(server(), 'https://raven.home:8096')

    expect(screen.getByText('Sign in to watch on raven.home')).toBeInTheDocument()
    expect(server()).toHaveAccessibleDescription('Not checked.')
  })

  it('names this host while the server typed is not an address yet', async () => {
    const user = userEvent.setup()
    renderSignIn(signInUnavailable)
    await user.clear(server())
    await user.type(server(), 'raven')

    expect(screen.getByText('Sign in to watch on localhost')).toBeInTheDocument()
  })

  it('shows the password with Show and hides it again with Hide', async () => {
    const user = userEvent.setup()
    renderSignIn(signInUnavailable)
    await user.type(password(), 'correct-horse')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password()).toHaveAttribute('type', 'text')
    expect(password()).toHaveValue('correct-horse')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password()).toHaveAttribute('type', 'password')
  })

  it('takes the fields in order from the keyboard', async () => {
    const user = userEvent.setup()
    renderSignIn(signInUnavailable)
    const order = [
      server(),
      name(),
      password(),
      screen.getByRole('button', { name: 'Show password' }),
      screen.getByRole('checkbox', { name: 'Keep me signed in on this device' }),
      submit(),
    ]
    await order.reduce(async (previous, field) => {
      await previous
      await user.tab()
      expect(field).toHaveFocus()
    }, Promise.resolve())
  })

  it('reads Signing in… while it signs in, then goes home', async () => {
    const user = userEvent.setup()
    const attempt = held<void>()
    const onSignIn = mock((_details: SignInDetails) => attempt.promise)
    renderSignIn(onSignIn)
    await fillIn(user)
    await user.click(screen.getByRole('checkbox', { name: 'Keep me signed in on this device' }))
    await user.click(submit())

    expect(submit()).toHaveTextContent('Signing in…')
    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(onSignIn.mock.calls[0]?.[0]).toEqual({
      server: 'http://localhost:8484',
      name: 'jordan',
      password: 'correct-horse',
      keepSignedIn: false,
    })

    await user.click(submit())
    expect(onSignIn).toHaveBeenCalledTimes(1)

    attempt.answer()
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('says why not under the password, marked as the field to fix', async () => {
    const user = userEvent.setup()
    renderSignIn(() => Promise.reject(new Error('That password does not match. Try again.')))
    await fillIn(user)
    await user.click(submit())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That password does not match. Try again.')
    expect(password()).toHaveAttribute('aria-invalid', 'true')
    expect(password()).toHaveAccessibleDescription('That password does not match. Try again.')
    expect(password().parentElement).toHaveClass('invalid')
    expect(submit()).toHaveTextContent('Sign in')
  })

  it('clears the alert when it tries again', async () => {
    const user = userEvent.setup()
    const second = held<void>()
    const onSignIn = mock(() =>
      onSignIn.mock.calls.length === 1
        ? Promise.reject(new Error('That password does not match. Try again.'))
        : second.promise,
    )
    renderSignIn(onSignIn)
    await fillIn(user)
    await user.click(submit())
    await screen.findByRole('alert')

    await user.click(submit())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(password()).toHaveAttribute('aria-invalid', 'false')
    expect(submit()).toHaveTextContent('Signing in…')
  })

  it('takes the whole screen at /sign-in, saying there are no accounts yet', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/sign-in' })

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }))
    await fillIn(user)
    await user.click(submit())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This server has no accounts to sign in to yet.',
    )
  })
})
