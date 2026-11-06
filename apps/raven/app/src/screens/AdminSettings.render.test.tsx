import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  MEMBER_STATUSES,
  TRANSCODINGS,
  themeOf,
} from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { ActionSheetIOS } from 'react-native'

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
import { pathFor } from '@/test/fixtureFetch'
import { FILMS, NAS } from '@/test/homeServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

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

const writes = () => mockServer.heard.filter(({ method }) => method !== APP_CALL_METHODS.get)

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

  it("shows the owner the web's Admin sections, in its order, beside the theme", async () => {
    await renderScreen({ ui: <Settings />, client })
    await screen.findByRole('header', { name: 'Admin' })
    expect(
      screen
        .getAllByRole('header')
        .map((header) => header.props.children)
        .filter((name) =>
          ['Theme', 'Admin', 'Display', 'Remote Access', 'Library scans', 'Users'].includes(name),
        ),
    ).toEqual(['Theme', 'Admin', 'Display', 'Remote Access', 'Library scans', 'Users'])
    expect(
      screen.getByRole('button', { name: `Theme: ${themeOf(DEFAULT_APP_PREFS.theme).name}` }),
    ).toBeTruthy()
    expect(
      await screen.findByRole('button', { name: 'Server conversion: Remux and transcode' }),
    ).toBeTruthy()
  })

  it('saves a playback setting to the server and shows it at once', async () => {
    answerSheet('Remux only')
    await renderScreen({ ui: <Settings />, client })
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Server conversion: Remux and transcode' }),
    )
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: APP_CALL_METHODS.put,
          path: APP_CLIENT_CALLS.setPlaybackSettings.path,
          body: { transcoding: TRANSCODINGS.remuxOnly },
        },
      ]),
    )
    expect(
      await screen.findByRole('button', { name: 'Server conversion: Remux only' }),
    ).toBeTruthy()
  })

  it("starts a library's quick scan", async () => {
    await renderScreen({ ui: <Settings />, client })
    await fireEvent.press(await screen.findByRole('button', { name: 'Quick scan Films' }))
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: APP_CALL_METHODS.post,
          path: pathFor({ path: APP_CLIENT_CALLS.quickScanLibrary.path, id: FILMS.id }),
          body: undefined,
        },
      ]),
    )
  })

  it('approves an account waiting for it', async () => {
    await renderScreen({ ui: <Settings />, client })
    await fireEvent.press(await screen.findByRole('button', { name: `Approve ${WAITING.email}` }))
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: APP_CALL_METHODS.post,
          path: APP_CLIENT_CALLS.setMemberStatus.path.replace(':id', WAITING.id),
          body: { status: MEMBER_STATUSES.approved },
        },
      ]),
    )
  })

  it('shows a member no Admin and asks the server for none of it, the theme still there', async () => {
    mockServer.account = { ...OWNER, isOwner: false }
    await renderScreen({ ui: <Settings />, client })
    await waitFor(() =>
      expect(mockServer.heard.map(({ path }) => path)).toEqual([APP_CLIENT_CALLS.getMe.path]),
    )
    expect(screen.queryByRole('header', { name: 'Admin' })).toBeNull()
    expect(screen.queryByRole('header', { name: 'Remote Access' })).toBeNull()
    expect(
      screen.getByRole('button', { name: `Theme: ${themeOf(DEFAULT_APP_PREFS.theme).name}` }),
    ).toBeTruthy()
  })
})
