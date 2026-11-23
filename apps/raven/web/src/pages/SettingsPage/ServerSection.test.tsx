import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  CHECK_OUTCOMES,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  ENCODER_KINDS,
  HEALTH_STATUSES,
  METADATA_SERVICE_STATES,
  SERVERS_CAP,
  type ServerHealth,
  type ServerId,
  URL_PROTOCOLS,
  serverNameFor,
} from '@raven/core'
import { useActiveServer } from '@raven/ui/headless'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { apiAt } from '@/lib/api'
import { accountDataFor } from '@/lib/accountData'
import { ADD_PROBLEMS, checkNewServer } from '@/lib/servers'
import { ServerSection } from '@/pages/SettingsPage/ServerSection'
import { HOME_ID, fakeAccount, readyConfig } from '@/test/authClient'
import { asDesktop, fakeClient } from '@/test/desktop'
import { renderWithProviders } from '@/test/render'
import { MELEYS_ID, MELEYS_ORIGIN, homeEntry, meleysEntry, meleysRow } from '@/test/servers'

const VERMITHOR_ORIGIN = 'https://vermithor.example'

const VERMITHOR_ID = '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5'

type HealthOfProps = {
  /** Left out for a server too old to have one. */
  serverId?: ServerId
}

const healthOf = ({ serverId }: HealthOfProps): ServerHealth => ({
  status: HEALTH_STATUSES.ok,
  ffmpeg: '7.1',
  tonemap: true,
  encoder: ENCODER_KINDS.software,
  thumbnailsPending: 0,
  metadata: {
    tmdb: METADATA_SERVICE_STATES.ok,
    omdb: METADATA_SERVICE_STATES.off,
    mdblist: METADATA_SERVICE_STATES.off,
    pending: 0,
    error: null,
    lastOk: null,
    ai: METADATA_SERVICE_STATES.off,
    aiRemaining: 0,
    aiPending: 0,
  },
  ...(serverId === undefined ? {} : { serverId }),
})

// One spy for both suites: a second on the same method would be undone with the first.
const health = spyOn(apiAt(VERMITHOR_ORIGIN), 'getServerHealth')

afterAll(() => health.mockRestore())

const region = () => screen.getByRole('region', { name: 'Servers' })
const list = () => within(region()).getByRole('list', { name: 'Your servers' })

