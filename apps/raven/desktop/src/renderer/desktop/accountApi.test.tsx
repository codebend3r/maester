import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ACCOUNT_ANSWERS, useAccount, useAccountActions } from '@/renderer/desktop/accountApi'
import { accountKey } from '@/renderer/desktop/accountApi'
import { useDesktopBridge } from '@/renderer/stores/desktop'
import { createMenuHub } from '@/renderer/desktop/menuHub'
import { accountOf } from '@/renderer/test/accountFakes'
import { fakeClient } from '@/renderer/test/render'
import { S } from '@/renderer/test/serverFakes'
import {
  type AccountView,
  ACCOUNT_PAGES,
  ACCOUNT_STATES,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  PLAYER_CONNECTION_STATUSES,
} from '@/shared/protocol'

const setup = (answer: DesktopReply | (() => Promise<DesktopReply>)) => {
  const client = fakeClient({
    request: async () => (typeof answer === 'function' ? answer() : answer),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useDesktopBridge.setState({
    desktop: {
      client,
      menu: createMenuHub(),
      player: {
        read: () => ({ status: PLAYER_CONNECTION_STATUSES.unavailable, message: '' }),
        subscribe: () => () => {},
      },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { client, queryClient, wrapper }
}

const SIGNED_IN = accountOf({ state: ACCOUNT_STATES.approved, email: 'me@example.com' })

describe('accountKey', () => {
  it('is the desktop account key of one server', () => {
    expect(accountKey(S)).toEqual(['desktop', 'account', S])
  })
})

describe('useAccount', () => {
  it('reads the account of one server from main', async () => {
    const { client, wrapper } = setup({ type: DESKTOP_REPLIES.account, account: SIGNED_IN })
    const { result } = renderHook(() => useAccount(S), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(SIGNED_IN))
    expect(client.request).toHaveBeenCalledWith({ type: DESKTOP_REQUESTS.readAccount, serverId: S })
  })

  it('errors with the refusal main gives', async () => {
    const { wrapper } = setup({ type: DESKTOP_REPLIES.refused, message: 'No such server.' })
    const { result } = renderHook(() => useAccount(S), { wrapper })
    await waitFor(() => expect(result.current.error?.message ?? null).toBe('No such server.'))
  })

  it('errors with a plain message for a reply that is not an account', async () => {
    const { wrapper } = setup({ type: DESKTOP_REPLIES.done })
    const { result } = renderHook(() => useAccount(S), { wrapper })
    await waitFor(() =>
      expect(result.current.error?.message ?? null).toBe(
        'raven player could not read this server account.',
      ),
    )
  })
})

describe('useAccountActions', () => {
  it('signs in with the email and password, and keeps the account it answers with', async () => {
    const { client, queryClient, wrapper } = setup({
      type: DESKTOP_REPLIES.account,
      account: SIGNED_IN,
    })
    const { result } = renderHook(() => useAccountActions(), { wrapper })
    const answer = await result.current.signIn({
      serverId: S,
      email: 'me@example.com',
      password: 'hunter2',
    })
    expect(answer).toEqual({ kind: ACCOUNT_ANSWERS.done })
    expect(client.request).toHaveBeenCalledWith({
      type: DESKTOP_REQUESTS.signIn,
      serverId: S,
      email: 'me@example.com',
      password: 'hunter2',
    })
    expect(queryClient.getQueryData<AccountView>(accountKey(S))).toEqual(SIGNED_IN)
  })

  it('answers a refused sign in with its message and keeps no account', async () => {
    const { queryClient, wrapper } = setup({
      type: DESKTOP_REPLIES.refused,
      message: 'Email or password is wrong.',
    })
    const { result } = renderHook(() => useAccountActions(), { wrapper })
    const answer = await result.current.signIn({ serverId: S, email: 'a@b.c', password: 'x' })
    expect(answer).toEqual({
      kind: ACCOUNT_ANSWERS.refused,
      message: 'Email or password is wrong.',
    })
    expect(queryClient.getQueryData<AccountView>(accountKey(S))).toBeUndefined()
  })

  it('says main could not be reached when the request fails or the reply is not an account', async () => {
    const failing = setup(async () => {
      throw new Error('gone')
    })
    const first = renderHook(() => useAccountActions(), { wrapper: failing.wrapper })
    const unreached = {
      kind: ACCOUNT_ANSWERS.refused,
      message: 'raven player could not reach its sign-in. Try again.',
    }
    expect(await first.result.current.refresh(S)).toEqual(unreached)
    const odd = setup({ type: DESKTOP_REPLIES.done })
    const second = renderHook(() => useAccountActions(), { wrapper: odd.wrapper })
    expect(await second.result.current.signOut(S)).toEqual(unreached)
  })

  it('refreshes and signs out through main and keeps what it answers', async () => {
    const out = accountOf()
    const { client, queryClient, wrapper } = setup({ type: DESKTOP_REPLIES.account, account: out })
    const { result } = renderHook(() => useAccountActions(), { wrapper })
    await result.current.refresh(S)
    expect(client.request).toHaveBeenCalledWith({
      type: DESKTOP_REQUESTS.refreshAccount,
      serverId: S,
    })
    queryClient.setQueryData(accountKey(S), SIGNED_IN)
    await result.current.signOut(S)
    expect(client.request).toHaveBeenCalledWith({ type: DESKTOP_REQUESTS.signOut, serverId: S })
    expect(queryClient.getQueryData<AccountView>(accountKey(S))).toEqual(out)
  })

  it('asks main to open an account page, and passes a refusal on', async () => {
    const done = setup({ type: DESKTOP_REPLIES.done })
    const first = renderHook(() => useAccountActions(), { wrapper: done.wrapper })
    expect(
      await first.result.current.openAccountPage({ serverId: S, page: ACCOUNT_PAGES.forgot }),
    ).toEqual({ kind: ACCOUNT_ANSWERS.done })
    expect(done.client.request).toHaveBeenCalledWith({
      type: DESKTOP_REQUESTS.openAccountPage,
      serverId: S,
      page: ACCOUNT_PAGES.forgot,
    })
    const refused = setup({ type: DESKTOP_REPLIES.refused, message: 'No browser.' })
    const second = renderHook(() => useAccountActions(), { wrapper: refused.wrapper })
    expect(
      await second.result.current.openAccountPage({ serverId: S, page: ACCOUNT_PAGES.signUp }),
    ).toEqual({ kind: ACCOUNT_ANSWERS.refused, message: 'No browser.' })
  })
})
