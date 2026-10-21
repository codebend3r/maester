import { type SignInConfig, renamedServers } from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { CookieJar } from '@/servers/cookieJar'
import { type SecretStore, secretStateStorage } from '@/servers/secretStore'
import {
  ADD_OUTCOMES,
  type AddOutcome,
  type AppServer,
  addServer,
  pinServer,
  removeServer,
  storedServersOf,
} from '@/servers/serverList'

type ActiveServerState = {
  servers: AppServer[]
  activeId: string | null
  add: (server: AppServer) => AddOutcome
  /**
   * Drops the server and its cookies. When it was the active one, the first server left
   * becomes active, or none when it was the last, and the active id's change empties the
   * query cache (`clearOnServerSwitch`). Another server's answers are never in the cache.
   */
  remove: (id: string) => Promise<void>
  /** Gives a listed server the name typed; false, and nothing changed, when it will not do. */
  rename: (input: { id: string; name: string }) => boolean
  /**
   * Pins a listed server's sign-in in place of any it had, kept with the server and so
   * forgotten with it; false, and nothing changed, for a server not listed or endpoints the
   * app could not sign in through.
   */
  pin: (input: { id: string; account: SignInConfig }) => boolean
  /** Makes a listed server the one the app talks to; an id not on the list changes nothing. */
  activate: (id: string) => void
}

/** The secure-store key the list and the active id are kept under, as one JSON value. */
export const SERVER_LIST_KEY = 'raven.servers'

/**
 * The servers the app knows and the one it talks to, kept in the secure store, which keeps
 * them on tvOS too, where AsyncStorage's folder may be emptied. It hydrates only when asked,
 * so nothing reads the list before it is loaded, and it guards what it reads.
 */
export const createActiveServerStore = ({
  store,
  jar,
}: {
  store: SecretStore
  jar: Pick<CookieJar, 'forget'>
}) =>
  create<ActiveServerState>()(
    persist(
      (set, get) => ({
        servers: [],
        activeId: null,
        add: (server) => {
          const outcome = addServer({ servers: get().servers, server })
          if (outcome.kind === ADD_OUTCOMES.added) set({ servers: outcome.servers })
          return outcome
        },
        remove: async (id) => {
          set(({ servers, activeId }) => {
            const left = removeServer({ servers, id })
            return { servers: left, activeId: activeId === id ? (left[0]?.id ?? null) : activeId }
          })
          await jar.forget(id)
        },
        rename: ({ id, name }) => {
          const renamed = renamedServers({ servers: get().servers, id, name })
          if (renamed !== null) set({ servers: renamed })
          return renamed !== null
        },
        pin: ({ id, account }) => {
          const pinned = pinServer({ servers: get().servers, id, account })
          if (pinned !== null) set({ servers: pinned })
          return pinned !== null
        },
        activate: (id) => {
          if (get().servers.some((server) => server.id === id)) set({ activeId: id })
        },
      }),
      {
        name: SERVER_LIST_KEY,
        storage: createJSONStorage(() => secretStateStorage({ store })),
        skipHydration: true,
        partialize: ({ servers, activeId }) => ({ servers, activeId }),
        merge: (stored, current) => ({ ...current, ...storedServersOf(stored) }),
      },
    ),
  )
