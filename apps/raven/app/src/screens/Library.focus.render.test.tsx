import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CLIENT_CALLS,
  type Library as LibraryRecord,
  MEDIA_SORTS,
  type PosterEntry,
  JUMP_SCALE_LABELS,
  LIBRARY_VIEWS,
  SORT_FIELD_LABELS,
  sortFieldsFor,
} from '@raven/core'
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet } from 'react-native'

import { APP_ROUTE_PARAMS } from '@/routes'
import { Library } from '@/screens/Library'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { useLibraryViews } from '@/stores/libraryViews'
import { useReduceMotion } from '@/stores/reduceMotion'
import { FILMS, NAS, SERIES } from '@/test/homeServer'
import {
  FILM_SEARCHES,
  GROUPED_FILMS,
  NIGHT_TRAIN_IN_PROGRESS,
  libraryApi,
  libraryPath,
} from '@/test/libraryServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import {
  askedFor,
  leaveTestScreen,
  resetTestScreen,
  returnToTestScreen,
} from '@/test/navigationFocus'
import { renderScreen } from '@/test/renderScreen'
import { NATIVE_EVENTS } from '@/test/nativeEvents'

const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(FILMS.id),
}))
/** What the server heard, and the libraries it answers with in place of its own, per test. */
const mockServer: { requests: string[]; libraries: LibraryRecord[]; inProgress: PosterEntry[] } = {
  requests: [],
  libraries: [],
  inProgress: [],
}
const mockApi = jest.fn((_server: AppServer) =>
  libraryApi({
    record: (path) => {
      mockServer.requests = [...mockServer.requests, path]
    },
    libraries: () => mockServer.libraries,
    inProgress: () => mockServer.inProgress,
  }),
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
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
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

const SHOW_TITLES = ['Ashfall', 'The Beacon', 'Saltmarsh'] as const
const FILM_TITLES = ['Ashfall Gate', 'Busboys', 'Night Train'] as const

/** The cards among `titles` that ask for the remote's focus. */
const preferred = (titles: readonly string[]): string[] =>
  screen
    .getAllByRole('button')
    .filter(
      (card) =>
        titles.includes(card.props.accessibilityLabel) && card.props.hasTVPreferredFocus === true,
    )
    .map((card) => card.props.accessibilityLabel)

/** The TV's list waits for the height left under the header, which jest never lays out. */
const layOut = async () => {
  await screen.findByRole('header', {
    name: mockParams()[APP_ROUTE_PARAMS.id] === String(FILMS.id) ? 'Films' : 'Series',
  })
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 1920, height: 800 } } }
  // One at a time: each event is an act() of its own, and they may not overlap.
  await screen.container
    .queryAll((node) => typeof node.props.onLayout === 'function')
    .reduce<Promise<void>>(async (before, node) => {
      await before
      await fireEvent(node, NATIVE_EVENTS.layout, layout)
    }, Promise.resolve())
}

type RenderLibraryProps = { id: number }

const renderLibrary = async ({ id }: RenderLibraryProps) => {
  mockParams.mockReturnValue({ [APP_ROUTE_PARAMS.id]: String(id) })
  const rendered = await renderScreen({ ui: <Library /> })
  await layOut()
  return rendered
}

