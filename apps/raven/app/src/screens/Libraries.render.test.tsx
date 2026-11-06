import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { fireEvent, screen } from '@testing-library/react-native'

import { ROUTE_TARGETS, hrefOf } from '@/routes'
import { LIBRARIES_COPY } from '@/screens/copy'
import { Libraries } from '@/screens/Libraries'
import { useActiveServer } from '@/stores/activeServer'
import { heldAnswer } from '@/test/heldAnswer'
import { FILMS, NAS, SERIES, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

const LIBRARIES_FAILURE = 'The server is resting.'

/** A library no one pinned, which the side menu leaves out and this screen lists. */
const ARCHIVE = {
  ...SERIES,
  id: 3,
  name: 'Archive',
  settings: { ...SERIES.settings, pinned: false },
}

/** What the libraries' read waits on before it is answered, what it answers, and whether it fails. */
const mockLibraries = {
  answer: Promise.resolve(),
  listed: [FILMS, ARCHIVE, SERIES],
  isFailing: false,
}
const mockPush = jest.fn()
const mockApi = jest.fn((server: AppServer) => ({
  ...homeApi(server),
  listLibraries: async () => {
    await mockLibraries.answer
    if (mockLibraries.isFailing) throw new Error(LIBRARIES_FAILURE)
    return mockLibraries.listed
  },
}))

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }))
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

describe('Libraries on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLibraries.answer = Promise.resolve()
    mockLibraries.listed = [FILMS, ARCHIVE, SERIES]
    mockLibraries.isFailing = false
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('lists every library, pinned or not, in the server order', async () => {
    await renderScreen({ ui: <Libraries /> })
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeTruthy()
    expect(screen.getByRole('header', { name: LIBRARIES_COPY.title })).toBeTruthy()
    expect(screen.getByText('3 libraries')).toBeTruthy()
    const names = screen
      .getAllByRole('button')
      .map((button) => button.props.accessibilityLabel)
      .filter((name) => ['Films', 'Archive', 'Series'].includes(name))
    expect(names).toEqual(['Films', 'Archive', 'Series'])
  })

  it('shows the mark while the libraries are read', async () => {
    const { answer, release } = heldAnswer()
    mockLibraries.answer = answer
    await renderScreen({ ui: <Libraries /> })
    expect(await screen.findByLabelText(LIBRARIES_COPY.gathering)).toBeTruthy()
    release()
    expect(await screen.findByRole('button', { name: 'Films' })).toBeTruthy()
  })

  it('opens the library pressed, as the side menu does', async () => {
    await renderScreen({ ui: <Libraries /> })
    await fireEvent.press(await screen.findByRole('button', { name: 'Archive' }))
    expect(mockPush).toHaveBeenCalledWith(
      hrefOf({ kind: ROUTE_TARGETS.library, libraryId: ARCHIVE.id, query: '' }),
    )
  })

  it('says so when there are no libraries', async () => {
    mockLibraries.listed = []
    await renderScreen({ ui: <Libraries /> })
    expect(await screen.findByText(LIBRARIES_COPY.none)).toBeTruthy()
  })

  it('says what the server said when it cannot read the libraries', async () => {
    mockLibraries.isFailing = true
    await renderScreen({ ui: <Libraries /> })
    expect(await screen.findByText(LIBRARIES_FAILURE)).toBeTruthy()
  })
})
