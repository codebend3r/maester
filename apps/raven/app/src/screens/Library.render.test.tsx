import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CLIENT_CALLS,
  type Library as LibraryRecord,
  LIBRARY_VIEWS,
  LIBRARY_VIEW_LABELS,
  MEDIA_SORTS,
  type Saga,
  SEARCH_DELAY_MS,
  SORT_FIELD_LABELS,
  sortFieldsFor,
} from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet } from 'react-native'

import { APP_ROUTE_PARAMS, APP_ROUTES } from '@/routes'
import { Library } from '@/screens/Library'
import { LIBRARY_COPY } from '@/screens/copy'
import { useActiveServer } from '@/stores/activeServer'
import { useLibraryViews } from '@/stores/libraryViews'
import { FILMS, NAS, SERIES } from '@/test/homeServer'
import {
  FILM_SEARCHES,
  GROUPED_FILMS,
  NIGHT_SAGA,
  libraryApi,
  libraryPath,
} from '@/test/libraryServer'
import { heldAnswer } from '@/test/heldAnswer'
import { keyboardTapsAbove, renderScreen } from '@/test/renderScreen'
import { linesHeightOf } from '@/layouts/textHeights'
import { SIZES } from '@/theme/appTheme'
import { NATIVE_EVENTS } from '@/test/nativeEvents'

type RenderedNode = { type?: unknown; children?: readonly unknown[] }

const isRenderedNode = (value: unknown): value is RenderedNode =>
  typeof value === 'object' && value !== null

/** How many drawings (react-native-svg's views) sit in `node`'s rendered tree. */
const drawingsIn = (node: unknown): number =>
  !isRenderedNode(node)
    ? 0
    : (node.type === 'RNSVGSvgView' ? 1 : 0) +
      (node.children ?? []).reduce<number>((sum, child) => sum + drawingsIn(child), 0)

const mockPush = jest.fn()
const mockFontScale = jest.fn(() => 1)
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(FILMS.id),
}))
/**
 * What the server heard, the libraries it answers with in place of its own, and what its
 * answers wait on, per test.
 */
const mockServer: {
  requests: string[]
  libraries: LibraryRecord[]
  sagas: Saga[]
  reads: (path: string) => Promise<void>
} = {
  requests: [],
  libraries: [],
  sagas: [NIGHT_SAGA],
  reads: async () => undefined,
}
const mockApi = jest.fn((_server: AppServer) =>
  libraryApi({
    record: (path) => {
      mockServer.requests = [...mockServer.requests, path]
    },
    libraries: () => mockServer.libraries,
    sagas: () => mockServer.sagas,
    reads: (path) => mockServer.reads(path),
  }),
)

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale() }),
}))
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

const { listMedia, listShows } = APP_CLIENT_CALLS

/** How tall the row holding `card` stands: the nearest of its parents with a set height. */
const rowHeightOf = (card: ReturnType<typeof screen.getByRole>): unknown => {
  const heightOf = (node: typeof card | null): unknown => {
    if (node === null) return undefined
    return StyleSheet.flatten(node.props.style)?.height ?? heightOf(node.parent)
  }
  return heightOf(card.parent)
}

type SheetsProps = { answer: string | null }

/** The sheets the screen asked for, and the option each was answered with by `answer`. */
const sheets = ({ answer }: SheetsProps) => {
  const asked: { title: string; options: string[] }[] = []
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, done) => {
    asked.push({ title: options.title ?? '', options: options.options })
    const chosen = answer === null ? -1 : options.options.indexOf(answer)
    done(chosen === -1 ? (options.cancelButtonIndex ?? 0) : chosen)
  })
  return asked
}

/** The titles of the cards on screen, in order. */
const cardTitles = (titles: readonly string[]): string[] =>
  screen
    .getAllByRole('button')
    .map((card) => card.props.accessibilityLabel)
    .filter((label) => titles.includes(label))

const FILM_TITLES = ['Ashfall Gate', 'Busboys', 'Night Train'] as const

/** How each toolbar chip's spoken label starts. */
const TOOLBAR_LABEL = /^(Show |Shuffle |Sort: |Order: |View: |Group by: |Lock )/

/** The toolbar's chips by their spoken labels, in the order they stand. */
const toolbarLabels = (): string[] =>
  screen
    .getAllByRole('button')
    .map((chip) => chip.props.accessibilityLabel)
    .filter((label) => typeof label === 'string' && TOOLBAR_LABEL.test(label))

type RenderLibraryProps = { id: number | string; query?: string }

