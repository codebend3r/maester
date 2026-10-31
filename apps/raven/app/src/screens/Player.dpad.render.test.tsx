import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  DEFAULT_THEME,
  DIRECT_PLAYS,
  HLS_PARAMS,
  HLS_PATHS,
  PLAYBACK_MODES,
  THEMES,
  type PlaybackSettings,
  formatDuration,
} from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { CONTROLS_LINGER_SECONDS, usePlayerPrefs } from '@raven/ui/headless'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import type { ReactVideoProps } from 'react-native-video'
import { SelectedTrackType } from 'react-native-video'

import { PLAYER_COPY, SKIP_SECONDS } from '@/layouts/playerKit'
import { APP_ROUTES, PLAY_FROM } from '@/routes'
import { KEY_ACTIONS, LONG_PRESS_NAMES, REMOTE_KEYS } from '@/layouts/remoteKeys'
import type * as PlatformModule from '@/platform/platform'
import { APP_ROUTE_PARAMS } from '@/routes'
import { Player } from '@/screens/Player'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { useReduceMotion } from '@/stores/reduceMotion'
import { AUDIO_SETTLE_SECONDS } from '@/player/droppedAudio'
import { SESSION_COPY } from '@/player/usePlaybackSession'
import { type HeardRequest, pathFor } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import {
  BUSBOYS_DUAL,
  BUSBOYS_MP4,
  BUSBOYS_PICTURES,
  BUSBOYS_UNSUBTITLED,
  CUE_TEXT,
  DUAL_COMMENTARY,
  GOOD_NEWS_MP4,
  HALF_LOOP_MP4,
  PICTURE_LANGUAGE,
  playerApi,
} from '@/test/playerServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'
import { appThemeOf } from '@/theme/appTheme'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'
import type * as RemoteModule from '@/test/tvRemote'
import { holdRemote, pressRemote } from '@/test/tvRemote'
import type * as VideoMockModule from '@/test/videoMock'
import { drawnVideo, moveVideoTo, resetDrawnVideo, startVideo } from '@/test/videoMock'
import { NATIVE_EVENTS } from '@/test/nativeEvents'

const mockBack = jest.fn()
const mockReplace = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id),
}))
/** What the server heard, per test. */
const mockServer: { heard: HeardRequest[]; directPlay: PlaybackSettings['directPlay'] } = {
  heard: [],
  directPlay: DIRECT_PLAYS.auto,
}

