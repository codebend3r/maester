import {
  AUDIO_PROFILES,
  AUDIO_DEVICES,
  CARRIED_FORMATS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  ENGINE_STOPPED,
  fileUrlFor,
  type LocalFile,
  MENU_PLAYER_ACTIONS,
  type OutputSettings,
  PLAYER_COMMANDS,
  PLAYER_ERROR_REASONS,
  PLAYER_EVENTS,
  PLAYER_SOURCE_KINDS,
} from '@raven/core'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DESKTOP_PATHS, playPathOf } from '@/desktop/paths'
import { ENGINE_MOVED, ENGINE_NOTES, STATS_UNAVAILABLE } from '@/desktop/player/playerServices'
import { CONNECTION_STATUSES } from '@/desktop/playerConnection'
import { where } from '@/test/authPage'
import {
  connectionsOf,
  DL_1,
  fakeClient,
  fakePlayer,
  type FakeClient,
  FILE_ID,
  sentOfType,
  settled,
} from '@/test/desktop'
import { handedOver, renderPlayers, sourcedVideo } from '@/test/desktopPlayer'
import '@/test/mediaError'

const A = FILE_ID
const B = DL_1

const CLIP_A: LocalFile = {
  fileId: A,
  label: 'Clip 01',
  folder: 'Clips',
  isDownload: false,
  resumeAt: 0,
  next: { fileId: B, label: 'Clip 02', queue: [] },
  tracks: null,
}
const CLIP_B: LocalFile = { ...CLIP_A, fileId: B, label: 'Clip 02', next: null }

const PASSTHROUGH: OutputSettings = {
  profile: AUDIO_PROFILES.passthrough,
  device: AUDIO_DEVICES.auto,
  passthrough: [...CARRIED_FORMATS],
  spatial: false,
}

const DONE = { type: DESKTOP_REPLIES.done } as const satisfies DesktopReply

/** Main describing each file with `describe`, answering `output` for the sound, and done to the rest. */
const playMain = ({
  describeFile = (fileId) => ({ type: DESKTOP_REPLIES.file, file: fileId === A ? CLIP_A : CLIP_B }),
  output = null,
}: {
  describeFile?: (fileId: string) => DesktopReply
  output?: OutputSettings | null
} = {}) =>
  fakeClient({
    request: async (request: DesktopRequest) => {
      if (request.type === DESKTOP_REQUESTS.describeFile) return describeFile(request.fileId)
      if (request.type === DESKTOP_REQUESTS.readOutput && output !== null) {
        return { type: DESKTOP_REPLIES.output, output, devices: [], isEngineReady: true }
      }
      return DONE
    },
  })

const videoOf = (fileId: string) => sourcedVideo(fileUrlFor(fileId))

const sent = (client: FakeClient) => client.request.mock.calls.map(([request]) => request)

const commandTypes = (send: ReturnType<typeof fakePlayer>['send']) =>
  send.mock.calls.map(([command]) => command.type)

const nativeOf = (fake: ReturnType<typeof fakePlayer>) =>
  connectionsOf({ status: CONNECTION_STATUSES.native, player: fake.player })

