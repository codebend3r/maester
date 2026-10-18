import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  type Account,
  type AuthConfig,
  AUTH_CONFIG_STATES,
  AUTH_COOKIE,
  MEMBER_STATUSES,
} from '@raven/core'
import { api } from '@/lib/api'
import type { AuthClient } from '@/lib/authClient'
import { queryKeys } from '@/lib/queryClient'
import { AccountSection } from '@/pages/SettingsPage/AccountSection'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { ACCOUNT_ID, fakeAccount, fakeAuthClient } from '@/test/authClient'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const ready: AuthConfig = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_test',
  webUrl: 'http://localhost:8484',
  cookieName: AUTH_COOKIE,
}

type SignOutResult = Awaited<ReturnType<AuthClient['signOut']>>

describe('AccountSection', () => {
  const getMe = spyOn(api, 'getMe')

  const renderAccount = ({
    account = fakeAccount({ email: 'jordan@example.com' }),
    signOut = async (): Promise<SignOutResult> => ({ error: null }),
  }: { account?: Account; signOut?: AuthClient['signOut'] } = {}) => {
    useAuthSession.setState({
      client: fakeAuthClient({ calls: { signOut } }).client,
      status: AUTH_SESSION_STATUSES.ready,
      session: { accessToken: 't', userId: ACCOUNT_ID },
    })
    getMe.mockResolvedValue(account)
    return renderWithProviders({ authConfig: ready, ui: <AccountSection /> })
  }

  afterEach(() => {
    cleanup()
    getMe.mockReset()
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

  it('is not shown while accounts are off', () => {
    renderWithProviders({ authConfig: { state: AUTH_CONFIG_STATES.off }, ui: <AccountSection /> })

    expect(screen.queryByRole('heading', { name: 'Account' })).toBeNull()
    expect(getMe).not.toHaveBeenCalled()
  })

  it('is not shown while accounts cannot be reached', () => {
    renderWithProviders({
      authConfig: { state: AUTH_CONFIG_STATES.unavailable },
      ui: <AccountSection />,
    })

    expect(screen.queryByRole('heading', { name: 'Account' })).toBeNull()
  })

  it('is not shown to an account that is not approved', async () => {
    renderAccount({ account: fakeAccount({ status: MEMBER_STATUSES.pending }) })

    await waitFor(() => expect(getMe).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Account' })).toBeNull()
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
    renderAccount({ signOut: () => ending.promise })

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(screen.getByRole('button', { name: 'Signing out' })).toBeDisabled()

    await act(async () => ending.answer({ error: null }))
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
