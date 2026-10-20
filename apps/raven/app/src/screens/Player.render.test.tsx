import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  HLS_PARAMS,
  HLS_PATHS,
  PLAYBACK_MODES,
  mediaLabel,
} from '@raven/core'
import { SAVE_EVERY_S, usePlayerPrefs, useUnlockPrompt } from '@raven/ui/headless'
import { act, cleanup, fireEvent, screen } from '@testing-library/react-native'
import type * as ReactModule from 'react'
import type * as VideoModule from 'react-native-video'
import type { ReactVideoProps, VideoRef } from 'react-native-video'

import { useUnlockRoute } from '@/queries/useUnlockRoute'
import { APP_ROUTES, APP_ROUTE_PARAMS } from '@/routes'
import { Player } from '@/screens/Player'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { type HeardRequest, STATUSES } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import { BUSBOYS_MP4, CUE_TEXT, playerApi } from '@/test/playerServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockPathname = jest.fn((): string => APP_ROUTES.play)
const mockBack = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id),
}))
/** What the server heard, and how it answers the ticket, per test. */
const mockServer: { heard: HeardRequest[]; ticketStatus: number } = {
  heard: [],
  ticketStatus: STATUSES.ok,
}
/** The props the player was last drawn with, which the test fires the player's events through. */
const mockVideo: { props: ReactVideoProps | null; seek: jest.Mock } = {
  props: null,
  seek: jest.fn(),
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
  }),
)

jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: AppServer) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))
jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock'),
)
jest.mock('react-native-video', () => {
  const { useEffect, useImperativeHandle } = jest.requireActual<typeof ReactModule>('react')
  const Video = ({ ref, ...props }: ReactVideoProps & { ref?: ReactModule.Ref<VideoRef> }) => {
    useEffect(() => {
      mockVideo.props = props
    })
    useImperativeHandle(ref, () => ({
      seek: (time: number) => mockVideo.seek(time),
      resume: () => undefined,
      pause: () => undefined,
      presentFullscreenPlayer: () => undefined,
      dismissFullscreenPlayer: () => undefined,
      restoreUserInterfaceForPictureInPictureStopCompleted: () => undefined,
      save: () => undefined,
      setVolume: () => undefined,
      getCurrentPosition: async () => 0,
      setFullScreen: () => undefined,
      setSource: () => undefined,
      enterPictureInPicture: () => undefined,
      exitPictureInPicture: () => undefined,
    }))
    return null
  }
  // The library's own constants, with its player swapped for one the test drives.
  return {
    ...jest.requireActual<typeof VideoModule>('react-native-video'),
    __esModule: true,
    default: Video,
  }
})

/** The player as the app hosts it, beside what opens the PIN screen on a 423. */
const WithUnlock = () => {
  useUnlockRoute()
  return <Player />
}

const shown = { client: createScreenClient() }

let servers = 0

const renderPlayer = async (params: Record<string, string>) => {
  mockParams.mockReturnValue(params)
  shown.client = createScreenClient()
  return renderScreen({ ui: <WithUnlock />, client: shown.client })
}

/** The props the player was last drawn with. */
const videoProps = (): ReactVideoProps => {
  const { props } = mockVideo
  if (props === null) throw new Error('The player was never drawn')
  return props
}

/** The player's props once it has a source to play. */
const loadedVideo = async (): Promise<ReactVideoProps> => {
  await screen.findByRole('button', { name: 'Pause' })
  return videoProps()
}

const progressPath = APP_CLIENT_CALLS.saveProgress.path.replace(':id', String(BUSBOYS_MP4.id))
const playsPath = APP_CLIENT_CALLS.recordPlay.path.replace(':id', String(BUSBOYS_MP4.id))

/** Each spot the server was told to save, in order. */
const savedSpots = (): unknown[] =>
  mockServer.heard
    .filter(({ method, path }) => method === APP_CALL_METHODS.put && path === progressPath)
    .map(({ body }) => body)

const playsRecorded = (): number =>
  mockServer.heard.filter(
    ({ method, path }) => method === APP_CALL_METHODS.post && path === playsPath,
  ).length

/** Fires what the player says as it opens its source and starts. */
const start = async (props: ReactVideoProps) => {
  await act(async () => {
    props.onLoad!({
      currentTime: 0,
      duration: BUSBOYS_MP4.duration ?? 0,
      naturalSize: { width: 1920, height: 1080, orientation: 'landscape' },
      audioTracks: [],
      textTracks: [],
      videoTracks: [],
    })
    props.onPlaybackStateChanged!({ isPlaying: true, isSeeking: false })
  })
}

