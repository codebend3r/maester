import { type StateStorage, createJSONStorage } from 'zustand/middleware'
import { usePageBackdrop } from '@/stores/pageBackdrop'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { usePlayerServices } from '@/stores/playerServices'
import { useUnlockPrompt } from '@/stores/unlockPrompt'

type ConfigureStorageProps = { storage: StateStorage }

/**
 * Gives the headless stores the host's storage and loads what it holds. A host
 * calls it once, before anything renders: `window.localStorage` on the web and
 * the desktop, AsyncStorage in the app.
 */
export const configureStorage = async ({ storage }: ConfigureStorageProps): Promise<void> => {
  usePlayerPrefs.persist.setOptions({ storage: createJSONStorage(() => storage) })
  usePageBackdrop.persist.setOptions({ storage: createJSONStorage(() => storage) })
  usePlayerServices.persist.setOptions({ storage: createJSONStorage(() => storage) })
  useUnlockPrompt.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await Promise.all([
    usePlayerPrefs.persist.rehydrate(),
    usePageBackdrop.persist.rehydrate(),
    usePlayerServices.persist.rehydrate(),
    useUnlockPrompt.persist.rehydrate(),
  ])
}
