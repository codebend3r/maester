import type { AppPath } from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

export type Follow = (link: { to: AppPath; state: unknown }) => void

type CardLinksState = {
  /** Opens a card link's address in the app; null until `CardLinks` mounts. */
  follow: Follow | null
}

/** How every card link in the app follows its address, set by the one `CardLinks` near the root. */
export const useCardLinks = create<CardLinksState>()(
  devtools(
    persist((): CardLinksState => ({ follow: null }), {
      name: STORE_KEYS.cardLinks,
      storage: createJSONStorage(() => window.localStorage),
      partialize: () => ({}),
    }),
    { name: 'raven/cardLinks' },
  ),
)
