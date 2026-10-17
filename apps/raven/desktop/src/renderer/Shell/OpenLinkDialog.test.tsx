import { describe, expect, it, mock } from 'bun:test'
import type { NativePlayer } from '@raven/ui'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { connectionsOf, fakeClient, renderDesktop, STUB_ROUTES } from '@/renderer/test/render'
import { reply, S, serverClient } from '@/renderer/test/serverFakes'
import type { DesktopReply, DesktopRequest, LocalFile } from '@/shared/protocol'
import { mediaItemFor } from '@/shared/test/mediaItem'

const A = '11111111-1111-4111-8111-111111111111'

const LINK = 'https://raven.example/watch/7'

/** The Shell over Home, with main answering `openLink` with `answer`; File > Open Link opens the dialog. */
const openDialog = async ({
  answer = { type: 'done' },
}: {
  answer?: DesktopReply | (() => Promise<DesktopReply>)
} = {}) => {
  const client = fakeClient({
    request: async (asked: DesktopRequest) => {
      if (asked.type === 'listRecents') return { type: 'recents', recents: [] }
      if (asked.type !== 'openLink') return { type: 'done' }
      return typeof answer === 'function' ? answer() : answer
    },
  })
  const { router } = renderDesktop({ client, routes: STUB_ROUTES })
  await screen.findByText('Nothing opened yet.')
  await client.emit({ type: 'openLink' })
  const dialog = await screen.findByRole('dialog', { name: 'Open a link' })
  const field = within(dialog).getByRole('textbox', { name: 'Link' })
  return { client, router, dialog, field }
}

const linkRequestsOf = (client: ReturnType<typeof fakeClient>): DesktopRequest[] =>
  client.request.mock.calls
    .map(([request]) => request)
    .filter((request) => request.type === 'openLink')

