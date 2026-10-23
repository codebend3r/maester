import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import {
  isPlayerRequest,
  type OutputSettings,
  PLAYER_COMMANDS,
  PLAYER_EVENTS,
  type PlayerCommand,
  type PlayerEvent,
  type PlayerRefusalReason,
} from '@raven/core'
import type { NativePlayer } from '@raven/ui/headless'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavigationType } from 'react-router-dom'
import { listenForPlayer } from '@/renderer/desktop/playerConnection'
import { ENGINE_MOVED, ENGINE_NOTES, STATS_UNAVAILABLE } from '@/renderer/PlayPage/playerServices'
import { connectionsOf, fakeClient, renderDesktop } from '@/renderer/test/render'
import {
  APP_ORIGIN,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  ENGINE_STOPPED,
  type LocalFile,
  WINDOW_MESSAGE_TYPES,
} from '@/shared/protocol'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const CLIP_A: LocalFile = {
  fileId: A,
  label: 'Clip 01',
  folder: 'Clips',
  isDownload: false,
  resumeAt: 0,
  next: { fileId: B, label: 'Clip 02', queue: [] },
  tracks: null,
}
const CLIP_B: LocalFile = {
  fileId: B,
  label: 'Clip 02',
  folder: 'Clips',
  isDownload: false,
  resumeAt: 0,
  next: null,
  tracks: null,
}

const describing =
  (reply: (fileId: string) => DesktopReply) =>
  async (request: DesktopRequest): Promise<DesktopReply> => {
    if (request.type === DESKTOP_REQUESTS.describeFile) return reply(request.fileId)
    if (request.type === DESKTOP_REQUESTS.listRecents) return { type: 'recents', recents: [] }
    return { type: 'done' }
  }

const PASSTHROUGH: OutputSettings = {
  profile: 'passthrough',
  device: 'auto',
  passthrough: ['ac3', 'dts'],
  spatial: false,
}

const clips = describing((fileId) => ({ type: 'file', file: fileId === A ? CLIP_A : CLIP_B }))

/**
 * The html engine's video once it is pointed at `fileId`. The element mounts first and its
 * source is set in an effect after, so waiting for the element alone races a slow runner.
 */
const sourcedVideo = ({ fileId }: { fileId: string }) =>
  waitFor(() => {
    const element = document.querySelector('video')
    if (element === null) throw new Error('no video element')
    const source = element.getAttribute('src')
    if (source !== `raven-file://${fileId}`) throw new Error(`video source is ${source ?? 'unset'}`)
    return element
  })

const videoElement = async () => {
  await screen.findByRole('heading', { name: 'Clip 01' })
  return sourcedVideo({ fileId: A })
}

