import {
  AUTH_CONFIG_STATES,
  AUTH_PATHS,
  type AccountDataClient,
  type AccountServer,
  type AuthConfig,
  CHECK_OUTCOMES,
  type FetchLike,
  type LibraryPin,
  SERVER_CHECK_PROBLEMS,
  type ServerId,
  createAccountDataClient,
  isAuthConfig,
  renamedServers,
  serverNameFor,
} from '@raven/core'

import { refreshingFetch } from '@/account/refreshingFetch'
import type { ActiveServerStore } from '@/servers/activeServerStore'
import { checkNewServer, openRead } from '@/servers/newServerCheck'
import { appServerOf } from '@/servers/serverList'

/** Who is signed in, as the account's calls need it: their token, their id and a new token once that one ends. */
type AccountReader = {
  getState: () => {
    session: { accessToken: string; userId: string } | null
    refresh: () => Promise<string | null>
  }
}

type AccountServersForProps = {
  servers: Pick<ActiveServerStore, 'getState'>
  session: AccountReader
  /** A `fetch` that leaves the system's cookies alone, as every call of the app's does. */
  fetch: FetchLike
}

/** How a read of the account's list ended. */
export const SYNC_OUTCOMES = {
  /** The list is the account's, as its database has it now. */
  followed: 'followed',
  /** Accounts are off on the home server, so home is the only server. */
  accountsOff: 'accountsOff',
  /** No one is signed in, so the list stays as it was. */
  signedOut: 'signedOut',
  /** Home or the database did not answer, so the list stays as it was. */
  unreachable: 'unreachable',
} as const

export type SyncOutcome = (typeof SYNC_OUTCOMES)[keyof typeof SYNC_OUTCOMES]

/**
 * Why a new server was not added: core's reasons for refusing an address (the web's https one
 * aside, which a device has no page to need), or no account to add it to.
 */
export const ADD_PROBLEMS = { ...SERVER_CHECK_PROBLEMS, signedOut: 'signedOut' } as const

export type AddProblem = (typeof ADD_PROBLEMS)[keyof typeof ADD_PROBLEMS]

type RenameProps = { id: string; name: string }

type SetPinProps = { serverId: ServerId; libraryId: number; shouldPin: boolean }

/** How a rename ended: done, or refused because `renamedServers` would not take the name. */
export const RENAME_OUTCOMES = { renamed: 'renamed', badName: 'badName' } as const

export type RenameOutcome = (typeof RENAME_OUTCOMES)[keyof typeof RENAME_OUTCOMES]

/** Home's auth config as last read, and the database's client while accounts are on. */
type HomeConfig = { config: AuthConfig; client: AccountDataClient | null }

/**
 * The account's servers, kept in its Supabase database (`createAccountDataClient`), for an app
 * whose home is `RAVEN_SERVER`: the database's address and key come from home's open auth
 * config, which also names home's own id, and the account's token from `session`. `sync` reads
 * the account's list into `servers` (`follow`), so the app lists home and the account's others,
 * and goes home when the server in use has left the account. Adding checks the address first
 * (`checkNewServer`); a change reads the list again. Wren and the device app share it.
 */
