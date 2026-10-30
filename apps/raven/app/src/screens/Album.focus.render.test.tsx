import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { QUEUE_SOURCE_KINDS } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { fireEvent, screen } from '@testing-library/react-native'

import { APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf } from '@/routes'
import { Album } from '@/screens/Album'
import { useActiveServer } from '@/stores/activeServer'
import { NAS } from '@/test/homeServer'
import { OK_COMPUTER, PARANOID, RADIOHEAD, musicApi } from '@/test/musicServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import {
  askedFor,
  leaveTestScreen,
  resetTestScreen,
  returnToTestScreen,
} from '@/test/navigationFocus'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(OK_COMPUTER.id),
}))
const mockApi = jest.fn(musicApi)

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').navigationFocusMocks,
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('@/servers/serverClient', () => ({
  apiFor: () => mockApi(),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

/** The labels of whatever on screen asks for the remote's focus. */
const preferred = (): string[] =>
  [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]
    .filter((node) => node.props.hasTVPreferredFocus === true)
    .map((node) => node.props.accessibilityLabel)

/** A host element on screen, as the queries hand it back. */
type ScreenNode = ReturnType<typeof screen.getByRole>

/** The nearest focus guide holding `node` that hands the remote coming into it on (`autoFocus`), or null. */
const guideAround = (node: ScreenNode | null): ScreenNode | null => {
  if (node === null) return null
  return node.props.autoFocus === true ? node : guideAround(node.parent)
}

/** The client this test's screen reads through. */
const shown = { client: createScreenClient() }

const renderAlbum = async () => {
  shown.client = createScreenClient()
  return renderScreen({ ui: <Album />, client: shown.client })
}

describe('Album on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useAudioQueue.getState().clear()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(async () => {
    await untilIdle(shown.client)
  })

  it('opens with the remote on Play, and only as it opens', async () => {
    await renderAlbum()
    await screen.findByRole('button', { name: 'Play' })
    expect(preferred()).toEqual(['Play'])
    expect(askedFor()).toEqual(['Play'])

    await fireEvent(screen.getByRole('button', { name: '1. Airbag' }), NATIVE_EVENTS.focus)
    expect(preferred()).toEqual([])
  })

  it('lays the tracks out by disc, each in a band the remote moves into', async () => {
    await renderAlbum()
    expect(await screen.findByText('Disc 1')).toBeTruthy()
    expect(screen.getByText('Disc 2')).toBeTruthy()
    expect(screen.getByText('1997 · 3 tracks · 15:00')).toBeTruthy()
    const firstDisc = guideAround(screen.getByRole('button', { name: '1. Airbag' }))
    const secondDisc = guideAround(screen.getByRole('button', { name: '3. Lucky' }))
    expect(firstDisc).not.toBeNull()
    expect(secondDisc).not.toBeNull()
    expect(secondDisc).not.toBe(firstDisc)
    expect(guideAround(screen.getByRole('button', { name: 'Play' }))).not.toBe(firstDisc)
  })

  it('plays the album from the track pressed, and marks it playing', async () => {
    await renderAlbum()
    await fireEvent.press(await screen.findByRole('button', { name: '2. Paranoid Android' }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(PARANOID.id)
    expect(useAudioQueue.getState().queue.source).toEqual({
      kind: QUEUE_SOURCE_KINDS.album,
      id: OK_COMPUTER.id,
    })
    expect(
      screen.getByRole('button', { name: '2. Paranoid Android' }).props.accessibilityState,
    ).toEqual({ selected: true })
  })

  it('shuffles the album', async () => {
    await renderAlbum()
    await fireEvent.press(await screen.findByRole('button', { name: 'Shuffle' }))
    expect(useAudioQueue.getState().queue.isShuffled).toBe(true)
    expect(useAudioQueue.getState().queue.items).toHaveLength(3)
  })

  it("opens the artist's page, and Back lands on the artist again", async () => {
    await renderAlbum()
    const artist = await screen.findByRole('link', { name: `Go to ${RADIOHEAD.name}` })
    await fireEvent.press(artist)
    expect(mockPush).toHaveBeenCalledWith(
      hrefOf({ kind: ROUTE_TARGETS.artist, artistId: RADIOHEAD.id }),
    )

    await leaveTestScreen()
    await returnToTestScreen()
    expect(askedFor().at(-1)).toBe(`Go to ${RADIOHEAD.name}`)
  })
})
