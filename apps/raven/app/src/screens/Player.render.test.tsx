import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  ACCOUNT_ACCESS_MESSAGES,
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  DEFAULT_THEME,
  HLS_PARAMS,
  HLS_PATHS,
  MEDIA_TICKET_PARAM,
  PLAYBACK_MODES,
  THEMES,
  THEME_TONES,
  mediaLabel,
  toQueryString,
} from '@raven/core'
import { SAVE_EVERY_S, usePlayerPrefs, useUnlockPrompt } from '@raven/ui/headless'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet } from 'react-native'
import type { ReactVideoProps } from 'react-native-video'

import { APPLE_ERROR_DOMAINS, URL_ERROR_HTTP_CODES } from '@/player/playerErrors'
import { useUnlockRoute } from '@/queries/useUnlockRoute'
import { APP_ROUTES, APP_ROUTE_PARAMS } from '@/routes'
import { Player } from '@/screens/Player'
import { ACCOUNT_ANSWERS } from '@/servers/authConfigs'
import type { AppServer } from '@/servers/serverList'
import { useAccountAnswers } from '@/stores/accountAnswers'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { type HeardRequest, STATUSES, pathFor } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import { BUSBOYS_MP4, CUE_TEXT, accountTicketOf, playerApi } from '@/test/playerServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'
import { appThemeOf } from '@/theme/appTheme'
import type * as VideoMock from '@/test/videoMock'
import { drawnVideo, moveVideoTo, resetDrawnVideo, startVideo } from '@/test/videoMock'

const mockPush = jest.fn()
const mockPathname = jest.fn((): string => APP_ROUTES.play)
const mockBack = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id),
}))
/** What the server heard, and how it answers the ticket and an account's mints, per test. */
const mockServer: { heard: HeardRequest[]; ticketStatus: number; mints: readonly number[] } = {
  heard: [],
  ticketStatus: STATUSES.ok,
  mints: [STATUSES.ok],
}

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams(),
  usePathname: () => mockPathname(),
}))
const mockApi = jest.fn((_server: AppServer) =>
  playerApi({
    hear: (request) => {
      mockServer.heard = [...mockServer.heard, request]
    },
    ticketStatus: mockServer.ticketStatus,
    mints: mockServer.mints,
  }),
)

jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: AppServer) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  credentialsFor: async () => ({ cookies: {}, token: null }),
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))
jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock'),
)
jest.mock('react-native-video', () =>
  jest.requireActual<typeof VideoMock>('@/test/videoMock').videoModuleMock(),
)

/** The player as the app hosts it, beside what opens the PIN screen on a 423. */
const WithUnlock = () => {
  useUnlockRoute()
  return <Player />
}

const shown = { client: createScreenClient(), serverId: NAS.id }

let servers = 0

const renderPlayer = async (params: Record<string, string>) => {
  mockParams.mockReturnValue(params)
  shown.client = createScreenClient()
  return renderScreen({ ui: <WithUnlock />, client: shown.client })
}

/** The props the player was last drawn with. */
const videoProps = (): ReactVideoProps => {
  const { props } = drawnVideo
  if (props === null) throw new Error('The player was never drawn')
  return props
}

/** The player's props once it has a source to play. */
const loadedVideo = async (): Promise<ReactVideoProps> => {
  await screen.findByRole('button', { name: 'Pause' })
  return videoProps()
}

const progressPath = pathFor({ path: APP_CLIENT_CALLS.saveProgress.path, id: BUSBOYS_MP4.id })
const playsPath = pathFor({ path: APP_CLIENT_CALLS.recordPlay.path, id: BUSBOYS_MP4.id })

/** Each spot the server was told to save, in order. */
/** The audio track every save names: the file's only one. */
const AUDIO_PLAYED = 0

const savedSpots = (): unknown[] =>
  mockServer.heard
    .filter(({ method, path }) => method === APP_CALL_METHODS.put && path === progressPath)
    .map(({ body }) => body)