describe('ServerSection', () => {
  const accountData = accountDataFor(readyConfig)
  const spies = {
    list: spyOn(accountData, 'listServers'),
    add: spyOn(accountData, 'addServer'),
    rename: spyOn(accountData, 'renameServer'),
    remove: spyOn(accountData, 'removeServer'),
    health,
  }

  beforeEach(() => {
    spies.list.mockImplementation(async () => [meleysRow()])
    spies.add.mockImplementation(async () => meleysRow())
    spies.rename.mockImplementation(async () => meleysRow())
    spies.remove.mockImplementation(async () => undefined)
    spies.health.mockImplementation(async () => healthOf({ serverId: VERMITHOR_ID }))
  })

  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  afterAll(() =>
    [spies.list, spies.add, spies.rename, spies.remove].forEach((spy) => spy.mockRestore()),
  )

  it("names the home server and links its address, this page's own when /api is raven, with accounts off", () => {
    renderWithProviders({ ui: <ServerSection /> })
    const origin = window.location.origin
    const home = within(list()).getByRole('listitem')
    expect(within(home).getByText(serverNameFor(origin))).toBeInTheDocument()
    expect(within(home).getByRole('link', { name: origin })).toHaveAttribute('href', origin)
    expect(within(home).getByText('Home')).toBeInTheDocument()
    expect(within(home).getByText('In use')).toBeInTheDocument()
    expect(within(region()).getByText(/Sign in to keep more servers/)).toBeInTheDocument()
    expect(within(region()).queryByRole('button', { name: 'Add server' })).toBeNull()
  })

  it("lists the account's servers after the home one, and switches to one", async () => {
    renderWithProviders({ ui: <ServerSection />, account: fakeAccount() })
    const meleys = await within(list()).findByText('Meleys')
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2)
    expect(meleys).toBeInTheDocument()
    expect(within(list()).queryByRole('button', { name: `Rename ${homeEntry().name}` })).toBeNull()
    await userEvent.click(within(list()).getByRole('button', { name: 'Use Meleys' }))
    expect(useActiveServer.getState().active).toEqual({
      serverId: MELEYS_ID,
      origin: MELEYS_ORIGIN,
    })
    await waitFor(() =>
      expect(within(list()).getByRole('button', { name: `Use ${homeEntry().name}` })).toBeEnabled(),
    )
  })

  it('adds a server by its address once it answers with its id, named after its address', async () => {
    renderWithProviders({ ui: <ServerSection />, account: fakeAccount() })
    await userEvent.type(
      within(region()).getByRole('textbox', { name: 'Server address' }),
      'HTTPS://Vermithor.example:443/',
    )
    await userEvent.click(within(region()).getByRole('button', { name: 'Add server' }))
    await waitFor(() =>
      expect(spies.add).toHaveBeenCalledWith({
        serverId: VERMITHOR_ID,
        name: serverNameFor(VERMITHOR_ORIGIN),
        origin: VERMITHOR_ORIGIN,
      }),
    )
    await waitFor(() =>
      expect(within(region()).getByRole('textbox', { name: 'Server address' })).toHaveValue(''),
    )
  })

  it("inside Raven, has main read a new server's health, since the page may call no other origin", async () => {
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.checkServer
          ? { type: DESKTOP_REPLIES.server, serverId: VERMITHOR_ID }
          : { type: DESKTOP_REPLIES.done },
    })
    asDesktop(client)
    renderWithProviders({ ui: <ServerSection />, account: fakeAccount() })
    expect(within(list()).getByText('raven')).toBeInTheDocument()
    await userEvent.type(
      within(region()).getByRole('textbox', { name: 'Server address' }),
      VERMITHOR_ORIGIN,
    )
    await userEvent.click(within(region()).getByRole('button', { name: 'Add server' }))
    await waitFor(() =>
      expect(spies.add).toHaveBeenCalledWith({
        serverId: VERMITHOR_ID,
        name: serverNameFor(VERMITHOR_ORIGIN),
        origin: VERMITHOR_ORIGIN,
      }),
    )
    expect(spies.health).not.toHaveBeenCalled()
    expect(client.request).toHaveBeenCalledWith({
      type: DESKTOP_REQUESTS.checkServer,
      origin: VERMITHOR_ORIGIN,
    })
  })

  it('says why it refuses a server too old to have an id, adding nothing', async () => {
    spies.health.mockImplementation(async () => healthOf({}))
    renderWithProviders({ ui: <ServerSection />, account: fakeAccount() })
    await userEvent.type(
      within(region()).getByRole('textbox', { name: 'Server address' }),
      VERMITHOR_ORIGIN,
    )
    await userEvent.click(within(region()).getByRole('button', { name: 'Add server' }))
    expect(await within(region()).findByRole('alert')).toHaveTextContent(/too old/)
    expect(spies.add).not.toHaveBeenCalled()
  })

  it('renames one of the account servers, tidying the name', async () => {
    renderWithProviders({ ui: <ServerSection />, account: fakeAccount() })
    await userEvent.click(await within(list()).findByRole('button', { name: 'Rename Meleys' }))
    const field = within(list()).getByRole('textbox', { name: 'New name' })
    await userEvent.clear(field)
    await userEvent.type(field, '  Meleys  upstairs ')
    await userEvent.click(within(list()).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(spies.rename).toHaveBeenCalledWith({ id: meleysRow().id, name: 'Meleys upstairs' }),
    )
  })

  it('refuses a blank name without asking the database', async () => {
    renderWithProviders({ ui: <ServerSection />, account: fakeAccount() })
    await userEvent.click(await within(list()).findByRole('button', { name: 'Rename Meleys' }))
    await userEvent.clear(within(list()).getByRole('textbox', { name: 'New name' }))
    await userEvent.click(within(list()).getByRole('button', { name: 'Save' }))
    expect(await within(list()).findByRole('alert')).toHaveTextContent(/1 to 80 characters/)
    expect(spies.rename).not.toHaveBeenCalled()
  })

  it('removes the server in use after going home', async () => {
    useActiveServer.getState().choose({ serverId: MELEYS_ID, origin: MELEYS_ORIGIN })
    renderWithProviders({ ui: <ServerSection />, account: fakeAccount() })
    await userEvent.click(await within(list()).findByRole('button', { name: 'Remove Meleys' }))
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith({ id: meleysRow().id }))
    expect(useActiveServer.getState().active).toBeNull()
  })
})

describe('checkNewServer', () => {
  const servers = [{ ...homeEntry(), serverId: HOME_ID }, meleysEntry()]
  afterEach(() => health.mockReset())

  it('refuses what is no server address', async () => {
    expect(await checkNewServer({ address: 'not a server', servers })).toEqual({
      kind: CHECK_OUTCOMES.refused,
      problem: ADD_PROBLEMS.address,
    })
  })

  it('refuses an http server from an https page, which the browser would refuse without a word', async () => {
    expect(
      await checkNewServer({
        address: 'http://nas:8484',
        servers,
        pageProtocol: URL_PROTOCOLS.https,
      }),
    ).toEqual({ kind: CHECK_OUTCOMES.refused, problem: ADD_PROBLEMS.needsHttps })
  })

  it('refuses a server already listed, by its address or by the id it answers with', async () => {
    expect(await checkNewServer({ address: MELEYS_ORIGIN, servers })).toEqual({
      kind: CHECK_OUTCOMES.refused,
      problem: ADD_PROBLEMS.listed,
    })
    health.mockImplementation(async () => healthOf({ serverId: MELEYS_ID }))
    expect(await checkNewServer({ address: VERMITHOR_ORIGIN, servers })).toEqual({
      kind: CHECK_OUTCOMES.refused,
      problem: ADD_PROBLEMS.listed,
    })
  })

  it('refuses a server that does not answer', async () => {
    health.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await checkNewServer({ address: VERMITHOR_ORIGIN, servers })).toEqual({
      kind: CHECK_OUTCOMES.refused,
      problem: ADD_PROBLEMS.unreachable,
    })
  })

  it('refuses one more server once the list is full', async () => {
    const full = Array.from({ length: SERVERS_CAP + 1 }, () => meleysEntry()).map(
      (entry, index) => ({
        ...entry,
        origin: `https://server-${index}.example`,
      }),
    )
    expect(await checkNewServer({ address: VERMITHOR_ORIGIN, servers: full })).toEqual({
      kind: CHECK_OUTCOMES.refused,
      problem: ADD_PROBLEMS.full,
    })
  })
})