describe('Library on a TV', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    mockServer.requests = []
    mockServer.libraries = []
    mockServer.inProgress = []
    resetTestScreen()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
    useLibraryViews.setState({ choices: {} })
  })

  it('puts focus on the first card as it opens, and on no other', async () => {
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    expect(preferred(FILM_TITLES)).toEqual(['Ashfall Gate'])
  })

  it('has a search box the remote reaches, which never takes the opening focus', async () => {
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    const field = screen.getByLabelText('Search Films')
    expect(field.props.hasTVPreferredFocus).not.toBe(true)
    expect(preferred(FILM_TITLES)).toEqual(['Ashfall Gate'])

    await fireEvent(screen.getByRole('button', { name: 'Ashfall Gate' }), NATIVE_EVENTS.focus)
    await fireEvent.changeText(field, FILM_SEARCHES.busboys)
    await fireEvent(field, NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: FILM_SEARCHES.busboys },
    })
    expect(mockServer.requests).toContain(
      libraryPath({
        call: APP_CLIENT_CALLS.listMedia,
        library: FILMS,
        sort: MEDIA_SORTS.title,
        search: FILM_SEARCHES.busboys,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Night Train' })).toBeNull())
    expect(preferred(FILM_TITLES)).toEqual([])
  })

  it('grows the focused card and rings it, as Home does', async () => {
    useReduceMotion.setState({ isReduced: true })
    await renderLibrary({ id: FILMS.id })
    const card = await screen.findByRole('button', { name: 'Busboys' })
    const scaleOf = () => {
      const [face] = card.children
      if (typeof face !== 'object' || face === null) throw new Error('No card face')
      return StyleSheet.flatten(face.props.style)?.transform ?? null
    }
    expect(scaleOf()).toEqual([{ scale: 1 }])
    await fireEvent(card, NATIVE_EVENTS.focus)
    expect(scaleOf()).toEqual([{ scale: 1.08 }])
  })

  it("moves focus to the first show under a letter from the jump row, as the web's strip jumps", async () => {
    await renderLibrary({ id: SERIES.id })
    await screen.findByRole('button', { name: 'Saltmarsh' })
    expect(preferred(SHOW_TITLES)).toEqual(['Ashfall'])

    const row = within(screen.getByLabelText('Jump to a letter'))
    expect(row.getByRole('button', { name: 'C' }).props.accessibilityState!.disabled).toBe(true)
    await fireEvent.press(row.getByRole('button', { name: 'B' }))
    expect(askedFor()).toEqual(['The Beacon'])
    expect(preferred(SHOW_TITLES)).toEqual([])
  })

  it('draws no card before the list has its height, so the first card takes focus as it mounts', async () => {
    mockParams.mockReturnValue({ [APP_ROUTE_PARAMS.id]: String(FILMS.id) })
    await renderScreen({ ui: <Library /> })
    await screen.findByRole('header', { name: 'Films' })
    expect(screen.queryByRole('button', { name: 'Ashfall Gate' })).toBeNull()
    await layOut()
    expect(await screen.findByRole('button', { name: 'Ashfall Gate' })).toBeTruthy()
    expect(preferred(FILM_TITLES)).toEqual(['Ashfall Gate'])
  })

  it('asks for the focus on every jump, the same card twice included', async () => {
    await renderLibrary({ id: SERIES.id })
    await screen.findByRole('button', { name: 'Saltmarsh' })
    const row = within(screen.getByLabelText('Jump to a letter'))

    await fireEvent.press(row.getByRole('button', { name: 'B' }))
    await fireEvent.press(row.getByRole('button', { name: 'B' }))
    await fireEvent.press(row.getByRole('button', { name: 'S' }))
    expect(askedFor()).toEqual(['The Beacon', 'The Beacon', 'Saltmarsh'])
  })

  it('asks once per jump, not again when the card jumped to mounts afresh', async () => {
    mockServer.libraries = [GROUPED_FILMS]
    // A library opens on its grid; the grouped view is picked here.
    useLibraryViews.setState({
      choices: { [`${NAS.id}/${FILMS.id}`]: { view: LIBRARY_VIEWS.grouped } },
    })
    await renderLibrary({ id: FILMS.id })
    const bucket = await screen.findByRole('button', { name: 'Matched, 3 videos' })
    const row = within(screen.getByLabelText('Jump to a letter'))

    await fireEvent.press(row.getByRole('button', { name: 'B' }))
    expect(await screen.findByRole('button', { name: 'Busboys' })).toBeTruthy()
    expect(askedFor()).toEqual(['Busboys'])

    await fireEvent.press(bucket)
    expect(screen.queryByRole('button', { name: 'Busboys' })).toBeNull()
    await fireEvent.press(bucket)
    expect(screen.getByRole('button', { name: 'Busboys' })).toBeTruthy()
    expect(askedFor()).toEqual(['Busboys'])
  })

  it('leaves the focus on the toolbar when the sort changes after a jump', async () => {
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    const row = within(screen.getByLabelText('Jump to a letter'))
    await fireEvent.press(row.getByRole('button', { name: 'B' }))
    expect(askedFor()).toEqual(['Busboys'])

    await fireEvent.press(screen.getByRole('button', { name: 'Sort: Title' }))
    await fireEvent.press(
      within(screen.getByLabelText('Sort')).getByRole('button', { name: SORT_FIELD_LABELS.added }),
    )
    expect(await screen.findByRole('button', { name: 'Sort: Date added' })).toBeTruthy()
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button')
          .map((card) => card.props.accessibilityLabel)
          .filter((label) => FILM_TITLES.includes(label)),
      ).toEqual(['Busboys', 'Night Train', 'Ashfall Gate']),
    )
    expect(preferred(FILM_TITLES)).toEqual([])
    expect(askedFor()).toEqual(['Busboys'])

    // The newest first now: the strip runs by month, and its one month holds Busboys first.
    await fireEvent.press(
      within(screen.getByLabelText(JUMP_SCALE_LABELS.added)).getByRole('button', {
        name: 'October 2026',
      }),
    )
    expect(askedFor()).toEqual(['Busboys', 'Busboys'])
  })

  it('takes the opening focus off the first card once anything in the grid has the focus', async () => {
    await renderLibrary({ id: FILMS.id })
    const first = await screen.findByRole('button', { name: 'Ashfall Gate' })
    expect(preferred(FILM_TITLES)).toEqual(['Ashfall Gate'])
    await fireEvent(first, NATIVE_EVENTS.focus)
    expect(preferred(FILM_TITLES)).toEqual([])
  })

  it('lets the opening focus go once the header has had it, before any card did', async () => {
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    // A control's focus bubbles up to the header that holds it, as the Sort chip's does.
    const header = screen.getByRole('header', { name: 'Films' }).parent
    if (header === null) throw new Error('No header')
    await fireEvent(header, NATIVE_EVENTS.focus)
    expect(preferred(FILM_TITLES)).toEqual([])

    const field = screen.getByLabelText('Search Films')
    await fireEvent.changeText(field, FILM_SEARCHES.busboys)
    await fireEvent(field, NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: FILM_SEARCHES.busboys },
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Night Train' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Busboys' }).props.hasTVPreferredFocus).not.toBe(true)
  })

  it('picks a sort from a focusable list rather than a sheet, offering only what the type allows', async () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })

    await fireEvent.press(screen.getByRole('button', { name: 'Sort: Title' }))
    const list = within(screen.getByLabelText('Sort'))
    const options = list.getAllByRole('button')
    expect(options.map((option) => option.props.accessibilityLabel)).toEqual(
      sortFieldsFor(FILMS.settings.kind).map((field) => SORT_FIELD_LABELS[field]),
    )
    expect(
      options
        .filter((option) => option.props.hasTVPreferredFocus === true)
        .map((option) => option.props.accessibilityLabel),
    ).toEqual([SORT_FIELD_LABELS.title])

    await fireEvent.press(list.getByRole('button', { name: SORT_FIELD_LABELS.added }))
    expect(sheet).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Sort: Date added' })).toBeTruthy()
    await waitFor(() =>
      expect(
        mockServer.requests.includes(
          libraryPath({
            call: APP_CLIENT_CALLS.listMedia,
            library: FILMS,
            sort: MEDIA_SORTS.added,
          }),
        ),
      ).toBe(true),
    )
    expect(screen.queryByLabelText('Sort')).toBeNull()
  })

  it('takes the focus back to the card a page was opened from, and to no other', async () => {
    await renderLibrary({ id: FILMS.id })
    const card = await screen.findByRole('button', { name: 'Night Train' })
    await fireEvent(card, NATIVE_EVENTS.focus)
    await fireEvent.press(card)
    await leaveTestScreen()
    expect(askedFor()).toEqual([])
    await returnToTestScreen()
    expect(askedFor()).toEqual(['Night Train'])
    expect(preferred(FILM_TITLES)).toEqual([])
  })

  it('takes it back to a card of the list view too', async () => {
    useLibraryViews
      .getState()
      .choose({ serverId: NAS.id, libraryId: FILMS.id, change: { view: LIBRARY_VIEWS.list } })
    await renderLibrary({ id: FILMS.id })
    const card = await screen.findByRole('button', { name: 'Busboys' })
    await fireEvent.press(card)
    await leaveTestScreen()
    await returnToTestScreen()
    expect(askedFor()).toEqual(['Busboys'])
  })

  it('opens on Continue watching while something is in progress, its card first, one press from the library', async () => {
    mockServer.inProgress = [NIGHT_TRAIN_IN_PROGRESS]
    await renderLibrary({ id: FILMS.id })
    expect(await screen.findByText('Continue watching, 1 video')).toBeTruthy()
    expect(preferred(FILM_TITLES)).toEqual(['Night Train'])
    expect(screen.queryByRole('button', { name: 'Ashfall Gate' })).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: 'Show Library' }))
    await layOut()
    expect(await screen.findByRole('button', { name: 'Ashfall Gate' })).toBeTruthy()
    expect(screen.getByText(/^Movies, \d+ videos$/u)).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Show Continue watching' }))
    await layOut()
    expect(await screen.findByText('Continue watching, 1 video')).toBeTruthy()
  })

  it('opens on the library when nothing is in progress, and still offers Continue watching', async () => {
    await renderLibrary({ id: FILMS.id })
    expect(await screen.findByRole('button', { name: 'Ashfall Gate' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Show Continue watching' }))
    expect(await screen.findByText('Nothing in progress here yet.')).toBeTruthy()
  })

  it('opens on the library when handed a search, whatever is in progress', async () => {
    mockServer.inProgress = [NIGHT_TRAIN_IN_PROGRESS]
    mockParams.mockReturnValue({
      [APP_ROUTE_PARAMS.id]: String(FILMS.id),
      [APP_ROUTE_PARAMS.query]: FILM_SEARCHES.busboys,
    })
    await renderScreen({ ui: <Library /> })
    await layOut()
    expect(await screen.findByRole('button', { name: 'Busboys' })).toBeTruthy()
  })
})
