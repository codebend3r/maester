import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CLIENT_CALLS } from '@raven/core'
import { fireEvent, screen } from '@testing-library/react-native'

import { APP_ROUTES } from '@/routes'
import { Item } from '@/screens/Item'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { useReduceMotion } from '@/stores/reduceMotion'
import { BUSBOYS, NAS, SEVERANCE, SEVERANCE_ONE, itemApi, pathFor } from '@/test/itemServer'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({ id: String(BUSBOYS.id) }))
/** The answers the server's writes and reads wait on, per test. */
const mockServer: { writes: () => Promise<void>; reads: (path: string) => Promise<void> } = {
  writes: async () => undefined,
  reads: async () => undefined,
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
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
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

const renderItem = async (id: number) => {
  mockParams.mockReturnValue({ id: String(id) })
  return renderScreen({ ui: <Item /> })
}

describe('Item on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockServer.writes = async () => undefined
    mockServer.reads = async () => undefined
    useReduceMotion.setState({ isReduced: true })
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('opens with the focus on Resume, and only on Resume', async () => {
    await renderItem(BUSBOYS.id)
    await screen.findByRole('button', { name: 'Resume from 50:00' })
    expect(preferred()).toEqual(['Resume from 50:00'])
    expect(screen.getByText('50 min left')).toBeTruthy()
  })

  it('asks for the focus once: not again once the viewer has moved it, nor as Play changes', async () => {
    // The mark is held unanswered, so the page shows it as made rather than read again.
    mockServer.writes = () => new Promise<void>(() => undefined)
    await renderItem(BUSBOYS.id)
    const watched = await screen.findByRole('checkbox', { name: 'Mark watched' })

    await fireEvent(watched, 'focus')
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
    await fireEvent(season, 'focus')
    await fireEvent.press(season)
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.item,
      params: { id: String(SEVERANCE_ONE.id) },
    })
  })

  it("waits for a show's next episode before drawing anything the remote could take first", async () => {
    let release = () => {}
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const nextPath = pathFor({ path: APP_CLIENT_CALLS.nextEpisode.path, id: SEVERANCE.id })
    mockServer.reads = (path) => (path === nextPath ? next : Promise.resolve())
    await renderItem(SEVERANCE.id)
    await screen.findByRole('header', { name: 'Severance' })

    // Nothing focusable is drawn yet, so tvOS has nothing else to give the focus to.
    const seasonEarly = screen.queryByRole('button', { name: 'Season 1' })
    release()
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
})
