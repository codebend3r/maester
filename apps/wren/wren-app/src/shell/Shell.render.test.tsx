import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import type * as Native from '@raven/native'
import { LIBRARY_PAGE_COPY, LIBRARY_SEGMENTS, SETTINGS_COPY } from '@raven/wren'
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library'
import { Dimensions } from 'react-native'

import { wrenVersion } from '@/about/version'
import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@raven/wren-native'
import { WREN_ROUTES, collectionPathOf } from '@raven/wren-native/headless'
import { PHONE_WINDOW } from '@/test/jestSetup'
import { AIRBAG, LISTENER, PARANOID, musicApi } from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  isOnCellular: async () => false,
  apiFor: () => mockApi,
  watchNetwork: () => () => undefined,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

// An 11 inch iPad's window, held sideways.
const TABLET_WINDOW = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const

const MINI_PLAYER = 'Now Playing: Airbag, Radiohead'

const holdAs = (window: typeof PHONE_WINDOW | typeof TABLET_WINDOW) =>
  act(() => Dimensions.set({ window, screen: window }))

const queueAirbag = async () => {
  await act(async () => useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID] }))
  await act(async () => useAudioQueue.getState().engine.state(AUDIO_STATES.playing))
}

describe("Wren's shell", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.getState().clear()
  })

  afterEach(() => holdAs(PHONE_WINDOW))

  it("draws the phone's four tabs, the one showing selected, and moves between them", async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    const home = await screen.findByRole('button', { name: 'Home, tab, 1 of 4' })
    expect(home.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }))

    await fireEvent.press(screen.getByRole('button', { name: 'Settings, tab, 4 of 4' }))
    expect(await screen.findByRole('header', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Albums' })).toBeNull()
  })

  it('floats the mini player on the tabs while a track is queued, with its controls', async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.recent })
    await queueAirbag()

    expect(await screen.findByRole('button', { name: MINI_PLAYER })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }))
    expect(useAudioQueue.getState().queue.at).toBe(1)
  })

  it("opens each Library category on a page of its own, from the tablet's sidebar", async () => {
    await holdAs(TABLET_WINDOW)
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.recent })
    expect(screen.queryByRole('button', { name: 'Home, tab, 1 of 4' })).toBeNull()

    await fireEvent.press(screen.getByRole('link', { name: 'Albums' }))
    expect(await screen.findByRole('header', { name: 'Albums' })).toBeTruthy()
    expect(router.getPathname()).toBe(collectionPathOf(LIBRARY_SEGMENTS.albums))
    expect(screen.getByRole('link', { name: 'Albums' }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    )
  })

  it("shows Wren's version at the foot of the tablet's sidebar", async () => {
    await holdAs(TABLET_WINDOW)
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.recent })
    expect(screen.getByText(SETTINGS_COPY.versionOf(wrenVersion))).toBeTruthy()
  })

  it("plays from the tablet's player bar in place of the mini player", async () => {
    await holdAs(TABLET_WINDOW)
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.recent })
    await queueAirbag()

    expect(await screen.findAllByRole('button', { name: MINI_PLAYER })).toHaveLength(1)
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }))
    expect(useAudioQueue.getState().state).toBe(AUDIO_STATES.paused)
    await fireEvent.press(screen.getByRole('button', { name: 'Lyrics' }))
    expect(await screen.findByRole('header', { name: AIRBAG.title })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Albums' })).toBeNull()
  })
})
