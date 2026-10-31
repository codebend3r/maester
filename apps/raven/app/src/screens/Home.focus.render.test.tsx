import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { type Home as HomeAnswer, isRecord } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { APP_ROUTES, APP_ROUTE_PARAMS } from '@/routes'
import { Home } from '@/screens/Home'
import { useActiveServer } from '@/stores/activeServer'
import { useReduceMotion } from '@/stores/reduceMotion'
import { FILMS, HOME, NAS, SPARSE, homeApi } from '@/test/homeServer'
import { heldAnswer } from '@/test/heldAnswer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import type * as NavigationFocus from '@/test/navigationFocus'
import {
  askedFor,
  focusRequested,
  leaveTestScreen,
  resetTestScreen,
  returnToTestScreen,
} from '@/test/navigationFocus'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

/** What Home's read waits on before it is answered, and what it answers when not the server's. */
const mockHome: { answer: Promise<void>; home: HomeAnswer | null } = {
  answer: Promise.resolve(),
  home: null,
}
const mockApi = jest.fn((server: AppServer) => {
  const api = homeApi(server)
  return {
    ...api,
    getHome: async () => {
      await mockHome.answer
      return mockHome.home ?? api.getHome()
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
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: ({ server }: ApiForProps) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const shown = { client: createScreenClient() }

const renderHome = async () => {
  shown.client = createScreenClient()
  return renderScreen({ ui: <Home />, client: shown.client })
}

const BUSBOYS = 'Busboys'
const NIGHT_TRAIN = 'Night Train'

/** Home with nothing being watched and no Films shelf: every card the shelves held goes. */
const WITHOUT_FILMS: HomeAnswer = {
  inProgress: [],
  shelves: HOME.shelves.filter((shelf) => shelf.libraryId !== FILMS.id),
}

type AnswerHomeProps = {
  home: HomeAnswer
  card: string
  isDrawn: boolean
}

/**
 * The server answers Home anew and the shelves are read again, as an event or a refetch does,
 * until the card titled `card` is drawn (`isDrawn`) or gone.
 */
const answerHome = async ({ home, card, isDrawn }: AnswerHomeProps) => {
  mockHome.home = home
  await act(async () => shown.client.invalidateQueries())
  await untilIdle(shown.client)
  await waitFor(() =>
    expect(screen.queryAllByRole('button', { name: card }).length > 0).toBe(isDrawn),
  )
}

/** Whatever on screen asks for the remote's focus, by its label. */
const preferred = (): unknown[] =>
  [...screen.getAllByRole('button'), ...screen.getAllByRole('link')]
    .filter((node) => node.props.hasTVPreferredFocus === true)
    .map((node) => node.props.accessibilityLabel)

describe('Home on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    mockHome.answer = Promise.resolve()
    mockHome.home = null
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
    expect(await screen.findByLabelText('Gathering your libraries')).toBeTruthy()
    // Drawn alone, it would be all tvOS had to give the opening focus to.
    expect(screen.queryByRole('link', { name: 'Search' })).toBeNull()

    release()
    await screen.findByRole('header', { name: 'Films' })
    const search = screen.getByRole('link', { name: 'Search' })
    expect(search.props.hasTVPreferredFocus).not.toBe(true)
    expect(screen.getAllByRole('button')[0]!.props.hasTVPreferredFocus).toBe(true)

    await fireEvent.press(search)
    expect(mockPush).toHaveBeenCalledWith(APP_ROUTES.search)
  })

  it('offers Settings beside the search with the shelves, and takes the focus back to it on return', async () => {
    const { answer, release } = heldAnswer()
    mockHome.answer = answer
    await renderHome()
    expect(await screen.findByLabelText('Gathering your libraries')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()

    release()
    await screen.findByRole('header', { name: 'Films' })
    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(preferred()).toEqual(['Busboys'])

    await fireEvent(settings, NATIVE_EVENTS.focus)
    await fireEvent.press(settings)
    expect(mockPush).toHaveBeenCalledWith(APP_ROUTES.settings)
    await leaveTestScreen()
    expect(askedFor()).toEqual([])
    await returnToTestScreen()
    expect(askedFor()).toEqual(['Settings'])
    expect(preferred()).toEqual([])
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

    await fireEvent(screen.getByRole('link', { name: 'Search' }), NATIVE_EVENTS.focus)
    expect(preferred()).toEqual([])

    // The shelves are drawn again: every card goes, then mounts afresh, the first unpreferred.
    await answerHome({ home: WITHOUT_FILMS, card: BUSBOYS, isDrawn: false })
    await answerHome({ home: HOME, card: BUSBOYS, isDrawn: true })
    expect(preferred()).toEqual([])
    expect(askedFor()).toEqual([])
  })

  it('takes the focus back to the card a screen was opened from, on the shelf it sits on', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const cards = screen.getAllByRole('button')
    await fireEvent(cards[2]!, NATIVE_EVENTS.focus)
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
    const [instance, ...more] = focusRequested()
    expect(more).toEqual([])
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
    await fireEvent(screen.getAllByRole('button')[3]!, NATIVE_EVENTS.focus)
    await fireEvent.press(screen.getByRole('link', { name: 'Search' }))
    await leaveTestScreen()
    await returnToTestScreen()
    expect(askedFor()).toEqual(['Night Train'])
  })

  it('takes the focus back to a card drawn afresh while another screen covered Home', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    await fireEvent.press(screen.getByRole('button', { name: NIGHT_TRAIN }))
    await leaveTestScreen()

    // Covered, the shelves are read again: the card goes, then comes back as a new view.
    await answerHome({ home: WITHOUT_FILMS, card: NIGHT_TRAIN, isDrawn: false })
    await answerHome({ home: HOME, card: NIGHT_TRAIN, isDrawn: true })

    await returnToTestScreen()
    expect(askedFor()).toEqual([NIGHT_TRAIN])
  })

  it('lets go of an opener no card took, once another screen covers Home again', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    await fireEvent.press(screen.getByRole('button', { name: NIGHT_TRAIN }))
    await leaveTestScreen()
    await answerHome({ home: WITHOUT_FILMS, card: NIGHT_TRAIN, isDrawn: false })
    await returnToTestScreen()
    expect(askedFor()).toEqual([])

    // The card is drawn again, then the search, which is not a card, opens and goes back.
    await answerHome({ home: HOME, card: NIGHT_TRAIN, isDrawn: true })
    await fireEvent.press(screen.getByRole('link', { name: 'Search' }))
    await leaveTestScreen()
    await returnToTestScreen()
    expect(askedFor()).toEqual([])
  })

  // Android TV restores no focus as a screen comes back, so with the card gone nothing on Home
  // would have it.
  it('gives Home its opening focus again when the card a screen was opened from has gone', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    // Busboys under Continue watching opens; while its page covers Home, the spot is cleared.
    await fireEvent(screen.getAllByRole('button')[2]!, NATIVE_EVENTS.focus)
    await fireEvent.press(screen.getAllByRole('button')[0]!)
    await leaveTestScreen()
    mockHome.home = { ...HOME, inProgress: [] }
    await act(async () => shown.client.invalidateQueries())
    await untilIdle(shown.client)
    await waitFor(() =>
      expect(screen.queryByRole('header', { name: 'Continue watching' })).toBeNull(),
    )
    expect(preferred()).toEqual([])

    await returnToTestScreen()
    expect(askedFor()).toEqual([])
    expect(preferred()).toEqual([BUSBOYS])
  })
})