describe('PlayPage', () => {
  it('plays the granted file through raven-file when there is no video engine', async () => {
    const client = playMain()
    renderPlayers({ client, route: playPathOf(A) })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await videoOf(A)
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.describeFile })).toEqual([
      { type: DESKTOP_REQUESTS.describeFile, fileId: A, queue: [] },
    ])
  })

  it('asks main with the queue the page that opened it left', async () => {
    const client = playMain()
    renderPlayers({ client, route: playPathOf(A), state: { queue: [B] } })
    await videoOf(A)
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.describeFile })).toEqual([
      { type: DESKTOP_REQUESTS.describeFile, fileId: A, queue: [B] },
    ])
  })

  it('asks main with an empty queue when the location state is malformed', async () => {
    const client = playMain()
    renderPlayers({ client, route: playPathOf(A), state: { queue: ['../x'] } })
    await videoOf(A)
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.describeFile })).toEqual([
      { type: DESKTOP_REQUESTS.describeFile, fileId: A, queue: [] },
    ])
  })

  it('says under the title where a download came from', async () => {
    const download: LocalFile = { ...CLIP_A, folder: 'Downloaded from raven', isDownload: true }
    renderPlayers({
      client: playMain({ describeFile: () => ({ type: DESKTOP_REPLIES.file, file: download }) }),
      route: playPathOf(A),
    })
    expect(await screen.findByText('Downloaded from raven · Direct play')).toBeInTheDocument()
  })

  it('links the next video and replaces the entry with it when the menu says next', async () => {
    const { menu } = renderPlayers({
      client: playMain(),
      route: playPathOf(A),
      behind: [DESKTOP_PATHS.local],
    })
    await videoOf(A)
    expect(screen.getByRole('link', { name: 'Up next: Clip 02' })).toHaveAttribute(
      'href',
      playPathOf(B),
    )
    await act(async () => menu.emit(MENU_PLAYER_ACTIONS.next))
    await screen.findByRole('heading', { name: 'Clip 02' })
    // Replaced: Back leaves the player for the page that opened the first video.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.local))
  })

  it('does nothing for the menu next when no video follows', async () => {
    const { menu } = renderPlayers({ client: playMain(), route: playPathOf(B) })
    await screen.findByRole('heading', { name: 'Clip 02' })
    act(() => menu.emit(MENU_PLAYER_ACTIONS.next))
    expect(screen.getByRole('heading', { name: 'Clip 02' })).toBeInTheDocument()
  })

  it('goes back to On this Mac with no page behind it', async () => {
    renderPlayers({ client: playMain(), route: playPathOf(A) })
    await videoOf(A)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.local))
  })

  it('goes back to Downloads from a download with no page behind it', async () => {
    const download: LocalFile = { ...CLIP_A, isDownload: true }
    renderPlayers({
      client: playMain({ describeFile: () => ({ type: DESKTOP_REPLIES.file, file: download }) }),
      route: playPathOf(A),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
  })

  it('sends no position for a video left before it played', async () => {
    const client = playMain()
    renderPlayers({ client, route: playPathOf(A) })
    await videoOf(A)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() =>
      expect(sent(client)).toContainEqual({ type: DESKTOP_REQUESTS.playbackLeft, fileId: A }),
    )
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.savePosition })).toEqual([])
  })

  it('tells main it left the file once the player saved where it was', async () => {
    const played = playMain()
    renderPlayers({ client: played, route: playPathOf(A) })
    fireEvent(await videoOf(A), new Event('playing'))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() =>
      expect(sent(played)).toContainEqual({ type: DESKTOP_REQUESTS.playbackLeft, fileId: A }),
    )
    const saved = sent(played).findLastIndex(
      (request) => request.type === DESKTOP_REQUESTS.savePosition && request.fileId === A,
    )
    const left = sent(played).findIndex((request) => request.type === DESKTOP_REQUESTS.playbackLeft)
    expect(saved).toBeGreaterThan(-1)
    expect(left).toBeGreaterThan(saved)
  })

  it("says it left only once it leaves, not for StrictMode's second run of its effects", async () => {
    const client = playMain()
    renderPlayers({ client, route: playPathOf(A), isStrict: true })
    await videoOf(A)
    await settled(0)
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playbackLeft })).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.playbackLeft })).toHaveLength(1),
    )
  })

  it('starts on the tracks main stored for the file', async () => {
    const fake = fakePlayer()
    renderPlayers({
      client: playMain({
        describeFile: () => ({
          type: DESKTOP_REPLIES.file,
          file: { ...CLIP_A, tracks: { audio: 1, subtitle: 'embedded-0' } },
        }),
      }),
      player: nativeOf(fake),
      route: playPathOf(A),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    expect(fake.send.mock.calls[0]![0]).toMatchObject({ audio: 1, subtitle: 'embedded-0' })
  })

  it('says why a video cannot be opened, with the way back', async () => {
    renderPlayers({
      client: playMain({
        describeFile: () => ({ type: DESKTOP_REPLIES.refused, message: 'That video is gone.' }),
      }),
      route: playPathOf(A),
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('That video is gone.')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.local))
  })

  it('goes back to the page that opened a video it cannot open, as Downloads', async () => {
    renderPlayers({
      client: playMain({
        describeFile: () => ({ type: DESKTOP_REPLIES.refused, message: 'That video is gone.' }),
      }),
      route: playPathOf(A),
      behind: [DESKTOP_PATHS.downloads],
    })
    await screen.findByRole('alert')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
  })

  it('offers Back and Escape while main describes the file', async () => {
    const pending = Promise.withResolvers<DesktopReply>()
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.describeFile ? pending.promise : DONE,
    })
    renderPlayers({ client, route: playPathOf(A), behind: [DESKTOP_PATHS.downloads] })
    expect(await screen.findByText('Loading')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
    await act(async () => pending.resolve(DONE))
  })

  it('offers Back while main has not said which engine it has', async () => {
    renderPlayers({
      client: playMain(),
      player: connectionsOf({ status: CONNECTION_STATUSES.waiting }),
      route: playPathOf(A),
    })
    await settled()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.local))
  })

  it('says it cannot open an answer that is no file', async () => {
    renderPlayers({ client: playMain({ describeFile: () => DONE }), route: playPathOf(A) })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'raven player cannot open that video.',
    )
  })

  it('refuses an id that is not an opaque id without asking main', async () => {
    const client = playMain()
    renderPlayers({ client, route: playPathOf('not-an-id') })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'raven player cannot open that video.',
    )
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.describeFile })).toEqual([])
  })
})

