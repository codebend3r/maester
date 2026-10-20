import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CLIENT_CALLS,
  type Library as LibraryRecord,
  LIBRARY_VIEW_LABELS,
  MEDIA_SORTS,
  SORT_FIELD_LABELS,
  sortFieldsFor,
} from '@raven/core'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { ActionSheetIOS } from 'react-native'

import { APP_ROUTES } from '@/routes'
import { Library } from '@/screens/Library'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { useLibraryViews } from '@/stores/libraryViews'
import { FILMS, GROUPED_FILMS, NAS, SERIES, libraryApi, libraryPath } from '@/test/libraryServer'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockParams = jest.fn(() => ({ id: String(FILMS.id) }))
/** What the server heard, and the libraries it answers with in place of its own, per test. */
const mockServer: { requests: string[]; libraries: LibraryRecord[] } = {
  requests: [],
  libraries: [],
}
const mockApi = jest.fn((_server: AppServer) =>
  libraryApi({
    record: (path) => {
      mockServer.requests = [...mockServer.requests, path]
    },
    libraries: () => mockServer.libraries,
  }),
)

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

const { listMedia, listShows } = APP_CLIENT_CALLS

/** The sheets the screen asked for, and the option each was answered with by `answer`. */
const sheets = ({ answer }: { answer: string | null }) => {
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

const renderLibrary = async ({ id }: { id: number | string }) => {
  mockParams.mockReturnValue({ id: String(id) })
  return renderScreen({ ui: <Library /> })
}

describe('Library on a phone or tablet', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    mockServer.requests = []
    mockServer.libraries = []
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
    useLibraryViews.setState({ choices: {} })
  })

  it("lists a movies library's posters in the library's own sort", async () => {
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

  it('opens a card on its item', async () => {
    await renderLibrary({ id: FILMS.id })
    await fireEvent.press(await screen.findByRole('button', { name: 'Busboys' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: APP_ROUTES.item, params: { id: '51' } })
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
    })
  })

  it("does not offer a sort a show library's type cannot use", async () => {
    const asked = sheets({ answer: null })
    await renderLibrary({ id: SERIES.id })
    await screen.findByRole('button', { name: 'Saltmarsh' })

    await fireEvent.press(screen.getByRole('button', { name: 'Sort: Title' }))
    const [sheet] = asked
    expect(sheet?.options).toEqual([
      ...sortFieldsFor(SERIES.settings.kind).map((field) => SORT_FIELD_LABELS[field]),
      'Cancel',
    ])
    expect(sheet?.options).not.toContain(SORT_FIELD_LABELS.size)
    expect(sheet?.options).not.toContain(SORT_FIELD_LABELS.resolution)
  })

  it("lists a show library by title when this device's choice is one its type cannot use", async () => {
    useLibraryViews.setState({
      choices: { [`${NAS.id}/${SERIES.id}`]: { sort: MEDIA_SORTS.largest } },
    })
    await renderLibrary({ id: SERIES.id })
    await screen.findByRole('button', { name: 'Saltmarsh' })

    expect(mockServer.requests).toContain(
      libraryPath({ call: listShows, library: SERIES, sort: MEDIA_SORTS.title }),
    )
    expect(mockServer.requests.some((path) => path.includes(MEDIA_SORTS.largest))).toBe(false)
    expect(screen.getByRole('button', { name: 'Sort: Title' })).toBeTruthy()
  })

  it("files a show library's shows under their letters, past a leading The, as the web does", async () => {
    await renderLibrary({ id: SERIES.id })
    await screen.findByRole('button', { name: 'Saltmarsh' })

    const strip = screen.getByLabelText('Jump to a letter')
    expect(strip).toBeTruthy()
    const open = (name: string) =>
      screen.getByRole('button', { name }).props.accessibilityState?.disabled !== true
    expect(['A', 'B', 'S'].map(open)).toEqual([true, true, true])
    expect(['Numbers and symbols', 'C', 'T', 'Z'].map(open)).toEqual([false, false, false, false])
  })

  it("shows the server's grouping as folded buckets, each opening on a press", async () => {
    mockServer.libraries = [GROUPED_FILMS]
    await renderLibrary({ id: FILMS.id })

    const matched = await screen.findByRole('button', { name: 'Matched, 3 videos' })
    expect(screen.getByRole('button', { name: 'Group by: Matched or not' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Busboys' })).toBeNull()

    await fireEvent.press(matched)
    expect(cardTitles(FILM_TITLES)).toEqual(['Ashfall Gate', 'Busboys', 'Night Train'])
  })

  it('offers only the views and groupings the type has', async () => {
    const asked = sheets({ answer: null })
    mockServer.libraries = [GROUPED_FILMS]
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Matched, 3 videos' })

    await fireEvent.press(screen.getByRole('button', { name: 'Group by: Matched or not' }))
    await fireEvent.press(screen.getByRole('button', { name: 'View: Grouped' }))
    expect(asked.map(({ title }) => title)).toEqual(['Group by', 'View'])
    expect(asked[0]?.options).toEqual([
      'Matched or not',
      'Resolution',
      'Video codec',
      'Month added',
      'Cancel',
    ])
    expect(asked[1]?.options).toEqual(['Grid', 'List', 'Tiles', 'Grouped', 'Cancel'])
  })

  it('says a library that is not there is not there', async () => {
    await renderLibrary({ id: 99 })
    expect(await screen.findByText('This library is not on the server.')).toBeTruthy()
  })

  it('asks for nothing when the address names no library', async () => {
    await renderLibrary({ id: '1e3' })
    expect(await screen.findByText('This library is not on the server.')).toBeTruthy()
    expect(mockServer.requests.some((path) => path.startsWith('/api/libraries/'))).toBe(false)
  })
})
