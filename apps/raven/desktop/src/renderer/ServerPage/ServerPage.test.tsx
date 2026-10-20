import { describe, expect, it, mock } from 'bun:test'
import {
  ADMIN_LOCK_STATES,
  AUTH_REFUSALS,
  PLAYER_COMMANDS,
  PLAYER_ERROR_REASONS,
  PLAYER_EVENTS,
  PLAYER_SOURCE_KINDS,
  type PlayerCommand,
  type PlayerEvent,
} from '@raven/core'
import type { NativePlayer } from '@raven/ui'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavigationType } from 'react-router-dom'
import { SERVER_COPY } from '@/renderer/ServerPage/serverServices'
import { accountOf } from '@/renderer/test/accountFakes'
import { ACCOUNT_COPY } from '@/renderer/Account/accountCopy'
import { accountKey } from '@/renderer/desktop/accountApi'
import { connectionsOf, renderDesktop } from '@/renderer/test/render'
import { PlayerRefusal } from '@/renderer/desktop/playerConnection'
import {
  callNamesOf,
  heldReply,
  OFF_ACCOUNT,
  reply,
  S,
  sentOfType,
  serverCallsOf,
  serverClient,
} from '@/renderer/test/serverFakes'
import {
  ACCOUNT_STATES,
  type AccountView,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  ENGINE_STOPPED,
} from '@/shared/protocol'
import { mediaItemFor } from '@/shared/test/mediaItem'

const OTHER = '44444444-4444-4444-8444-444444444444'
const EPISODE = mediaItemFor({})
const LOCKED = reply({ status: 423, body: { message: 'This library is locked.' } })
const MISSING = reply({ status: 404, body: { message: 'Not found' } })
const UNLOCKED = reply({ body: { available: true, unlocked: true } })

/** A player whose commands are recorded and answered at once; `emit` plays main's events. */
const fakePlayer = () => {
  const listeners = new Set<(event: PlayerEvent) => void>()
  const send = mock<NativePlayer['send']>(async () => {})
  const player: NativePlayer = {
    send,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    player,
    send,
    emit: (event: PlayerEvent) =>
      act(() => {
        listeners.forEach((listener) => listener(event))
      }),
  }
}

type FakePlayer = ReturnType<typeof fakePlayer>

const loadsOf = (
  fake: FakePlayer,
): Extract<PlayerCommand, { type: typeof PLAYER_COMMANDS.load }>[] =>
  fake.send.mock.calls
    .map(([command]) => command)
    .flatMap((command) => (command.type === PLAYER_COMMANDS.load ? [command] : []))

/** The player took the load: it sends its caption size only once the load is answered. */
const loaded = ({ fake, count = 1 }: { fake: FakePlayer; count?: number }) =>
  waitFor(() => {
    const scales = fake.send.mock.calls.filter(
      ([command]) => command.type === PLAYER_COMMANDS.subtitleScale,
    )
    expect(scales).toHaveLength(count)
  })

// Written out, as main sends it, so a copy edit on either side cannot quietly bring
// "Open in browser" back for a removed server.
const MAIN_SERVER_GONE = 'That server is no longer in raven player.'

const NO_BROWSER: DesktopReply = {
  type: DESKTOP_REPLIES.refused,
  message: 'raven player could not open your browser.',
}

const playTitle = ({
  calls,
  replies,
  account = { current: OFF_ACCOUNT },
  state = { at: 0, next: [] },
  route = `/server/${S}/7`,
}: {
  calls: Parameters<typeof serverClient>[0]['calls']
  replies?: Parameters<typeof serverClient>[0]['replies']
  account?: { current: AccountView }
  state?: unknown
  route?: string
}) => {
  const client = serverClient({ calls, replies, account })
  const fake = fakePlayer()
  const rendered = renderDesktop({
    client,
    route,
    state,
    player: connectionsOf({ status: 'native', player: fake.player }),
  })
  return { client, fake, ...rendered }
}

const enter = async ({ label, value }: { label: string; value: string }) => {
  await userEvent.type(await screen.findByLabelText(label), value)
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
}

