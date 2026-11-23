import { type ServerId, isRecord, isServerId } from '@raven/core'
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
}

type ActiveServerState = {
  /** The server the app was built for, always first on the list and never removed. */
  home: AppServer
  /** Home first, then the account's other servers in the order they were added. */
  servers: AppServer[]
  activeId: string
  /** The home server's own id, as its auth config names it: what a pin on it keys on. */
  homeServerId: ServerId | null
  add: (server: AppServer) => AddOutcome
  /** Makes a listed server the one the app talks to; an id not on the list changes nothing. */
  activate: (id: string) => void
  /**
   * Takes the account's list as it now stands: home first, then its servers. A server that left
   * the list forgets its cookies, and when it was the active one the app goes back home, which
   * empties the query cache (`clearOnServerSwitch`). Its downloads stay, kept under its id.
   */
  follow: (input: FollowProps) => Promise<void>
}

/** The secure-store key the list and the active id are kept under, as one JSON value. */
export const SERVER_LIST_KEY = 'raven.servers'

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
        add: (server) => {
          const outcome = addServer({ servers: get().servers, server })
          if (outcome.kind === ADD_OUTCOMES.added) set({ servers: outcome.servers })
          return outcome
        },
        activate: (id) => {
          if (get().servers.some((server) => server.id === id)) set({ activeId: id })
        },
        follow: async ({ servers: theirs, homeServerId }) => {
          const { servers: known, activeId } = get()
          const next = listedWith({
            home,
            servers: theirs.filter(({ id }) => id !== homeServerId),
            activeId,
          })
          set({ ...next, homeServerId })
          const gone = known.filter(({ id }) => !next.servers.some((server) => server.id === id))
          await Promise.all(gone.map(({ id }) => jar.forget(id)))
        },
      }),
      {
        name: SERVER_LIST_KEY,
        storage: createJSONStorage(() => secretStateStorage({ store })),
        skipHydration: true,
        partialize: ({ servers, activeId, homeServerId }) => ({ servers, activeId, homeServerId }),
        merge: (stored, current) => {
          const homeServerId =
            isRecord(stored) && isServerId(stored.homeServerId) ? stored.homeServerId : null
          return {
            ...current,
            ...listedWith({ home, ...storedServersOf(stored) }),
            homeServerId,
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
