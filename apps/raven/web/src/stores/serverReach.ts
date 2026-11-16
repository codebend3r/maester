import { create } from 'zustand'
import { keptInStorage, STORE_KEYS } from '@/stores/storage'

type ServerReach = {
  /**
   * Whether Raven could not reach its server when it asked for the account config. It
   * holds through every retry, so the offline frame stays put while one is under way, and goes
   * once the server answers.
   */
  isOffline: boolean
}

export const useServerReach = create<ServerReach>()(
  keptInStorage({
    key: STORE_KEYS.serverReach,
    name: 'raven/serverReach',
    state: (): ServerReach => ({ isOffline: false }),
    keep: ({ isOffline }) => ({ isOffline }),
  }),
)
