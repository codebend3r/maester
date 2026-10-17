import { type MediaOrigin, isMediaOrigin } from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

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

const memory = new Map<string, string>()

const memoryStorage: Storage = {
  get length() {
    return memory.size
  },
  clear: () => memory.clear(),
  getItem: (key) => memory.get(key) ?? null,
  key: (index) => [...memory.keys()][index] ?? null,
  removeItem: (key) => void memory.delete(key),
  setItem: (key, value) => void memory.set(key, value),
}

/** Reading `window.sessionStorage` itself throws in some private or locked-down windows. */
export const sessionOrMemoryStorage = (): Storage => {
  try {
    return window.sessionStorage
  } catch {
    return memoryStorage
  }
}

/** The pick lasts for the tab's session: a new tab probes again, a reload does not. */
export const useMediaOrigin = create<MediaOriginState>()(
  persist(
    (set) => ({
      pick: null,
      isProbing: false,
      setPick: (pick) => set({ pick }),
      setProbing: (isProbing) => set({ isProbing }),
    }),
    {
      name: 'raven-media-origin',
      storage: createJSONStorage(sessionOrMemoryStorage),
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
)
