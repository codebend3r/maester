import { describe, expect, it, jest } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignInForm } from '@/renderer/Account/SignInForm'
import { accountOf } from '@/renderer/test/accountFakes'
import { fakeClient, renderDesktop } from '@/renderer/test/render'
import { S } from '@/renderer/test/serverFakes'
import {
  ACCOUNT_STATES,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  ACCOUNT_PAGES,
} from '@/shared/protocol'

const WRONG = 'Email or password is wrong.'

const FORM = {
  serverId: S,
  signInHost: 'project.supabase.co',
  isRemembered: true,
}

const mainAnswering = (answer: DesktopReply | (() => Promise<DesktopReply>)) =>
  fakeClient({
    request: async (asked: DesktopRequest) => {
      if (
        asked.type === DESKTOP_REQUESTS.signIn ||
        asked.type === DESKTOP_REQUESTS.openAccountPage
      ) {
        return typeof answer === 'function' ? answer() : answer
      }
      return { type: DESKTOP_REPLIES.done }
    },
  })

const renderForm = ({
  client = mainAnswering({ type: DESKTOP_REPLIES.refused, message: WRONG }),
  ...props
}: Partial<Parameters<typeof SignInForm>[0]> & { client?: ReturnType<typeof fakeClient> } = {}) =>
  renderDesktop({
    client,
    routes: [{ path: '/', element: <SignInForm {...FORM} {...props} /> }],
  })

const fill = async ({ email = 'me@example.com', password = 'hunter2' } = {}) => {
  await userEvent.type(screen.getByLabelText('Email'), email)
  await userEvent.type(screen.getByLabelText('Password'), password)
}

describe('SignInForm', () => {
  it('asks for an email and a password the way a password manager reads them', () => {
    renderForm()
    const email = screen.getByLabelText('Email')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'username')
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
  })

  it('sends the email and the password to main once, to sign in', async () => {
    const client = mainAnswering({ type: DESKTOP_REPLIES.account, account: accountOf() })
    renderForm({ client })
    await fill({ email: '  me@example.com ' })
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const sent = client.request.mock.calls.filter(
      ([request]) => request.type === DESKTOP_REQUESTS.signIn,
    )
    expect(sent).toEqual([
      [
        {
          type: DESKTOP_REQUESTS.signIn,
          serverId: S,
          email: 'me@example.com',
          password: 'hunter2',
        },
      ],
    ])
  })

  it.each([
    'Email or password is wrong.',
    'Confirm your email first. The link is in your inbox.',
    'Wait a moment before trying again.',
    'Vhagar could not sign you in right now. Try again.',
    'raven player could not reach its sign-in. Try again.',
  ])('says %s when main refuses the sign in', async (message) => {
    renderForm({ client: mainAnswering({ type: DESKTOP_REPLIES.refused, message }) })
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('says main could not be reached when the request fails', async () => {
    renderForm({
      client: mainAnswering(async () => {
        throw new Error('gone')
      }),
    })
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'raven player could not reach its sign-in. Try again.',
    )
  })

  it('marks the password invalid, clears it and puts the cursor back in it after a refusal', async () => {
    renderForm()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const alert = await screen.findByRole('alert')
    const password = screen.getByLabelText('Password')
    expect(password).toHaveValue('')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAttribute('aria-describedby', alert.id)
    expect(password).toHaveFocus()
    expect(screen.getByLabelText('Email')).toHaveValue('me@example.com')
  })

  it('clears the password after a sign in too, and tells the host it is done', async () => {
    const onSignedIn = jest.fn()
    const client = mainAnswering({
      type: DESKTOP_REPLIES.account,
      account: accountOf({ state: ACCOUNT_STATES.approved, email: 'me@example.com' }),
    })
    renderForm({ client, onSignedIn })
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignedIn).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('holds a second submit while main is answering the first', async () => {
    const answers: Array<(reply: DesktopReply) => void> = []
    const client = mainAnswering(
      () =>
        new Promise<DesktopReply>((resolve) => {
          answers.push(resolve)
        }),
    )
    renderForm({ client })
    await fill()
    const button = screen.getByRole('button', { name: 'Sign in' })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(answers).toHaveLength(1)
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it.each([
    ['Create account', ACCOUNT_PAGES.signUp],
    ['Forgot password', ACCOUNT_PAGES.forgot],
  ])('asks main to open the %s page', async (name, page) => {
    const client = mainAnswering({ type: DESKTOP_REPLIES.done })
    renderForm({ client })
    await userEvent.click(screen.getByRole('button', { name }))
    expect(client.request).toHaveBeenCalledWith({
      type: DESKTOP_REQUESTS.openAccountPage,
      serverId: S,
      page,
    })
  })

  it('says why a page did not open', async () => {
    renderForm({
      client: mainAnswering({
        type: DESKTOP_REPLIES.refused,
        message: 'raven player could not open your browser.',
      }),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'raven player could not open your browser.',
    )
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('names the host the sign in goes to', () => {
    renderForm()
    expect(screen.getByText('Signs in with project.supabase.co.')).toBeInTheDocument()
  })

  it('names no host when main gave none', () => {
    renderForm({ signInHost: null })
    expect(screen.queryByText(/Signs in with/)).toBeNull()
  })

  it('says the sign in is not kept only when it is not', () => {
    renderForm({ isRemembered: false })
    expect(
      screen.getByText(
        'raven player cannot keep your sign-in on this Mac, so you sign in again after quitting.',
      ),
    ).toBeInTheDocument()
  })

  it('does not say it when the sign in is kept', () => {
    renderForm()
    expect(screen.queryByText(/cannot keep your sign-in/)).toBeNull()
  })

  it('offers Cancel only to a host that can close it', async () => {
    const onCancel = jest.fn()
    renderForm({ onCancel })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('has no Cancel when nobody is listening', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})
