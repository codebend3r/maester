import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CALL_METHODS, APP_CLIENT_CALLS } from '@raven/core'
import type * as Native from '@raven/native'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import { APP_ROUTE_PARAMS } from '@/routes'
import { Artist } from '@/screens/Artist'
import { useActiveServer } from '@/stores/activeServer'
import { type HeardRequest, pathFor } from '@/test/fixtureFetch'
import { heldAnswer } from '@/test/heldAnswer'
import { NAS } from '@/test/homeServer'
import { OK_COMPUTER, RADIOHEAD, musicApi } from '@/test/musicServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(RADIOHEAD.id),
}))
const mockHeard: HeardRequest[] = []
const mockServer = { writes: async (): Promise<void> => undefined }
const mockApi = jest.fn(() =>
  musicApi({ hear: (request) => mockHeard.push(request), writes: () => mockServer.writes() }),
)

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
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

/** The client this test's screen reads through. */
const shown = { client: createScreenClient() }

describe('Artist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHeard.splice(0)
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(async () => {
    await untilIdle(shown.client)
  })

  it('shows their albums, and marks the artist a favourite before the server answers', async () => {
    const { answer, release } = heldAnswer()
    mockServer.writes = () => answer
    shown.client = createScreenClient()
    await renderScreen({ ui: <Artist />, client: shown.client })
    expect(await screen.findByText(OK_COMPUTER.title)).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Favourite' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Favourite' }).props.accessibilityState,
      ).toMatchObject({ selected: true }),
    )
    expect(mockHeard.filter(({ method }) => method !== APP_CALL_METHODS.get)).toEqual([
      {
        method: APP_CALL_METHODS.put,
        path: pathFor({ path: APP_CLIENT_CALLS.setArtistFavourite.path, id: RADIOHEAD.id }),
        body: { favourite: true },
      },
    ])
    release()
  })
})