describe('PlayPage', () => {
  it('plays the granted file through raven-file', async () => {
    renderDesktop({ client: fakeClient({ request: clips }), route: `/play/${A}` })
    const video = await videoElement()
    expect(video.getAttribute('src')).toBe(`raven-file://${A}`)
  })

  it('asks main to describe the file with its queue', async () => {
    const client = fakeClient({ request: clips })
    renderDesktop({ client, route: `/play/${A}` })
    await videoElement()
    expect(client.request).toHaveBeenCalledWith({ type: 'describeFile', fileId: A, queue: [] })
  })

  it('says where it resumed', async () => {
    const client = fakeClient({
      request: describing(() => ({ type: 'file', file: { ...CLIP_A, resumeAt: 65 } })),
    })
    renderDesktop({ client, route: `/play/${A}` })
    await videoElement()
    expect(await screen.findByText('Resumed at 1:05')).toBeInTheDocument()
  })

  it('says under the title where a download came from', async () => {
    const download: LocalFile = { ...CLIP_A, folder: 'Downloaded from Vhagar', isDownload: true }
    const client = fakeClient({
      request: describing((fileId) => ({ type: 'file', file: fileId === A ? download : CLIP_B })),
    })
    renderDesktop({ client, route: `/play/${A}` })
    await videoElement()
    expect(screen.getByText('Downloaded from Vhagar · Direct play')).toBeInTheDocument()
  })

  it('names no folder under the title of a file that is no download', async () => {
    renderDesktop({ client: fakeClient({ request: clips }), route: `/play/${A}` })
    await videoElement()
    const about = screen.getByRole('heading', { level: 1, name: 'Clip 01' }).nextElementSibling
    expect(about).toHaveTextContent(/^Direct play$/)
    expect(screen.queryByText(/Clips/)).toBeNull()
  })

  it('links the next video', async () => {
    renderDesktop({ client: fakeClient({ request: clips }), route: `/play/${A}` })
    await videoElement()
    expect(screen.getByRole('link', { name: 'Up next: Clip 02' })).toHaveAttribute(
      'href',
      `/play/${B}`,
    )
  })

  it('goes Home from Back', async () => {
    const { router } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
    })
    await videoElement()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('replaces the entry with the next video when the menu says next', async () => {
    const { router, menu } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
    })
    await videoElement()
    await act(async () => menu.emit('next'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/play/${B}`))
    expect(router.state.historyAction).toBe(NavigationType.Replace)
    await screen.findByRole('heading', { name: 'Clip 02' })
  })

  it('does nothing for the menu next when no video follows', async () => {
    const { router, menu } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${B}`,
    })
    await screen.findByRole('heading', { name: 'Clip 02' })
    act(() => menu.emit('next'))
    expect(router.state.location.pathname).toBe(`/play/${B}`)
  })

  it('saves the position of the video it leaves before it asks about the next', async () => {
    const client = fakeClient({ request: clips })
    const { router } = renderDesktop({ client, route: `/play/${A}` })
    const video = await videoElement()
    fireEvent(video, new Event('playing'))
    await act(() => router.navigate(`/play/${B}`))
    await screen.findByRole('heading', { name: 'Clip 02' })
    const sent = client.request.mock.calls.map(([request]) => request)
    const saved = sent.findIndex(
      (request) => request.type === DESKTOP_REQUESTS.savePosition && request.fileId === A,
    )
    const described = sent.findIndex(
      (request) => request.type === DESKTOP_REQUESTS.describeFile && request.fileId === B,
    )
    expect(saved).toBeGreaterThan(-1)
    expect(described).toBeGreaterThan(saved)
  })

  it('sends no position for a video left before it played, and sends one once it played', async () => {
    const client = fakeClient({ request: clips })
    const { router } = renderDesktop({ client, route: `/play/${A}` })
    await videoElement()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    const saves = () =>
      client.request.mock.calls.filter(([request]) => request.type === 'savePosition')
    expect(saves()).toEqual([])
    await act(() => router.navigate(`/play/${A}`))
    fireEvent(await videoElement(), new Event('playing'))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(saves().length).toBeGreaterThan(0)
  })

  it('tells main it left the file once the player saved where it was', async () => {
    const client = fakeClient({ request: clips })
    const { router } = renderDesktop({ client, route: `/play/${A}` })
    const video = await videoElement()
    fireEvent(video, new Event('playing'))
    const sent = () => client.request.mock.calls.map(([request]) => request)
    expect(sent()).not.toContainEqual({ type: 'playbackLeft', fileId: A })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(sent()).toContainEqual({ type: 'playbackLeft', fileId: A }))
    const saved = sent().findLastIndex(
      (request) => request.type === 'savePosition' && request.fileId === A,
    )
    const left = sent().findIndex((request) => request.type === 'playbackLeft')
    expect(saved).toBeGreaterThan(-1)
    expect(left).toBeGreaterThan(saved)
    expect(router.state.location.pathname).toBe('/')
  })

  it('tells main it left a file for the next one, and a file it could not open', async () => {
    const client = fakeClient({
      request: describing((fileId) =>
        fileId === A ? { type: 'file', file: CLIP_A } : { type: 'refused', message: 'Gone.' },
      ),
    })
    const { router } = renderDesktop({ client, route: `/play/${A}` })
    await videoElement()
    await act(() => router.navigate(`/play/${B}`))
    await screen.findByText('Gone.')
    const lefts = () =>
      client.request.mock.calls
        .map(([request]) => request)
        .filter((request) => request.type === 'playbackLeft')
    await waitFor(() => expect(lefts()).toEqual([{ type: 'playbackLeft', fileId: A }]))
    await userEvent.click(screen.getByRole('button', { name: 'Home' }))
    await waitFor(() =>
      expect(lefts()).toEqual([
        { type: 'playbackLeft', fileId: A },
        { type: 'playbackLeft', fileId: B },
      ]),
    )
  })

  it("says it left only once it leaves, not for StrictMode's second run of its effects", async () => {
    const client = fakeClient({ request: clips })
    const { router } = renderDesktop({ client, route: `/play/${A}`, isStrict: true })
    await videoElement()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const lefts = () =>
      client.request.mock.calls.filter(([request]) => request.type === 'playbackLeft')
    expect(lefts()).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await waitFor(() => expect(lefts()).toHaveLength(1))
  })

  it('names the page it shows while main describes the file', async () => {
    const pending = Promise.withResolvers<DesktopReply>()
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.describeFile ? pending.promise : { type: 'done' },
    })
    renderDesktop({ client, route: `/play/${A}` })
    const waiting = await screen.findByRole('main', { name: 'Opening video' })
    expect(waiting).toHaveAttribute('aria-busy', 'true')
    await act(async () => pending.resolve({ type: 'file', file: CLIP_A }))
  })

  it('says why a video cannot be opened and goes Home', async () => {
    const client = fakeClient({
      request: describing(() => ({ type: 'refused', message: 'That video is gone.' })),
    })
    const { router } = renderDesktop({ client, route: `/play/${A}` })
    expect(
      await screen.findByRole('heading', { name: "This video can't be opened" }),
    ).toBeInTheDocument()
    expect(screen.getByText('That video is gone.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Home' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('asks main with an empty queue when the location state is malformed', async () => {
    const client = fakeClient({ request: clips })
    renderDesktop({ client, route: `/play/${A}`, state: { queue: ['../x'] } })
    await videoElement()
    expect(client.request).toHaveBeenCalledWith({ type: 'describeFile', fileId: A, queue: [] })
  })

  it('refuses an id that is not an opaque id without asking main', async () => {
    const client = fakeClient({ request: clips })
    renderDesktop({ client, route: '/play/not-an-id' })
    expect(
      await screen.findByRole('heading', { name: "This video can't be opened" }),
    ).toBeInTheDocument()
    expect(
      client.request.mock.calls.some(([request]) => request.type === DESKTOP_REQUESTS.describeFile),
    ).toBe(false)
  })
})

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

const settled = (ms = 10) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })

const sentOfType = ({
  client,
  type,
}: {
  client: ReturnType<typeof fakeClient>
  type: DesktopRequest['type']
}) =>
  client.request.mock.calls.map(([request]) => request).filter((request) => request.type === type)

const commandTypes = (send: ReturnType<typeof fakePlayer>['send']) =>
  send.mock.calls.map(([command]) => command.type)

describe('PlayPage engines', () => {
  it('plays through the native engine when main hands over its player', async () => {
    const fake = fakePlayer()
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    expect(document.querySelector('video')).toBeNull()
    expect(fake.send).toHaveBeenCalledWith({
      type: 'load',
      source: { kind: 'file', fileId: A },
      start: 0,
      audio: null,
      subtitle: null,
    })
  })

  it('loads the stored track pick', async () => {
    const fake = fakePlayer()
    renderDesktop({
      client: fakeClient({
        request: describing(() => ({
          type: 'file',
          file: { ...CLIP_A, tracks: { audio: 1, subtitle: 'embedded-0' } },
        })),
      }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    expect(fake.send.mock.calls[0]![0]).toMatchObject({ audio: 1, subtitle: 'embedded-0' })
  })

  it('shows the busy view while main has not said which engine it has', async () => {
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'waiting' }),
    })
    await settled()
    const waiting = screen.getByRole('main', { name: 'Opening video' })
    expect(waiting).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('heading', { name: 'Clip 01' })).toBeNull()
  })

  it('moves from waiting to the native engine when the hand-over comes', async () => {
    const fake = fakePlayer()
    const player = connectionsOf({ status: 'waiting' })
    renderDesktop({ client: fakeClient({ request: clips }), route: `/play/${A}`, player })
    await settled()
    player.set({ status: 'native', player: fake.player })
    await screen.findByRole('heading', { name: 'Clip 01' })
    expect(document.querySelector('video')).toBeNull()
  })

  it('plays through the html engine when the native one is unavailable', async () => {
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'unavailable', message: 'No engine.' }),
    })
    const video = await videoElement()
    expect(video.getAttribute('src')).toBe(`raven-file://${A}`)
  })

  it('fixes the volume under a passthrough output', async () => {
    const fake = fakePlayer()
    const output = describing((fileId) => ({ type: 'file', file: fileId === A ? CLIP_A : CLIP_B }))
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.readOutput
          ? { type: 'output', output: PASSTHROUGH, devices: [], isEngineReady: true }
          : output(request),
    })
    renderDesktop({
      client,
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeDisabled()
    await settled()
    expect(fake.send.mock.calls.some(([command]) => command.type === PLAYER_COMMANDS.volume)).toBe(
      false,
    )
  })

  it('keeps the volume for the html engine, which mixes the sound itself', async () => {
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.readOutput
          ? { type: 'output', output: PASSTHROUGH, devices: [], isEngineReady: false }
          : clips(request),
    })
    renderDesktop({ client, route: `/play/${A}` })
    await videoElement()
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled()
  })

  it('keeps the volume when passthrough holds only formats CoreAudio does not carry', async () => {
    const fake = fakePlayer()
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.readOutput
          ? {
              type: 'output',
              output: { ...PASSTHROUGH, passthrough: ['truehd', 'eac3'] },
              devices: [],
              isEngineReady: true,
            }
          : clips(request),
    })
    renderDesktop({
      client,
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled()
  })

  it('keeps the volume when passthrough carries no format', async () => {
    const fake = fakePlayer()
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.readOutput
          ? {
              type: 'output',
              output: { ...PASSTHROUGH, passthrough: [] },
              devices: [],
              isEngineReady: true,
            }
          : clips(request),
    })
    renderDesktop({
      client,
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled()
  })

  // The shared chrome tells the host on its way out; the page adds nothing of its own.
  it('shows the window buttons again when it goes Home', async () => {
    const fake = fakePlayer()
    const client = fakeClient({ request: clips })
    const { router } = renderDesktop({
      client,
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    client.request.mockClear()
    await act(() => router.navigate('/'))
    expect(sentOfType({ client, type: 'windowButtons' })).toContainEqual({
      type: 'windowButtons',
      isVisible: true,
    })
  })

  it('goes Home on Escape and on Back with the native engine', async () => {
    const fake = fakePlayer()
    const player = connectionsOf({ status: 'native', player: fake.player })
    const { router } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player,
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await act(() => router.navigate(`/play/${A}`))
    await screen.findByRole('heading', { name: 'Clip 01' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('never changes engine mid-play when the connection changes under it', async () => {
    const fake = fakePlayer()
    const player = connectionsOf({ status: 'native', player: fake.player })
    renderDesktop({ client: fakeClient({ request: clips }), route: `/play/${A}`, player })
    await screen.findByRole('heading', { name: 'Clip 01' })
    player.set({ status: 'unavailable', message: 'No engine.' })
    await settled()
    expect(document.querySelector('video')).toBeNull()
    expect(commandTypes(fake.send).filter((type) => type === PLAYER_COMMANDS.load)).toHaveLength(1)
    expect(commandTypes(fake.send)).not.toContain('stop')
  })

  it('resumes through the html engine where mpv stopped', async () => {
    const fake = fakePlayer()
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    fake.emit({ type: 'time', time: 75 })
    fake.emit({ type: 'error', reason: 'engine', message: ENGINE_STOPPED })
    await sourcedVideo({ fileId: A })
    expect(await screen.findByText('Resumed at 1:15')).toBeInTheDocument()
  })

  it('does not wait on the output settings, and fixes the volume when they come', async () => {
    const fake = fakePlayer()
    const output = Promise.withResolvers<DesktopReply>()
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.readOutput ? output.promise : clips(request),
    })
    renderDesktop({
      client,
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled()
    await settled()
    await act(async () =>
      output.resolve({ type: 'output', output: PASSTHROUGH, devices: [], isEngineReady: true }),
    )
    await waitFor(() => expect(screen.getByRole('slider', { name: 'Volume' })).toBeDisabled())
    expect(commandTypes(fake.send).filter((type) => type === PLAYER_COMMANDS.load)).toHaveLength(1)
    expect(commandTypes(fake.send)).not.toContain('stop')
  })

  it('says Video Info is not in the built-in player', async () => {
    const html = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'unavailable', message: 'No engine.' }),
    })
    await videoElement()
    await act(async () => html.menu.emit('stats'))
    expect(screen.getByRole('status')).toHaveTextContent(STATS_UNAVAILABLE)
  })

  it('toggles video info under mpv from the Playback menu, with no notice', async () => {
    const fake = fakePlayer()
    const native = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    // As mpv reports once the file loads, so the preloader is not the only status.
    await act(async () => fake.emit({ type: PLAYER_EVENTS.waiting, waiting: false }))
    await act(async () => native.menu.emit('stats'))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(commandTypes(fake.send)).toContain('stats')
  })

  it('offers Back and Escape while it waits for the engine', async () => {
    const { router } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'waiting' }),
    })
    await screen.findByRole('main', { name: 'Opening video' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await act(() => router.navigate(`/play/${A}`))
    await screen.findByRole('main', { name: 'Opening video' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('puts focus on Home once Back or Escape leaves the wait', async () => {
    const { router } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'waiting' }),
    })
    await screen.findByRole('main', { name: 'Opening video' })
    await userEvent.keyboard('{Escape}')
    const home = await screen.findByRole('heading', { name: 'raven player' })
    await waitFor(() => expect(document.activeElement).toBe(home))
    await act(() => router.navigate(`/play/${A}`))
    await screen.findByRole('main', { name: 'Opening video' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    const again = await screen.findByRole('heading', { name: 'raven player' })
    await waitFor(() => expect(document.activeElement).toBe(again))
  })

  it('stops the native player when it leaves the video', async () => {
    const fake = fakePlayer()
    const { router } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'native', player: fake.player }),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    await act(() => router.navigate('/'))
    expect(fake.send).toHaveBeenLastCalledWith({ type: 'stop' })
  })
})