describe('PlayPage engines', () => {
  it('plays through the native engine when main hands over its player', async () => {
    const fake = fakePlayer()
    renderPlayers({ client: playMain(), player: nativeOf(fake), route: playPathOf(A) })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    expect(document.querySelector('video')).toBeNull()
    expect(fake.send).toHaveBeenCalledWith({
      type: PLAYER_COMMANDS.load,
      source: { kind: PLAYER_SOURCE_KINDS.file, fileId: A },
      start: 0,
      audio: null,
      subtitle: null,
    })
  })

  it('waits while main has not said which engine it has, then plays on the one it hands over', async () => {
    const fake = fakePlayer()
    const player = connectionsOf({ status: CONNECTION_STATUSES.waiting })
    renderPlayers({ client: playMain(), player, route: playPathOf(A) })
    await settled()
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Clip 01' })).toBeNull()
    player.set({ status: CONNECTION_STATUSES.native, player: fake.player })
    await screen.findByRole('heading', { name: 'Clip 01' })
    expect(document.querySelector('video')).toBeNull()
  })

  it('fixes the volume under a passthrough output, on mpv only', async () => {
    const fake = fakePlayer()
    renderPlayers({
      client: playMain({ output: PASSTHROUGH }),
      player: nativeOf(fake),
      route: playPathOf(A),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await waitFor(() => expect(screen.getByRole('slider', { name: 'Volume' })).toBeDisabled())
    expect(commandTypes(fake.send)).not.toContain(PLAYER_COMMANDS.volume)
  })

  it('keeps the volume for the html engine, which mixes the sound itself', async () => {
    renderPlayers({ client: playMain({ output: PASSTHROUGH }), route: playPathOf(A) })
    await videoOf(A)
    await settled()
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled()
  })

  it('never changes engine mid-play when the connection changes under it', async () => {
    const fake = fakePlayer()
    const player = nativeOf(fake)
    renderPlayers({ client: playMain(), player, route: playPathOf(A) })
    await screen.findByRole('heading', { name: 'Clip 01' })
    player.set({ status: CONNECTION_STATUSES.unavailable, message: 'No engine.' })
    await settled()
    expect(document.querySelector('video')).toBeNull()
    expect(commandTypes(fake.send).filter((type) => type === PLAYER_COMMANDS.load)).toHaveLength(1)
  })

  it('resumes through the html engine where mpv stopped, and says the video moved', async () => {
    const fake = fakePlayer()
    renderPlayers({ client: playMain(), player: nativeOf(fake), route: playPathOf(A) })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    fake.emit({ type: PLAYER_EVENTS.time, time: 75 })
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.engine,
      message: ENGINE_STOPPED,
    })
    await videoOf(A)
    expect(await screen.findByText('Resumed at 1:15')).toBeInTheDocument()
    expect(await screen.findByText(ENGINE_MOVED)).toBeInTheDocument()
  })

  it('says Video Info is not in the built-in player', async () => {
    const { menu } = renderPlayers({ client: playMain(), route: playPathOf(A) })
    await videoOf(A)
    await act(async () => menu.emit(MENU_PLAYER_ACTIONS.stats))
    expect(await screen.findByText(STATS_UNAVAILABLE)).toBeInTheDocument()
  })

  it('toggles video info under mpv from the Playback menu, with no notice', async () => {
    const fake = fakePlayer()
    const { menu } = renderPlayers({
      client: playMain(),
      player: nativeOf(fake),
      route: playPathOf(A),
    })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await act(async () => menu.emit(MENU_PLAYER_ACTIONS.stats))
    expect(commandTypes(fake.send)).toContain(PLAYER_COMMANDS.stats)
    expect(screen.queryByText(STATS_UNAVAILABLE)).toBeNull()
  })

  it('stops the native player and shows the window buttons when it leaves the video', async () => {
    const fake = fakePlayer()
    const client = playMain()
    renderPlayers({ client, player: nativeOf(fake), route: playPathOf(A) })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.local))
    expect(fake.send).toHaveBeenLastCalledWith({ type: PLAYER_COMMANDS.stop })
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.windowButtons })).toContainEqual({
      type: DESKTOP_REQUESTS.windowButtons,
      isVisible: true,
    })
  })
})

