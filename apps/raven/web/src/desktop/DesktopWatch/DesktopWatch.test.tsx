import {
  AUDIO_DEVICES,
  AUDIO_PROFILES,
  ApiError,
  CARRIED_FORMATS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  ENGINE_STOPPED,
  MENU_PLAYER_ACTIONS,
  PLAYER_COMMANDS,
  PLAYER_ERROR_REASONS,
  PLAYER_EVENTS,
  PLAYER_SOURCE_KINDS,
  type PlayerSource,
  TITLE_REFUSALS,
  watchLink,
  watchPageOf,
  watchPathFor,
} from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { useNavigate } from 'react-router-dom'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PLAY_TITLE_WAIT_MS, WATCH_COPY } from '@/desktop/DesktopWatch/DesktopWatch'
import { handled } from '@/desktop/handled'
import { CONNECTION_STATUSES } from '@/desktop/playerConnection'
import { api } from '@/lib/api'
import { where } from '@/test/authPage'
import {
  connectionsOf,
  fakeClient,
  fakePlayer,
  FILE_ID,
  SERVER_ID,
  sentOfType,
  settled,
} from '@/test/desktop'
import { renderPlayers } from '@/test/desktopPlayer'
import { mediaItem } from '@/test/fixtures'

const MEDIA = mediaItem({ position: 600 })
const NEXT = mediaItem({ id: 8, title: 'Busboys 2 (2027)' })
const WATCH = watchPageOf(MEDIA.id)
const LIBRARY = `/libraries/${MEDIA.libraryId}`

const SERVER_SOURCE: PlayerSource = {
  kind: PLAYER_SOURCE_KINDS.server,
  serverId: SERVER_ID,
  mediaId: MEDIA.id,
}
const FILE_SOURCE: PlayerSource = { kind: PLAYER_SOURCE_KINDS.file, fileId: FILE_ID }

const DONE = { type: DESKTOP_REPLIES.done } as const satisfies DesktopReply

type PlayTitle = Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.playTitle }>

/** Main answering `playTitle` with `answer` (the source it hands over, by default from the server). */
const titleMain = ({
  answer = ({ at, next }) => ({
    type: DESKTOP_REPLIES.title,
    source: SERVER_SOURCE,
    resumeAt: at,
    next,
  }),
  isPassthrough = false,
}: {
  answer?: (request: PlayTitle) => DesktopReply
  isPassthrough?: boolean
} = {}) =>
  fakeClient({
    request: async (request) => {
      if (request.type === DESKTOP_REQUESTS.playTitle) return answer(request)
      if (request.type === DESKTOP_REQUESTS.readOutput && isPassthrough) {
        return {
          type: DESKTOP_REPLIES.output,
          output: {
            profile: AUDIO_PROFILES.passthrough,
            device: AUDIO_DEVICES.auto,
            passthrough: [...CARRIED_FORMATS],
            spatial: false,
          },
          devices: [],
          isEngineReady: true,
        }
      }
      return DONE
    },
  })

const refusedWith = (reason: (typeof TITLE_REFUSALS)[keyof typeof TITLE_REFUSALS]) =>
  ({
    type: DESKTOP_REPLIES.titleRefused,
    reason,
    message: 'Your access to raven is waiting for approval.',
  }) as const satisfies DesktopReply

const nativeOf = (fake: ReturnType<typeof fakePlayer>) =>
  connectionsOf({ status: CONNECTION_STATUSES.native, player: fake.player })

const loadsOf = (fake: ReturnType<typeof fakePlayer>) =>
  fake.send.mock.calls
    .map(([command]) => command)
    .filter((command) => command.type === PLAYER_COMMANDS.load)

/** Stands in for main's `navigate` event: a play link opened while the page shows a title. */
const NavigateTo = ({ to }: { to: string }) => {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => handled(Promise.resolve(navigate(to)))}>
      Open the link
    </button>
  )
}

const spies: Array<{ mockRestore: () => void }> = []
const spy = <T extends { mockRestore: () => void }>(made: T): T => {
  spies.push(made)
  return made
}

beforeEach(() => {
  spy(spyOn(api, 'getMedia').mockImplementation(async (id) => (id === NEXT.id ? NEXT : MEDIA)))
  spy(spyOn(api, 'recordPlay').mockImplementation(async () => undefined))
  spy(spyOn(api, 'saveProgress').mockImplementation(async () => undefined))
})

afterEach(() => {
  // Unmounted first, so a player leaving does not reach a spy already restored.
  cleanup()
  spies.splice(0).forEach((made) => made.mockRestore())
})

