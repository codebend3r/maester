import {
  type Infer,
  PICK_FRESH_MS,
  isMediaOrigin,
  isNumber,
  isRemotePlayback,
  nullable,
  object,
} from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { localOrMemoryStorage } from '@/stores/browserStorage'
import { STORE_KEYS } from '@/stores/storage'

/**
 * What a probe last found: the origin media plays from (null plays through
 * the web host), when it was chosen (epoch ms), and what the server said of
 * remote play then (null from a server that says nothing).
 */
const isMediaPick = object({
  origin: nullable(isMediaOrigin),
  at: isNumber,
  remote: nullable(isRemotePlayback),
})

export type MediaPick = Infer<typeof isMediaPick>

/** The part of the store kept across reloads and tabs. */
const isPersistedOrigin = object({ pick: isMediaPick })

type MediaOriginState = {
  /** The last probe's pick; null before any probe answered. */
  pick: MediaPick | null
  isProbing: boolean
  /** Whether a probe has ended since launch; before one, an empty pick says nothing yet. */
  hasProbed: boolean
  setPick: (pick: MediaPick | null) => void
  setProbing: (isProbing: boolean) => void
}

type IsFreshPickProps = { pick: MediaPick | null; now: number }

export const isFreshPick = ({ pick, now }: IsFreshPickProps): boolean => {
  if (!pick) return false
  const age = now - pick.at
  return age >= 0 && age < PICK_FRESH_MS
}

/**
 * The pick, and the server's word on remote play with it, last across
 * reloads and tabs until the pick goes stale, so a player that starts before
 * the next probe answers already plays from that origin and plans away from
 * home as that probe found.
 */
export const useMediaOrigin = create<MediaOriginState>()(
  devtools(
    persist(
      (set) => ({
        pick: null,
        isProbing: false,
        hasProbed: false,
        setPick: (pick) => set({ pick }),
        setProbing: (isProbing) =>
          set((state) => ({ isProbing, hasProbed: state.hasProbed || !isProbing })),
      }),
      {
        name: STORE_KEYS.mediaOrigin,
        storage: createJSONStorage(localOrMemoryStorage),
        partialize: ({ pick }) => ({ pick }),
        merge: (persisted, current) => ({
          ...current,
          pick: isPersistedOrigin(persisted) ? persisted.pick : null,
        }),
      },
    ),
    { name: 'raven/mediaOrigin' },
  ),
)
