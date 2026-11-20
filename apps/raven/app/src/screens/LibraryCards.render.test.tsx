import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CLIENT_CALLS, HTTP_METHODS } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { pathWithId } from '@raven/native/testing'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import { useAccountSession } from '@/account/session'
import { LIBRARIES_COPY } from '@/screens/copy'
import { Libraries } from '@/screens/Libraries'
import { useActiveServer } from '@/stores/activeServer'
import { type AdminServerState, OWNER, PLAYBACK, SIGNED_IN, adminApi } from '@/test/adminServer'
import { FILMS, NAS } from '@/test/homeServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockServer: AdminServerState = { account: OWNER, playback: PLAYBACK, heard: [] }
const mockApi = jest.fn((server: AppServer) => adminApi(mockServer)(server))
const mockPush = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), dismissTo: jest.fn() }),
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

const writes = () => mockServer.heard.filter(({ method }) => method !== HTTP_METHODS.get)

describe("the owner's library cards on a phone or tablet", () => {
  let client = createScreenClient()

  afterEach(() => untilIdle(client))

  beforeEach(() => {
    client = createScreenClient()
    jest.clearAllMocks()
    mockServer.heard.length = 0
    mockServer.account = OWNER
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
    useAccountSession.setState({ session: SIGNED_IN })
  })

  it("folds a card's buttons away until its chevron opens it, as the web's card does", async () => {
    await renderScreen({ ui: <Libraries />, client })
    const more = await screen.findByRole('button', { name: LIBRARIES_COPY.showMore(FILMS.name) })
    expect(screen.queryByRole('button', { name: 'Quick scan Films' })).toBeNull()
    await fireEvent.press(more)
    expect(await screen.findByRole('button', { name: 'Quick scan Films' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Full scan Films' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update ratings Films' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: LIBRARIES_COPY.showLess(FILMS.name) }))
    expect(screen.queryByRole('button', { name: 'Quick scan Films' })).toBeNull()
  })

  it("starts a library's quick scan from its card", async () => {
    await renderScreen({ ui: <Libraries />, client })
    await fireEvent.press(
      await screen.findByRole('button', { name: LIBRARIES_COPY.showMore(FILMS.name) }),
    )
    await fireEvent.press(await screen.findByRole('button', { name: 'Quick scan Films' }))
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: HTTP_METHODS.post,
          path: pathWithId({ path: APP_CLIENT_CALLS.quickScanLibrary.path, id: FILMS.id }),
          body: undefined,
        },
      ]),
    )
  })

  it('gives a member cards that only open their library, with nothing to fold', async () => {
    mockServer.account = { ...OWNER, isOwner: false }
    await renderScreen({ ui: <Libraries />, client })
    expect(await screen.findByRole('button', { name: FILMS.name })).toBeTruthy()
    await waitFor(() =>
      expect(mockServer.heard.map(({ path }) => path)).toContain(APP_CLIENT_CALLS.getMe.path),
    )
    expect(screen.queryByRole('button', { name: LIBRARIES_COPY.showMore(FILMS.name) })).toBeNull()
  })
})