describe('PlayPage after the video engine stopped', () => {
  it('plays the next file in Chromium, saying the engine stopped when that cannot play either', async () => {
    renderPlayers({
      client: playMain(),
      player: connectionsOf({ status: CONNECTION_STATUSES.lost, message: ENGINE_STOPPED }),
      route: playPathOf(A),
    })
    fireEvent.error(await videoOf(A))
    expect(await screen.findByText(ENGINE_NOTES.stopped)).toBeInTheDocument()
  })
})

describe('PlayPage over the real connection', () => {
  let warnSpy: ReturnType<typeof spyOn<Console, 'warn'>>
  const opened: ReturnType<typeof handedOver>[] = []

  beforeEach(() => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    opened.splice(0).forEach(({ connections }) => connections.dispose())
    warnSpy.mockRestore()
  })

  /** The page sends its subtitle size only once main answered the load. */
  const loaded = (main: ReturnType<typeof handedOver>) =>
    waitFor(() =>
      expect(main.commands.map(({ type }) => type)).toContain(PLAYER_COMMANDS.subtitleScale),
    )

  const open = () => {
    const main = handedOver()
    opened.push(main)
    return main
  }

  it('falls back to the html engine where the video was when mpv stops', async () => {
    const main = open()
    renderPlayers({ client: playMain(), player: main.connections, route: playPathOf(A) })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await loaded(main)
    main.fromMain({ type: PLAYER_EVENTS.time, time: 30 })
    await settled()
    main.fromMain({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.engine,
      message: ENGINE_STOPPED,
    })
    await videoOf(A)
    expect(await screen.findByText('Resumed at 0:30')).toBeInTheDocument()
  })

  it('says the engine stopped, not that it never started, when the fallback cannot play either', async () => {
    const main = open()
    renderPlayers({ client: playMain(), player: main.connections, route: playPathOf(A) })
    await screen.findByRole('heading', { name: 'Clip 01' })
    await settled()
    main.fromMain({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.engine,
      message: ENGINE_STOPPED,
    })
    fireEvent.error(await videoOf(A))
    expect(await screen.findByText(ENGINE_NOTES.stopped)).toBeInTheDocument()
    expect(screen.queryByText(ENGINE_NOTES.fallback)).toBeNull()
  })

  it('says the engine did not start when the page never had it', async () => {
    renderPlayers({ client: playMain(), route: playPathOf(A) })
    fireEvent.error(await videoOf(A))
    expect(await screen.findByText(ENGINE_NOTES.fallback)).toBeInTheDocument()
  })
})
