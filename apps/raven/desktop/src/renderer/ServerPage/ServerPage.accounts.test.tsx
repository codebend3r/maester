import { describe, expect, it } from 'bun:test'
import {
  ADMIN_LOCK_STATES,
  AUTH_REFUSALS,
  PLAYER_COMMANDS,
  PLAYER_ERROR_REASONS,
  PLAYER_EVENTS,
  PLAYER_SOURCE_KINDS,
} from '@raven/core'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SERVER_COPY } from '@/renderer/ServerPage/serverServices'
import { accountOf } from '@/renderer/test/accountFakes'
import { ACCOUNT_COPY } from '@/renderer/Account/accountCopy'
import { accountKey } from '@/renderer/desktop/accountApi'
import { callNamesOf, reply, S, sentOfType, serverClient } from '@/renderer/test/serverFakes'
import {
  ACCOUNT_STATES,
  type AccountView,
  DESKTOP_EVENTS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
} from '@/shared/protocol'
import {
  enter,
  EPISODE,
  loaded,
  loadsOf,
  LOCKED,
  MISSING,
  playTitle,
  UNLOCKED,
} from '@/renderer/test/serverTitle'

const APPROVED = accountOf({ state: ACCOUNT_STATES.approved, email: 'me@example.com' })
const ACCOUNT_DONE = (account: AccountView): DesktopReply => ({
  type: DESKTOP_REPLIES.account,
  account,
})
const REFUSED_SIGNED_OUT = reply({
  status: 401,
  body: { reason: AUTH_REFUSALS.signedOut, message: 'Sign in to Vhagar.' },
})

