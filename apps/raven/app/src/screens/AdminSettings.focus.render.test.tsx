import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CALL_METHODS, APP_CLIENT_CALLS, QUALITIES, themeOf } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native'

import { useAccountSession } from '@/account/session'
import { Settings } from '@/screens/Settings'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { type AdminServerState, OWNER, PLAYBACK, SIGNED_IN, adminApi } from '@/test/adminServer'
import { NAS } from '@/test/homeServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { resetTestScreen } from '@/test/navigationFocus'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
const mockServer: AdminServerState = { account: OWNER, playback: PLAYBACK, heard: [] }
const mockApi = jest.fn((server: AppServer) => adminApi(mockServer)(server))

jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').navigationFocusMocks,
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
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

/** Whatever on screen asks for the remote's focus, by its label. */
const preferred = (): unknown[] =>
  [...screen.getAllByRole('button'), ...screen.getAllByRole('switch')]
    .filter((node) => node.props.hasTVPreferredFocus === true)
    .map((node) => node.props.accessibilityLabel)

describe("the owner's settings on a TV", () => {
  let client = createScreenClient()

  afterEach(() => untilIdle(client))

  beforeEach(() => {
    client = createScreenClient()
    resetTestScreen()
    mockServer.heard.length = 0
    mockServer.account = OWNER
    mockServer.playback = PLAYBACK
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
    useAccountSession.setState({ session: SIGNED_IN })
  })

  it('still opens on Sign out once the Admin sections are drawn, the theme among the settings', async () => {
    await renderScreen({ ui: <Settings />, client })
    await screen.findByRole('button', { name: 'Quick scan Films' })
    expect(preferred()).toEqual(['Sign out'])
    expect(
      screen.getByRole('button', { name: `Theme: ${themeOf(DEFAULT_APP_PREFS.theme).name}` }),
    ).toBeTruthy()
  })

  it("saves a playback setting picked from the TV's list", async () => {
    await renderScreen({ ui: <Settings />, client })
    await fireEvent.press(await screen.findByRole('button', { name: 'Transcode quality: Medium' }))
    await fireEvent.press(
      within(screen.getByLabelText('Transcode quality')).getByRole('button', { name: 'High' }),
    )
    await waitFor(() =>
      expect(mockServer.heard.filter(({ method }) => method !== APP_CALL_METHODS.get)).toEqual([
        {
          method: APP_CALL_METHODS.put,
          path: APP_CLIENT_CALLS.setPlaybackSettings.path,
          body: { quality: QUALITIES.high },
        },
      ]),
    )
  })

  it('turns a server switch on with a press, saying which it is', async () => {
    await renderScreen({ ui: <Settings />, client })
    const markers = await screen.findByRole('switch', { name: 'Find intros and credits' })
    expect(markers.props.accessibilityState).toMatchObject({ checked: true })
    await fireEvent.press(markers)
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Find intros and credits' }).props.accessibilityState,
      ).toMatchObject({ checked: false }),
    )
  })

  it('shows a member no Admin', async () => {
    mockServer.account = { ...OWNER, isOwner: false }
    await renderScreen({ ui: <Settings />, client })
    await waitFor(() =>
      expect(mockServer.heard.map(({ path }) => path)).toEqual([APP_CLIENT_CALLS.getMe.path]),
    )
    expect(screen.queryByRole('header', { name: 'Admin' })).toBeNull()
  })
})
