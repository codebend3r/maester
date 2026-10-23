import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

type ServerReach = {
  /**
   * Whether Raven could not reach its server when it asked for the account config. It
   * holds through every retry, so the offline frame stays put while one is under way, and goes
   * once the server answers.
   */
  isOffline: boolean
}

export const useServerReach = create<ServerReach>()(
  devtools(
    persist((): ServerReach => ({ isOffline: false }), {
      name: STORE_KEYS.serverReach,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ isOffline }) => ({ isOffline }),
    }),
    { name: 'raven/serverReach' },
  ),
)
