import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { FetchLike } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type * as Headless from '@raven/native/headless'
import { RAVEN_SERVER } from '@raven/native/headless'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import { useAccountSession } from '@/account/session'
import { APP_ROUTES } from '@/routes'
import { SERVERS_COPY } from '@/screens/copy'
import { ServerSettings } from '@/screens/ServerSettings'
import { useActiveServer } from '@/stores/activeServer'
import {
  type AccountData,
  HOME_SERVER_ID,
  MELEYS,
  accountDataOf,
  accountFetchOf,
  meleysRow,
  signInTestAccount,
} from '@/test/accountData'
import { homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

const mockDismissTo = jest.fn()
const mockApiOf = (server: Headless.AppServer) => homeApi(server)
let mockAccount: AccountData = accountDataOf()
const mockAccountFetch: FetchLike = (url, init) => accountFetchOf(mockAccount)(url, init)

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), dismissTo: mockDismissTo }),
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: ({ server }: ApiForProps) => mockApiOf(server),
  openFetch: ((url, init) => mockAccountFetch(url, init)) satisfies FetchLike,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

/** Another server, not yet on the account, which answers its health with its own id. */
const CARAXES_ORIGIN = 'https://caraxes.example'
const CARAXES_ID = '6e7f8091-a2b3-4c4d-9e5f-60718293a4b5'

const serverNames = () => useActiveServer.getState().servers.map(({ name }) => name)

describe("Settings' Servers", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({
      home: RAVEN_SERVER,
      servers: [RAVEN_SERVER],
      activeId: RAVEN_SERVER.id,
      homeServerId: null,
    })
    mockAccount = accountDataOf({ rows: [meleysRow()], health: { [CARAXES_ORIGIN]: CARAXES_ID } })
    signInTestAccount()
  })

  it("reads the account's servers as it opens: home first, in use, then the account's", async () => {
    await renderScreen({ ui: <ServerSettings /> })
    expect(await screen.findByLabelText(`${MELEYS.name}: ${MELEYS.origin}`)).toBeTruthy()
    expect(screen.getByLabelText(`${RAVEN_SERVER.name}: ${RAVEN_SERVER.origin}`)).toBeTruthy()
    expect(
      screen.getByText(SERVERS_COPY.tags([SERVERS_COPY.home, SERVERS_COPY.inUse])),
    ).toBeTruthy()
    expect(serverNames()).toEqual([RAVEN_SERVER.name, MELEYS.name])
    expect(useActiveServer.getState().homeServerId).toBe(HOME_SERVER_ID)
    // Home is the build's own: never renamed or removed here.
    expect(
      screen.queryByRole('button', { name: SERVERS_COPY.renameName(RAVEN_SERVER.name) }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: SERVERS_COPY.renameName(MELEYS.name) })).toBeTruthy()
  })

  it('switches to another server and opens its Home', async () => {
    await renderScreen({ ui: <ServerSettings /> })
    await fireEvent.press(
      await screen.findByRole('button', { name: SERVERS_COPY.switchToName(MELEYS.name) }),
    )
    expect(useActiveServer.getState().activeId).toBe(MELEYS.id)
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it('adds a server by its address once it answers with its id', async () => {
    await renderScreen({ ui: <ServerSettings /> })
    await screen.findByLabelText(`${MELEYS.name}: ${MELEYS.origin}`)
    await fireEvent.changeText(screen.getByLabelText(SERVERS_COPY.address), CARAXES_ORIGIN)
    await fireEvent.press(screen.getByRole('button', { name: SERVERS_COPY.add }))
    expect(await screen.findByLabelText(`caraxes.example: ${CARAXES_ORIGIN}`)).toBeTruthy()
    expect(mockAccount.rows.map(({ serverId }) => serverId)).toContain(CARAXES_ID)
  })

  it('refuses a server already on the list, and one that does not answer, saying why', async () => {
    await renderScreen({ ui: <ServerSettings /> })
    await screen.findByLabelText(`${MELEYS.name}: ${MELEYS.origin}`)
    const field = screen.getByLabelText(SERVERS_COPY.address)
    await fireEvent.changeText(field, MELEYS.origin)
    await fireEvent.press(screen.getByRole('button', { name: SERVERS_COPY.add }))
    expect(await screen.findByText(SERVERS_COPY.problems.listed)).toBeTruthy()
    await fireEvent.changeText(field, 'https://quiet.example')
    await fireEvent.press(screen.getByRole('button', { name: SERVERS_COPY.add }))
    expect(await screen.findByText(SERVERS_COPY.problems.unreachable)).toBeTruthy()
    expect(mockAccount.rows).toHaveLength(1)
  })

  it("renames one of the account's servers", async () => {
    await renderScreen({ ui: <ServerSettings /> })
    await fireEvent.press(
      await screen.findByRole('button', { name: SERVERS_COPY.renameName(MELEYS.name) }),
    )
    await fireEvent.changeText(screen.getByLabelText(SERVERS_COPY.newName), 'Attic')
    await fireEvent.press(screen.getByRole('button', { name: SERVERS_COPY.save }))
    expect(await screen.findByLabelText(`Attic: ${MELEYS.origin}`)).toBeTruthy()
    expect(mockAccount.rows[0]?.name).toBe('Attic')
  })

  it('removes the server in use and goes back home', async () => {
    await renderScreen({ ui: <ServerSettings /> })
    await screen.findByLabelText(`${MELEYS.name}: ${MELEYS.origin}`)
    useActiveServer.getState().activate(MELEYS.id)
    await fireEvent.press(
      await screen.findByRole('button', { name: SERVERS_COPY.removeName(MELEYS.name) }),
    )
    await waitFor(() => expect(serverNames()).toEqual([RAVEN_SERVER.name]))
    expect(useActiveServer.getState().activeId).toBe(RAVEN_SERVER.id)
    expect(mockAccount.rows).toEqual([])
  })

  it('goes back home when the server in use has left the account on another device', async () => {
    useActiveServer.setState({ servers: [RAVEN_SERVER, MELEYS], activeId: MELEYS.id })
    mockAccount.rows = []
    await renderScreen({ ui: <ServerSettings /> })
    await waitFor(() => expect(useActiveServer.getState().activeId).toBe(RAVEN_SERVER.id))
    expect(serverNames()).toEqual([RAVEN_SERVER.name])
  })

  it('asks for a sign-in before the list can change', async () => {
    useAccountSession.setState({ session: null })
    await renderScreen({ ui: <ServerSettings /> })
    expect(await screen.findByText(SERVERS_COPY.signInToAdd)).toBeTruthy()
    expect(screen.queryByLabelText(SERVERS_COPY.address)).toBeNull()
  })
})
