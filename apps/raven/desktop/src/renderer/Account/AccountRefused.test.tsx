import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountRefused } from '@/renderer/Account/AccountRefused'
import { accountOf } from '@/renderer/test/accountFakes'
import { fakeClient, renderDesktop } from '@/renderer/test/render'
import { S } from '@/renderer/test/serverFakes'
import {
  ACCOUNT_STATES,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
} from '@/shared/protocol'

const renderRefused = ({
  state = ACCOUNT_STATES.pending,
  answer = { type: DESKTOP_REPLIES.account, account: accountOf({ state: ACCOUNT_STATES.pending }) },
}: {
  state?: typeof ACCOUNT_STATES.pending | typeof ACCOUNT_STATES.revoked
  answer?: DesktopReply
} = {}) => {
  const client = fakeClient({ request: async () => answer })
  renderDesktop({
    client,
    routes: [
      {
        path: '/',
        element: <AccountRefused serverId={S} state={state} email="me@example.com" />,
      },
    ],
  })
  return client
}

describe('AccountRefused', () => {
  it('says the account is waiting for approval', () => {
    renderRefused()
    expect(screen.getByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument()
    expect(screen.getByText(/me@example\.com/)).toBeInTheDocument()
  })

  it('says the access was removed', () => {
    renderRefused({ state: ACCOUNT_STATES.revoked })
    expect(screen.getByRole('heading', { name: 'Your access was removed' })).toBeInTheDocument()
  })

  it('checks again through main and says when nothing has changed', async () => {
    const client = renderRefused()
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(client.request).toHaveBeenCalledWith({
      type: DESKTOP_REQUESTS.refreshAccount,
      serverId: S,
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Not approved yet.')
  })

  it('says a removed account is still removed after checking', async () => {
    renderRefused({
      state: ACCOUNT_STATES.revoked,
      answer: {
        type: DESKTOP_REPLIES.account,
        account: accountOf({ state: ACCOUNT_STATES.revoked }),
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Your access is still removed.')
  })

  it('says what the account became when checking finds it removed while it was waiting', async () => {
    renderRefused({
      answer: {
        type: DESKTOP_REPLIES.account,
        account: accountOf({ state: ACCOUNT_STATES.revoked }),
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Your access has been removed.')
    expect(screen.getByRole('status')).not.toHaveTextContent('Not approved yet.')
  })

  it('says nothing when checking finds the account approved', async () => {
    const client = renderRefused({
      answer: {
        type: DESKTOP_REPLIES.account,
        account: accountOf({ state: ACCOUNT_STATES.approved }),
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(client.request).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check again' })).toHaveAttribute(
        'aria-disabled',
        'false',
      ),
    )
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('signs out through main', async () => {
    const client = renderRefused()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(client.request).toHaveBeenCalledWith({ type: DESKTOP_REQUESTS.signOut, serverId: S })
  })

  it('says why main could not check', async () => {
    renderRefused({ answer: { type: DESKTOP_REPLIES.refused, message: 'Vhagar did not answer.' } })
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Vhagar did not answer.')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