describe('ServerPage', () => {
  it('plays a title natively from its server', async () => {
    const { client, fake } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      state: { at: 30, next: [] },
    })
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(1))
    expect(loadsOf(fake)[0]).toEqual({
      type: PLAYER_COMMANDS.load,
      source: { kind: PLAYER_SOURCE_KINDS.server, serverId: S, mediaId: 7 },
      start: 30,
      audio: null,
      subtitle: null,
    })
    expect(await screen.findByRole('heading', { name: 'Episode 1' })).toBeInTheDocument()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.noteServerTitle })).toEqual([
      {
        type: DESKTOP_REQUESTS.noteServerTitle,
        serverId: S,
        mediaId: 7,
        label: 'Episode 1',
        watched: 0,
      },
    ])
  })

  it('asks for the PIN on a locked title and plays after it', async () => {
    const { client, fake } = playTitle({
      calls: {
        'GET /api/media/7': [LOCKED, reply({ body: EPISODE })],
        'POST /api/lock/unlock': UNLOCKED,
      },
    })
    expect(await screen.findByRole('dialog', { name: 'Locked library' })).toBeInTheDocument()
    expect(screen.getByText(SERVER_COPY.pinHint('Vhagar'))).toBeInTheDocument()
    expect(loadsOf(fake)).toHaveLength(0)
    await enter({ label: 'PIN', value: '1234' })
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(1))
    expect(serverCallsOf(client)).toContainEqual({
      type: DESKTOP_REQUESTS.serverCall,
      serverId: S,
      method: 'POST',
      path: '/api/lock/unlock',
      body: '{"pin":"1234"}',
    })
  })

  it('says a wrong PIN is wrong', async () => {
    const { fake } = playTitle({
      calls: {
        'GET /api/media/7': LOCKED,
        'POST /api/lock/unlock': reply({
          status: 401,
          body: { message: 'That PIN is not right.' },
        }),
      },
    })
    await enter({ label: 'PIN', value: '0000' })
    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN is not right.')
    expect(screen.getByRole('dialog', { name: 'Locked library' })).toBeInTheDocument()
    expect(loadsOf(fake)).toHaveLength(0)
  })

  it('goes Home when the PIN dialog is dismissed', async () => {
    const { router, fake } = playTitle({ calls: { 'GET /api/media/7': LOCKED } })
    await screen.findByRole('dialog', { name: 'Locked library' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(loadsOf(fake)).toHaveLength(0)
  })

  it('asks for the admin password first while the admin lock hides the title', async () => {
    const { client, fake } = playTitle({
      calls: {
        'GET /api/media/7': [MISSING, LOCKED, reply({ body: EPISODE })],
        'GET /api/admin': reply({ body: { state: 'on', available: true } }),
        'POST /api/admin/unlock': reply({ body: { state: 'on', available: true } }),
        'POST /api/lock/unlock': UNLOCKED,
      },
    })
    expect(await screen.findByRole('dialog', { name: 'Admin lock' })).toBeInTheDocument()
    expect(screen.getByText(SERVER_COPY.adminHint('Vhagar'))).toBeInTheDocument()
    await enter({ label: 'Admin password', value: 'hunter2' })
    expect(await screen.findByRole('dialog', { name: 'Locked library' })).toBeInTheDocument()
    await enter({ label: 'PIN', value: '1234' })
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(1))
    expect(callNamesOf(client)).toEqual([
      'GET /api/media/7',
      'GET /api/admin',
      'POST /api/admin/unlock',
      'GET /api/media/7',
      'POST /api/lock/unlock',
      'GET /api/media/7',
    ])
  })

  it('waits, never asking for the password again, while the title and the lock are read after an admin unlock', async () => {
    const mediaReread = heldReply()
    const lockReread = heldReply()
    const { client } = playTitle({
      calls: {
        'GET /api/media/7': [MISSING, mediaReread.promise],
        'GET /api/admin': [reply({ body: { state: 'on', available: true } }), lockReread.promise],
        'POST /api/admin/unlock': reply({ body: { state: 'off' } }),
      },
    })
    const reads = (name: string) => callNamesOf(client).filter((each) => each === name)
    await enter({ label: 'Admin password', value: 'hunter2' })
    await waitFor(() => expect(reads('GET /api/media/7')).toHaveLength(2))
    expect(screen.queryByRole('dialog', { name: 'Admin lock' })).toBeNull()
    expect(screen.getByRole('main', { name: 'Opening video' })).toBeInTheDocument()
    await act(async () => mediaReread.resolve(MISSING))
    await waitFor(() => expect(reads('GET /api/admin')).toHaveLength(2))
    expect(screen.queryByRole('dialog', { name: 'Admin lock' })).toBeNull()
    expect(screen.getByRole('main', { name: 'Opening video' })).toBeInTheDocument()
    await act(async () => lockReread.resolve(reply({ body: { state: 'off' } })))
    expect(await screen.findByText(SERVER_COPY.gone('Vhagar'))).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Admin lock' })).toBeNull()
  })

  it('says a title that is gone is gone', async () => {
    const { fake } = playTitle({
      calls: {
        'GET /api/media/7': MISSING,
        'GET /api/admin': reply({ body: { state: 'off' } }),
      },
    })
    expect(await screen.findByText('This title is not on Vhagar any more.')).toBeInTheDocument()
    expect(loadsOf(fake)).toHaveLength(0)
  })

  it('says the server cannot be reached and offers the browser', async () => {
    const { client } = playTitle({
      calls: {
        'GET /api/media/7': {
          type: DESKTOP_REPLIES.serverUnreachable,
          message: 'raven player could not reach raven.example.',
        },
      },
    })
    expect(
      await screen.findByText('raven player could not reach raven.example.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(callNamesOf(client)).toEqual(['GET /api/media/7', 'GET /api/media/7']),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Open in browser' }))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.openInBrowser })).toEqual([
      { type: DESKTOP_REQUESTS.openInBrowser, serverId: S, mediaId: 7 },
    ])
  })

  it("says main's reason when it will not open the browser", async () => {
    playTitle({
      calls: {
        'GET /api/media/7': { type: DESKTOP_REPLIES.serverUnreachable, message: 'No answer.' },
      },
      replies: { openInBrowser: NO_BROWSER },
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Open in browser' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(NO_BROWSER.message)
  })

  it('offers no browser for a server raven player no longer has', async () => {
    playTitle({
      calls: {
        'GET /api/media/7': { type: DESKTOP_REPLIES.refused, message: MAIN_SERVER_GONE },
      },
    })
    expect(await screen.findByText(SERVER_COPY.unknownServer)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in browser' })).toBeNull()
  })

  it("says main's reason when the browser does not open for an unavailable engine", async () => {
    const client = serverClient({ calls: {}, replies: { openInBrowser: NO_BROWSER } })
    renderDesktop({
      client,
      route: `/server/${S}/7`,
      state: { at: 0, next: [] },
      player: connectionsOf({ status: 'unavailable', message: 'No engine.' }),
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(NO_BROWSER.message)
  })

  it("says main's reason under Unplayable when the browser does not open", async () => {
    const { fake } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }) },
      replies: { openInBrowser: NO_BROWSER },
    })
    await loaded({ fake })
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.open,
      message: 'The file is damaged.',
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Open in browser' }))
    expect(await screen.findByText(NO_BROWSER.message)).toBeInTheDocument()
  })

  it('offers no browser under Unplayable once the server is gone mid-play', async () => {
    const { fake } = playTitle({ calls: { 'GET /api/media/7': reply({ body: EPISODE }) } })
    await loaded({ fake })
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.open,
      message: MAIN_SERVER_GONE,
    })
    expect(await screen.findByText(SERVER_COPY.unknownServer)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in browser' })).toBeNull()
  })

  it('offers no browser under Unplayable when main refuses the server source', async () => {
    const { fake } = playTitle({ calls: { 'GET /api/media/7': reply({ body: EPISODE }) } })
    fake.send.mockImplementation(async (command) => {
      if (command.type === PLAYER_COMMANDS.load) {
        throw new PlayerRefusal({ message: MAIN_SERVER_GONE, isEngineGone: false })
      }
    })
    expect(await screen.findByText(SERVER_COPY.unknownServer)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in browser' })).toBeNull()
  })

  it('opens the title in the browser when the video engine is unavailable', async () => {
    const client = serverClient({ calls: { 'GET /api/media/7': reply({ body: EPISODE }) } })
    renderDesktop({
      client,
      route: `/server/${S}/7`,
      state: { at: 0, next: [] },
      isStrict: true,
      player: connectionsOf({ status: 'unavailable', message: 'No engine.' }),
    })
    expect(await screen.findByText(SERVER_COPY.inBrowser('Vhagar'))).toBeInTheDocument()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.openInBrowser })).toEqual([
      { type: DESKTOP_REQUESTS.openInBrowser, serverId: S, mediaId: 7 },
    ])
    expect(serverCallsOf(client)).toEqual([])
  })

  it('offers the browser when the video engine stops mid-play', async () => {
    const { client, fake } = playTitle({ calls: { 'GET /api/media/7': reply({ body: EPISODE }) } })
    await loaded({ fake })
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.engine,
      message: ENGINE_STOPPED,
    })
    expect(await screen.findByText(SERVER_COPY.engineStopped)).toBeInTheDocument()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.openInBrowser })).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.openInBrowser })).toEqual([
      { type: DESKTOP_REQUESTS.openInBrowser, serverId: S, mediaId: 7 },
    ])
  })

  it('shows the next title from the link', async () => {
    playTitle({
      calls: {
        'GET /api/media/7': reply({ body: EPISODE }),
        'GET /api/media/8': reply({ body: mediaItemFor({ id: 8, title: 'Episode 2' }) }),
      },
      state: { at: 0, next: [8] },
    })
    expect(await screen.findByRole('link', { name: 'Up next: Episode 2' })).toHaveAttribute(
      'href',
      `/server/${S}/8`,
    )
  })

  it('shows no next title when the next one cannot be read', async () => {
    const { queryClient, fake } = playTitle({
      calls: { 'GET /api/media/7': reply({ body: EPISODE }), 'GET /api/media/8': MISSING },
      state: { at: 0, next: [8] },
    })
    await loaded({ fake })
    await waitFor(() =>
      expect(queryClient.getQueryState(['desktop', 'server', S, 'next', 8])?.status ?? null).toBe(
        'error',
      ),
    )
    expect(screen.queryByRole('link', { name: /^Up next/ })).toBeNull()
  })

  it('replaces the entry with the next title when the menu says next', async () => {
    const { router, menu, fake } = playTitle({
      calls: {
        'GET /api/media/7': reply({ body: EPISODE }),
        'GET /api/media/8': reply({ body: mediaItemFor({ id: 8, title: 'Episode 2' }) }),
      },
      state: { at: 0, next: [8, 9] },
    })
    await screen.findByRole('link', { name: 'Up next: Episode 2' })
    await loaded({ fake })
    await act(async () => menu.emit('next'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/server/${S}/8`))
    expect(router.state.historyAction).toBe(NavigationType.Replace)
    expect(router.state.location.state).toEqual({ at: 0, next: [9] })
  })

  it('asks for the PIN again when a library locks mid-play, then resumes', async () => {
    const { client, fake } = playTitle({
      calls: {
        'GET /api/media/7': [reply({ body: EPISODE }), LOCKED, reply({ body: EPISODE })],
        'POST /api/media/7/plays': reply({ status: 204, body: '' }),
        'PUT /api/media/7/progress': reply({ status: 204, body: '' }),
        'POST /api/lock/unlock': UNLOCKED,
      },
    })
    await loaded({ fake })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    fake.emit({ type: PLAYER_EVENTS.time, time: 40 })
    await waitFor(() =>
      expect(serverCallsOf(client)).toContainEqual({
        type: DESKTOP_REQUESTS.serverCall,
        serverId: S,
        method: 'PUT',
        path: '/api/media/7/progress',
        body: '{"position":40}',
      }),
    )
    fake.emit({ type: PLAYER_EVENTS.error, reason: PLAYER_ERROR_REASONS.locked, message: 'x' })
    expect(await screen.findByRole('dialog', { name: 'Locked library' })).toBeInTheDocument()
    await enter({ label: 'PIN', value: '1234' })
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(2))
    expect(loadsOf(fake)[1]).toMatchObject({
      source: { kind: PLAYER_SOURCE_KINDS.server, serverId: S, mediaId: 7 },
      start: 40,
    })
  })

  it('resumes a relock from where the title started when nothing was saved yet', async () => {
    const { fake } = playTitle({
      calls: {
        'GET /api/media/7': [reply({ body: EPISODE }), LOCKED, reply({ body: EPISODE })],
        'POST /api/lock/unlock': UNLOCKED,
      },
      state: { at: 300, next: [] },
    })
    await loaded({ fake })
    fake.emit({ type: PLAYER_EVENTS.error, reason: PLAYER_ERROR_REASONS.locked, message: 'x' })
    await enter({ label: 'PIN', value: '1234' })
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(2))
    expect(loadsOf(fake).map(({ start }) => start)).toEqual([300, 300])
  })

  it('records the play once, not again after a relock remounts the player', async () => {
    const { client, fake } = playTitle({
      calls: {
        'GET /api/media/7': [reply({ body: EPISODE }), LOCKED, reply({ body: EPISODE })],
        'POST /api/media/7/plays': reply({ status: 204, body: '' }),
        'PUT /api/media/7/progress': reply({ status: 204, body: '' }),
        'POST /api/lock/unlock': UNLOCKED,
      },
    })
    await loaded({ fake })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    await waitFor(() => expect(callNamesOf(client)).toContain('POST /api/media/7/plays'))
    fake.emit({ type: PLAYER_EVENTS.error, reason: PLAYER_ERROR_REASONS.locked, message: 'x' })
    await enter({ label: 'PIN', value: '1234' })
    await loaded({ fake, count: 2 })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    fake.emit({ type: PLAYER_EVENTS.time, time: 50 })
    await waitFor(() => expect(callNamesOf(client)).toContain('PUT /api/media/7/progress'))
    expect(callNamesOf(client).filter((name) => name === 'POST /api/media/7/plays')).toHaveLength(1)
  })

  it("keeps the engine's length for the recents when the next title's name arrives", async () => {
    const next = heldReply()
    const { client, fake, router } = playTitle({
      calls: {
        'GET /api/media/7': reply({ body: mediaItemFor({ duration: null }) }),
        'GET /api/media/8': next.promise,
        'POST /api/media/7/plays': reply({ status: 204, body: '' }),
        'PUT /api/media/7/progress': reply({ status: 204, body: '' }),
      },
      state: { at: 0, next: [8] },
    })
    await loaded({ fake })
    fake.emit({ type: PLAYER_EVENTS.duration, duration: 100 })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    fake.emit({ type: PLAYER_EVENTS.time, time: 40 })
    await act(async () =>
      next.resolve(reply({ body: mediaItemFor({ id: 8, title: 'Episode 2' }) })),
    )
    await screen.findByRole('link', { name: 'Up next: Episode 2' })
    await act(async () => router.navigate('/'))
    const notes = sentOfType({ client, type: DESKTOP_REQUESTS.noteServerTitle })
    expect(notes.at(-1)).toMatchObject({ type: DESKTOP_REQUESTS.noteServerTitle, watched: 0.4 })
  })

  it('asks again when the title stays locked after an unlock mid-play', async () => {
    const { client, fake } = playTitle({
      calls: {
        'GET /api/media/7': [reply({ body: EPISODE }), LOCKED],
        'POST /api/lock/unlock': UNLOCKED,
      },
    })
    await loaded({ fake })
    fake.emit({ type: PLAYER_EVENTS.error, reason: PLAYER_ERROR_REASONS.locked, message: 'x' })
    await enter({ label: 'PIN', value: '1234' })
    await waitFor(() =>
      expect(callNamesOf(client).filter((name) => name === 'GET /api/media/7')).toHaveLength(3),
    )
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: 'Locked library' })
      expect(dialog).toHaveAttribute('open')
      expect(screen.getByLabelText('PIN')).toHaveValue('')
    })
    expect(loadsOf(fake)).toHaveLength(1)
  })

  it('refuses a route it cannot read without asking anything', async () => {
    const client = serverClient({ calls: {} })
    renderDesktop({ client, route: '/server/not-an-id/7' })
    expect(
      await screen.findByRole('heading', { name: "This video can't be opened" }),
    ).toBeInTheDocument()
    expect(screen.getByText('raven player cannot open that title.')).toBeInTheDocument()
    const asked = () =>
      client.request.mock.calls
        .map(([request]) => request.type)
        .filter(
          (type) => type === DESKTOP_REQUESTS.listServers || type === DESKTOP_REQUESTS.serverCall,
        )
    expect(asked()).toEqual([])
  })

  it('refuses a media id that is not a whole number without asking anything', async () => {
    const client = serverClient({ calls: {} })
    renderDesktop({ client, route: `/server/${S}/abc` })
    expect(
      await screen.findByRole('heading', { name: "This video can't be opened" }),
    ).toBeInTheDocument()
    expect(
      client.request.mock.calls.filter(
        ([request]) =>
          request.type === DESKTOP_REQUESTS.listServers ||
          request.type === DESKTOP_REQUESTS.serverCall,
      ),
    ).toEqual([])
  })

  it('says a server it does not know is gone', async () => {
    const client = serverClient({ calls: {} })
    renderDesktop({ client, route: `/server/${OTHER}/7` })
    expect(await screen.findByText(SERVER_COPY.unknownServer)).toBeInTheDocument()
    expect(serverCallsOf(client)).toEqual([])
  })
})

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
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
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
    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
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
      fake.emit({ type: PLAYER_EVENTS.time, time: 60 })
      await waitFor(() => expect(callNamesOf(client)).toContain('PUT /api/media/7/progress'))
      refuse()
      await waitFor(() => expect(loadsOf(fake)).toHaveLength(3))
      expect(loadsOf(fake)[2]).toMatchObject({ start: 60 })
    })
  })
})
