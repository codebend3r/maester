import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Account } from '@raven/core'
import type { AuthClient } from '@/lib/authClient'
import { queryKeys } from '@raven/ui/headless'
import { AccountSection } from '@/pages/SettingsPage/AccountSection'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { ACCOUNT_ID, SIGNED_IN, fakeAccount, fakeAuthClient } from '@/test/authClient'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

type SignOutResult = Awaited<ReturnType<AuthClient['signOut']>>

describe('AccountSection', () => {
  const renderAccount = ({
    account = fakeAccount({ email: 'jordan@example.com' }),
    signOut = async (): Promise<SignOutResult> => ({ error: null }),
  }: { account?: Account; signOut?: AuthClient['signOut'] } = {}) => {
    useAuthSession.setState({
      client: fakeAuthClient({ calls: { signOut } }).client,
      status: AUTH_SESSION_STATUSES.ready,
      session: SIGNED_IN,
    })
    const rendered = renderWithProviders({ ui: <AccountSection account={account} /> })
    rendered.client.setQueryData(queryKeys.account(ACCOUNT_ID), account)
    return rendered
  }

  afterEach(() => {
    cleanup()
    useAuthSession.setState({ client: null, session: null })
  })

  it('shows the signed in address and that the account is approved', async () => {
    renderAccount()

    expect(await screen.findByRole('heading', { level: 2, name: 'Account' })).toBeVisible()
    expect(screen.getByText('jordan@example.com')).toBeVisible()
    expect(screen.getByText('Approved')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  })

  it('shows the same to the owner', async () => {
    renderAccount({ account: fakeAccount({ isOwner: true }) })

    expect(await screen.findByRole('heading', { name: 'Account' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  it('signs out, and empties what the account left in the cache', async () => {
    const user = userEvent.setup()
    const signOut = mock(async (): Promise<SignOutResult> => {
      useAuthSession.setState({ session: null })
      return { error: null }
    })
    const { client } = renderAccount({ signOut })
    await screen.findByRole('button', { name: 'Sign out' })
    expect(client.getQueryData(queryKeys.account(ACCOUNT_ID))).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(client.getQueryData(queryKeys.account(ACCOUNT_ID))).toBeUndefined())
  })

  it('is busy while the session ends', async () => {
    const user = userEvent.setup()
    const ending = held<SignOutResult>()
    const { client } = renderAccount({ signOut: () => ending.promise })

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(screen.getByRole('button', { name: 'Signing out' })).toBeDisabled()

    await act(async () => ending.answer({ error: null }))
    await waitFor(() => expect(client.getQueryData(queryKeys.account(ACCOUNT_ID))).toBeUndefined())
  })

  it('says why signing out failed, and offers it again', async () => {
    const user = userEvent.setup()
    renderAccount({
      signOut: async () => {
        throw new Error('The network is down')
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign out: The network is down',
    )
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  })
})
