import {
  type Infer,
  type ServerId,
  isServerId,
  isServerOrigin,
  nullable,
  object,
} from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS, UNCONFIGURED_STORAGE } from '@/stores/storage'

/** Another server than the home one, by its id and the origin the account keeps for it. */
const isActiveServer = object({ serverId: isServerId, origin: isServerOrigin })

export type ActiveServer = Infer<typeof isActiveServer>

const isStoredActiveServer = object({ active: nullable(isActiveServer) })

type ActiveServerState = {
  /**
   * The server the app talks to now: null for the home one (the server that served the page,
   * or the one the app was built for), else one of the account's extra servers.
   */
  active: ActiveServer | null
  /** Talks to `server` from now on; null goes back home. */
  choose: (server: ActiveServer | null) => void
}

/**
 * Which server this viewer is using, kept across visits so a reload stays on it. The API
 * client reads it on every call (`activeBaseUrl`) and `followActiveServer` empties what the
 * last server left in the cache when it changes. A host gives it storage with
 * `configureStorage`, before anything is asked of the server.
 */
export const useActiveServer = create<ActiveServerState>()(
  devtools(
    persist(
      (set) => ({
        active: null,
        choose: (server) => set({ active: server }),
      }),
      {
        name: STORE_KEYS.activeServer,
        storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
        partialize: ({ active }) => ({ active }),
        // Anything stored that is not a server this client could have written goes back home.
        merge: (stored, current) =>
          isStoredActiveServer(stored) ? { ...current, active: stored.active } : current,
      },
    ),
    { name: 'raven/activeServer' },
  ),
)

/** The API's origin now: '' for the home server's own `/api`, else the active server's origin. */
export const activeBaseUrl = (): string => useActiveServer.getState().active?.origin ?? ''

/** The active server's id: null for the home one. */
export const activeServerId = (): ServerId | null =>
  useActiveServer.getState().active?.serverId ?? null

type SameServerProps = { one: ActiveServer | null; other: ActiveServer | null }

const isSameServer = ({ one, other }: SameServerProps): boolean =>
  (one?.serverId ?? null) === (other?.serverId ?? null) &&
  (one?.origin ?? null) === (other?.origin ?? null)

type ActiveServerListener = (active: ActiveServer | null) => void

/**
 * Calls `listener` with the server the app moves to, each time it moves to another one (choosing
 * the one in use again is no move); returns the unsubscribe.
 */
export const onActiveServerChange = (listener: ActiveServerListener): (() => void) =>
  useActiveServer.subscribe((state, previous) => {
    if (!isSameServer({ one: state.active, other: previous.active })) listener(state.active)
  })
