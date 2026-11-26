import { describe, expect, it } from 'bun:test'
import {
  ACCOUNT_COLUMNS,
  ACCOUNT_TABLES,
  AUTH_CONFIG_STATES,
  AUTH_COOKIE,
  AUTH_PATHS,
  AUTH_SCHEME,
  CHECK_OUTCOMES,
  type AccountServer,
  type FetchInit,
  type FetchLike,
  POSTGREST,
  type ServerName,
  ROUTES,
  SERVERS_CAP,
} from '@raven/core'
import { HEADERS, HTTP_METHODS, HTTP_STATUSES } from '@shared/http'

import {
  ADD_PROBLEMS,
  RENAME_OUTCOMES,
  SYNC_OUTCOMES,
  accountServersFor,
} from '@/servers/accountServers'
import { activePinServerIdOf, createActiveServerStore } from '@/servers/activeServerStore'
import { checkNewServer } from '@/servers/newServerCheck'
import { type AppServer, pinServerIdOf } from '@/servers/serverList'
import { responseOf } from '@/test/fixtureFetch'
import { memoryStore } from '@/test/memoryStore'
import { healthOf } from '@/test/serverHealth'

const HOME: AppServer = {
  id: '7c1f4e2a-3b5d-4a6e-8f90-1a2b3c4d5e6f',
  name: 'raven',
  origin: 'https://home.example',
  addedAt: 0,
}

const HOME_SERVER_ID = '3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d'
const MELEYS_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const MELEYS_ORIGIN = 'https://meleys.example:8443'
const SUPABASE = 'https://project.supabase.co'

const READY_CONFIG = {
  state: AUTH_CONFIG_STATES.ready,
  serverId: HOME_SERVER_ID,
  supabaseUrl: SUPABASE,
  publishableKey: 'sb_publishable_x',
  webUrl: 'https://raven.example',
  cookieName: AUTH_COOKIE,
}

const MELEYS_ROW: AccountServer = {
  id: '9b2d3f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  serverId: MELEYS_ID,
  name: 'Meleys',
  origin: MELEYS_ORIGIN,
  addedAt: '2026-11-23T10:00:00.000Z',
}

type Call = { url: string; init: FetchInit }

type FakeFetchProps = {
  config?: unknown
  rows?: () => AccountServer[]
  /** The names the account gave servers it keeps no row for. */
  names?: () => ServerName[]
  health?: Record<string, unknown>
}

/** A fetch that answers home's auth config, servers' health and the account's servers and names, and logs every call. */
const fakeFetch = ({
  config = READY_CONFIG,
  rows = () => [],
  names = () => [],
  health = {},
}: FakeFetchProps) => {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init = {}) => {
    calls.push({ url, init })
    if (url === `${HOME.origin}${AUTH_PATHS.config}`) {
      return responseOf({ status: HTTP_STATUSES.ok, body: config })
    }
    if (url.endsWith(ROUTES.getServerHealth.path)) {
      const origin = url.slice(0, -ROUTES.getServerHealth.path.length)
      const body = health[origin]
      if (body === undefined) throw new TypeError('Network request failed')
      return responseOf({ status: HTTP_STATUSES.ok, body })
    }
    if (url.startsWith(SUPABASE) && url.includes(`/${ACCOUNT_TABLES.serverNames}`)) {
      const isWrite = (init.method ?? HTTP_METHODS.get) !== HTTP_METHODS.get
      const written = JSON.parse(isWrite ? (init.body ?? '{}') : '{}')
      return responseOf({
        status: isWrite ? HTTP_STATUSES.created : HTTP_STATUSES.ok,
        body: isWrite
          ? [{ serverId: written[ACCOUNT_COLUMNS.serverId], name: written[ACCOUNT_COLUMNS.name] }]
          : names(),
      })
    }
    if (url.startsWith(SUPABASE)) {
      const isWrite = (init.method ?? HTTP_METHODS.get) !== HTTP_METHODS.get
      return responseOf({
        status: isWrite ? HTTP_STATUSES.created : HTTP_STATUSES.ok,
        body: isWrite ? [MELEYS_ROW] : rows(),
      })
    }
    return responseOf({ status: HTTP_STATUSES.notFound, body: null })
  }
  return { fetch, calls }
}

