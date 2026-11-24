import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { FetchLike } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import { ROUTE_TARGETS, hrefOf } from '@/routes'
import { LIBRARIES_COPY } from '@/screens/copy'
import { Libraries } from '@/screens/Libraries'
import { useActiveServer } from '@/stores/activeServer'
import {
  type AccountData,
  accountDataOf,
  accountFetchOf,
  signInTestAccount,
} from '@/test/accountData'
import { heldAnswer } from '@/test/heldAnswer'
import { useAccountSession } from '@/account/session'
import { FILMS, NAS, SERIES, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

const LIBRARIES_FAILURE = 'The server is resting.'

/** Another library, which this screen lists. */
const ARCHIVE = {
  ...SERIES,
  id: 3,
  name: 'Archive',
  settings: SERIES.settings,
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

let mockAccount: AccountData = accountDataOf()
const mockAccountFetch: FetchLike = (url, init) => accountFetchOf(mockAccount)(url, init)

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  openFetch: ((url, init) => mockAccountFetch(url, init)) satisfies FetchLike,
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
    mockAccount = accountDataOf()
    useAccountSession.setState({ session: null })
  })

  it("pins a library for the account on this server, each card's Pin a toggle", async () => {
    mockAccount.pins = [{ serverId: NAS.id, libraryId: FILMS.id, pinnedAt: '1' }]
    signInTestAccount()
    await renderScreen({ ui: <Libraries /> })
    const films = await screen.findByRole('button', { name: LIBRARIES_COPY.pinName(FILMS.name) })
    await waitFor(() => expect(films.props.accessibilityState).toMatchObject({ selected: true }))
    expect(screen.getByText(LIBRARIES_COPY.pinned)).toBeTruthy()
    const archive = screen.getByRole('button', { name: LIBRARIES_COPY.pinName(ARCHIVE.name) })
    expect(archive.props.accessibilityState).toMatchObject({ selected: false })
    await fireEvent.press(archive)
    await waitFor(() =>
      expect(mockAccount.pins).toContainEqual(
        expect.objectContaining({ serverId: NAS.id, libraryId: ARCHIVE.id }),
      ),
    )
    await fireEvent.press(screen.getByRole('button', { name: LIBRARIES_COPY.pinName(FILMS.name) }))
    await waitFor(() =>
      expect(mockAccount.pins.some(({ libraryId }) => libraryId === FILMS.id)).toBe(false),
    )
  })

  it('offers no Pin while nobody is signed in', async () => {
    await renderScreen({ ui: <Libraries /> })
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: LIBRARIES_COPY.pinName(ARCHIVE.name) })).toBeNull()
  })

  it('lists every library, pinned or not, in the server order', async () => {
    await renderScreen({ ui: <Libraries /> })
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeTruthy()
    expect(screen.getByRole('header', { name: LIBRARIES_COPY.title })).toBeTruthy()
    expect(screen.getByText('3 libraries · 6 videos')).toBeTruthy()
    expect(screen.getByText('Movies · 2 videos')).toBeTruthy()
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
