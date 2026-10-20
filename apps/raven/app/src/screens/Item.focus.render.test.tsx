import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CLIENT_CALLS } from '@raven/core'
import { fireEvent, screen, within } from '@testing-library/react-native'

import { APP_ROUTES, APP_ROUTE_PARAMS } from '@/routes'
import { Item } from '@/screens/Item'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { useReduceMotion } from '@/stores/reduceMotion'
import { NAS } from '@/test/homeServer'
import { pathFor } from '@/test/fixtureFetch'
import { BUSBOYS, SEVERANCE, SEVERANCE_ONE, itemApi } from '@/test/itemServer'
import { heldAnswer } from '@/test/heldAnswer'
import type * as NavigationFocus from '@/test/navigationFocus'
import {
  askedFor,
  leaveTestScreen,
  resetTestScreen,
  returnToTestScreen,
} from '@/test/navigationFocus'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'
import { NATIVE_EVENTS } from '@/test/nativeEvents'

const mockPush = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(BUSBOYS.id),
}))
/** The answers the server's writes and reads wait on, and what lets a held one through, per test. */
const mockServer: {
  writes: () => Promise<void>
  reads: (path: string) => Promise<void>
  release: () => void
} = {
  writes: async () => undefined,
  reads: async () => undefined,
  release: () => undefined,
}
const mockApi = jest.fn((_server: AppServer) =>
  itemApi({ writes: () => mockServer.writes(), reads: (path) => mockServer.reads(path) }),
)

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
  apiFor: (server: AppServer) => mockApi(server),
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
  [...screen.queryAllByRole('button'), ...screen.queryAllByRole('checkbox')]
    .filter((node) => node.props.hasTVPreferredFocus === true)
    .map((node) => node.props.accessibilityLabel)

/** A host element on screen, as the queries hand it back. */
type ScreenNode = ReturnType<typeof screen.getByRole>

/**
 * The nearest focus guide holding `node` that hands the remote coming into it to a card of its
 * own (`autoFocus`), or null.
 */
const guideAround = (node: ScreenNode | null): ScreenNode | null => {
  if (node === null) return null
  return node.props.autoFocus === true ? node : guideAround(node.parent)
}

/** The client this test's screen reads through. */
const shown = { client: createScreenClient() }

const renderItem = async (id: number) => {
  mockParams.mockReturnValue({ [APP_ROUTE_PARAMS.id]: String(id) })
  shown.client = createScreenClient()
  return renderScreen({ ui: <Item />, client: shown.client })
}

describe('Item on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    mockServer.writes = async () => undefined
    mockServer.reads = async () => undefined
    mockServer.release = () => undefined
    useReduceMotion.setState({ isReduced: true })
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  // A write a test held is let through once it is done, and what follows it lands in time.
  afterEach(async () => {
    mockServer.release()
    await untilIdle(shown.client)
  })

  it('opens with the focus on Resume, and only on Resume', async () => {
    await renderItem(BUSBOYS.id)
    await screen.findByRole('button', { name: 'Resume from 50:00' })
    expect(preferred()).toEqual(['Resume from 50:00'])
    expect(screen.getByText('50 min left')).toBeTruthy()
  })

  it('asks for the focus once: not again once the viewer has moved it, nor as Play changes', async () => {
    // The mark is held unanswered, so the page shows it as made rather than read again.
    const write = heldAnswer()
    mockServer.writes = () => write.answer
    mockServer.release = write.release
    await renderItem(BUSBOYS.id)
    const watched = await screen.findByRole('checkbox', { name: 'Mark watched' })

    await fireEvent(watched, NATIVE_EVENTS.focus)
    expect(preferred()).toEqual([])

    await fireEvent.press(watched)
    // Marking clears the resume spot, so the button that held the focus now reads Play.
    await screen.findByRole('button', { name: 'Play' })
    expect(preferred()).toEqual([])
  })

  it("puts a show's seasons on a row the remote moves along, Play first", async () => {
    await renderItem(SEVERANCE.id)
    await screen.findByRole('button', { name: 'Play S01E01' })
    expect(preferred()).toEqual(['Play S01E01'])

    const season = screen.getByRole('button', { name: 'Season 1' })
    await fireEvent(season, NATIVE_EVENTS.focus)
    await fireEvent.press(season)
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.item,
      params: { [APP_ROUTE_PARAMS.id]: String(SEVERANCE_ONE.id) },
    })
  })

  it("waits for a show's next episode before drawing anything the remote could take first", async () => {
    const next = heldAnswer()
    const nextPath = pathFor({ path: APP_CLIENT_CALLS.nextEpisode.path, id: SEVERANCE.id })
    mockServer.reads = (path) => (path === nextPath ? next.answer : Promise.resolve())
    await renderItem(SEVERANCE.id)
    await screen.findByRole('header', { name: 'Severance' })

    // Nothing focusable is drawn yet, so tvOS has nothing else to give the focus to.
    const seasonEarly = screen.queryByRole('button', { name: 'Season 1' })
    next.release()
    expect(seasonEarly).toBeNull()

    await screen.findByRole('button', { name: 'Play S01E01' })
    expect(preferred()).toEqual(['Play S01E01'])
    expect(screen.getByRole('button', { name: 'Season 1' })).toBeTruthy()
  })

  it("puts a season's episodes on a row, each opening its page", async () => {
    await renderItem(SEVERANCE_ONE.id)
    expect(await screen.findByRole('button', { name: 'E2 · Half Loop' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'E1 · Good News About Hell' })).toBeTruthy()
    expect(preferred()).toEqual(['Play S01E01'])
  })

  it("brings the remote down from a show's actions to its seasons, and up again", async () => {
    await renderItem(SEVERANCE.id)
    const play = await screen.findByRole('button', { name: 'Play S01E01' })
    // Each is a guide the width of the page: Play sits to the right of the poster, past the
    // seasons' first card, so without them Down skipped the row for whatever lay under Play.
    const seasons = guideAround(screen.getByRole('button', { name: 'Season 1' }))
    const actions = guideAround(play)
    if (seasons === null || actions === null) throw new Error('No focus guide')
    expect(within(seasons).queryByRole('button', { name: 'Play S01E01' })).toBeNull()
    expect(within(actions).queryByRole('button', { name: 'Season 1' })).toBeNull()
    expect(within(actions).getByRole('checkbox', { name: 'Mark watched' })).toBeTruthy()
  })

  it('takes the focus back to the season a page was opened from', async () => {
    await renderItem(SEVERANCE.id)
    const season = await screen.findByRole('button', { name: 'Season 1' })
    await fireEvent(season, 'focus')
    await fireEvent.press(season)
    await leaveTestScreen()
    expect(askedFor()).toEqual([])
    await returnToTestScreen()
    expect(askedFor()).toEqual(['Season 1'])
    expect(preferred()).toEqual([])
  })
})