describe('WatchPage inside raven player', () => {
  it('asks main for the title and plays what it hands over on mpv, from the saved spot', async () => {
    const client = titleMain()
    const fake = fakePlayer()
    renderPlayers({ client, player: nativeOf(fake), route: WATCH })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await settled()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toEqual([
      { type: DESKTOP_REQUESTS.playTitle, mediaId: MEDIA.id, at: 600, next: [] },
    ])
    expect(loadsOf(fake)).toEqual([
      {
        type: PLAYER_COMMANDS.load,
        source: SERVER_SOURCE,
        start: 600,
        audio: null,
        subtitle: null,
      },
    ])
    expect(document.querySelector('video')).toBeNull()
  })

  it('starts where a play link says and reads the next title it names', async () => {
    const client = titleMain()
    const fake = fakePlayer()
    renderPlayers({
      client,
      player: nativeOf(fake),
      route: watchPathFor({ mediaId: MEDIA.id, at: 30, next: [NEXT.id, 9] }),
    })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toEqual([
      { type: DESKTOP_REQUESTS.playTitle, mediaId: MEDIA.id, at: 30, next: [NEXT.id, 9] },
    ])
    expect(await screen.findByRole('link', { name: /Up next/ })).toHaveAttribute(
      'href',
      watchPathFor({ mediaId: NEXT.id, at: 0, next: [9] }),
    )
    expect(loadsOf(fake)[0]).toMatchObject({ start: 30 })
  })

  it('names the titles a card handed over as the ones after it', async () => {
    const client = titleMain()
    const { to, state } = watchLink({ media: MEDIA, upNext: [NEXT] })
    renderPlayers({ client, player: nativeOf(fakePlayer()), route: to, state })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toEqual([
      { type: DESKTOP_REQUESTS.playTitle, mediaId: MEDIA.id, at: 600, next: [NEXT.id] },
    ])
  })

  it("reports a server title's play and spot to the server, as the browser does", async () => {
    const client = titleMain()
    const fake = fakePlayer()
    renderPlayers({ client, player: nativeOf(fake), route: WATCH, behind: [LIBRARY] })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await settled()
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    fake.emit({ type: PLAYER_EVENTS.waiting, waiting: false })
    fake.emit({ type: PLAYER_EVENTS.time, time: 640 })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: true })
    await waitFor(() => expect(api.recordPlay).toHaveBeenCalledWith(MEDIA.id))
    await waitFor(() =>
      expect(api.saveProgress).toHaveBeenCalledWith(
        expect.objectContaining({ id: MEDIA.id, position: 640 }),
      ),
    )
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.savePosition })).toEqual([])
  })

  it("reports a download's spot to main alone, and says when the page left it", async () => {
    const client = titleMain({
      answer: ({ at, next }) => ({
        type: DESKTOP_REPLIES.title,
        source: FILE_SOURCE,
        resumeAt: at,
        next,
      }),
    })
    const fake = fakePlayer()
    renderPlayers({ client, player: nativeOf(fake), route: WATCH, behind: [LIBRARY] })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await settled()
    expect(loadsOf(fake)[0]).toMatchObject({ source: FILE_SOURCE })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    fake.emit({ type: PLAYER_EVENTS.waiting, waiting: false })
    fake.emit({ type: PLAYER_EVENTS.time, time: 640 })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: true })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(LIBRARY))
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.playbackLeft })).toEqual([
        { type: DESKTOP_REQUESTS.playbackLeft, fileId: FILE_ID },
      ]),
    )
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.savePosition })).toContainEqual({
      type: DESKTOP_REQUESTS.savePosition,
      fileId: FILE_ID,
      position: 640,
      duration: MEDIA.duration,
    })
    // Main reads the last position before it hears the page left, which may delete the download.
    const sent = client.request.mock.calls.map(([request]) => request.type)
    expect(sent.lastIndexOf(DESKTOP_REQUESTS.savePosition)).toBeLessThan(
      sent.indexOf(DESKTOP_REQUESTS.playbackLeft),
    )
    expect(api.recordPlay).not.toHaveBeenCalled()
    expect(api.saveProgress).not.toHaveBeenCalled()
  })

  it('says the title cannot play once mpv stopped under an earlier one', async () => {
    const client = titleMain()
    renderPlayers({
      client,
      player: connectionsOf({ status: CONNECTION_STATUSES.lost, message: ENGINE_STOPPED }),
      route: WATCH,
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(WATCH_COPY.engineStopped)
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toEqual([])
  })

  it('offers Back and Escape while it waits for the engine', async () => {
    renderPlayers({
      client: titleMain(),
      player: connectionsOf({ status: CONNECTION_STATUSES.waiting }),
      route: WATCH,
      behind: [LIBRARY],
    })
    await settled()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(where()).toBe(LIBRARY))
  })

  it('offers Back while main gets the title ready', async () => {
    const answer = Promise.withResolvers<DesktopReply>()
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.playTitle ? answer.promise : DONE,
    })
    renderPlayers({ client, player: nativeOf(fakePlayer()), route: WATCH })
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toHaveLength(1),
    )
    expect(screen.getByText('Loading')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(LIBRARY))
    await act(async () => answer.resolve(DONE))
  })

  it('tells main the page left a download it handed over after the page went', async () => {
    const answer = Promise.withResolvers<DesktopReply>()
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.playTitle ? answer.promise : DONE,
    })
    renderPlayers({ client, player: nativeOf(fakePlayer()), route: WATCH, behind: [LIBRARY] })
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toHaveLength(1),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(where()).toBe(LIBRARY))
    await act(async () =>
      answer.resolve({ type: DESKTOP_REPLIES.title, source: FILE_SOURCE, resumeAt: 0, next: [] }),
    )
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.playbackLeft })).toEqual([
        { type: DESKTOP_REQUESTS.playbackLeft, fileId: FILE_ID },
      ]),
    )
  })

  it('stops waiting on main after a while, and lets go of a download it hands over later', async () => {
    jest.useFakeTimers()
    try {
      const answer = Promise.withResolvers<DesktopReply>()
      const client = fakeClient({
        request: async (request) =>
          request.type === DESKTOP_REQUESTS.playTitle ? answer.promise : DONE,
      })
      const fake = fakePlayer()
      renderPlayers({ client, player: nativeOf(fake), route: WATCH })
      await act(async () => {
        await Promise.resolve()
      })
      await waitFor(() =>
        expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toHaveLength(1),
      )
      await act(async () => {
        jest.advanceTimersByTime(PLAY_TITLE_WAIT_MS)
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(WATCH_COPY.tooSlow)
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
      await act(async () =>
        answer.resolve({ type: DESKTOP_REPLIES.title, source: FILE_SOURCE, resumeAt: 0, next: [] }),
      )
      await waitFor(() =>
        expect(sentOfType({ client, type: DESKTOP_REQUESTS.playbackLeft })).toEqual([
          { type: DESKTOP_REQUESTS.playbackLeft, fileId: FILE_ID },
        ]),
      )
      expect(loadsOf(fake)).toEqual([])
    } finally {
      jest.useRealTimers()
    }
  })

  it('starts the title on screen again where a new play link for it says', async () => {
    const fake = fakePlayer()
    const client = titleMain()
    renderPlayers({
      client,
      player: nativeOf(fake),
      route: WATCH,
      beside: <NavigateTo to={watchPathFor({ mediaId: MEDIA.id, at: 300, next: [] })} />,
    })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await settled()
    await userEvent.click(screen.getByRole('button', { name: 'Open the link' }))
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(2))
    expect(loadsOf(fake)[1]).toMatchObject({ start: 300 })
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle }).at(-1)).toMatchObject({
      at: 300,
    })
  })

  it('waits while main has not said which engine it has', async () => {
    const client = titleMain()
    renderPlayers({
      client,
      player: connectionsOf({ status: CONNECTION_STATUSES.waiting }),
      route: WATCH,
    })
    await settled()
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toEqual([])
  })

  it('says a title cannot play without mpv, and never plays it in Chromium', async () => {
    const client = titleMain()
    renderPlayers({ client, route: WATCH })
    expect(await screen.findByRole('alert')).toHaveTextContent(WATCH_COPY.noEngine)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(LIBRARY))
    expect(document.querySelector('video')).toBeNull()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toEqual([])
  })

  it('says the title stopped when mpv goes mid-play', async () => {
    const fake = fakePlayer()
    renderPlayers({ client: titleMain(), player: nativeOf(fake), route: WATCH })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await settled()
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.engine,
      message: ENGINE_STOPPED,
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(WATCH_COPY.engineStopped)
    expect(document.querySelector('video')).toBeNull()
  })

  it("says main's reason when it will not play the title", async () => {
    const fake = fakePlayer()
    renderPlayers({
      client: titleMain({ answer: () => refusedWith(TITLE_REFUSALS.denied) }),
      player: nativeOf(fake),
      route: WATCH,
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your access to raven is waiting for approval.',
    )
    expect(loadsOf(fake)).toEqual([])
  })

  it('says it could not open the title when main answers something else', async () => {
    renderPlayers({
      client: titleMain({ answer: () => DONE }),
      player: nativeOf(fakePlayer()),
      route: WATCH,
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(WATCH_COPY.unreadable)
  })

  it('asks for the PIN for a locked library, then asks main again and plays', async () => {
    const answers = [refusedWith(TITLE_REFUSALS.locked)]
    const client = titleMain({
      answer: (request) =>
        answers.shift() ?? {
          type: DESKTOP_REPLIES.title,
          source: SERVER_SOURCE,
          resumeAt: request.at,
          next: request.next,
        },
    })
    spy(spyOn(api, 'unlock').mockImplementation(async () => ({ available: true, unlocked: true })))
    const fake = fakePlayer()
    renderPlayers({ client, player: nativeOf(fake), route: WATCH })
    await userEvent.type(await screen.findByLabelText('PIN'), '3001{Enter}')
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await settled()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toHaveLength(2)
    expect(loadsOf(fake)).toHaveLength(1)
  })

  it('leaves the locked title as it is when the PIN is not entered', async () => {
    const client = titleMain({ answer: () => refusedWith(TITLE_REFUSALS.locked) })
    renderPlayers({ client, player: nativeOf(fakePlayer()), route: WATCH })
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('PIN')).toBeNull()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await settled()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toHaveLength(1)
  })

  it('asks main again for a library locked mid-play, and carries on from where it stood', async () => {
    const answers: DesktopReply[] = [
      { type: DESKTOP_REPLIES.title, source: SERVER_SOURCE, resumeAt: 600, next: [] },
      refusedWith(TITLE_REFUSALS.locked),
    ]
    const client = titleMain({
      answer: (request) =>
        answers.shift() ?? {
          type: DESKTOP_REPLIES.title,
          source: SERVER_SOURCE,
          resumeAt: request.at,
          next: request.next,
        },
    })
    spy(spyOn(api, 'unlock').mockImplementation(async () => ({ available: true, unlocked: true })))
    const fake = fakePlayer()
    renderPlayers({ client, player: nativeOf(fake), route: WATCH })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await settled()
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    fake.emit({ type: PLAYER_EVENTS.waiting, waiting: false })
    fake.emit({ type: PLAYER_EVENTS.time, time: 700 })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: true })
    fake.emit({ type: PLAYER_EVENTS.paused, paused: false })
    fake.emit({ type: PLAYER_EVENTS.waiting, waiting: false })
    // Played on past the last save, too little for the next periodic one.
    fake.emit({ type: PLAYER_EVENTS.time, time: 706 })
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.locked,
      message: 'raven locked this library again.',
    })
    await userEvent.type(await screen.findByLabelText('PIN'), '3001{Enter}')
    await waitFor(() => expect(loadsOf(fake)).toHaveLength(2))
    expect(loadsOf(fake)[1]).toMatchObject({ source: SERVER_SOURCE, start: 706 })
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toHaveLength(3)
  })

  it('keeps the title it plays when the page reads everything again', async () => {
    const client = titleMain()
    const fake = fakePlayer()
    const { client: queryClient } = renderPlayers({
      client,
      player: nativeOf(fake),
      route: WATCH,
    })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await settled()
    // As a PIN entered or a download confirmed does; the other reads are left to run.
    act(() => {
      queryClient.invalidateQueries().catch(() => undefined)
    })
    await settled()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toHaveLength(1)
    expect(loadsOf(fake)).toHaveLength(1)
  })

  it('offers no Open in raven player, being in it', async () => {
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    const fake = fakePlayer()
    renderPlayers({ client: titleMain(), player: nativeOf(fake), route: WATCH })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await settled()
    fake.emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.decode,
      message: 'raven player could not play this video.',
    })
    expect(await screen.findByRole('button', { name: 'Copy file link' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in raven player' })).toBeNull()
  })

  it('fixes the volume under a passthrough output', async () => {
    const fake = fakePlayer()
    renderPlayers({
      client: titleMain({ isPassthrough: true }),
      player: nativeOf(fake),
      route: WATCH,
    })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await waitFor(() => expect(screen.getByRole('slider', { name: 'Volume' })).toBeDisabled())
  })

  it('plays the next title in place of this one when the Playback menu says next', async () => {
    const { to, state } = watchLink({ media: MEDIA, upNext: [NEXT] })
    const client = titleMain()
    const { menu } = renderPlayers({
      client,
      player: nativeOf(fakePlayer()),
      route: to,
      state,
      behind: [LIBRARY],
    })
    await screen.findByRole('heading', { name: 'Busboys (2026)' })
    await act(async () => menu.emit(MENU_PLAYER_ACTIONS.next))
    await screen.findByRole('heading', { name: 'Busboys 2 (2027)' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(LIBRARY))
  })

  it('says why the title could not be read, before asking main for it', async () => {
    const getMedia = spyOn(api, 'getMedia').mockImplementation(async () => {
      throw new ApiError({ status: 500, message: 'raven is down.' })
    })
    spy(getMedia)
    const client = titleMain()
    renderPlayers({ client, player: nativeOf(fakePlayer()), route: WATCH })
    expect(await screen.findByRole('alert')).toHaveTextContent('raven is down.')
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.playTitle })).toEqual([])
  })
})