describe('ServerPage accounts', () => {
  it('asks for sign in in place of the player, then plays once approved', async () => {
    const account = { current: accountOf() }
    const { client, fake } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      account,
      replies: { signIn: ACCOUNT_DONE(APPROVED) },
    })
    expect(
      await screen.findByRole('heading', { name: SERVER_COPY.accountNeededTitle }),
    ).toBeInTheDocument()
    expect(screen.getByText(SERVER_COPY.signInNeeded('Vhagar'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.getByLabelText('Email')).toHaveFocus()
    expect(callNamesOf(client)).toEqual([])
    expect(loadsOf(fake)).toHaveLength(0)
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(1))
    expect(callNamesOf(client)).toEqual(['GET /api/media/7'])
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.signIn })).toEqual([
      { type: DESKTOP_REQUESTS.signIn, serverId: S, email: 'me@example.com', password: 'hunter2' },
    ])
  })

  it.each([
    { state: ACCOUNT_STATES.pending, title: 'Waiting for approval' },
    { state: ACCOUNT_STATES.revoked, title: 'Your access was removed' },
  ])(
    'says an account that is $state is not let in, and reads no title',
    async ({ state, title }) => {
      const { client, fake } = playTitle({
        calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
        account: { current: accountOf({ state, email: 'me@example.com' }) },
      })
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
      expect(screen.getByText(SERVER_COPY.approvedOnly('Vhagar'))).toBeInTheDocument()
      expect(callNamesOf(client)).toEqual([])
      expect(loadsOf(fake)).toHaveLength(0)
    },
  )

  it('plays once Check again finds the account approved', async () => {
    const { fake } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      account: { current: accountOf({ state: ACCOUNT_STATES.pending }) },
      replies: { refreshAccount: ACCOUNT_DONE(APPROVED) },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(1))
  })

  it.each([ACCOUNT_STATES.off, ACCOUNT_STATES.unavailable, ACCOUNT_STATES.approved])(
    'plays when the account is %s',
    async (state) => {
      const { fake } = playTitle({
        calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
        account: { current: accountOf({ state }) },
      })
      await waitFor(() => expect(loadsOf(fake)).toHaveLength(1))
    },
  )

  it('says a hidden title is gone for an approved account, never asking for the admin password', async () => {
    const { client, fake } = playTitle({
      calls: {
        'GET /api/media/7': MISSING,
        'GET /api/admin': reply({ body: { state: ADMIN_LOCK_STATES.on, available: true } }),
      },
      account: { current: accountOf({ state: ACCOUNT_STATES.approved }) },
    })
    expect(await screen.findByText(SERVER_COPY.gone('Vhagar'))).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Admin lock' })).toBeNull()
    expect(callNamesOf(client)).toEqual(['GET /api/media/7'])
    expect(loadsOf(fake)).toHaveLength(0)
  })

  it('still asks for the PIN of an approved account on a locked title', async () => {
    const { client } = playTitle({
      calls: { 'GET /api/media/7': LOCKED },
      account: { current: accountOf({ state: ACCOUNT_STATES.approved }) },
    })
    expect(await screen.findByRole('dialog', { name: 'Locked library' })).toBeInTheDocument()
    expect(callNamesOf(client)).toEqual(['GET /api/media/7'])
  })

  it('still asks for the admin password when the accounts are unavailable, as the server has none to use', async () => {
    const { client } = playTitle({
      calls: {
        'GET /api/media/7': [MISSING, reply({ body: EPISODE })],
        'GET /api/admin': reply({ body: { state: ADMIN_LOCK_STATES.on, available: true } }),
        'POST /api/admin/unlock': reply({ body: { state: ADMIN_LOCK_STATES.off } }),
      },
      account: { current: accountOf({ state: ACCOUNT_STATES.unavailable }) },
    })
    expect(await screen.findByRole('dialog', { name: 'Admin lock' })).toBeInTheDocument()
    await enter({ label: 'Admin password', value: 'hunter2' })
    await waitFor(() => expect(callNamesOf(client)).toContain('POST /api/admin/unlock'))
  })

  it('says the account could not be checked and reads it again on Try again', async () => {
    const account = { current: accountOf({ state: ACCOUNT_STATES.failed }) }
    const { client, fake } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      account,
    })
    expect(await screen.findByText(ACCOUNT_COPY.failed('Vhagar'))).toBeInTheDocument()
    expect(callNamesOf(client)).toEqual([])
    account.current = APPROVED
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(1))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.readAccount })).toHaveLength(2)
  })

  it("says main's reason when the account cannot be read", async () => {
    const { client } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      replies: { readAccount: { type: DESKTOP_REPLIES.refused, message: 'No sign in today.' } },
    })
    expect(await screen.findByText('No sign in today.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(callNamesOf(client)).toEqual([])
  })

  it('shows the refusal and resumes at the last saved position after an approval', async () => {
    const account = { current: APPROVED }
    const { client, fake } = playTitle({
      calls: {
        'GET /api/media/7': reply({ body: EPISODE }),
        'POST /api/media/7/plays': reply({ status: 204, body: '' }),
        'PUT /api/media/7/progress': reply({ status: 204, body: '' }),
      },
      account,
      replies: { refreshAccount: ACCOUNT_DONE(APPROVED) },
    })
    await loaded({ fake })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    fake.emit({ type: PLAYER_EVENTS.waiting, waiting: false })
    fake.emit({ type: PLAYER_EVENTS.time, time: 40 })
    await waitFor(() => expect(callNamesOf(client)).toContain('PUT /api/media/7/progress'))
    account.current = accountOf({ state: ACCOUNT_STATES.revoked, email: 'me@example.com' })
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.account,
      message: 'Your access to Vhagar was removed.',
    })
    expect(
      await screen.findByRole('heading', { name: 'Your access was removed' }),
    ).toBeInTheDocument()
    expect(loadsOf(fake)).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(2))
    expect(loadsOf(fake)[1]).toMatchObject({
      source: { kind: PLAYER_SOURCE_KINDS.server, serverId: S, mediaId: 7 },
      start: 40,
    })
    expect(callNamesOf(client).filter((name) => name === 'GET /api/media/7')).toHaveLength(1)
  })

  it('asks to sign in again when the account is gone mid-play', async () => {
    const account = { current: APPROVED }
    const { fake } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      account,
    })
    await loaded({ fake })
    account.current = accountOf()
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.account,
      message: 'Sign in to Vhagar again.',
    })
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
  })

  it('reads the account again when the title read is refused for it', async () => {
    const account = { current: APPROVED }
    const { client, fake } = playTitle({
      calls: { 'GET /api/media/7': [REFUSED_SIGNED_OUT, reply({ body: EPISODE })] },
      account,
      replies: { signIn: ACCOUNT_DONE(APPROVED) },
    })
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.readAccount })).toHaveLength(1),
    )
    account.current = accountOf()
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.readAccount })).toHaveLength(2),
    )
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(loadsOf(fake)).toHaveLength(0)
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(1))
  })

  it('says the refusal when the account is still approved', async () => {
    const { fake } = playTitle({
      calls: { 'GET /api/media/7': REFUSED_SIGNED_OUT },
      account: { current: APPROVED },
    })
    expect(await screen.findByText('Sign in to Vhagar.')).toBeInTheDocument()
    expect(loadsOf(fake)).toHaveLength(0)
  })

  it('keeps a title read that is refused for another reason as it was', async () => {
    const { client } = playTitle({
      calls: { 'GET /api/media/7': reply({ status: 500, body: { message: 'Boom.' } }) },
    })
    expect(await screen.findByText('Boom.')).toBeInTheDocument()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.readAccount })).toHaveLength(1)
  })

  it('keeps playing when a later read of the account fails', async () => {
    const replies: NonNullable<Parameters<typeof serverClient>[0]['replies']> = {}
    const { fake, queryClient } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      account: { current: APPROVED },
      replies,
    })
    await loaded({ fake })
    replies.readAccount = { type: DESKTOP_REPLIES.refused, message: 'No sign in today.' }
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: accountKey(S) })
    })
    await waitFor(() =>
      expect(queryClient.getQueryState(accountKey(S))?.status ?? null).toBe('error'),
    )
    expect(screen.queryByText('No sign in today.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Episode 1' })).toBeInTheDocument()
    expect(loadsOf(fake)).toHaveLength(1)
  })

  it('keeps playing when a later read of the account says it could not be checked', async () => {
    const account = { current: APPROVED }
    const { fake, queryClient } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      account,
    })
    await loaded({ fake })
    account.current = accountOf({ state: ACCOUNT_STATES.failed, email: 'me@example.com' })
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: accountKey(S) })
    })
    await waitFor(() =>
      expect(queryClient.getQueryData<AccountView>(accountKey(S))?.state ?? null).toBe(
        ACCOUNT_STATES.failed,
      ),
    )
    expect(screen.queryByText(ACCOUNT_COPY.failed('Vhagar'))).toBeNull()
    expect(screen.getByRole('heading', { name: 'Episode 1' })).toBeInTheDocument()
    expect(
      fake.send.mock.calls.filter(([command]) => command.type === PLAYER_COMMANDS.stop),
    ).toHaveLength(0)
    expect(loadsOf(fake)).toHaveLength(1)
  })

  it('does not bring the player back when the account cannot be checked after a sign out', async () => {
    const account = { current: APPROVED }
    const { fake, queryClient } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      account,
    })
    await loaded({ fake })
    account.current = accountOf()
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: accountKey(S) })
    })
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    account.current = accountOf({ state: ACCOUNT_STATES.failed })
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: accountKey(S) })
    })
    expect(await screen.findByText(ACCOUNT_COPY.failed('Vhagar'))).toBeInTheDocument()
    expect(loadsOf(fake)).toHaveLength(1)
  })

  it('loads again at the last saved position when the account is still approved after its refusal', async () => {
    const { client, fake } = playTitle({
      calls: {
        'GET /api/media/7': reply({ body: EPISODE }),
        'POST /api/media/7/plays': reply({ status: 204, body: '' }),
        'PUT /api/media/7/progress': reply({ status: 204, body: '' }),
      },
      account: { current: APPROVED },
    })
    await loaded({ fake })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    fake.emit({ type: PLAYER_EVENTS.waiting, waiting: false })
    fake.emit({ type: PLAYER_EVENTS.time, time: 40 })
    await waitFor(() => expect(callNamesOf(client)).toContain('PUT /api/media/7/progress'))
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.account,
      message: 'Sign in to Vhagar again.',
    })
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(2))
    expect(loadsOf(fake)[1]).toMatchObject({ start: 40 })
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.readAccount })).toHaveLength(2)
    expect(callNamesOf(client).filter((name) => name === 'GET /api/media/7')).toHaveLength(1)
  })

  it('loads once, not twice, when the account asked to sign in before it was approved again', async () => {
    const account = { current: APPROVED }
    const { fake } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      account,
      replies: { signIn: ACCOUNT_DONE(APPROVED) },
    })
    await loaded({ fake })
    account.current = accountOf()
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.account,
      message: 'Sign in to Vhagar again.',
    })
    await userEvent.type(await screen.findByLabelText('Email'), 'me@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(2))
    await act(async () => {})
    expect(loadsOf(fake)).toHaveLength(2)
  })

  describe('refusals of an approved account', () => {
    const playApproved = () => {
      const rendered = playTitle({
        calls: {
          'GET /api/media/7': reply({ body: EPISODE }),
          'POST /api/media/7/plays': reply({ status: 204, body: '' }),
          'PUT /api/media/7/progress': reply({ status: 204, body: '' }),
        },
        account: { current: APPROVED },
      })
      const refuse = () =>
        rendered.fake.emit({
          type: PLAYER_EVENTS.error,
          reason: PLAYER_ERROR_REASONS.account,
          message: 'Sign in to Vhagar again.',
        })
      const reads = () =>
        sentOfType({ client: rendered.client, type: DESKTOP_REQUESTS.readAccount }).length
      return { ...rendered, refuse, reads }
    }

    it('reloads once for refusals with no playback between them, then keeps the errored player', async () => {
      const { fake, refuse, reads } = playApproved()
      await loaded({ fake })
      refuse()
      await waitFor(() => expect(loadsOf(fake)).toHaveLength(2))
      await loaded({ fake, count: 2 })
      refuse()
      await waitFor(() => expect(reads()).toBe(3))
      await act(async () => {})
      expect(loadsOf(fake)).toHaveLength(2)
      expect(screen.getByRole('heading', { name: 'Episode 1' })).toBeInTheDocument()
    })

    it('reloads again at the new position once playback has moved between refusals', async () => {
      const { client, fake, refuse } = playApproved()
      await loaded({ fake })
      refuse()
      await waitFor(() => expect(loadsOf(fake)).toHaveLength(2))
      await loaded({ fake, count: 2 })
      fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
      fake.emit({ type: PLAYER_EVENTS.waiting, waiting: false })
      fake.emit({ type: PLAYER_EVENTS.time, time: 60 })
      await waitFor(() => expect(callNamesOf(client)).toContain('PUT /api/media/7/progress'))
      refuse()
      await waitFor(() => expect(loadsOf(fake)).toHaveLength(3))
      expect(loadsOf(fake)[2]).toMatchObject({ start: 60 })
    })
  })

  describe('a title on screen when another account signs in', () => {
    const OTHER_APPROVED = accountOf({ state: ACCOUNT_STATES.approved, email: 'bo@example.com' })

    const switchedMidPlay = async () => {
      const account = { current: APPROVED }
      const rendered = playTitle({
        calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
        account,
      })
      await loaded({ fake: rendered.fake })
      account.current = OTHER_APPROVED
      await rendered.client.emit({ type: DESKTOP_EVENTS.accountSwitched, serverId: S })
      await rendered.client.emit({ type: DESKTOP_EVENTS.account, account: OTHER_APPROVED })
      await waitFor(() => expect(rendered.queryClient.isFetching()).toBe(0))
      return rendered
    }

    it.each([
      {
        event: 'a window focus',
        happen: () => {
          focusManager.setFocused(false)
          focusManager.setFocused(true)
        },
        restore: () => focusManager.setFocused(undefined),
      },
      {
        event: 'a reconnect',
        happen: () => {
          onlineManager.setOnline(false)
          onlineManager.setOnline(true)
        },
        restore: () => onlineManager.setOnline(true),
      },
    ])('neither reads it again nor reloads its player on $event', async ({ happen, restore }) => {
      const { client, fake, queryClient } = await switchedMidPlay()
      try {
        act(happen)
        await waitFor(() => expect(queryClient.isFetching()).toBe(0))
        expect(callNamesOf(client)).toEqual(['GET /api/media/7'])
        expect(loadsOf(fake)).toHaveLength(1)
        expect(screen.getByRole('heading', { name: 'Episode 1' })).toBeInTheDocument()
      } finally {
        restore()
      }
    })

    it('tells main the page left the title only when it leaves, never when the player reloads', async () => {
      const { client, fake, router } = playTitle({
        calls: {
          'GET /api/media/7': [reply({ body: EPISODE }), LOCKED, reply({ body: EPISODE })],
          'POST /api/lock/unlock': UNLOCKED,
        },
        account: { current: APPROVED },
      })
      await loaded({ fake })
      fake.emit({ type: PLAYER_EVENTS.error, reason: PLAYER_ERROR_REASONS.locked, message: 'x' })
      await enter({ label: 'PIN', value: '1234' })
      await loaded({ fake, count: 2 })
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.leaveServerTitle })).toEqual([])
      await act(async () => router.navigate('/'))
      await waitFor(() =>
        expect(sentOfType({ client, type: DESKTOP_REQUESTS.leaveServerTitle })).toEqual([
          { type: DESKTOP_REQUESTS.leaveServerTitle, serverId: S, mediaId: 7 },
        ]),
      )
    })

    it('tells main the page left the title when the account in its place is not let in', async () => {
      const account = { current: APPROVED }
      const { client, fake } = playTitle({
        calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
        account,
      })
      await loaded({ fake })
      account.current = accountOf({ state: ACCOUNT_STATES.pending, email: 'bo@example.com' })
      await client.emit({ type: DESKTOP_EVENTS.accountSwitched, serverId: S })
      await client.emit({ type: DESKTOP_EVENTS.account, account: account.current })
      expect(
        await screen.findByRole('heading', { name: 'Waiting for approval' }),
      ).toBeInTheDocument()
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.leaveServerTitle })).toEqual([
        { type: DESKTOP_REQUESTS.leaveServerTitle, serverId: S, mediaId: 7 },
      ])
    })
  })
})
