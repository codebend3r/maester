import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { HTTP_METHODS, APP_CLIENT_CALLS, MEMBER_STATUSES, TRANSCODINGS } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet } from 'react-native'

import { useAccountSession } from '@/account/session'
import { Settings } from '@/screens/Settings'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import {
  type AdminServerState,
  OWNER,
  PLAYBACK,
  SIGNED_IN,
  WAITING,
  adminApi,
} from '@/test/adminServer'
import { FILMS, NAS } from '@/test/homeServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'
import { CODE_FONT } from '@/theme/fonts'

const mockServer: AdminServerState = { account: OWNER, playback: PLAYBACK, heard: [] }
const mockApi = jest.fn((server: AppServer) => adminApi(mockServer)(server))

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), dismissTo: jest.fn() }),
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

/** The system sheet a touch picker opens, answered with the option named `answer`. */
const answerSheet = (answer: string) =>
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, done) => {
    done(options.options.indexOf(answer))
  })

/** Opens Settings' Admin tab once the account is known to be the owner's. */
const openAdmin = async () => fireEvent.press(await screen.findByRole('tab', { name: 'Admin' }))

const writes = () => mockServer.heard.filter(({ method }) => method !== HTTP_METHODS.get)

describe("the owner's settings on a phone or tablet", () => {
  let client = createScreenClient()

  afterEach(() => untilIdle(client))

  beforeEach(() => {
    client = createScreenClient()
    jest.restoreAllMocks()
    mockServer.heard.length = 0
    mockServer.account = OWNER
    mockServer.playback = PLAYBACK
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
    useAccountSession.setState({ session: SIGNED_IN })
  })

  it("shows the owner the web's Admin sections, in its order, under an Admin tab of their own", async () => {
    await renderScreen({ ui: <Settings />, client })
    await openAdmin()
    await screen.findByRole('header', { name: 'Admin' })
    expect(
      screen
        .getAllByRole('header')
        .map((header) => header.props.children)
        .filter((name) =>
          ['Theme', 'Admin', 'Display', 'Remote Access', 'Library scans', 'Users'].includes(name),
        ),
    ).toEqual(['Admin', 'Display', 'Remote Access', 'Library scans', 'Users'])
    expect(screen.getAllByRole('tab').at(-1)?.props.accessibilityLabel).toBe('Admin')
    expect(
      await screen.findByRole('button', { name: 'Server conversion: Remux and transcode' }),
    ).toBeTruthy()
  })

  it('shows Remote Access to read only: the addresses in the fixed-width face, and nothing to switch or apply', async () => {
    await renderScreen({ ui: <Settings />, client })
    await openAdmin()
    const address = await screen.findByText(/^192\.168\.1\.20:/u)
    expect(StyleSheet.flatten(address.props.style)?.fontFamily).toBe(CODE_FONT)
    expect(screen.getByLabelText(/^Private: 192\.168\.1\.20:/u)).toBeTruthy()
    expect(screen.getByText('Remote access is off.')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: /remote access/iu })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('saves a playback setting to the server and shows it at once', async () => {
    answerSheet('Remux only')
    await renderScreen({ ui: <Settings />, client })
    await openAdmin()
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Server conversion: Remux and transcode' }),
    )
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: HTTP_METHODS.put,
          path: APP_CLIENT_CALLS.setPlaybackSettings.path,
          body: { transcoding: TRANSCODINGS.remuxOnly },
        },
      ]),
    )
    expect(
      await screen.findByRole('button', { name: 'Server conversion: Remux only' }),
    ).toBeTruthy()
  })

  it('lists no library of its own: their scans are on the Libraries page, as on the web', async () => {
    await renderScreen({ ui: <Settings />, client })
    await openAdmin()
    expect(await screen.findByRole('button', { name: 'Cancel all running scans' })).toBeTruthy()
    expect(screen.queryByRole('header', { name: FILMS.name })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Quick scan Films' })).toBeNull()
  })

  it('approves an account waiting for it', async () => {
    await renderScreen({ ui: <Settings />, client })
    await openAdmin()
    await fireEvent.press(await screen.findByRole('button', { name: `Approve ${WAITING.email}` }))
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: HTTP_METHODS.post,
          path: APP_CLIENT_CALLS.setMemberStatus.path.replace(':id', WAITING.id),
          body: { status: MEMBER_STATUSES.approved },
        },
      ]),
    )
  })

  it('shows a member no Admin tab and asks the server for none of it', async () => {
    mockServer.account = { ...OWNER, isOwner: false }
    await renderScreen({ ui: <Settings />, client })
    await waitFor(() =>
      expect(mockServer.heard.map(({ path }) => path).toSorted()).toEqual(
        [APP_CLIENT_CALLS.getMe.path, APP_CLIENT_CALLS.listRequests.path].toSorted(),
      ),
    )
    expect(screen.queryByRole('tab', { name: 'Admin' })).toBeNull()
    expect(screen.queryByRole('header', { name: 'Remote Access' })).toBeNull()
  })
})