export const accountServersFor = ({ servers, session, fetch }: AccountServersForProps) => {
  const { home } = servers.getState()
  let homeConfig: Promise<HomeConfig | null> | null = null
  let rows: readonly AccountServer[] = []

  // A config that did not answer is asked for again next time; one that did is kept, client and all.
  const homeConfigNow = (): Promise<HomeConfig | null> => {
    homeConfig ??= openRead({ url: `${home.origin}${AUTH_PATHS.config}`, fetch }).then((body) => {
      if (!isAuthConfig(body)) {
        homeConfig = null
        return null
      }
      const client =
        body.state === AUTH_CONFIG_STATES.ready
          ? createAccountDataClient({
              supabaseUrl: body.supabaseUrl,
              publishableKey: body.publishableKey,
              accessToken: async () => session.getState().session?.accessToken ?? null,
              /*
               * An app opened after an hour away still holds its last token, which the database
               * refuses, and nothing asks for the servers or the pins again once the timer has
               * renewed it: the refused call renews it itself and goes again.
               */
              fetch: refreshingFetch({ fetch, refresh: () => session.getState().refresh() }),
            })
          : null
      return { config: body, client }
    })
    return homeConfig
  }

  /** The database's client, or null while accounts are off, home is out of reach or no one is signed in. */
  const accountData = async (): Promise<AccountDataClient | null> => {
    if (session.getState().session === null) return null
    return (await homeConfigNow())?.client ?? null
  }

  const sync = async (): Promise<SyncOutcome> => {
    const read = await homeConfigNow()
    if (read === null) return SYNC_OUTCOMES.unreachable
    const { config, client } = read
    const homeServerId = config.serverId ?? null
    if (config.state === AUTH_CONFIG_STATES.unavailable) return SYNC_OUTCOMES.unreachable
    if (client === null) {
      rows = []
      await servers.getState().follow({ servers: [], homeServerId })
      return SYNC_OUTCOMES.accountsOff
    }
    if (session.getState().session === null) return SYNC_OUTCOMES.signedOut
    try {
      rows = await client.listServers()
    } catch {
      return SYNC_OUTCOMES.unreachable
    }
    await servers.getState().follow({ servers: rows.map(appServerOf), homeServerId })
    return SYNC_OUTCOMES.followed
  }

  const rowIdOf = (serverId: string): string | null =>
    rows.find((row) => row.serverId === serverId)?.id ?? null

  return {
    sync,

    /** The account's pins on every server, none while there is no account to ask. */
    listPins: async (): Promise<LibraryPin[]> => (await accountData())?.listPins() ?? [],

    /** Pins a library on a server for the account, or unpins it; throws while there is no account to keep it. */
    setPin: async ({ serverId, libraryId, shouldPin }: SetPinProps): Promise<void> => {
      const client = await accountData()
      if (client === null) throw new Error('There is no account to keep the pin for.')
      await (shouldPin
        ? client.pinLibrary({ serverId, libraryId })
        : client.unpinLibrary({ serverId, libraryId }))
    },

    /** Adds the server at `address` to the account, named after its address, and reads the list again. */
    add: async (address: string): Promise<AddProblem | null> => {
      const client = await accountData()
      if (client === null) return ADD_PROBLEMS.signedOut
      const { servers: known, homeServerId } = servers.getState()
      const check = await checkNewServer({ address, servers: known, home, homeServerId, fetch })
      if (check.kind === CHECK_OUTCOMES.refused) return check.problem
      await client.addServer({
        serverId: check.serverId,
        name: serverNameFor(check.origin),
        origin: check.origin,
      })
      await sync()
      return null
    },

    /** Gives one of the account's servers the name typed, tidied as every client's list renames. */
    rename: async ({ id, name }: RenameProps): Promise<RenameOutcome> => {
      const client = await accountData()
      const rowId = rowIdOf(id)
      const renamed = renamedServers({ servers: servers.getState().servers, id, name })
      const cleaned = renamed?.find((server) => server.id === id)?.name ?? null
      if (client === null || rowId === null || cleaned === null) return RENAME_OUTCOMES.badName
      await client.renameServer({ id: rowId, name: cleaned })
      await sync()
      return RENAME_OUTCOMES.renamed
    },

    /** Takes a server off the account, and its pins with it; the one in use goes home first. */
    remove: async (id: string): Promise<void> => {
      const client = await accountData()
      const rowId = rowIdOf(id)
      if (client === null || rowId === null) return
      const { activeId, activate } = servers.getState()
      if (activeId === id) activate(home.id)
      await client.removeServer({ id: rowId })
      await sync()
    },
  }
}
