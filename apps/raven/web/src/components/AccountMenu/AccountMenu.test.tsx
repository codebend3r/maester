import { afterEach, describe, expect, it, mock } from 'bun:test'
import { type Account, MEMBER_STATUSES } from '@raven/core'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AccountMenu } from '@/components/AccountMenu/AccountMenu'
import type { AuthClient } from '@/lib/authClient'
import { queryKeys } from '@raven/ui/headless'
import { useAuthSession } from '@/stores/authSession'
import { ACCOUNT_ID, fakeAccount, fakeAuthClient } from '@/test/authClient'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

type SignOutResult = Awaited<ReturnType<AuthClient['signOut']>>

const Where = () => <p data-testid="where">{useLocation().pathname}</p>

describe('AccountMenu', () => {
  type RenderMenuProps = { account?: Account | null; signOut?: AuthClient['signOut'] }

  const renderMenu = ({
    account = fakeAccount({ email: 'jordan@example.com' }),
    signOut = async (): Promise<SignOutResult> => ({ error: null }),
  }: RenderMenuProps = {}) => {
    const rendered = renderWithProviders({
      ui: (
        <>
          <AccountMenu />
          <p>Elsewhere</p>
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </>
      ),
      account,
    })
    useAuthSession.setState({ client: fakeAuthClient({ calls: { signOut } }).client })
    return rendered
  }

  const trigger = () => screen.getByRole('button', { name: 'Account' })

  afterEach(() => {
    cleanup()
    useAuthSession.setState({ client: null, session: null })
  })

  it('is not there while accounts are off', () => {
    renderMenu({ account: null })
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull()
  })

  it('is not there for an account still waiting for approval', () => {
    renderMenu({ account: fakeAccount({ status: MEMBER_STATUSES.pending }) })
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull()
  })

  it('wears the first letter of the address and opens on who is signed in', async () => {
    const user = userEvent.setup()
    renderMenu()
    expect(trigger()).toHaveTextContent('J')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger())

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('jordan@example.com')).toBeVisible()
    expect(screen.getByText('Member')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeEnabled()
  })

  it('names the owner as the owner', async () => {
    const user = userEvent.setup()
    renderMenu({ account: fakeAccount({ isOwner: true }) })
    await user.click(trigger())
    expect(screen.getByText('Owner')).toBeVisible()
  })

  it('moves with the arrows and closes on Escape, back on its button', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it('closes on a click elsewhere', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('goes to Settings and closes', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/settings')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('signs out, and empties what the account left in the cache', async () => {
    const user = userEvent.setup()
    const signOut = mock(async (): Promise<SignOutResult> => {
      useAuthSession.setState({ session: null })
      return { error: null }
    })
    const { client } = renderMenu({ signOut })
    await user.click(trigger())

    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(client.getQueryData(queryKeys.account(ACCOUNT_ID))).toBeUndefined())
  })

  it('is busy while the session ends', async () => {
    const user = userEvent.setup()
    const ending = held<SignOutResult>()
    const { client } = renderMenu({ signOut: () => ending.promise })
    await user.click(trigger())

    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(screen.getByRole('menuitem', { name: 'Signing out' })).toBeDisabled()

    await act(async () => ending.answer({ error: null }))
    await waitFor(() => expect(client.getQueryData(queryKeys.account(ACCOUNT_ID))).toBeUndefined())
  })

  it('says why signing out failed, and offers it again', async () => {
    const user = userEvent.setup()
    renderMenu({
      signOut: async () => {
        throw new Error('The network is down')
      },
    })
    await user.click(trigger())

    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign out: The network is down',
    )
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeEnabled()
  })
})