/** The page's real connection, with the test playing main on the other end of a real channel. */
const handedOver = () => {
  const connections = listenForPlayer({ target: window, origin: APP_ORIGIN })
  const { port1, port2 } = new MessageChannel()
  const commands: PlayerCommand[] = []
  const refusals = new Map<
    PlayerCommand['type'],
    { reason: PlayerRefusalReason; message: string }
  >()
  const held = { load: Promise.resolve() }
  port2.addEventListener('message', async (event) => {
    const data: unknown = event.data
    if (!isPlayerRequest(data)) return
    commands.push(data.command)
    if (data.command.type === PLAYER_COMMANDS.load) await held.load
    const refusal = refusals.get(data.command.type)
    port2.postMessage(
      refusal === undefined ? { id: data.id, ok: true } : { id: data.id, ok: false, ...refusal },
    )
  })
  port2.start()
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: WINDOW_MESSAGE_TYPES.playerPort, connection: { status: 'native' } },
      origin: APP_ORIGIN,
      source: window,
      ports: [port1],
    }),
  )
  return {
    connections,
    commands,
    refusals,
    /** The next answers to `load` wait for `until`. */
    holdLoad: (until: Promise<void>) => {
      held.load = until
    },
    fromMain: (data: unknown) => port2.postMessage(data),
  }
}