const NO_REFRESH = async (): Promise<string | null> => null

const SIGNED_IN = { session: { accessToken: 'token', userId: 'user' }, refresh: NO_REFRESH }

const SIGNED_OUT = { session: null, refresh: NO_REFRESH }

type AccountOfProps = FakeFetchProps & { isSignedIn?: boolean }

const accountOf = ({ isSignedIn = true, ...answers }: AccountOfProps = {}) => {
  const servers = createActiveServerStore({
    store: memoryStore().store,
    jar: { forget: async () => {} },
    home: HOME,
  })
  const { fetch, calls } = fakeFetch(answers)
  const session = { getState: () => (isSignedIn ? SIGNED_IN : SIGNED_OUT) }
  return { servers, calls, account: accountServersFor({ servers, session, fetch }) }
}

describe('accountServersFor', () => {
  it("lists the account's servers after home, under their own ids, with the account's token", async () => {
    const { servers, calls, account } = accountOf({ rows: () => [MELEYS_ROW] })
    expect(await account.sync()).toBe(SYNC_OUTCOMES.followed)
    expect(servers.getState()).toMatchObject({
      servers: [HOME, { id: MELEYS_ID, name: 'Meleys', origin: MELEYS_ORIGIN }],
      homeServerId: HOME_SERVER_ID,
    })
    const listing = calls.find(({ url }) => url.startsWith(SUPABASE))
    expect(listing?.init.headers ?? {}).toMatchObject({
      [HEADERS.authorization]: `${AUTH_SCHEME} token`,
    })
  })

  it('renews a token the database refuses as expired and asks again, so a launch after an hour away still reads the account', async () => {
    const servers = createActiveServerStore({
      store: memoryStore().store,
      jar: { forget: async () => {} },
      home: HOME,
    })
    const fresh = `${AUTH_SCHEME} fresh`
    const tokens: unknown[] = []
    const fetch: FetchLike = async (url, init = {}) => {
      if (url === `${HOME.origin}${AUTH_PATHS.config}`) {
        return responseOf({ status: HTTP_STATUSES.ok, body: READY_CONFIG })
      }
      const token = init.headers?.[HEADERS.authorization]
      tokens.push(token)
      return token === fresh
        ? responseOf({ status: HTTP_STATUSES.ok, body: [MELEYS_ROW] })
        : responseOf({ status: HTTP_STATUSES.unauthorized, body: { message: 'JWT expired' } })
    }
    const session = { getState: () => ({ ...SIGNED_IN, refresh: async () => 'fresh' }) }
    const account = accountServersFor({ servers, session, fetch })
    expect(await account.sync()).toBe(SYNC_OUTCOMES.followed)
    // The servers and their names are read together, and each read renews the token it was refused.
    expect(tokens).toEqual([`${AUTH_SCHEME} token`, `${AUTH_SCHEME} token`, fresh, fresh])
    expect(servers.getState().servers).toMatchObject([HOME, { id: MELEYS_ID }])
  })

  it('goes home when the server in use is no longer on the account', async () => {
    let rows = [MELEYS_ROW]
    const { servers, account } = accountOf({ rows: () => rows })
    await account.sync()
    servers.getState().activate(MELEYS_ID)
    rows = []
    await account.sync()
    expect(servers.getState()).toMatchObject({ servers: [HOME], activeId: HOME.id })
  })

  it('keeps the list as it was while the database does not answer', async () => {
    const { servers, account } = accountOf({ rows: () => [MELEYS_ROW] })
    await account.sync()
    servers.getState().activate(MELEYS_ID)
    const offline = accountServersFor({
      servers,
      session: { getState: () => SIGNED_IN },
      fetch: async () => {
        throw new TypeError('Network request failed')
      },
    })
    expect(await offline.sync()).toBe(SYNC_OUTCOMES.unreachable)
    expect(servers.getState().activeId).toBe(MELEYS_ID)
  })

  it('keeps the list while no one is signed in', async () => {
    const { calls, account } = accountOf({ isSignedIn: false })
    expect(await account.sync()).toBe(SYNC_OUTCOMES.signedOut)
    expect(calls.some(({ url }) => url.startsWith(SUPABASE))).toBe(false)
  })

  it('lists home alone, and goes there, with accounts off', async () => {
    const { servers, account } = accountOf({ rows: () => [MELEYS_ROW] })
    await account.sync()
    servers.getState().activate(MELEYS_ID)
    const off = accountServersFor({
      servers,
      session: { getState: () => SIGNED_IN },
      fetch: fakeFetch({ config: { state: AUTH_CONFIG_STATES.off } }).fetch,
    })
    expect(await off.sync()).toBe(SYNC_OUTCOMES.accountsOff)
    expect(servers.getState()).toMatchObject({ servers: [HOME], activeId: HOME.id })
  })

  it('adds a server by its address once its health names it, then lists it', async () => {
    let rows: AccountServer[] = []
    const { servers, calls, account } = accountOf({
      rows: () => rows,
      health: { [MELEYS_ORIGIN]: healthOf(MELEYS_ID) },
    })
    await account.sync()
    rows = [MELEYS_ROW]
    expect(await account.add(MELEYS_ORIGIN)).toBeNull()
    const write = calls.find(({ init }) => init.method === HTTP_METHODS.post)
    expect(JSON.parse(write?.init.body ?? '{}')).toEqual({
      [ACCOUNT_COLUMNS.serverId]: MELEYS_ID,
      [ACCOUNT_COLUMNS.name]: 'meleys.example:8443',
      [ACCOUNT_COLUMNS.origin]: MELEYS_ORIGIN,
    })
    expect(servers.getState().servers.map(({ id }) => id)).toEqual([HOME.id, MELEYS_ID])
  })

  it('refuses to add while no one is signed in', async () => {
    const { account } = accountOf({ isSignedIn: false })
    expect(await account.add(MELEYS_ORIGIN)).toBe(ADD_PROBLEMS.signedOut)
  })

  it('renames by the row, with the name tidied, and refuses a name that will not do', async () => {
    const { calls, account } = accountOf({ rows: () => [MELEYS_ROW] })
    await account.sync()
    expect(await account.rename({ id: MELEYS_ID, name: '' })).toBe(RENAME_OUTCOMES.badName)
    expect(await account.rename({ id: MELEYS_ID, name: '  Attic ' })).toBe(RENAME_OUTCOMES.renamed)
    const patch = calls.find(({ init }) => init.method === HTTP_METHODS.patch)
    expect(patch?.url ?? '').toContain(`${ACCOUNT_COLUMNS.id}=${POSTGREST.equals}${MELEYS_ROW.id}`)
    expect(JSON.parse(patch?.init.body ?? '{}')).toEqual({ [ACCOUNT_COLUMNS.name]: 'Attic' })
  })

  it("wears the account's name for home, and lets it go once the account has none", async () => {
    let names: ServerName[] = [{ serverId: HOME_SERVER_ID, name: 'Vhagar' }]
    const { servers, account } = accountOf({ rows: () => [MELEYS_ROW], names: () => names })
    await account.sync()
    expect(servers.getState().servers[0]).toEqual({ ...HOME, name: 'Vhagar' })
    names = []
    await account.sync()
    expect(servers.getState().servers[0]).toEqual(HOME)
  })

  it('renames home by its own id on the account, so every device wears the name', async () => {
    let names: ServerName[] = []
    const { servers, calls, account } = accountOf({ names: () => names })
    await account.sync()
    const renaming = account.rename({ id: HOME.id, name: '  Vhagar ' })
    names = [{ serverId: HOME_SERVER_ID, name: 'Vhagar' }]
    expect(await renaming).toBe(RENAME_OUTCOMES.renamed)
    const upsert = calls.find(
      ({ url, init }) =>
        url.includes(`/${ACCOUNT_TABLES.serverNames}`) && init.method === HTTP_METHODS.post,
    )
    expect(JSON.parse(upsert?.init.body ?? '{}')).toEqual({
      [ACCOUNT_COLUMNS.serverId]: HOME_SERVER_ID,
      [ACCOUNT_COLUMNS.name]: 'Vhagar',
    })
    expect(servers.getState().home.name).toBe('Vhagar')
  })

  it('keeps no name while there is no account to keep it', async () => {
    const { account } = accountOf({ isSignedIn: false })
    await account.sync()
    expect(await account.rename({ id: HOME.id, name: 'Vhagar' })).toBe(RENAME_OUTCOMES.noAccount)
  })

  it('removes by the row, going home first when it is the one in use', async () => {
    let rows = [MELEYS_ROW]
    const { servers, calls, account } = accountOf({ rows: () => rows })
    await account.sync()
    servers.getState().activate(MELEYS_ID)
    rows = []
    await account.remove(MELEYS_ID)
    expect(calls.some(({ init }) => init.method === HTTP_METHODS.delete)).toBe(true)
    expect(servers.getState()).toMatchObject({ servers: [HOME], activeId: HOME.id })
  })

  it('lists no pins while there is no account to ask, and keeps none', async () => {
    const { account } = accountOf({ isSignedIn: false })
    expect(await account.listPins()).toEqual([])
    await expect(
      account.setPin({ serverId: MELEYS_ID, libraryId: 3, shouldPin: true }),
    ).rejects.toThrow()
  })
})

