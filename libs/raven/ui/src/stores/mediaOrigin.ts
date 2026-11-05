import {
  type MediaOrigin,
  PICK_FRESH_MS,
  type RemotePlayback,
  isMediaOrigin,
  isRemotePlayback,
} from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { localOrMemoryStorage } from '@/stores/browserStorage'
import { STORE_KEYS } from '@/stores/storage'

export type MediaPick = { origin: MediaOrigin; at: number }

type MediaOriginState = {
  /** The origin media plays from, and when it was chosen (epoch ms); null plays through the web host. */
  pick: MediaPick | null
  /** What the server last said of remote play; null before it answers, or from a server that says nothing. */
  remote: RemotePlayback | null
  isProbing: boolean
  /** Whether a probe has ended since launch; before one, an empty pick says nothing yet. */
  hasProbed: boolean
  setPick: (pick: MediaPick | null) => void
  setRemote: (remote: RemotePlayback | null) => void
  setProbing: (isProbing: boolean) => void
}

type IsFreshPickProps = { pick: MediaPick | null; now: number }

export const isFreshPick = ({ pick, now }: IsFreshPickProps): boolean => {
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

type PersistedOriginProps = { persisted: unknown }

const persistedPick = ({ persisted }: PersistedOriginProps): MediaPick | null =>
  typeof persisted === 'object' &&
  persisted !== null &&
  'pick' in persisted &&
  isMediaPick(persisted.pick)
    ? persisted.pick
    : null

const persistedRemote = ({ persisted }: PersistedOriginProps): RemotePlayback | null =>
  typeof persisted === 'object' &&
  persisted !== null &&
  'remote' in persisted &&
  isRemotePlayback(persisted.remote)
    ? persisted.remote
    : null

/**
 * The pick lasts across reloads and tabs until it goes stale, and the remote
 * limit with it, so a player that starts before the next probe answers
 * already plays away from home at that size.
 */
export const useMediaOrigin = create<MediaOriginState>()(
  devtools(
    persist(
      (set) => ({
        pick: null,
        isProbing: false,
        hasProbed: false,
        remote: null,
        setPick: (pick) => set({ pick }),
        setRemote: (remote) => set({ remote }),
        setProbing: (isProbing) =>
          set((state) => ({ isProbing, hasProbed: state.hasProbed || !isProbing })),
      }),
      {
        name: STORE_KEYS.mediaOrigin,
        storage: createJSONStorage(localOrMemoryStorage),
        partialize: ({ pick, remote }) => ({ pick, remote }),
        merge: (persisted, current) => ({
          ...current,
          pick: persistedPick({ persisted }),
          remote: persistedRemote({ persisted }),
        }),
      },
    ),
    { name: 'raven/mediaOrigin' },
  ),
)
