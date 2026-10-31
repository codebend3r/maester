import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type * as Native from '@raven/native'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { fireEvent, screen } from '@testing-library/react-native'

import { NowPlaying } from '@/screens/NowPlaying'
import { useActiveServer } from '@/stores/activeServer'
import { NAS } from '@/test/homeServer'
import { AIRBAG, DUNE_BOOK, LUCKY, PARANOID, musicApi } from '@/test/musicServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

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
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
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
  screen
    .queryAllByRole('button')
    .filter((node) => node.props.hasTVPreferredFocus === true)
    .map((node) => node.props.accessibilityLabel)

describe('Now Playing on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useAudioQueue.getState().clear()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('says so when nothing plays', async () => {
    await renderScreen({ ui: <NowPlaying /> })
    expect(screen.getByText('Nothing is playing.')).toBeTruthy()
    expect(preferred()).toEqual([])
  })

  it('opens with the remote on Play or Pause, and only as it opens', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    await renderScreen({ ui: <NowPlaying /> })
    expect(screen.getAllByText('Airbag').length).toBeGreaterThan(0)
    const [toggle] = preferred()
    expect(['Play', 'Pause']).toContain(toggle)
    expect(askedFor()).toEqual([toggle])

    await fireEvent(screen.getByRole('button', { name: 'Next' }), NATIVE_EVENTS.focus)
    expect(preferred()).toEqual([])
  })

  it('steps through the queue with Next and Previous, and plays from a queued track', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    await renderScreen({ ui: <NowPlaying /> })

    await fireEvent.press(screen.getByRole('button', { name: 'Next' }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(PARANOID.id)
    await fireEvent.press(screen.getByRole('button', { name: 'Previous' }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(AIRBAG.id)

    await fireEvent.press(screen.getByRole('button', { name: LUCKY.title }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(LUCKY.id)
    expect(screen.getByRole('button', { name: LUCKY.title }).props.accessibilityState).toEqual({
      selected: true,
    })
  })

  it('turns shuffle on and steps the repeat mode', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    await renderScreen({ ui: <NowPlaying /> })

    await fireEvent.press(screen.getByRole('button', { name: 'Shuffle off' }))
    expect(screen.getByRole('button', { name: 'Shuffle on' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat off' }))
    expect(screen.getByRole('button', { name: 'Repeat all' })).toBeTruthy()
  })

  it('marks the synced line being sung, with nothing in the lyrics for the remote to stop on', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    useAudioQueue.getState().engine.time({ position: 13, duration: 300 })
    const client = createScreenClient()
    await renderScreen({ ui: <NowPlaying />, client })
    const sung = await screen.findByText('In a jackknifed juggernaut')
    expect(sung.props.accessibilityState).toEqual({ selected: true })
    expect(screen.queryByRole('button', { name: 'In a jackknifed juggernaut' })).toBeNull()
    await untilIdle(client)
  })

  it("gives an audiobook its chapters to play from, the chapter after, and the speed's list", async () => {
    useAudioQueue.getState().playTracks({ tracks: [DUNE_BOOK] })
    useAudioQueue.getState().engine.time({ position: 700, duration: 1800 })
    const client = createScreenClient()
    await renderScreen({ ui: <NowPlaying />, client })
    const playing = await screen.findByRole('button', { name: 'Arrakis, 10:00' })
    expect(playing.props.accessibilityState).toMatchObject({ selected: true })
    expect(screen.getByRole('button', { name: 'Speed: 1\u00D7' })).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Next chapter' }))
    expect(useAudioQueue.getState().position).toBe(1200)
    expect(screen.queryByRole('button', { name: 'Next chapter' })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Opening, 0:00' }))
    expect(useAudioQueue.getState().position).toBe(0)
    await untilIdle(client)
  })
})
