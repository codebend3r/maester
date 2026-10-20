import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { isRecord } from '@raven/core'
import { fireEvent, screen } from '@testing-library/react-native'
import { BackHandler, StyleSheet, TVEventControl } from 'react-native'

import { APP_ROUTES, APP_ROUTE_PARAMS } from '@/routes'
import { Home } from '@/screens/Home'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { useReduceMotion } from '@/stores/reduceMotion'
import { useScreenFocus } from '@/stores/screenFocus'
import { NAS, SPARSE, homeApi } from '@/test/homeServer'
import { heldAnswer } from '@/test/heldAnswer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import type * as NavigationFocus from '@/test/navigationFocus'
import { leaveTestScreen, resetTestScreen, returnToTestScreen } from '@/test/navigationFocus'
import { renderScreen } from '@/test/renderScreen'

/** What Home's read waits on before it is answered, per test. */
const mockHome: { answer: Promise<void> } = { answer: Promise.resolve() }
const mockApi = jest.fn((server: AppServer) => {
  const api = homeApi(server)
  return {
    ...api,
    getHome: async () => {
      await mockHome.answer
      return api.getHome()
    },
  }
})

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
const mockPush = jest.fn()

jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').navigationFocusMocks,
  useRouter: () => ({ push: mockPush }),
}))
// The fork's requestTVFocus is native; what matters is which card asks for the focus, and when.
const mockRequestTVFocus = jest.fn<(instance: unknown) => void>()
jest.mock('@/layouts/tvFocus', () => ({
  requestTVFocus: (instance: unknown) => mockRequestTVFocus(instance),
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

const renderHome = async () => renderScreen({ ui: <Home /> })

/** The cards that asked for the remote's focus, by title, in order. */
const askedFor = (): unknown[] =>
  mockRequestTVFocus.mock.calls.map(([instance]) =>
    isRecord(instance) && isRecord(instance.props) ? instance.props.accessibilityLabel : instance,
  )

/** Whatever on screen asks for the remote's focus, by its label. */
const preferred = (): unknown[] =>
  [...screen.getAllByRole('button'), ...screen.getAllByRole('link')]
    .filter((node) => node.props.hasTVPreferredFocus === true)
    .map((node) => node.props.accessibilityLabel)

describe('Home on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useScreenFocus.setState({ screens: {} })
    mockHome.answer = Promise.resolve()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('shows the same shelves and cards as the touch layout', async () => {
    await renderHome()
    expect(await screen.findByRole('header', { name: 'Continue watching' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Films' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Series' })).toBeTruthy()
    const cards = screen.getAllByRole('button').map((card) => card.props.accessibilityLabel)
    expect(cards).toEqual(['Busboys', 'Busboys', 'Night Train', 'Severance'])
  })

  it('puts focus on the first card as it opens, and on no other', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const [first, ...rest] = screen.getAllByRole('button')
    if (first === undefined) throw new Error('No card')
    expect(first.props.hasTVPreferredFocus).toBe(true)
    expect(rest.some((card) => card.props.hasTVPreferredFocus === true)).toBe(false)
  })

  it('grows the focused card and rings it, at once when the system asks for less motion', async () => {
    useReduceMotion.setState({ isReduced: true })
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const [first] = screen.getAllByRole('button')
    if (first === undefined) throw new Error('No card')
    const scaleOf = () => {
      const [face] = first.children
      if (typeof face !== 'object' || face === null) throw new Error('No card face')
      return StyleSheet.flatten(face.props.style)?.transform ?? null
    }
    expect(scaleOf()).toEqual([{ scale: 1 }])

    await fireEvent(first, NATIVE_EVENTS.focus)
    expect(scaleOf()).toEqual([{ scale: 1.08 }])

    await fireEvent(first, NATIVE_EVENTS.blur)
    expect(scaleOf()).toEqual([{ scale: 1 }])
  })

  it("lets the remote open a library from its shelf's title", async () => {
    await renderHome()
    await fireEvent.press(await screen.findByRole('link', { name: 'See all in Series' }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.library,
      params: { [APP_ROUTE_PARAMS.id]: '2' },
    })
  })

  it('offers the search in the top row once the shelves are drawn, never before them or first', async () => {
    const { answer, release } = heldAnswer()
    mockHome.answer = answer
    await renderHome()
    expect(await screen.findByText('Gathering your libraries')).toBeTruthy()
    // Drawn alone, it would be all tvOS had to give the opening focus to.
    expect(screen.queryByRole('link', { name: 'Search every library' })).toBeNull()

    release()
    await screen.findByRole('header', { name: 'Films' })
    const search = screen.getByRole('link', { name: 'Search every library' })
    expect(search.props.hasTVPreferredFocus).not.toBe(true)
    expect(screen.getAllByRole('button')[0]!.props.hasTVPreferredFocus).toBe(true)

    await fireEvent.press(search)
    expect(mockPush).toHaveBeenCalledWith(APP_ROUTES.search)
  })

  it('puts focus on the first card of the first shelf that has one', async () => {
    useActiveServer.setState({ servers: [SPARSE], activeId: SPARSE.id })
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    expect(screen.getByRole('header', { name: 'Cartoons' })).toBeTruthy()
    const [first, ...rest] = screen.getAllByRole('button')
    if (first === undefined) throw new Error('No card')
    expect(first.props.accessibilityLabel).toBe('Busboys')
    expect(first.props.hasTVPreferredFocus).toBe(true)
    expect(rest.some((card) => card.props.hasTVPreferredFocus === true)).toBe(false)
  })

  it('lets the opening focus go once anything on Home has had it, so nothing drawn later takes it', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    expect(preferred()).toEqual(['Busboys'])

    await fireEvent(screen.getByRole('link', { name: 'Search every library' }), 'focus')
    expect(preferred()).toEqual([])

    // A new answer draws the shelves again; the first card mounts as it did, unpreferred.
    await leaveTestScreen()
    await returnToTestScreen()
    expect(preferred()).toEqual([])
    expect(askedFor()).toEqual([])
  })

  it('takes the focus back to the card a screen was opened from, on the shelf it sits on', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const cards = screen.getAllByRole('button')
    await fireEvent(cards[2]!, 'focus')
    await fireEvent.press(cards[2]!)
    expect(mockPush).toHaveBeenCalledTimes(1)

    await leaveTestScreen()
    expect(askedFor()).toEqual([])
    await returnToTestScreen()
    expect(askedFor()).toEqual(['Night Train'])
    expect(preferred()).toEqual([])
  })

  it('takes it back to the copy on its own shelf when a title sits on two', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    // Busboys is under Continue watching and under Films; the one in Films opens.
    const [, inFilms] = screen.getAllByRole('button')
    await fireEvent.press(inFilms!)
    await leaveTestScreen()
    await returnToTestScreen()
    expect(mockRequestTVFocus).toHaveBeenCalledTimes(1)
    const [[instance]] = mockRequestTVFocus.mock.calls
    // The view the card hands over is drawn as the element on screen with its own handlers.
    const [inContinue, inFilmsNow] = screen.getAllByRole('button')
    const focusOf = (view: unknown) =>
      isRecord(view) && isRecord(view.props) ? view.props.onFocus : null
    expect(focusOf(instance) === inFilmsNow!.props.onFocus).toBe(true)
    expect(focusOf(instance) === inContinue!.props.onFocus).toBe(false)
  })

  it('takes it back once, never on a later return from a screen no card opened', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    await fireEvent.press(screen.getAllByRole('button')[2]!)
    await leaveTestScreen()
    await returnToTestScreen()
    expect(askedFor()).toEqual(['Night Train'])

    // The viewer moves on, then opens the search, which is not a card, and comes back.
    await fireEvent(screen.getAllByRole('button')[3]!, 'focus')
    await fireEvent.press(screen.getByRole('link', { name: 'Search every library' }))
    await leaveTestScreen()
    await returnToTestScreen()
    expect(askedFor()).toEqual(['Night Train'])
  })

  it('leaves Menu to the navigator, which on Home hands it to tvOS', async () => {
    const listen = jest.spyOn(BackHandler, 'addEventListener')
    const menuKey = jest.spyOn(TVEventControl, 'enableTVMenuKey')
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    await fireEvent.press(screen.getAllByRole('button')[2]!)
    await leaveTestScreen()
    await returnToTestScreen()
    expect(listen).not.toHaveBeenCalled()
    expect(menuKey).not.toHaveBeenCalled()
  })
})
