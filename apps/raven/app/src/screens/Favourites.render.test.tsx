import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiClient } from '@raven/core'
import type * as Native from '@raven/native'
import { fireEvent, screen } from '@testing-library/react-native'

import { APP_ROUTES, APP_ROUTE_PARAMS } from '@/routes'
import { Favourites } from '@/screens/Favourites'
import { useActiveServer } from '@/stores/activeServer'
import { NAS } from '@/test/homeServer'
import {
  FAVOURITES_FAILURE,
  type Favourites as ServerFavourites,
  favouritesApi,
} from '@/test/favouritesServer'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockBack = jest.fn()
let mockHeld: ServerFavourites = {}
const mockApi = jest.fn((): ApiClient => favouritesApi({ read: () => mockHeld }))

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi(),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

describe('Favourites on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHeld = {}
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('lists every kind of favourite as cards under its own title', async () => {
    await renderScreen({ ui: <Favourites /> })
    expect(await screen.findByRole('button', { name: 'Severance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dune' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Home Movie' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'OK Computer' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Radiohead' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Favourites' })).toBeTruthy()
    expect(screen.getByText('5 favourites')).toBeTruthy()
  })

  it('opens the page of the card pressed', async () => {
    await renderScreen({ ui: <Favourites /> })
    await fireEvent.press(await screen.findByRole('button', { name: 'Severance' }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.item,
      params: { [APP_ROUTE_PARAMS.id]: '4' },
    })
    await fireEvent.press(screen.getByRole('button', { name: 'OK Computer' }))
    expect(mockPush).toHaveBeenLastCalledWith(
      expect.objectContaining({ pathname: APP_ROUTES.album }),
    )
  })

  it('says so when nothing is a favourite yet', async () => {
    mockHeld = { titles: [], videos: [], albums: [], artists: [] }
    await renderScreen({ ui: <Favourites /> })
    expect(await screen.findByText(/Nothing is a favourite yet/u)).toBeTruthy()
  })

  it('says what the server said when it cannot list them', async () => {
    mockHeld = { isFailing: true }
    await renderScreen({ ui: <Favourites /> })
    expect(await screen.findByText(FAVOURITES_FAILURE)).toBeTruthy()
  })
})
