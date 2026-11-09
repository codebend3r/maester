import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { screen } from '@testing-library/react-native'

import { Binge } from '@/screens/Binge'
import { BINGE_PAGE_COPY } from '@/screens/copy'
import { useActiveServer } from '@/stores/activeServer'
import { NAS, SEVERANCE_PAGE, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

/** The shows the server says are binged. */
const mockBinge: { ids: number[] } = { ids: [] }
const mockPush = jest.fn()
const mockBack = jest.fn()
const mockApi = jest.fn((server: AppServer) => {
  const api = homeApi(server)
  return { ...api, getBinge: async () => ({ ids: mockBinge.ids, hasSeenTip: true }) }
})

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }))
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

describe('Binge on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBinge.ids = []
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('says no show is set to binge while the list is empty', async () => {
    await renderScreen({ ui: <Binge /> })
    expect(await screen.findByText(BINGE_PAGE_COPY.none)).toBeTruthy()
    expect(screen.getByRole('header', { name: BINGE_PAGE_COPY.title })).toBeTruthy()
  })

  it("draws each binged show as Home's Binge card", async () => {
    mockBinge.ids = [SEVERANCE_PAGE.id]
    await renderScreen({ ui: <Binge /> })
    expect(await screen.findByText(SEVERANCE_PAGE.title)).toBeTruthy()
    expect(screen.queryByText(BINGE_PAGE_COPY.none)).toBeNull()
  })
})