describe('checkNewServer', () => {
  const health = (body: unknown): FetchLike =>
    fakeFetch({ health: { [MELEYS_ORIGIN]: body } }).fetch

  it('reads the address and confirms its id', async () => {
    expect(
      await checkNewServer({
        address: MELEYS_ORIGIN,
        servers: [HOME],
        home: HOME,
        homeServerId: HOME_SERVER_ID,
        fetch: health(healthOf(MELEYS_ID)),
      }),
    ).toEqual({ kind: CHECK_OUTCOMES.ready, serverId: MELEYS_ID, origin: MELEYS_ORIGIN })
  })

  it.each([
    ['no origin', 'not an address', {}, ADD_PROBLEMS.address],
    ['home again', MELEYS_ORIGIN, healthOf(HOME_SERVER_ID), ADD_PROBLEMS.listed],
    ['no answer', 'https://quiet.example', {}, ADD_PROBLEMS.unreachable],
    ['too old', MELEYS_ORIGIN, healthOf(), ADD_PROBLEMS.tooOld],
  ])('refuses %s', async (_, address, body, problem) => {
    const outcome = await checkNewServer({
      address,
      servers: [HOME],
      home: HOME,
      homeServerId: HOME_SERVER_ID,
      fetch: health(body),
    })
    expect(outcome).toEqual({ kind: CHECK_OUTCOMES.refused, problem })
  })

  it('refuses an address already listed, and a full list', async () => {
    const listed = { ...HOME, id: MELEYS_ID, origin: MELEYS_ORIGIN }
    const fetch = health(healthOf(MELEYS_ID))
    expect(
      await checkNewServer({
        address: MELEYS_ORIGIN,
        servers: [HOME, listed],
        home: HOME,
        homeServerId: null,
        fetch,
      }),
    ).toEqual({ kind: CHECK_OUTCOMES.refused, problem: ADD_PROBLEMS.listed })
    const full = Array.from({ length: SERVERS_CAP + 1 }, (_, n) => ({
      ...HOME,
      origin: `https://s${n}.example`,
    }))
    expect(
      await checkNewServer({
        address: MELEYS_ORIGIN,
        servers: full,
        home: HOME,
        homeServerId: null,
        fetch,
      }),
    ).toEqual({ kind: CHECK_OUTCOMES.refused, problem: ADD_PROBLEMS.full })
  })
})

describe('pinServerIdOf', () => {
  it("keys a pin on home by home's own id, and on another server by its list id", () => {
    const meleys = { ...HOME, id: MELEYS_ID }
    expect(pinServerIdOf({ server: HOME, home: HOME, homeServerId: HOME_SERVER_ID })).toBe(
      HOME_SERVER_ID,
    )
    expect(pinServerIdOf({ server: HOME, home: HOME, homeServerId: null })).toBeNull()
    expect(pinServerIdOf({ server: meleys, home: HOME, homeServerId: null })).toBe(MELEYS_ID)
  })
})

describe('activePinServerIdOf', () => {
  it("keys on home's own id while home is in use, and on the server's id once another is", async () => {
    const { servers, account } = accountOf({ rows: () => [MELEYS_ROW] })
    await account.sync()
    expect(activePinServerIdOf(servers.getState())).toBe(HOME_SERVER_ID)
    servers.getState().activate(MELEYS_ID)
    expect(activePinServerIdOf(servers.getState())).toBe(MELEYS_ID)
  })
})
