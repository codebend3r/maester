import { type StateStorage, createJSONStorage } from 'zustand/middleware'
import { useActiveServer } from '@/stores/activeServer'
import { usePlayerPrefs } from '@/stores/playerPrefs'

type ConfigureStorageProps = { storage: StateStorage }

/**
 * Gives the player preferences and the active server the host's storage and loads what they
 * hold. A host calls it once, before anything renders: `window.localStorage` on the web and
 * the desktop, AsyncStorage in the app.
 */
export const configureStorage = async ({ storage }: ConfigureStorageProps): Promise<void> => {
  usePlayerPrefs.persist.setOptions({ storage: createJSONStorage(() => storage) })
  useActiveServer.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await Promise.all([usePlayerPrefs.persist.rehydrate(), useActiveServer.persist.rehydrate()])
}