const playsRecorded = (): number =>
  mockServer.heard.filter(
    ({ method, path }) => method === APP_CALL_METHODS.post && path === playsPath,
  ).length

/** A light theme, whose page colours would vanish over a bright picture. */
const PATINA = THEMES.find((theme) => theme.name === 'Patina')?.id ?? DEFAULT_THEME

/** What a drawn element is painted with. */
const styleOf = (node: ReturnType<typeof screen.getByRole>) => StyleSheet.flatten(node.props.style)

/** Fires what the player says as it opens Busboys and starts. */
const start = async (props: ReactVideoProps) =>
  startVideo({ props, duration: BUSBOYS_MP4.duration ?? 0 })

describe('Player on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockServer.heard = []
    mockServer.ticketStatus = STATUSES.ok
    mockServer.mints = [STATUSES.ok]
    useAccountAnswers.setState({ answers: {} })
    resetDrawnVideo()
    useUnlockPrompt.setState({ open: false })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
    usePlayerPrefs.setState({ subtitles: { on: false, language: null } })
    // A server of its own for each test, so no test plays on a ticket or a probe another held.
    const server = { ...NAS, id: `0f8fad5b-d9cb-469f-a165-${String(++servers).padStart(12, '0')}` }
    useActiveServer.setState({ servers: [server], activeId: server.id })
    shown.serverId = server.id
  })

  // The subtitle windows keep their own half hour in the cache, which would hold jest open: the
  // screen goes first, so no query is let go of after the cache is emptied.
  afterEach(async () => {
    await untilIdle(shown.client)
    await cleanup()
    shown.client.clear()
    jest.restoreAllMocks()
  })

  it('starts Resume at the spot it names, playing the file as it is', async () => {
    await renderPlayer({
      [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id),
      [APP_ROUTE_PARAMS.at]: String(BUSBOYS_MP4.position),
    })
    const props = await loadedVideo()
    expect(props.source!.uri).toBe(
      `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_MP4.id })}`,
    )
    expect(props.source!.startPosition).toBe(BUSBOYS_MP4.position * 1000)
    expect(screen.getByText(mediaLabel(BUSBOYS_MP4))).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  })

  it(`saves the spot every ${SAVE_EVERY_S} seconds of play and on a pause`, async () => {
    await renderPlayer({
      [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id),
      [APP_ROUTE_PARAMS.at]: String(BUSBOYS_MP4.position),
    })
    const props = await loadedVideo()
    await start(props)
    const from = BUSBOYS_MP4.position
    await moveVideoTo({ props, seconds: from + 4 })
    await moveVideoTo({ props, seconds: from + SAVE_EVERY_S })
    await moveVideoTo({ props, seconds: from + SAVE_EVERY_S + 4 })
    await moveVideoTo({ props, seconds: from + SAVE_EVERY_S * 2 })
    await moveVideoTo({ props, seconds: from + SAVE_EVERY_S * 2 + 3 })
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }))
    expect(videoProps().paused).toBe(true)
    await act(async () => {
      videoProps().onPlaybackStateChanged!({ isPlaying: false, isSeeking: false })
    })
    expect(savedSpots()).toEqual([
      { position: from + SAVE_EVERY_S, audio: AUDIO_PLAYED },
      { position: from + SAVE_EVERY_S * 2, audio: AUDIO_PLAYED },
      { position: from + SAVE_EVERY_S * 2 + 3, audio: AUDIO_PLAYED },
    ])
  })

  it('records the play once, as it starts, and none more on the way past the watched percentage', async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    await start(props)
    expect(playsRecorded()).toBe(1)
    const length = BUSBOYS_MP4.duration ?? 0
    const ninety = length * 0.9
    await [ninety - 600, ninety - 300, ninety, ninety + 300].reduce(
      (before, seconds) => before.then(() => moveVideoTo({ props, seconds })),
      Promise.resolve(),
    )
    expect(playsRecorded()).toBe(1)
    expect(savedSpots()).toContainEqual({ position: ninety, audio: AUDIO_PLAYED })
  })

  it('opens the PIN screen when the video sits in a locked library', async () => {
    mockServer.ticketStatus = STATUSES.locked
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    expect(await screen.findByText("This video's library on nas:8080 is locked.")).toBeTruthy()
    expect(mockPush).toHaveBeenCalledWith(APP_ROUTES.unlock)
  })

  it('reloads the remux from the same spot when direct play fails', async () => {
    await renderPlayer({
      [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id),
      [APP_ROUTE_PARAMS.at]: String(BUSBOYS_MP4.position),
    })
    const props = await loadedVideo()
    await start(props)
    await moveVideoTo({ props, seconds: 3125 })
    await act(async () => {
      props.onError!({ error: { code: -11828, localizedDescription: 'Cannot Open' } })
    })
    const master = pathFor({ path: HLS_PATHS.master, id: BUSBOYS_MP4.id })
    await screen.findByRole('button', { name: 'Pause' })
    expect(videoProps().source!.uri).toBe(
      `${NAS.origin}${master}?${HLS_PARAMS.mode}=${PLAYBACK_MODES.remux}`,
    )
    expect(videoProps().source!.startPosition).toBe(3125 * 1000)
  })

  describe('on a server with accounts', () => {
    const master = pathFor({ path: HLS_PATHS.master, id: BUSBOYS_MP4.id })
    const mintPath = pathFor({ path: APP_CLIENT_CALLS.getAccountTicket.path, id: BUSBOYS_MP4.id })
    const mints = (): number => mockServer.heard.filter(({ path }) => path === mintPath).length
    const remuxBy = (ticket: string) =>
      `${NAS.origin}${master}?${toQueryString({
        [HLS_PARAMS.mode]: PLAYBACK_MODES.remux,
        [MEDIA_TICKET_PARAM]: ticket,
      })}`
    /** What AVPlayer said on the iOS simulator once the server had forgotten the stream's session. */
    const SESSION_GONE = {
      error: {
        code: URL_ERROR_HTTP_CODES.notFound,
        domain: APPLE_ERROR_DOMAINS.url,
        localizedDescription: 'The requested URL was not found on this server.',
      },
    }

    beforeEach(() => {
      useAccountAnswers.setState({ answers: { [shown.serverId]: ACCOUNT_ANSWERS.ready } })
    })

    /** Plays Busboys from its spot, then through the remux once direct play fails at `at`. */
    const remuxFrom = async (at: number) => {
      await renderPlayer({
        [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id),
        [APP_ROUTE_PARAMS.at]: String(BUSBOYS_MP4.position),
      })
      const file = await loadedVideo()
      expect(file.source!.uri).toBe(
        `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_MP4.id })}?${toQueryString({ [MEDIA_TICKET_PARAM]: accountTicketOf(1) })}`,
      )
      expect(file.source!.headers).toEqual({})
      await start(file)
      await moveVideoTo({ props: file, seconds: at })
      await act(async () => {
        file.onError!({ error: { code: -11828, localizedDescription: 'Cannot Open' } })
      })
      await screen.findByRole('button', { name: 'Pause' })
      return videoProps()
    }

    it('plays by account ticket, a fresh one for the step down, and no cookie', async () => {
      const stream = await remuxFrom(3125)
      expect(stream.source!.uri).toBe(remuxBy(accountTicketOf(2)))
      expect(stream.source!.headers).toEqual({})
      expect(stream.source!.startPosition).toBe(3125 * 1000)
      expect(mints()).toBe(2)
    })

    it('opens the master again with a fresh ticket from the spot when the server lets go of the stream mid-play', async () => {
      const stream = await remuxFrom(3125)
      await start(stream)
      await moveVideoTo({ props: stream, seconds: 4210 })
      await act(async () => {
        stream.onError!(SESSION_GONE)
      })
      await screen.findByRole('button', { name: 'Pause' })
      expect(videoProps().source!.uri).toBe(remuxBy(accountTicketOf(3)))
      expect(videoProps().source!.startPosition).toBe(4210 * 1000)
      expect(mints()).toBe(3)
      expect(
        screen.queryByText("This video didn't start in any of the ways the server offers."),
      ).toBeNull()
    })

    it('shows the account refusal when the server will not mint for the reopen', async () => {
      mockServer.mints = [STATUSES.ok, STATUSES.ok, STATUSES.forbidden]
      const stream = await remuxFrom(3125)
      await start(stream)
      await moveVideoTo({ props: stream, seconds: 4210 })
      await act(async () => {
        stream.onError!(SESSION_GONE)
      })
      expect(await screen.findByText(ACCOUNT_ACCESS_MESSAGES.removed(NAS.name))).toBeTruthy()
    })
  })

  it('skips ten seconds either way from where the video is', async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    await start(props)
    await moveVideoTo({ props, seconds: 100 })
    await fireEvent.press(screen.getByRole('button', { name: 'Forward 10 seconds' }))
    expect(drawnVideo.seek).toHaveBeenLastCalledWith(110)
    await fireEvent.press(screen.getByRole('button', { name: 'Back 10 seconds' }))
    expect(drawnVideo.seek).toHaveBeenLastCalledWith(100)
  })

  it("draws the picked track's cues from the server's WebVTT while they last", async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: null } })
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    await start(props)
    expect(screen.getByRole('button', { name: 'Subtitles: English' })).toBeTruthy()
    await moveVideoTo({ props, seconds: 15 })
    expect(await screen.findByText(CUE_TEXT)).toBeTruthy()
    await moveVideoTo({ props, seconds: 25 })
    expect(screen.queryByText(CUE_TEXT)).toBeNull()
  })

  it("keeps its chips, Play and Back the player's dark glass under Patina, and the sheet dark", async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: null } })
    useAppPrefs.setState({ theme: PATINA })
    const { palette, overPicture } = appThemeOf(PATINA)
    const sheets: (string | undefined)[] = []
    jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options) => {
      sheets.push(options.userInterfaceStyle)
    })
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    await loadedVideo()

    const chip = screen.getByRole('button', { name: 'Subtitles: English' })
    expect(styleOf(chip)?.backgroundColor ?? null).toBe(overPicture.quiet)
    expect(styleOf(within(chip).getByText('English'))?.color ?? null).toBe(overPicture.text)
    expect(styleOf(within(chip).getByText('Subtitles'))?.color ?? null).toBe(overPicture.muted)
    expect(overPicture.quiet).not.toBe(palette.quiet)
    expect(overPicture.text).not.toBe(palette.text)
    expect(
      styleOf(screen.getByRole('button', { name: 'Picture in Picture' }))?.backgroundColor ?? null,
    ).toBe(overPicture.quiet)
    expect(styleOf(screen.getByRole('button', { name: 'Pause' }))?.backgroundColor ?? null).toBe(
      overPicture.quiet,
    )
    expect(styleOf(screen.getByRole('button', { name: 'Back' }))?.backgroundColor ?? null).toBe(
      overPicture.quiet,
    )
    expect(styleOf(screen.getByText(mediaLabel(BUSBOYS_MP4)))?.color ?? null).toBe(overPicture.text)

    await fireEvent.press(chip)
    expect(sheets).toEqual([THEME_TONES.dark])
  })

  it('saves the spot and goes back when Back is pressed', async () => {
    const { unmount } = await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    await start(props)
    await moveVideoTo({ props, seconds: 42 })
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalled()
    unmount()
    expect(savedSpots().at(-1)).toEqual({ position: 42, audio: AUDIO_PLAYED })
  })
})
