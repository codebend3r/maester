import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CLIENT_CALLS,
  type Library as LibraryRecord,
  MEDIA_SORTS,
  SORT_FIELD_LABELS,
  sortFieldsFor,
} from '@raven/core'
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet } from 'react-native'

import { Library } from '@/screens/Library'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { useLibraryViews } from '@/stores/libraryViews'
import { useReduceMotion } from '@/stores/reduceMotion'
import { FILMS, NAS, SERIES, libraryApi, libraryPath } from '@/test/libraryServer'
import { renderScreen } from '@/test/renderScreen'

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

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
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

const renderLibrary = async ({ id }: { id: number }) => {
  mockParams.mockReturnValue({ id: String(id) })
  return renderScreen({ ui: <Library /> })
}

describe('Library on a TV', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    mockServer.requests = []
    mockServer.libraries = []
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
    useLibraryViews.setState({ choices: {} })
  })

  it('puts focus on the first card as it opens, and on no other', async () => {
    await renderLibrary({ id: FILMS.id })
    await screen.findByRole('button', { name: 'Night Train' })
    expect(preferred(FILM_TITLES)).toEqual(['Ashfall Gate'])
  })

  it('grows the focused card and rings it, as Home does', async () => {
    useReduceMotion.setState({ isReduced: true })
    await renderLibrary({ id: FILMS.id })
    const card = await screen.findByRole('button', { name: 'Busboys' })
    const scaleOf = () => {
      const [face] = card.children
      if (typeof face !== 'object' || face === null) throw new Error('No card face')
      return StyleSheet.flatten(face.props.style)?.transform
    }
    expect(scaleOf()).toEqual([{ scale: 1 }])
    await fireEvent(card, 'focus')
    expect(scaleOf()).toEqual([{ scale: 1.08 }])
  })

  it("moves focus to the first show under a letter from the jump row, as the web's strip jumps", async () => {
    await renderLibrary({ id: SERIES.id })
    await screen.findByRole('button', { name: 'Saltmarsh' })
    expect(preferred(SHOW_TITLES)).toEqual(['Ashfall'])

    const row = within(screen.getByLabelText('Jump to a letter'))
    expect(row.getByRole('button', { name: 'C' }).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(row.getByRole('button', { name: 'B' }))
    expect(preferred(SHOW_TITLES)).toEqual(['The Beacon'])
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
})
