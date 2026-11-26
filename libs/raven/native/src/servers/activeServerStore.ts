import { type ServerId, cleanName, isRecord, isServerId, isString } from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { CookieJar } from '@/servers/cookieJar'
import { type SecretStore, secretStateStorage } from '@/servers/secretStore'
import {
  ADD_OUTCOMES,
  type AddOutcome,
  type AppServer,
  addServer,
  listedWith,
  pinServerIdOf,
  storedServersOf,
} from '@/servers/serverList'

type FollowProps = {
  /** The account's other servers, as its database lists them, home or not. */
  servers: readonly AppServer[]
  /** The home server's own id, which a row naming it is left out by; null for one too old to say. */
  homeServerId: ServerId | null
  /** The name the account gave the home server, null for none, which wears the build's own. */
  homeName: string | null
}

type ActiveServerState = {
  /** The server the app was built for, always first on the list and never removed, under the account's name for it. */
  home: AppServer
  /** Home first, then the account's other servers in the order they were added. */
  servers: AppServer[]
  activeId: string
  /** The home server's own id, as its auth config names it: what a pin on it keys on. */
  homeServerId: ServerId | null
  /** The name the account gave the home server, kept so a launch away from the network still wears it. */
  homeName: string | null
  add: (server: AppServer) => AddOutcome
  /** Makes a listed server the one the app talks to; an id not on the list changes nothing. */
  activate: (id: string) => void
  /**
   * Takes the account's list as it now stands: home first, under the account's name for it, then
   * its servers. A server that left
   * the list forgets its cookies, and when it was the active one the app goes back home, which
   * empties the query cache (`clearOnServerSwitch`). Its downloads stay, kept under its id.
   */
  follow: (input: FollowProps) => Promise<void>
}

/** The secure-store key the list and the active id are kept under, as one JSON value. */
export const SERVER_LIST_KEY = 'raven.servers'

type NamedHomeProps = { home: AppServer; homeName: string | null }

/** Home under the account's name for it, or the build's own while it has none. */
const namedHome = ({ home, homeName }: NamedHomeProps): AppServer =>
  homeName === null ? home : { ...home, name: homeName }

type Followed = Pick<ActiveServerState, 'servers' | 'activeId' | 'homeServerId' | 'homeName'>

type IsSameListingProps = { before: Followed; after: Followed }

/** Whether a read of the account's list says what the store already holds. */
const isSameListing = ({ before, after }: IsSameListingProps): boolean =>
  before.activeId === after.activeId &&
  before.homeServerId === after.homeServerId &&
  before.homeName === after.homeName &&
  JSON.stringify(before.servers) === JSON.stringify(after.servers)

/** A home name read back from storage, kept only when it is one `cleanName` leaves as it is. */
const storedHomeNameOf = (stored: unknown): string | null => {
  const name = isRecord(stored) ? stored.homeName : null
  return isString(name) && cleanName(name) === name ? name : null
}

type CreateActiveServerStoreProps = {
  store: SecretStore
  jar: Pick<CookieJar, 'forget'>
  /** The server the app was built for, `RAVEN_SERVER`. */
  home: AppServer
}

/**
 * The servers the app knows and the one it talks to, kept in the secure store, which keeps
 * them on tvOS too, where AsyncStorage's folder may be emptied. Home is always first, at the
 * origin this build names, and the account's other servers follow it, so a relaunch away from
 * the network still lists them, their downloads and the one last used. It hydrates only when
 * asked, so nothing reads the list before it is loaded, and it guards what it reads.
 */
export const createActiveServerStore = ({ store, jar, home }: CreateActiveServerStoreProps) =>
  create<ActiveServerState>()(
    persist(
      (set, get) => ({
        home,
        servers: [home],
        activeId: home.id,
        homeServerId: null,
        homeName: null,
        add: (server) => {
          const outcome = addServer({ servers: get().servers, server })
          if (outcome.kind === ADD_OUTCOMES.added) set({ servers: outcome.servers })
          return outcome
        },
        activate: (id) => {
          if (get().servers.some((server) => server.id === id)) set({ activeId: id })
        },
        follow: async ({ servers: theirs, homeServerId, homeName }) => {
          const before = get()
          const { servers: known, activeId } = before
          const named = namedHome({ home, homeName })
          const next = listedWith({
            home: named,
            servers: theirs.filter(({ id }) => id !== homeServerId),
            activeId,
          })
          // A read that changed nothing leaves the list as it was, so nothing that reads it draws again.
          if (isSameListing({ before, after: { ...next, homeServerId, homeName } })) return
          set({ ...next, home: named, homeServerId, homeName })
          const gone = known.filter(({ id }) => !next.servers.some((server) => server.id === id))
          await Promise.all(gone.map(({ id }) => jar.forget(id)))
        },
      }),
      {
        name: SERVER_LIST_KEY,
        storage: createJSONStorage(() => secretStateStorage({ store })),
        skipHydration: true,
        partialize: ({ servers, activeId, homeServerId, homeName }) => ({
          servers,
          activeId,
          homeServerId,
          homeName,
        }),
        merge: (stored, current) => {
          const homeServerId =
            isRecord(stored) && isServerId(stored.homeServerId) ? stored.homeServerId : null
          const homeName = storedHomeNameOf(stored)
          const named = namedHome({ home, homeName })
          return {
            ...current,
            ...listedWith({ home: named, ...storedServersOf(stored) }),
            home: named,
            homeServerId,
            homeName,
          }
        },
      },
    ),
  )

/** One app's server list, as `createActiveServerStore` makes it. */
export type ActiveServerStore = ReturnType<typeof createActiveServerStore>

type Listing = Pick<ActiveServerState, 'servers'>

/** Whether the list holds more than home: what the switchers, and the pins' server names, show for. */
export const hasSeveralServers = ({ servers }: Listing): boolean => servers.length > 1

type PinnedOn = Pick<ActiveServerState, 'servers' | 'activeId' | 'home' | 'homeServerId'>

/** The id a pin on the server in use keys on (`pinServerIdOf`), a selector over the server list. */
export const activePinServerIdOf = ({
  servers,
  activeId,
  home,
  homeServerId,
}: PinnedOn): ServerId | null =>
  pinServerIdOf({
    server: servers.find(({ id }) => id === activeId) ?? home,
    home,
    homeServerId,
  })