describe('OpenLinkDialog', () => {
  it('opens from the File menu, explains itself, and puts focus in the field', async () => {
    const { dialog, field } = await openDialog()
    expect(dialog.tagName).toBe('DIALOG')
    expect(
      within(dialog).getByText(
        'Paste a raven player link or the address of a title on a raven server.',
      ),
    ).toBeInTheDocument()
    expect(field).toHaveAttribute('type', 'url')
    expect(field).toBeRequired()
    await waitFor(() => expect(field).toHaveFocus())
  })

  it('sends the pasted link, trimmed', async () => {
    const { client, dialog, field } = await openDialog()
    await userEvent.type(field, `  ${LINK} `)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(linkRequestsOf(client)).toEqual([{ type: 'openLink', link: LINK }]))
  })

  it('plays a server title main opens, and closes', async () => {
    const { router, dialog, field } = await openDialog({
      answer: { type: 'playServer', target: { serverId: S, mediaId: 7, at: 0, next: [] } },
    })
    await userEvent.type(field, LINK)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/server/${S}/7`))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('Playing from a server')).toBeInTheDocument()
  })

  it('says why main refused, as an alert, and stays open', async () => {
    const { router, dialog, field } = await openDialog({
      answer: { type: 'refused', message: 'That is not a raven link.' },
    })
    await userEvent.type(field, 'https://example.com/')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That is not a raven link.')
    expect(screen.getByRole('dialog', { name: 'Open a link' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    await waitFor(() => expect(field).toHaveFocus())
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('That is not a raven link.')
  })

  it('closes on Escape without asking main', async () => {
    const { client, field } = await openDialog()
    await userEvent.type(field, LINK)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(linkRequestsOf(client)).toEqual([])
  })

  it('plays nothing when main answers after the dialog was cancelled', async () => {
    const held = Promise.withResolvers<DesktopReply>()
    const { router, dialog, field } = await openDialog({ answer: () => held.promise })
    await userEvent.type(field, LINK)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await act(async () =>
      held.resolve({ type: 'playServer', target: { serverId: S, mediaId: 7, at: 0, next: [] } }),
    )
    expect(router.state.location.pathname).toBe('/')
  })

  it('closes quietly when the person declines the prompt', async () => {
    const { dialog, field } = await openDialog({ answer: { type: 'done' } })
    await userEvent.type(field, LINK)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('says so when main does not answer at all, and stays open', async () => {
    const { dialog, field } = await openDialog({
      answer: () => Promise.reject(new Error('port closed')),
    })
    await userEvent.type(field, LINK)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'raven player could not open that link. Try again.',
    )
  })

  it('holds Open while main is answering, so one paste asks once', async () => {
    const held = Promise.withResolvers<DesktopReply>()
    const { client, dialog, field } = await openDialog({ answer: () => held.promise })
    await userEvent.type(field, LINK)
    const open = within(dialog).getByRole('button', { name: 'Open' })
    await userEvent.click(open)
    await waitFor(() => expect(open).toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(open)
    expect(open).toHaveFocus()
    expect(linkRequestsOf(client)).toHaveLength(1)
    await act(async () => held.resolve({ type: 'done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes on Cancel without asking main', async () => {
    const { client, dialog, field } = await openDialog()
    await userEvent.type(field, LINK)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(linkRequestsOf(client)).toEqual([])
  })

  it('opens again, empty, after it closed', async () => {
    const { client, dialog, field } = await openDialog()
    await userEvent.type(field, LINK)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await client.emit({ type: 'openLink' })
    const again = await screen.findByRole('dialog', { name: 'Open a link' })
    expect(within(again).getByRole('textbox', { name: 'Link' })).toHaveValue('')
  })
})

/** A native player whose commands are recorded and answered at once. */
const fakePlayer = () => {
  const send = mock<NativePlayer['send']>(async () => {})
  const player: NativePlayer = { send, subscribe: () => () => undefined }
  return { player, send }
}

/** What a player key would send: none of it may come from a key pressed in the dialog. */
const PLAYER_COMMANDS = new Set(['play', 'pause', 'seek', 'volume', 'stop'])

const CLIP: LocalFile = {
  fileId: A,
  label: 'Clip 01',
  folder: 'Clips',
  resumeAt: 0,
  next: null,
  tracks: null,
}

/** Opens the dialog over the page, then presses Escape in the field and the player's keys on Open. */
const pressOverPlayer = async (client: ReturnType<typeof fakeClient>) => {
  await client.emit({ type: 'openLink' })
  const dialog = await screen.findByRole('dialog', { name: 'Open a link' })
  const field = within(dialog).getByRole('textbox', { name: 'Link' })
  const open = within(dialog).getByRole('button', { name: 'Open' })
  ;['k', 'm', 'l', 'j', 'f'].forEach((key) => {
    fireEvent.keyDown(open, { key })
  })
  await waitFor(() => expect(field).toHaveFocus())
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

describe('OpenLinkDialog over a playing video', () => {
  it('keeps its keys from a server title, and Escape closes only the dialog', async () => {
    const client = serverClient({
      calls: { 'GET /api/media/7': reply({ body: mediaItemFor({}) }) },
    })
    const fake = fakePlayer()
    const { router } = renderDesktop({
      client,
      route: `/server/${S}/7`,
      state: { at: 0, next: [] },
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Episode 1' })
    await waitFor(() =>
      expect(fake.send.mock.calls.some(([command]) => command.type === 'load')).toBe(true),
    )
    const before = fake.send.mock.calls.length
    await pressOverPlayer(client)
    const after = fake.send.mock.calls.slice(before).map(([command]) => command.type)
    expect(after.filter((type) => PLAYER_COMMANDS.has(type))).toEqual([])
    expect(router.state.location.pathname).toBe(`/server/${S}/7`)
    expect(screen.getByRole('heading', { name: 'Episode 1' })).toBeInTheDocument()
  })

  it('keeps its keys from a local video, and Escape closes only the dialog', async () => {
    const client = fakeClient({
      request: async (asked) => {
        if (asked.type === 'describeFile') return { type: 'file', file: CLIP }
        if (asked.type === 'listRecents') return { type: 'recents', recents: [] }
        return { type: 'done' }
      },
    })
    const { router } = renderDesktop({ client, route: `/play/${A}` })
    await screen.findByRole('heading', { name: 'Clip 01' })
    const video = await waitFor(() => {
      const element = document.querySelector('video')
      if (element === null || element.getAttribute('src') !== `raven-file://${A}`) {
        throw new Error('no sourced video yet')
      }
      return element
    })
    const was = { paused: video.paused, time: video.currentTime, muted: video.muted }
    await pressOverPlayer(client)
    expect({ paused: video.paused, time: video.currentTime, muted: video.muted }).toEqual(was)
    expect(router.state.location.pathname).toBe(`/play/${A}`)
    expect(screen.getByRole('heading', { name: 'Clip 01' })).toBeInTheDocument()
  })
})