// The layouts pick their variant once, as they load, so the TV is set before anything does,
// and the platform is Android TV's, whose chrome is raven's own under the d-pad.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
jest.mock('@/platform/devicePlatform', () => ({
  DEVICE_PLATFORM:
    jest.requireActual<typeof PlatformModule>('@/platform/platform').APP_PLATFORMS.androidTv,
}))
jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () =>
  jest.requireActual<typeof RemoteModule>('@/test/tvRemote').tvEventHandlerMock(),
)
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('react-native-video', () =>
  jest.requireActual<typeof VideoMockModule>('@/test/videoMock').videoModuleMock(),
)
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: mockReplace }),
  useLocalSearchParams: () => mockParams(),
}))
const mockApi = jest.fn((_server: AppServer) =>
  playerApi({
    hear: (request) => {
      mockServer.heard = [...mockServer.heard, request]
    },
    directPlay: mockServer.directPlay,
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

const shown = { client: createScreenClient() }

let servers = 0

/** How long the controls linger in the tests that watch them go, in seconds: short. */
const BRIEF_LINGER_SECONDS = 0.2

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

/** Where the player's source points, or null before it has one. */
const sourceUri = ({ source }: ReactVideoProps): string | null =>
  source !== undefined && typeof source.uri === 'string' ? source.uri : null

type AudioPickedProps = { count: number; picked: number | null }

/** What ExoPlayer says of a file's audio tracks: which of them, by place, it picked. */
const audioPicked = ({ count, picked }: AudioPickedProps) =>
  Array.from({ length: count }, (_, index) => ({ index, selected: index === picked }))

type LoadWithProps = { audioTracks: ReturnType<typeof audioPicked> }

/** Fires what the player says as it opens its source, with the audio tracks it reports then. */
const loadWith = async ({ audioTracks }: LoadWithProps) => {
  const { onLoad } = await loadedVideo()
  if (onLoad === undefined) throw new Error('The player hears no load')
  await act(async () => {
    onLoad({
      currentTime: 0,
      duration: BUSBOYS_MP4.duration ?? 0,
      naturalSize: { width: 1920, height: 1080, orientation: 'landscape' },
      audioTracks,
      textTracks: [],
      videoTracks: [],
    })
  })
}

/** The player's props as last drawn. */
const videoProps = (): ReactVideoProps => {
  const { props } = drawnVideo
  if (props === null) throw new Error('No player drawn')
  return props
}

type PlayingProps = { id: number }

const playing = async ({ id }: PlayingProps): Promise<ReactVideoProps> => {
  await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(id) })
  const props = await loadedVideo()
  await startVideo({ props, duration: BUSBOYS_MP4.duration ?? 0 })
  return props
}

const scrubber = () => screen.getByRole('adjustable', { name: 'Position' })

/** A light theme, whose page colours would vanish over a bright picture. */
const PATINA = THEMES.find((theme) => theme.name === 'Patina')?.id ?? DEFAULT_THEME

/** What a drawn element is painted with. */
const styleOf = (node: ReturnType<typeof screen.getByRole>) => StyleSheet.flatten(node.props.style)

/** The fixture's one audio track, which every save names as the one playing. */
const AUDIO_PLAYED = 0

const progressPath = pathFor({
  path: APP_CLIENT_CALLS.saveProgress.path,
  id: BUSBOYS_UNSUBTITLED.id,
})

const savedSpots = (): unknown[] =>
  mockServer.heard
    .filter(({ method, path }) => method === APP_CALL_METHODS.put && path === progressPath)
    .map(({ body }) => body)

describe('Player on Android TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockServer.heard = []
    mockServer.directPlay = DIRECT_PLAYS.auto
    resetTestScreen()
    useReduceMotion.setState({ isReduced: true })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
    resetDrawnVideo()
    usePlayerPrefs.setState({
      subtitles: { on: false, language: null },
      controlsLingerSeconds: CONTROLS_LINGER_SECONDS.initial,
      autoplay: true,
    })
    const server = { ...NAS, id: `5b2d1f0e-8c3a-4f6b-9d7e-${String(++servers).padStart(12, '0')}` }
    useActiveServer.setState({ servers: [server], activeId: server.id })
  })

  afterEach(async () => {
    await untilIdle(shown.client)
    await cleanup()
    shown.client.clear()
  })

  it("plays the file as it is under raven's own controls, not the system's", async () => {
    const props = await playing({ id: BUSBOYS_UNSUBTITLED.id })
    expect(props.controls).toBe(false)
    expect(sourceUri(props)).toBe(
      `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_UNSUBTITLED.id })}`,
    )
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    expect(scrubber()).toBeTruthy()
  })

  it("gives the scrubber the remote's focus as the controls first appear, once", async () => {
    await playing({ id: BUSBOYS_UNSUBTITLED.id })
    expect(scrubber().props.hasTVPreferredFocus).toBe(true)
    await fireEvent(scrubber(), NATIVE_EVENTS.focus)
    expect(scrubber().props.hasTVPreferredFocus).toBe(false)
  })

  it('seeks ten seconds either way as the d-pad presses left and right on the scrubber', async () => {
    const props = await playing({ id: BUSBOYS_UNSUBTITLED.id })
    await moveVideoTo({ props, seconds: 100 })
    await fireEvent(scrubber(), NATIVE_EVENTS.focus)
    await pressRemote({ key: REMOTE_KEYS.right })
    expect(drawnVideo.seek).toHaveBeenLastCalledWith(110)
    await pressRemote({ key: REMOTE_KEYS.left })
    await pressRemote({ key: REMOTE_KEYS.left })
    expect(drawnVideo.seek).toHaveBeenLastCalledWith(90)
    expect(drawnVideo.seek).toHaveBeenCalledTimes(3)
  })

  it('moves along the buttons, not the video, once the focus has left the scrubber', async () => {
    await playing({ id: BUSBOYS_UNSUBTITLED.id })
    await fireEvent(scrubber(), NATIVE_EVENTS.focus)
    await fireEvent(scrubber(), NATIVE_EVENTS.blur)
    await pressRemote({ key: REMOTE_KEYS.right })
    expect(drawnVideo.seek).not.toHaveBeenCalled()
  })

  it('plays and pauses from the remote and from the Pause button', async () => {
    await playing({ id: BUSBOYS_UNSUBTITLED.id })
    expect(videoProps().paused).toBe(false)
    await pressRemote({ key: REMOTE_KEYS.playPause })
    expect(videoProps().paused).toBe(true)
    await fireEvent.press(screen.getByRole('button', { name: 'Play' }))
    expect(videoProps().paused).toBe(false)
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }))
    expect(videoProps().paused).toBe(true)
  })

  it('hides the controls as the video plays and brings them back on a press', async () => {
    usePlayerPrefs.setState({ controlsLingerSeconds: BRIEF_LINGER_SECONDS })
    const props = await playing({ id: BUSBOYS_UNSUBTITLED.id })
    await moveVideoTo({ props, seconds: 100 })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Show the controls' })).toBeTruthy()
    // Hidden, left and right still skip, and the press brings the controls back.
    await pressRemote({ key: REMOTE_KEYS.left })
    expect(drawnVideo.seek).toHaveBeenLastCalledWith(90)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull())
    await pressRemote({ key: REMOTE_KEYS.down })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
  })

  it('keeps the controls up while the video is paused', async () => {
    usePlayerPrefs.setState({ controlsLingerSeconds: BRIEF_LINGER_SECONDS })
    await playing({ id: BUSBOYS_UNSUBTITLED.id })
    await pressRemote({ key: REMOTE_KEYS.playPause })
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), BRIEF_LINGER_SECONDS * 3000)
    })
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
  })

  it('plays a file with a text track as it is and draws its cues itself', async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: null } })
    const props = await playing({ id: BUSBOYS_MP4.id })
    expect(sourceUri(props)).toBe(
      `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_MP4.id })}`,
    )
    expect(props.selectedTextTrack).toEqual({ type: SelectedTrackType.DISABLED })
    expect(screen.getByRole('button', { name: 'Subtitles: English' })).toBeTruthy()
    await moveVideoTo({ props, seconds: 15 })
    expect(await screen.findByText(CUE_TEXT)).toBeTruthy()
    await moveVideoTo({ props, seconds: 25 })
    expect(screen.queryByText(CUE_TEXT)).toBeNull()
  })

  it("keeps its icon buttons and the lists they open the player's dark glass under Patina", async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: null } })
    useAppPrefs.setState({ theme: PATINA })
    const { palette, overPicture } = appThemeOf(PATINA)
    await playing({ id: BUSBOYS_MP4.id })

    const chip = screen.getByRole('button', { name: 'Subtitles: English' })
    expect(overPicture.quiet).not.toBe(palette.quiet)
    expect(overPicture.text).not.toBe(palette.text)
    ;['Subtitles: English', 'Pause', PLAYER_COPY.leave].forEach((name) => {
      const plate = screen.getByRole('button', { name })
      expect(styleOf(plate)?.backgroundColor ?? null).toBe(overPicture.quiet)
      // An icon, not words: the label is said, never drawn.
      expect(within(plate).queryByText(name)).toBeNull()
    })
    expect(styleOf(screen.getByText(formatDuration(BUSBOYS_MP4.duration)))?.color ?? null).toBe(
      overPicture.text,
    )

    await fireEvent(chip, NATIVE_EVENTS.focus)
    expect(
      styleOf(screen.getByRole('button', { name: 'Subtitles: English' }))?.borderColor ?? null,
    ).toBe(overPicture.text)
    await fireEvent.press(screen.getByRole('button', { name: 'Subtitles: English' }))
    const list = screen.getByLabelText(PLAYER_COPY.subtitles)
    expect(styleOf(list)?.backgroundColor ?? null).toBe(overPicture.raised)
    expect(
      styleOf(within(list).getByRole('header', { name: PLAYER_COPY.subtitles }))?.color ?? null,
    ).toBe(overPicture.text)
  })

  it('steps down to the remux when ExoPlayer plays the file without any of its sound', async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id) })
    await loadWith({ audioTracks: audioPicked({ count: 1, picked: null }) })
    await moveVideoTo({ props: videoProps(), seconds: 1 })
    const master = pathFor({ path: HLS_PATHS.master, id: BUSBOYS_UNSUBTITLED.id })
    await waitFor(() =>
      expect(sourceUri(videoProps())).toBe(
        `${NAS.origin}${master}?${HLS_PARAMS.mode}=${PLAYBACK_MODES.remux}`,
      ),
    )
  })

  it('judges the audio once the asked track has settled, not from the pick reported at load', async () => {
    usePlayerPrefs.setState({ audioLanguage: DUAL_COMMENTARY.language })
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_DUAL.id) })
    expect((await loadedVideo()).selectedAudioTrack).toEqual({
      type: SelectedTrackType.INDEX,
      value: DUAL_COMMENTARY.index,
    })
    // ExoPlayer reports its own first pick as it loads, and the asked one once it has applied it.
    await loadWith({ audioTracks: audioPicked({ count: 2, picked: 0 }) })
    await act(async () => {
      videoProps().onAudioTracks!({
        audioTracks: audioPicked({ count: 2, picked: DUAL_COMMENTARY.index }),
      })
    })
    await moveVideoTo({ props: videoProps(), seconds: 1 })
    await moveVideoTo({ props: videoProps(), seconds: 2 })
    expect(sourceUri(videoProps())).toBe(
      `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_DUAL.id })}`,
    )
  })

  it('waits for the settled track when the first progress comes before it, as ExoPlayer sends them', async () => {
    usePlayerPrefs.setState({ audioLanguage: DUAL_COMMENTARY.language })
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_DUAL.id) })
    await loadWith({ audioTracks: audioPicked({ count: 2, picked: 0 }) })
    // The progress handler starts before the load is reported, so a tick comes first.
    await moveVideoTo({ props: videoProps(), seconds: 1 })
    await act(async () => {
      videoProps().onAudioTracks!({
        audioTracks: audioPicked({ count: 2, picked: DUAL_COMMENTARY.index }),
      })
    })
    await moveVideoTo({ props: videoProps(), seconds: 1.5 })
    expect(sourceUri(videoProps())).toBe(
      `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_DUAL.id })}`,
    )
  })

  it('steps down once the asked track has had its time to settle and never did', async () => {
    usePlayerPrefs.setState({ audioLanguage: DUAL_COMMENTARY.language })
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_DUAL.id) })
    await loadWith({ audioTracks: audioPicked({ count: 2, picked: 0 }) })
    await moveVideoTo({ props: videoProps(), seconds: 1 })
    const file = `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_DUAL.id })}`
    expect(sourceUri(videoProps())).toBe(file)
    await moveVideoTo({ props: videoProps(), seconds: 1 + AUDIO_SETTLE_SECONDS })
    await waitFor(() => expect(sourceUri(videoProps())).not.toBe(file))
  })

  it('keeps playing the original file the server forces, sound or none', async () => {
    mockServer.directPlay = DIRECT_PLAYS.force
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id) })
    await loadWith({ audioTracks: audioPicked({ count: 1, picked: null }) })
    await moveVideoTo({ props: videoProps(), seconds: 1 })
    expect(sourceUri(videoProps())).toBe(
      `${NAS.origin}${pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS_UNSUBTITLED.id })}`,
    )
    expect(screen.queryByText(SESSION_COPY.exhausted)).toBeNull()
  })

  it('lets a seek go that comes before the video has loaded', async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id) })
    await loadedVideo()
    await fireEvent(scrubber(), NATIVE_EVENTS.focus)
    await pressRemote({ key: REMOTE_KEYS.right })
    expect(drawnVideo.seek).not.toHaveBeenCalled()
    expect(scrubber().props.accessibilityValue.now).toBe(BUSBOYS_UNSUBTITLED.position)
  })

  it('gives the scrubber the focus back when a press catches the controls fading out', async () => {
    useReduceMotion.setState({ isReduced: false })
    usePlayerPrefs.setState({ controlsLingerSeconds: BRIEF_LINGER_SECONDS })
    const props = await playing({ id: BUSBOYS_UNSUBTITLED.id })
    await moveVideoTo({ props, seconds: 100 })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show the controls' })).toBeTruthy(),
    )
    const asked = askedFor().length
    await pressRemote({ key: REMOTE_KEYS.down })
    expect(askedFor().slice(asked)).toContain(PLAYER_COPY.seek)
  })

  it('saves the spot and goes back when Back is pressed', async () => {
    const { unmount } = await renderPlayer({
      [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id),
    })
    const props = await loadedVideo()
    await startVideo({ props, duration: BUSBOYS_MP4.duration ?? 0 })
    await moveVideoTo({ props, seconds: 42 })
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalled()
    unmount()
    await waitFor(() => expect(savedSpots().at(-1)).toEqual({ position: 42, audio: AUDIO_PLAYED }))
  })

  /** Where the next episode's play goes, in the current one's place. */
  const nextHref = {
    pathname: APP_ROUTES.play,
    params: { [APP_ROUTE_PARAMS.mediaId]: String(HALF_LOOP_MP4.id) },
  }

  it("offers an episode's next on Next, which plays it in this one's place", async () => {
    await playing({ id: GOOD_NEWS_MP4.id })
    const next = await screen.findByRole('button', {
      name: `${PLAYER_COPY.next} S01E02 Half Loop`,
    })
    await fireEvent.press(next)
    expect(mockReplace).toHaveBeenCalledWith(nextHref)
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('plays the next episode by itself once this one ends, while autoplay is on', async () => {
    const props = await playing({ id: GOOD_NEWS_MP4.id })
    await screen.findByRole('button', { name: `${PLAYER_COPY.next} S01E02 Half Loop` })
    if (props.onEnd === undefined) throw new Error('The player hears no end')
    await act(async () => props.onEnd?.())
    expect(mockReplace).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith(nextHref)
  })

  it('waits on Next at the end with autoplay off', async () => {
    usePlayerPrefs.setState({ autoplay: false })
    const props = await playing({ id: GOOD_NEWS_MP4.id })
    await screen.findByRole('button', { name: `${PLAYER_COPY.next} S01E02 Half Loop` })
    await act(async () => props.onEnd?.())
    expect(mockReplace).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: PLAYER_COPY.play })).toBeTruthy()
  })

  it("offers nothing after a show's last episode, nor after a film", async () => {
    await playing({ id: HALF_LOOP_MP4.id })
    await untilIdle(shown.client)
    expect(screen.queryByRole('button', { name: /^Next episode/u })).toBeNull()
    expect(
      mockServer.heard.some(({ path }) =>
        path.startsWith(
          pathFor({ path: APP_CLIENT_CALLS.nextInSession.path, id: HALF_LOOP_MP4.id }),
        ),
      ),
    ).toBe(true)
    await cleanup()
    mockServer.heard = []
    await playing({ id: BUSBOYS_UNSUBTITLED.id })
    await untilIdle(shown.client)
    expect(screen.queryByRole('button', { name: /^Next episode/u })).toBeNull()
    expect(
      mockServer.heard.some(({ path }) =>
        path.startsWith(
          pathFor({ path: APP_CLIENT_CALLS.nextInSession.path, id: BUSBOYS_UNSUBTITLED.id }),
        ),
      ),
    ).toBe(false)
  })

  it('keeps the controls up while right is held, and lets them linger once it comes up', async () => {
    const props = await playing({ id: BUSBOYS_UNSUBTITLED.id })
    await moveVideoTo({ props, seconds: 100 })
    // A hold seeks from the line, which has the focus as the controls appear.
    await fireEvent(scrubber(), NATIVE_EVENTS.focus)
    await holdRemote({ key: LONG_PRESS_NAMES.longRight, eventKeyAction: KEY_ACTIONS.down })
    // The linger goes short only once the key is down, so nothing can fade before the hold.
    await act(async () => usePlayerPrefs.setState({ controlsLingerSeconds: BRIEF_LINGER_SECONDS }))
    await new Promise<void>((resolve) =>
      setTimeout(() => resolve(), BRIEF_LINGER_SECONDS * 1000 * 3),
    )
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    await holdRemote({ key: LONG_PRESS_NAMES.longRight, eventKeyAction: KEY_ACTIONS.up })
    expect(drawnVideo.seek).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull())
  })

  it('says the time of day and how the video plays in the top right', async () => {
    await playing({ id: BUSBOYS_UNSUBTITLED.id })
    const corner = screen.getByLabelText(new RegExp(`, ${PLAYER_COPY.modes.direct}$`, 'u'))
    expect(corner.props.accessibilityLabel).toMatch(/^\d{1,2}:\d{2}/u)
  })

  /** What the middle of the picture says now, as it is read out. */
  const centre = (label: string) =>
    screen
      .queryAllByLabelText(label)
      .filter((node) => node.props.accessibilityLiveRegion === 'polite')

  it('says in the middle what each press did: a skip that fades, the pause while paused, then play', async () => {
    const props = await playing({ id: BUSBOYS_UNSUBTITLED.id })
    await moveVideoTo({ props, seconds: 100 })
    await fireEvent(scrubber(), NATIVE_EVENTS.focus)
    await pressRemote({ key: REMOTE_KEYS.right })
    expect(centre(PLAYER_COPY.forward(SKIP_SECONDS))).toHaveLength(1)
    await waitFor(() => expect(centre(PLAYER_COPY.forward(SKIP_SECONDS))).toHaveLength(0), {
      timeout: 3000,
    })

    await pressRemote({ key: REMOTE_KEYS.playPause })
    expect(centre(PLAYER_COPY.paused)).toHaveLength(1)
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 1200))
    expect(centre(PLAYER_COPY.paused)).toHaveLength(1)

    await pressRemote({ key: REMOTE_KEYS.playPause })
    expect(centre(PLAYER_COPY.paused)).toHaveLength(0)
    expect(centre(PLAYER_COPY.play)).toHaveLength(1)
    await pressRemote({ key: REMOTE_KEYS.rewind })
    expect(centre(PLAYER_COPY.back(SKIP_SECONDS))).toHaveLength(1)
  })

  it("opens under raven's mark and a spinner, with no words on screen, until the video loads", async () => {
    await renderPlayer({ [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id) })
    const props = await loadedVideo()
    expect(screen.getByRole('progressbar', { name: PLAYER_COPY.opening })).toBeTruthy()
    expect(screen.queryByText('Starting')).toBeNull()
    await startVideo({ props, duration: BUSBOYS_MP4.duration ?? 0 })
    expect(screen.queryByRole('progressbar', { name: PLAYER_COPY.opening })).toBeNull()
  })

  it('starts at the very beginning when asked to, past the spot the server saved', async () => {
    await renderPlayer({
      [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_UNSUBTITLED.id),
      [APP_ROUTE_PARAMS.from]: PLAY_FROM.start,
    })
    const props = await loadedVideo()
    expect(BUSBOYS_UNSUBTITLED.position).toBeGreaterThan(0)
    expect(props.source?.startPosition ?? null).toBe(0)
  })

  it("offers the file's picture subtitles in direct play and hands the pick to ExoPlayer to draw", async () => {
    const props = await playing({ id: BUSBOYS_PICTURES.id })
    expect(props.selectedTextTrack).toEqual({ type: SelectedTrackType.DISABLED })
    await fireEvent.press(screen.getByRole('button', { name: 'Subtitles: Off' }))
    const list = screen.getByLabelText(PLAYER_COPY.subtitles)
    const picture = within(list)
      .getAllByRole('button')
      .find((option) => String(option.props.accessibilityLabel).startsWith(PICTURE_LANGUAGE))
    if (picture === undefined) throw new Error('The picture track is not offered')
    await fireEvent.press(picture)
    expect(videoProps().selectedTextTrack).toEqual({ type: SelectedTrackType.INDEX, value: 1 })
  })
})
