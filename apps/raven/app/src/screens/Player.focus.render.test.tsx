import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  HLS_PARAMS,
  HLS_PATHS,
  ITEM_IMAGE_KINDS,
  PLAYBACK_MODES,
  appClientCallOf,
  mediaLabel,
} from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native'
import { type ReactVideoProps, SelectedTrackType } from 'react-native-video'

import { APP_ROUTE_PARAMS } from '@/routes'
import { Player } from '@/screens/Player'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { type HeardRequest, pathFor } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import { BUSBOYS } from '@/test/itemServer'
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

  it("plays a file with no subtitles as it is, under the system's transport and info panel", async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id) })
    const props = await loadedVideo()
    expect(props.controls).toBe(true)
    expect(props.source!.uri).toBe(
      `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_UNSUBTITLED.id })}`,
    )
    const poster = playerApi({ hear: () => undefined }).itemImageUrl({
      id: BUSBOYS.id,
      kind: ITEM_IMAGE_KINDS.poster,
      version: BUSBOYS.posterVersion,
    })
    expect(props.source!.metadata).toEqual({
      title: mediaLabel(BUSBOYS_UNSUBTITLED),
      description: BUSBOYS.summary,
      imageUri: poster,
    })
    // The system's transport is the only one: raven draws no controls of its own over it.
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('starts a file with a text track at the remux, whose renditions the system panel lists', async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: null } })
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    const master = pathFor({ path: HLS_PATHS.master, id: BUSBOYS_MP4.id })
    expect(props.source!.uri).toBe(
      `${NAS.origin}${master}?${HLS_PARAMS.mode}=${PLAYBACK_MODES.remux}`,
    )
    // The preferred track is the first rendition, picked for the system to draw.
    expect(props.selectedTextTrack).toEqual({ type: SelectedTrackType.INDEX, value: 0 })
    await start(props)
    await moveVideoTo({ props, seconds: 15 })
    expect(screen.queryByText(CUE_TEXT)).toBeNull()
    expect(subtitleReads()).toEqual([])
  })

  it("leaves the subtitles to the system's choice when the viewer has them off", async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_MP4.id) })
    const props = await loadedVideo()
    expect(props.selectedTextTrack).toBeUndefined()
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
})
