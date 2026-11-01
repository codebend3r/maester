import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import { useUnlockPrompt } from '@raven/ui/headless'
import { act, fireEvent, screen } from '@testing-library/react-native'

import { FORM_COPY } from '@/layouts/copy'
import { useUnlockRoute } from '@/queries/useUnlockRoute'
import { APP_ROUTES } from '@/routes'
import { Unlock } from '@/screens/Unlock'
import { useActiveServer } from '@/stores/activeServer'
import { NAS, homeApi } from '@/test/homeServer'
import { createScreenClient, renderScreen } from '@/test/renderScreen'

const mockBack = jest.fn()
const mockPush = jest.fn()
const mockPathname = jest.fn<() => string>(() => APP_ROUTES.home)
const mockApi = jest.fn(homeApi)

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush, canGoBack: () => true }),
  usePathname: () => mockPathname(),
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

const enterPin = async (pin: string) => {
  await fireEvent.changeText(screen.getByLabelText('PIN'), pin)
  await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))
}

describe('Unlock', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('asks for the PIN, then reads everything again and goes back', async () => {
    const client = createScreenClient()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    await renderScreen({ ui: <Unlock />, client })
    expect(screen.getByRole('header', { name: FORM_COPY.wordmark })).toBeTruthy()
    expect(screen.getByText(NAS.name)).toBeTruthy()

    await enterPin('1234')

    expect(invalidate).toHaveBeenCalledWith()
    expect(mockBack).toHaveBeenCalled()
  })

  it("shows the server's words for a wrong PIN, and stays", async () => {
    await renderScreen({ ui: <Unlock /> })
    await enterPin('0000')
    expect(await screen.findByText('That PIN is not right.')).toBeTruthy()
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('goes back on Not now', async () => {
    await renderScreen({ ui: <Unlock /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }))
    expect(mockBack).toHaveBeenCalled()
  })
})

const Watcher = () => {
  useUnlockRoute()
  return null
}

describe('useUnlockRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPathname.mockReturnValue(APP_ROUTES.home)
    useUnlockPrompt.setState({ open: false })
  })

  it('opens the PIN screen when a locked library refuses a page', async () => {
    await renderScreen({ ui: <Watcher /> })
    await act(async () => useUnlockPrompt.getState().ask())
    expect(mockPush).toHaveBeenCalledWith(APP_ROUTES.unlock)
    expect(useUnlockPrompt.getState().open).toBe(false)
  })

  it('opens it once, when it is already open', async () => {
    mockPathname.mockReturnValue(APP_ROUTES.unlock)
    await renderScreen({ ui: <Watcher /> })
    await act(async () => useUnlockPrompt.getState().ask())
    expect(mockPush).not.toHaveBeenCalled()
    expect(useUnlockPrompt.getState().open).toBe(false)
  })
})