/** happy-dom has no MediaError, which the html engine reads a failed video's codes from. */
const FAKE_MEDIA_ERROR = {
  MEDIA_ERR_ABORTED: 1,
  MEDIA_ERR_NETWORK: 2,
  MEDIA_ERR_DECODE: 3,
  MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
} as const

describe('PlayPage when the html engine cannot play', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'MediaError', { value: FAKE_MEDIA_ERROR, configurable: true })
  })

  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'MediaError')
  })

  const opened: ReturnType<typeof handedOver>[] = []
  afterEach(() => {
    opened.splice(0).forEach(({ connections }) => connections.dispose())
  })

  const failVideo = async () => {
    const video = await sourcedVideo({ fileId: A })
    fireEvent.error(video)
    return screen.findByText('Playback stopped unexpectedly.')
  }

  it('says the engine did not start when the page never had it', async () => {
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: connectionsOf({ status: 'unavailable', message: 'No engine.' }),
    })
    await failVideo()
    expect(screen.getByText(ENGINE_NOTES.fallback)).toBeInTheDocument()
    expect(screen.queryByText(ENGINE_NOTES.stopped)).toBeNull()
  })

  it('says the engine stopped when the video lost it mid-play', async () => {
    const main = handedOver()
    opened.push(main)
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: main.connections,
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    main.fromMain({ type: 'time', time: 30 })
    main.fromMain({ type: 'error', reason: 'engine', message: ENGINE_STOPPED })
    await failVideo()
    expect(screen.getByText(ENGINE_NOTES.stopped)).toBeInTheDocument()
    expect(screen.queryByText(ENGINE_NOTES.fallback)).toBeNull()
  })
})

