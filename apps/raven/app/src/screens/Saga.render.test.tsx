import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { SESSION_KINDS, SESSION_PARAMS } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import { fireEvent, screen } from '@testing-library/react-native'

import { APP_ROUTE_PARAMS, APP_ROUTES } from '@/routes'
import { SAGA_COPY } from '@/screens/copy'
import { Saga } from '@/screens/Saga'
import { useActiveServer } from '@/stores/activeServer'
import { FILMS, NAS } from '@/test/homeServer'
import { ASHFALL_GATE, NIGHT_SAGA, NIGHT_TRAIN, libraryApi } from '@/test/libraryServer'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockApi = jest.fn(() => libraryApi())
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: NIGHT_SAGA.tmdbId,
  [APP_ROUTE_PARAMS.library]: String(FILMS.id),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: (_props: ApiForProps) => mockApi(),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

describe('Saga on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it("lists the saga's movies as posters, with how many and the years they span", async () => {
    await renderScreen({ ui: <Saga /> })

    expect(await screen.findByRole('header', { name: NIGHT_SAGA.name })).toBeTruthy()
    expect(screen.getByRole('button', { name: ASHFALL_GATE.item?.title })).toBeTruthy()
    expect(screen.getByRole('button', { name: NIGHT_TRAIN.item?.title })).toBeTruthy()
    expect(screen.getByText('2 movies, 2021 to 2025')).toBeTruthy()
  })

  it("opens a movie's page in the library the saga was opened from", async () => {
    await renderScreen({ ui: <Saga /> })
    await fireEvent.press(await screen.findByRole('button', { name: NIGHT_TRAIN.item?.title }))

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: APP_ROUTES.item,
        params: expect.objectContaining({ [APP_ROUTE_PARAMS.library]: String(FILMS.id) }),
      }),
    )
  })

  it('plays the first movie not yet watched in the saga, so Next walks the saga', async () => {
    await renderScreen({ ui: <Saga /> })
    await fireEvent.press(await screen.findByRole('button', { name: SAGA_COPY.playAll }))

    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.play,
      params: {
        [APP_ROUTE_PARAMS.mediaId]: String(NIGHT_TRAIN.id),
        [SESSION_PARAMS.session]: SESSION_KINDS.saga,
        [SESSION_PARAMS.scope]: NIGHT_SAGA.tmdbId,
      },
    })
  })

  it('says so when the library lists no such saga', async () => {
    mockParams.mockReturnValue({
      [APP_ROUTE_PARAMS.id]: '99',
      [APP_ROUTE_PARAMS.library]: String(FILMS.id),
    })
    await renderScreen({ ui: <Saga /> })

    expect(await screen.findByText(SAGA_COPY.missing)).toBeTruthy()
  })
})
