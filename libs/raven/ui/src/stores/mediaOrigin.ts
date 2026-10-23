import { type MediaOrigin, isMediaOrigin } from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { localOrMemoryStorage } from '@/stores/browserStorage'
import { STORE_KEYS } from '@/stores/storage'

export type MediaPick = { origin: MediaOrigin; at: number }

type MediaOriginState = {
  /** The origin media plays from, and when it was chosen (epoch ms); null plays through the web host. */
  pick: MediaPick | null
  isProbing: boolean
  setPick: (pick: MediaPick | null) => void
  setProbing: (isProbing: boolean) => void
}

/** How long a pick is trusted before the origins are probed again. */
export const PICK_FRESH_MS = 600_000

export const isFreshPick = ({ pick, now }: { pick: MediaPick | null; now: number }): boolean => {
  if (!pick) return false
  const age = now - pick.at
  return age >= 0 && age < PICK_FRESH_MS
}

const isMediaPick = (value: unknown): value is MediaPick =>
  typeof value === 'object' &&
  value !== null &&
  'origin' in value &&
  isMediaOrigin(value.origin) &&
  'at' in value &&
  typeof value.at === 'number'

/** The pick lasts across reloads and tabs until it goes stale. */
export const useMediaOrigin = create<MediaOriginState>()(
  devtools(
    persist(
      (set) => ({
        pick: null,
        isProbing: false,
        setPick: (pick) => set({ pick }),
        setProbing: (isProbing) => set({ isProbing }),
      }),
      {
        name: STORE_KEYS.mediaOrigin,
        storage: createJSONStorage(localOrMemoryStorage),
        partialize: ({ pick }) => ({ pick }),
        merge: (persisted, current) => ({
          ...current,
          pick:
            typeof persisted === 'object' &&
            persisted !== null &&
            'pick' in persisted &&
            isMediaPick(persisted.pick)
              ? persisted.pick
              : null,
        }),
      },
    ),
    { name: 'raven/mediaOrigin' },
  ),
)