describe('PlayPage when the video engine stops', () => {
  let warnSpy: ReturnType<typeof spyOn<Console, 'warn'>>
  const opened: Array<ReturnType<typeof handedOver>> = []

  beforeEach(() => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    opened.splice(0).forEach(({ connections }) => connections.dispose())
    warnSpy.mockRestore()
  })

  const open = () => {
    const main = handedOver()
    opened.push(main)
    return main
  }

  it('falls back to the html engine where the video was', async () => {
    const main = open()
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: main.connections,
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    expect(document.querySelector('video')).toBeNull()
    main.fromMain({ type: 'time', time: 30 })
    await settled()
    main.fromMain({ type: 'error', reason: 'engine', message: ENGINE_STOPPED })
    const video = await sourcedVideo({ fileId: A })
    expect(video.getAttribute('src')).toBe(`raven-file://${A}`)
    expect(await screen.findByText('Resumed at 0:30')).toBeInTheDocument()
  })

  it('says the video moved and puts focus in the player', async () => {
    const main = open()
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: main.connections,
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    main.fromMain({ type: 'error', reason: 'engine', message: ENGINE_STOPPED })
    // The Shell's live region, which outlives the native chrome that went.
    expect((await screen.findByText(ENGINE_MOVED)).closest('output')).not.toBeNull()
    const video = await sourcedVideo({ fileId: A })
    await waitFor(() => expect(document.activeElement).toBe(video))
  })

  it('ignores a time from the replaced file before its load is answered', async () => {
    const main = open()
    const held = Promise.withResolvers<void>()
    main.holdLoad(held.promise)
    renderDesktop({
      client: fakeClient({
        request: describing(() => ({ type: 'file', file: { ...CLIP_A, resumeAt: 65 } })),
      }),
      route: `/play/${A}`,
      player: main.connections,
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    main.fromMain({ type: 'time', time: 3 })
    await settled()
    main.fromMain({ type: 'error', reason: 'engine', message: ENGINE_STOPPED })
    await act(async () => held.resolve())
    await sourcedVideo({ fileId: A })
    expect(await screen.findByText('Resumed at 1:05')).toBeInTheDocument()
  })

  it('resumes where a seek went when the engine stops before the next time', async () => {
    const main = open()
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: main.connections,
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    main.fromMain({ type: 'duration', duration: 120 })
    main.fromMain({ type: 'time', time: 4 })
    await settled()
    await userEvent.keyboard('5')
    await settled()
    expect(main.commands).toContainEqual({ type: 'seek', time: 60 })
    main.fromMain({ type: 'error', reason: 'engine', message: ENGINE_STOPPED })
    await sourcedVideo({ fileId: A })
    expect(await screen.findByText('Resumed at 1:00')).toBeInTheDocument()
  })

  it('loads, stops and loads again under StrictMode, and plays the last load', async () => {
    const main = open()
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: main.connections,
      isStrict: true,
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    const lifecycle = main.commands
      .map((command) => command.type)
      .filter((type) => type === PLAYER_COMMANDS.load || type === PLAYER_COMMANDS.stop)
    expect(lifecycle).toEqual(['load', 'stop', 'load'])
    main.fromMain({ type: 'duration', duration: 30 })
    main.fromMain({ type: 'time', time: 12 })
    await waitFor(() =>
      expect(screen.getByRole('slider', { name: /seek/i })).toHaveAttribute('aria-valuenow', '12'),
    )
    expect(document.querySelector('video')).toBeNull()
  })

  it('falls back when main answers the load that the engine stopped', async () => {
    const main = open()
    main.refusals.set('load', { reason: 'engine', message: ENGINE_STOPPED })
    renderDesktop({
      client: fakeClient({
        request: describing(() => ({ type: 'file', file: { ...CLIP_A, resumeAt: 65 } })),
      }),
      route: `/play/${A}`,
      player: main.connections,
    })
    const video = await sourcedVideo({ fileId: A })
    expect(video.getAttribute('src')).toBe(`raven-file://${A}`)
    expect(await screen.findByText('Resumed at 1:05')).toBeInTheDocument()
    expect(screen.queryByText(ENGINE_STOPPED)).toBeNull()
  })

  it('plays the next video through the html engine once the engine stopped', async () => {
    const main = open()
    const { router } = renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: main.connections,
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    main.fromMain({ type: 'error', reason: 'engine', message: ENGINE_STOPPED })
    await sourcedVideo({ fileId: A })
    const loads = () => main.commands.filter((command) => command.type === PLAYER_COMMANDS.load)
    expect(loads()).toHaveLength(1)
    await act(() => router.navigate(`/play/${B}`))
    await screen.findByRole('heading', { name: 'Clip 02' })
    await sourcedVideo({ fileId: B })
    expect(loads()).toHaveLength(1)
  })

  it('keeps the native engine on an error that is not the engine stopping', async () => {
    const main = open()
    renderDesktop({
      client: fakeClient({ request: clips }),
      route: `/play/${A}`,
      player: main.connections,
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    main.fromMain({
      type: 'error',
      reason: 'decode',
      message: 'raven player could not keep playing this video.',
    })
    expect(
      await screen.findByText('raven player could not keep playing this video.'),
    ).toBeInTheDocument()
    expect(screen.getByText('raven player could not play this video.')).toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
  })
})