const moveTo = async ({ props, seconds }: { props: ReactVideoProps; seconds: number }) =>
  act(async () => {
    props.onProgress!({ currentTime: seconds, playableDuration: seconds, seekableDuration: 6000 })
  })

describe('Player on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockServer.heard = []
    mockServer.ticketStatus = STATUSES.ok
    mockVideo.props = null
    useUnlockPrompt.setState({ open: false })
    usePlayerPrefs.setState({ subtitles: { on: false, language: null } })
    // A server of its own for each test, so no test plays on a ticket or a probe another held.
    const server = { ...NAS, id: `0f8fad5b-d9cb-469f-a165-${String(++servers).padStart(12, '0')}` }
    useActiveServer.setState({ servers: [server], activeId: server.id })
  })

  // The subtitle windows keep their own half hour in the cache, which would hold jest open: the
  // screen goes first, so no query is let go of after the cache is emptied.
  afterEach(async () => {
    await untilIdle(shown.client)
    await cleanup()
    shown.client.clear()
  })

  it('starts Resume at the spot it names, playing the file as it is', async () => {
    await renderPlayer({
      [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id),
      [APP_ROUTE_PARAMS.at]: String(BUSBOYS_MP4.position),
    })
    const props = await loadedVideo()
    expect(props.source!.uri).toBe(`${NAS.origin}/api/media/${BUSBOYS_MP4.id}/file`)
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
    await moveTo({ props, seconds: from + 4 })
    await moveTo({ props, seconds: from + SAVE_EVERY_S })
    await moveTo({ props, seconds: from + SAVE_EVERY_S + 4 })
    await moveTo({ props, seconds: from + SAVE_EVERY_S * 2 })
    await moveTo({ props, seconds: from + SAVE_EVERY_S * 2 + 3 })
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }))
    expect(videoProps().paused).toBe(true)
    await act(async () => {
      videoProps().onPlaybackStateChanged!({ isPlaying: false, isSeeking: false })
    })
    expect(savedSpots()).toEqual([
      { position: from + SAVE_EVERY_S },
      { position: from + SAVE_EVERY_S * 2 },
      { position: from + SAVE_EVERY_S * 2 + 3 },
    ])
  })

  it("records the play once on its way past the library's watched percentage", async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    await start(props)
    const length = BUSBOYS_MP4.duration ?? 0
    const ninety = length * 0.9
    await [ninety - 600, ninety - 300, ninety, ninety + 300].reduce(
      (before, seconds) => before.then(() => moveTo({ props, seconds })),
      Promise.resolve(),
    )
    expect(playsRecorded()).toBe(1)
    expect(savedSpots()).toContainEqual({ position: ninety })
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
    await moveTo({ props, seconds: 3125 })
    await act(async () => {
      props.onError!({ error: { code: -11828, localizedDescription: 'Cannot Open' } })
    })
    const master = HLS_PATHS.master.replace(`:${HLS_PARAMS.id}`, String(BUSBOYS_MP4.id))
    await screen.findByRole('button', { name: 'Pause' })
    expect(videoProps().source!.uri).toBe(
      `${NAS.origin}${master}?${HLS_PARAMS.mode}=${PLAYBACK_MODES.remux}`,
    )
    expect(videoProps().source!.startPosition).toBe(3125 * 1000)
  })

  it('skips ten seconds either way from where the video is', async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    await start(props)
    await moveTo({ props, seconds: 100 })
    await fireEvent.press(screen.getByRole('button', { name: 'Forward 10 seconds' }))
    expect(mockVideo.seek).toHaveBeenLastCalledWith(110)
    await fireEvent.press(screen.getByRole('button', { name: 'Back 10 seconds' }))
    expect(mockVideo.seek).toHaveBeenLastCalledWith(100)
  })

  it("draws the picked track's cues from the server's WebVTT while they last", async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: null } })
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    await start(props)
    expect(screen.getByRole('button', { name: 'Subtitles: English' })).toBeTruthy()
    await moveTo({ props, seconds: 15 })
    expect(await screen.findByText(CUE_TEXT)).toBeTruthy()
    await moveTo({ props, seconds: 25 })
    expect(screen.queryByText(CUE_TEXT)).toBeNull()
  })

  it('saves the spot and goes back when Back is pressed', async () => {
    const { unmount } = await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    await start(props)
    await moveTo({ props, seconds: 42 })
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalled()
    unmount()
    expect(savedSpots().at(-1)).toEqual({ position: 42 })
  })
})
