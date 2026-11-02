import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CALL_METHODS, APP_CLIENT_CALLS, appClientCallOf } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { usePlayerPrefs } from '@raven/ui/headless'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native'
import { type ReactVideoProps, SelectedTrackType } from 'react-native-video'

import { APP_ROUTE_PARAMS } from '@/routes'
import { Player } from '@/screens/Player'
import { useActiveServer } from '@/stores/activeServer'
import { type HeardRequest, pathFor } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import { BUSBOYS_MP4, BUSBOYS_UNSUBTITLED, CUE_TEXT, playerApi } from '@/test/playerServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'
import type * as VideoMock from '@/test/videoMock'
import { drawnVideo, moveVideoTo, resetDrawnVideo, startVideo } from '@/test/videoMock'
import { NATIVE_EVENTS } from '@/test/nativeEvents'

const mockBack = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id),
}))
/** What the server heard, per test. */
const mockServer: { heard: HeardRequest[] } = { heard: [] }

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack }),
  useLocalSearchParams: () => mockParams(),
}))
const mockApi = jest.fn((_server: AppServer) =>
  playerApi({
    hear: (request) => {
      mockServer.heard = [...mockServer.heard, request]
    },
  }),
)
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: ({ server }: ApiForProps) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  watchNetwork: () => () => {},
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))
jest.mock('react-native-video', () =>
  jest.requireActual<typeof VideoMock>('@/test/videoMock').videoModuleMock(),
)

const shown = { client: createScreenClient() }

let servers = 0

/** A video id no server holds. */
const MISSING_ID = 404

const renderPlayer = async (params: Record<string, string>) => {
  mockParams.mockReturnValue(params)
  shown.client = createScreenClient()
  return renderScreen({ ui: <Player />, client: shown.client })
}

/** The player's props once it has a source to play. */
const loadedVideo = async (): Promise<ReactVideoProps> =>
  waitFor(() => {
    const { props } = drawnVideo
    if (props === null || props.source === undefined) throw new Error('No source yet')
    return props
  })

const progressPath = pathFor({
  path: APP_CLIENT_CALLS.saveProgress.path,
  id: BUSBOYS_UNSUBTITLED.id,
})

/** The audio track every save names: the file's only one. */
const AUDIO_PLAYED = 0

const savedSpots = (): unknown[] =>
  mockServer.heard
    .filter(({ method, path }) => method === APP_CALL_METHODS.put && path === progressPath)
    .map(({ body }) => body)

/** Every request for a track's WebVTT, which raven reads only to draw the cues itself. */
const subtitleReads = (): HeardRequest[] =>
  mockServer.heard.filter(({ method, path }) => {
    const call = appClientCallOf({ method, url: `${NAS.origin}${path}` })
    return call !== null && APP_CLIENT_CALLS[call] === APP_CLIENT_CALLS.subtitles
  })

/** Fires what the player says as it opens Busboys and starts. */
const start = async (props: ReactVideoProps) =>
  startVideo({ props, duration: BUSBOYS_MP4.duration ?? 0 })

describe('Player on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockServer.heard = []
    resetDrawnVideo()
    usePlayerPrefs.setState({ subtitles: { on: false, language: null } })
    const server = { ...NAS, id: `1c3f7e20-4d5e-41d1-80b4-${String(++servers).padStart(12, '0')}` }
    useActiveServer.setState({ servers: [server], activeId: server.id })
  })

  afterEach(async () => {
    await untilIdle(shown.client)
    await cleanup()
    shown.client.clear()
  })

  it("plays a file with no subtitles as it is, under raven's own controls", async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id) })
    const props = await loadedVideo()
    expect(props.controls).toBeFalsy()
    expect(props.source!.uri).toBe(
      `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_UNSUBTITLED.id })}`,
    )
    expect(props.source!.metadata).toBeUndefined()
    // Raven draws the transport, with the skips either side of play and pause.
    expect(await screen.findByRole('button', { name: 'Back 10 seconds' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Forward 10 seconds' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  })

  it('plays a file with a text track as it is and draws its cues itself', async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: null } })
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    expect(props.source!.uri).toBe(
      `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_MP4.id })}`,
    )
    expect(props.selectedTextTrack).toEqual({ type: SelectedTrackType.DISABLED })
    await start(props)
    await moveVideoTo({ props, seconds: 15 })
    expect(await screen.findByText(CUE_TEXT)).toBeTruthy()
    expect(subtitleReads()).not.toEqual([])
  })

  it('draws no cue while the viewer has the subtitles off', async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    expect(props.selectedTextTrack).toEqual({ type: SelectedTrackType.DISABLED })
    await start(props)
    await moveVideoTo({ props, seconds: 15 })
    expect(screen.queryByText(CUE_TEXT)).toBeNull()
    expect(subtitleReads()).toEqual([])
  })

  it("gives the remote's focus to Back once, when nothing plays", async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(MISSING_ID) })
    expect(await screen.findByText('This video is not on the server.')).toBeTruthy()
    const back = screen.getByRole('button', { name: 'Back' })
    expect(back.props.hasTVPreferredFocus).toBe(true)
    await fireEvent(back, NATIVE_EVENTS.focus)
    expect(screen.getByRole('button', { name: 'Back' }).props.hasTVPreferredFocus).toBe(false)
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalled()
  })

  it('saves the spot on leaving, as Menu leaves', async () => {
    const { unmount } = await renderPlayer({
      [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id),
    })
    const props = await loadedVideo()
    await start(props)
    await moveVideoTo({ props, seconds: 42 })
    unmount()
    await waitFor(() => expect(savedSpots().at(-1)).toEqual({ position: 42, audio: AUDIO_PLAYED }))
  })

  // AVPlayer reports the buffer only after it ran empty, so a fast stream never says it flows.
  it('saves the spot of a stream that starts without ever reporting its buffer', async () => {
    const { unmount } = await renderPlayer({
      [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id),
    })
    const props = await loadedVideo()
    await act(async () => {
      props.onLoad?.({
        currentTime: 0,
        duration: BUSBOYS_MP4.duration ?? 0,
        naturalSize: { width: 1920, height: 1080, orientation: 'landscape' },
        audioTracks: [],
        textTracks: [],
        videoTracks: [],
      })
      props.onPlaybackStateChanged?.({ isPlaying: true, isSeeking: false })
    })
    await moveVideoTo({ props, seconds: 20 })
    unmount()
    await waitFor(() => expect(savedSpots().at(-1)).toEqual({ position: 20, audio: AUDIO_PLAYED }))
  })
})