const renderLibrary = async ({ id, query }: RenderLibraryProps) => {
  mockParams.mockReturnValue({
    [APP_ROUTE_PARAMS.id]: String(id),
    ...(query === undefined ? {} : { [APP_ROUTE_PARAMS.query]: query }),
  })
  return renderScreen({ ui: <Library /> })
}

const SEARCH_FILMS = 'Search Films'

/** The searches of Films' listing the server heard. */
const filmSearches = (): string[] =>
  mockServer.requests.filter(
    (path) =>
      path.startsWith(libraryPath({ call: listMedia, library: FILMS })) &&
      path.includes(`${APP_ROUTE_PARAMS.query}=`),
  )

/** Types `text` into Films' search box one key at a time, as a keyboard reports it. */
const typeSearch = async (text: string) => {
  const field = screen.getByLabelText(SEARCH_FILMS)
  await [...text].reduce(async (typed, _, index) => {
    await typed
    await fireEvent.changeText(field, text.slice(0, index + 1))
  }, Promise.resolve())
}

const pause = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

describe('Library on a phone or tablet', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    mockServer.requests = []
    mockServer.libraries = []
    mockServer.sagas = [NIGHT_SAGA]
    mockServer.reads = async () => undefined
    mockFontScale.mockReturnValue(1)
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
    useLibraryViews.setState({
      choices: {
        [`${NAS.id}/${FILMS.id}`]: { sort: MEDIA_SORTS.title },
        [`${NAS.id}/${SERIES.id}`]: { sort: MEDIA_SORTS.title },
      },
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('opens without a device preference on newest releases first', async () => {
    useLibraryViews.setState({ choices: {} })
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    expect(cardTitles(FILM_TITLES)).toEqual(['Busboys', 'Night Train', 'Ashfall Gate'])
    expect(mockServer.requests).toContain(
      libraryPath({ call: listMedia, library: FILMS, sort: MEDIA_SORTS.yearNew }),
    )
    expect(screen.getByRole('button', { name: 'Sort: Release date' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Order: Newest first' })).toBeTruthy()
  })

  it("honours this device's chosen title sort", async () => {
    await renderLibrary({ id: FILMS.id })

    expect(await screen.findByRole('header', { name: 'Films' })).toBeTruthy()
    await screen.findByRole('button', { name: 'Night Train' })
    expect(cardTitles(FILM_TITLES)).toEqual(['Ashfall Gate', 'Busboys', 'Night Train'])
    expect(mockServer.requests).toContain(
      libraryPath({ call: listMedia, library: FILMS, sort: MEDIA_SORTS.title }),
    )
    expect(screen.getByRole('button', { name: 'Sort: Title' })).toBeTruthy()
    expect(screen.getByRole('button', { name: `View: ${LIBRARY_VIEW_LABELS.grid}` })).toBeTruthy()
  })

  it('draws an icon on every toolbar chip, with words only on Sort', async () => {
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })

    const sort = screen.getByRole('button', { name: 'Sort: Title' })
    expect(drawingsIn(sort)).toBe(1)
    expect(within(sort).getByText('Sort')).toBeTruthy()
    expect(within(sort).getByText('Title')).toBeTruthy()

    const iconOnly = [
      screen.getByRole('button', { name: 'Show Continue watching' }),
      screen.getByRole('button', { name: 'Shuffle Films' }),
      screen.getByRole('button', { name: 'Order: A to Z' }),
      screen.getByRole('button', { name: `View: ${LIBRARY_VIEW_LABELS.grid}` }),
    ]
    iconOnly.forEach((chip) => {
      expect(drawingsIn(chip)).toBe(1)
      expect(within(chip).queryAllByText(/./)).toEqual([])
    })
  })

  it('stands the toolbar as page toggles, Shuffle, Sort, its direction, then View', async () => {
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })

    expect(toolbarLabels()).toEqual([
      'Show Continue watching',
      'Show Sagas',
      'Shuffle Films',
      'Sort: Title',
      'Order: A to Z',
      `View: ${LIBRARY_VIEW_LABELS.grid}`,
    ])
  })

  it("opens a card on its item's page, as this library shows it", async () => {
    await renderLibrary({ id: FILMS.id })
    await fireEvent.press(await screen.findByRole('button', { name: 'Busboys' }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.item,
      params: { [APP_ROUTE_PARAMS.id]: '51', [APP_ROUTE_PARAMS.library]: String(FILMS.id) },
    })
  })

  it('refetches with a sort the type allows, chosen from the sheet, and keeps it on this device', async () => {
    const asked = sheets({ answer: SORT_FIELD_LABELS.added })
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })

    await fireEvent.press(screen.getByRole('button', { name: 'Sort: Title' }))
    expect(asked).toEqual([
      {
        title: 'Sort',
        options: [
          ...sortFieldsFor(FILMS.settings.kind).map((field) => SORT_FIELD_LABELS[field]),
          'Cancel',
        ],
      },
    ])

    expect(await screen.findByRole('button', { name: 'Sort: Date added' })).toBeTruthy()
    await waitFor(() =>
      expect(cardTitles(FILM_TITLES)).toEqual(['Busboys', 'Night Train', 'Ashfall Gate']),
    )
    expect(mockServer.requests).toContain(
      libraryPath({ call: listMedia, library: FILMS, sort: MEDIA_SORTS.added }),
    )
    expect(screen.getByRole('button', { name: 'Order: Newest first' })).toBeTruthy()
    expect(useLibraryViews.getState().choices).toEqual({
      [`${NAS.id}/${FILMS.id}`]: { sort: MEDIA_SORTS.added },
      [`${NAS.id}/${SERIES.id}`]: { sort: MEDIA_SORTS.title },
    })
  })

  it("does not offer a sort a show library's type cannot use", async () => {
    const asked = sheets({ answer: null })
    await renderLibrary({ id: SERIES.id })
    await screen.findByRole('button', { name: 'Saltmarsh' })

    await fireEvent.press(screen.getByRole('button', { name: 'Sort: Title' }))
    const [sheet] = asked
    expect(sheet!.options).toEqual([
      ...sortFieldsFor(SERIES.settings.kind).map((field) => SORT_FIELD_LABELS[field]),
      'Cancel',
    ])
    expect(sheet!.options).not.toContain(SORT_FIELD_LABELS.size)
    expect(sheet!.options).not.toContain(SORT_FIELD_LABELS.resolution)
  })

  it("lists a show library by newest release when this device's choice is one its type cannot use", async () => {
    useLibraryViews.setState({
      choices: { [`${NAS.id}/${SERIES.id}`]: { sort: MEDIA_SORTS.largest } },
    })
    await renderLibrary({ id: SERIES.id })
    await screen.findByRole('button', { name: 'Saltmarsh' })

    expect(mockServer.requests).toContain(
      libraryPath({ call: listShows, library: SERIES, sort: MEDIA_SORTS.yearNew }),
    )
    expect(mockServer.requests.some((path) => path.includes(MEDIA_SORTS.largest))).toBe(false)
    expect(screen.getByRole('button', { name: 'Sort: Release date' })).toBeTruthy()
  })

  it("files a show library's shows under their letters, past a leading The, as the web does", async () => {
    await renderLibrary({ id: SERIES.id })
    await screen.findByRole('button', { name: 'Saltmarsh' })

    const strip = screen.getByLabelText('Jump to a letter')
    expect(strip).toBeTruthy()
    const open = (name: string) =>
      !(screen.getByRole('button', { name }).props.accessibilityState?.disabled ?? false)
    expect(['A', 'B', 'S'].map(open)).toEqual([true, true, true])
    expect(['Numbers and symbols', 'C', 'T', 'Z'].map(open)).toEqual([false, false, false, false])
  })

  it("shows the server's grouping as folded buckets, each opening on a press", async () => {
    mockServer.libraries = [GROUPED_FILMS]
    // A library opens on its grid; the grouped view is picked here.
    useLibraryViews.setState({
      choices: { [`${NAS.id}/${FILMS.id}`]: { view: LIBRARY_VIEWS.grouped } },
    })
    await renderLibrary({ id: FILMS.id })

    const matched = await screen.findByRole('button', { name: 'Matched, 3 videos' })
    expect(screen.getByRole('button', { name: 'Group by: Matched or not' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Busboys' })).toBeNull()

    await fireEvent.press(matched)
    expect(cardTitles(FILM_TITLES)).toEqual(['Busboys', 'Night Train', 'Ashfall Gate'])
  })

  it('offers only the views and groupings the type has', async () => {
    const asked = sheets({ answer: null })
    mockServer.libraries = [GROUPED_FILMS]
    // A library opens on its grid; the grouped view is picked here.
    useLibraryViews.setState({
      choices: { [`${NAS.id}/${FILMS.id}`]: { view: LIBRARY_VIEWS.grouped } },
    })
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Matched, 3 videos' })

    await fireEvent.press(screen.getByRole('button', { name: 'Group by: Matched or not' }))
    await fireEvent.press(screen.getByRole('button', { name: 'View: Grouped' }))
    expect(asked.map(({ title }) => title)).toEqual(['Group by', 'View'])
    expect(asked[0]!.options).toEqual([
      'Matched or not',
      'Resolution',
      'Video codec',
      'Month added',
      'Cancel',
    ])
    expect(asked[1]!.options).toEqual(['Grid', 'List', 'Tiles', 'Grouped', 'Cancel'])
  })

  it('shows a library the web left on covers as its grid, and offers no covers here', async () => {
    const asked = sheets({ answer: null })
    mockServer.libraries = [
      { ...FILMS, settings: { ...FILMS.settings, view: LIBRARY_VIEWS.covers } },
    ]
    await renderLibrary({ id: FILMS.id })

    expect(await screen.findByRole('button', { name: 'View: Grid' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'View: Grid' }))
    expect(asked[0]!.options).toEqual(['Grid', 'List', 'Tiles', 'Grouped', 'Cancel'])
  })

  it("stands the rows taller for the viewer's larger text, so captions are not cut", async () => {
    await renderLibrary({ id: FILMS.id })
    const normal = rowHeightOf(await screen.findByRole('button', { name: 'Busboys' }))

    mockFontScale.mockReturnValue(2)
    await renderLibrary({ id: FILMS.id })
    const larger = rowHeightOf(await screen.findByRole('button', { name: 'Busboys' }))
    expect(typeof normal === 'number' && typeof larger === 'number' && larger - normal).toBeCloseTo(
      linesHeightOf({ sizes: [SIZES.textSm, SIZES.textXs], fontScale: 1 }),
    )
  })

  it("stands a bucket's heading taller for the viewer's larger text, so its title is not cut", async () => {
    mockServer.libraries = [GROUPED_FILMS]
    // A library opens on its grid; the grouped view is picked here.
    useLibraryViews.setState({
      choices: { [`${NAS.id}/${FILMS.id}`]: { view: LIBRARY_VIEWS.grouped } },
    })
    const headingHeight = async () =>
      StyleSheet.flatten(
        (await screen.findByRole('button', { name: 'Matched, 3 videos' })).props.style,
      )?.height ?? null
    await renderLibrary({ id: FILMS.id })
    expect(await headingHeight()).toBe(SIZES.fieldHeight + SIZES.space2)

    mockFontScale.mockReturnValue(3)
    await renderLibrary({ id: FILMS.id })
    expect(await headingHeight()).toBeCloseTo(
      linesHeightOf({ sizes: [SIZES.textLg], fontScale: 3 }) + SIZES.space2,
    )
  })

  it('filters the grid by its search box once typing pauses, never for each key', async () => {
    jest.useFakeTimers()
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    await typeSearch(FILM_SEARCHES.busboys)
    await pause(SEARCH_DELAY_MS - 1)
    expect(filmSearches()).toEqual([])
    expect(cardTitles(FILM_TITLES)).toEqual(['Ashfall Gate', 'Busboys', 'Night Train'])

    await pause(1)
    expect(filmSearches()).toEqual([
      libraryPath({
        call: listMedia,
        library: FILMS,
        sort: MEDIA_SORTS.title,
        search: FILM_SEARCHES.busboys,
      }),
    ])
    await waitFor(() => expect(cardTitles(FILM_TITLES)).toEqual(['Busboys']))
  })

  it('searches at once when the keyboard sends it, and lists everything again once cleared', async () => {
    jest.useFakeTimers()
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    await typeSearch(FILM_SEARCHES.busboys)
    await fireEvent(screen.getByLabelText(SEARCH_FILMS), NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: FILM_SEARCHES.busboys },
    })
    expect(filmSearches()).toHaveLength(1)
    await waitFor(() => expect(cardTitles(FILM_TITLES)).toEqual(['Busboys']))

    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() =>
      expect(cardTitles(FILM_TITLES)).toEqual(['Ashfall Gate', 'Busboys', 'Night Train']),
    )
    await pause(SEARCH_DELAY_MS * 5)
    expect(filmSearches()).toHaveLength(1)
  })

  it('says when nothing in the library matches the search', async () => {
    jest.useFakeTimers()
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    await typeSearch(FILM_SEARCHES.nothing)
    await pause(SEARCH_DELAY_MS)
    expect(await screen.findByText(`Nothing here matches "${FILM_SEARCHES.nothing}".`)).toBeTruthy()
  })

  it('says nothing matches only once the server says so, not while the last search stands in', async () => {
    jest.useFakeTimers()
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    await typeSearch(FILM_SEARCHES.nothing)
    await pause(SEARCH_DELAY_MS)
    expect(await screen.findByText(`Nothing here matches "${FILM_SEARCHES.nothing}".`)).toBeTruthy()

    const answer = heldAnswer()
    const searched = libraryPath({
      call: listMedia,
      library: FILMS,
      sort: MEDIA_SORTS.title,
      search: FILM_SEARCHES.busboys,
    })
    mockServer.reads = (path) => (path === searched ? answer.answer : Promise.resolve())
    const field = screen.getByLabelText(SEARCH_FILMS)
    await fireEvent.changeText(field, FILM_SEARCHES.busboys)
    await fireEvent(field, NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: FILM_SEARCHES.busboys },
    })
    await waitFor(() => expect(mockServer.requests).toContain(searched))
    expect(screen.queryByText(/^Nothing here matches/)).toBeNull()

    answer.release()
    expect(await screen.findByRole('button', { name: 'Busboys' })).toBeTruthy()
  })
  it('lets the cards take the first tap while the keyboard is up', async () => {
    await renderLibrary({ id: FILMS.id })
    const card = await screen.findByRole('button', { name: 'Night Train' })
    expect(keyboardTapsAbove(card)).toEqual(['handled'])
  })

  it('leaves the keyboard down as it opens: its box is there to be chosen', async () => {
    await renderLibrary({ id: FILMS.id })
    expect((await screen.findByLabelText(SEARCH_FILMS)).props.autoFocus).toBe(false)
  })

  it('opens on the search it was handed, as a search through every library hands it over', async () => {
    await renderLibrary({ id: FILMS.id, query: FILM_SEARCHES.busboys })
    expect(await screen.findByRole('button', { name: 'Busboys' })).toBeTruthy()
    expect(screen.getByLabelText(SEARCH_FILMS).props.value).toBe(FILM_SEARCHES.busboys)
    expect(cardTitles(FILM_TITLES)).toEqual(['Busboys'])
    expect(mockServer.requests).not.toContain(
      libraryPath({ call: listMedia, library: FILMS, sort: MEDIA_SORTS.title }),
    )
  })

  it('says a library that is not there is not there', async () => {
    await renderLibrary({ id: 99 })
    expect(await screen.findByText('This library is not on the server.')).toBeTruthy()
  })

  it('asks for nothing when the address names no library', async () => {
    await renderLibrary({ id: '1e3' })
    expect(await screen.findByText('This library is not on the server.')).toBeTruthy()
    expect(
      mockServer.requests.some((path) =>
        path.startsWith(`${APP_CLIENT_CALLS.listLibraries.path}/`),
      ),
    ).toBe(false)
  })

  describe('sagas', () => {
    it("opens a movies library's sagas from a button, each a card that opens its page", async () => {
      await renderLibrary({ id: FILMS.id })
      await screen.findByRole('button', { name: 'Night Train' })

      await fireEvent.press(screen.getByRole('button', { name: 'Show Sagas' }))

      expect(await screen.findByRole('button', { name: 'Night Trains' })).toBeTruthy()
      expect(screen.getByText('2 movies, 2021 to 2025')).toBeTruthy()
      expect(screen.getByText('1 saga')).toBeTruthy()
      await fireEvent.press(screen.getByRole('button', { name: 'Night Trains' }))
      expect(mockPush).toHaveBeenCalledWith({
        pathname: APP_ROUTES.saga,
        params: {
          [APP_ROUTE_PARAMS.id]: NIGHT_SAGA.tmdbId,
          [APP_ROUTE_PARAMS.library]: String(FILMS.id),
        },
      })
      // Back to the listing, and on to the sagas again: the buttons name where each goes.
      expect(screen.getByRole('button', { name: 'Show Library' })).toBeTruthy()
    })

    it('says so when the library has none', async () => {
      mockServer.sagas = []
      await renderLibrary({ id: FILMS.id })
      await screen.findByRole('button', { name: 'Night Train' })

      await fireEvent.press(screen.getByRole('button', { name: 'Show Sagas' }))

      expect(await screen.findByText(LIBRARY_COPY.sagasEmpty('Films'))).toBeTruthy()
    })

    it('offers no sagas where files are not matched to movies', async () => {
      await renderLibrary({ id: SERIES.id })
      await screen.findByRole('button', { name: 'Saltmarsh' })

      expect(screen.queryByRole('button', { name: 'Show Sagas' })).toBeNull()
    })
  })
})
