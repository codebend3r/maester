import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { ITEM_TYPES, type ItemSummary } from '@raven/core'
import { BINGE_LIMIT } from '@/lib/binge'
import { useAuthSession } from '@/stores/authSession'
import { STORE_KEYS } from '@/stores/storage'

const LOCAL_VIEWER = 'local'
const EMPTY_IDS: readonly number[] = []
type BingeProfile = { account: string; ids: readonly number[]; hasSeenTip: boolean }
type BingeState = {
  profiles: BingeProfile[]
  toggle: (options: ToggleProps) => void
  dismissTip: (account: string) => void
}
type ToggleProps = { account: string; item: Pick<ItemSummary, 'id' | 'type'> }

const isProfile = (value: unknown): value is BingeProfile =>
  typeof value === 'object' &&
  value !== null &&
  'account' in value &&
  typeof value.account === 'string' &&
  'hasSeenTip' in value &&
  typeof value.hasSeenTip === 'boolean' &&
  'ids' in value &&
  Array.isArray(value.ids) &&
  value.ids.length <= BINGE_LIMIT &&
  value.ids.every((id: unknown) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0) &&
  new Set(value.ids).size === value.ids.length

const profilesOf = (value: unknown): BingeProfile[] => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('profiles' in value) ||
    !Array.isArray(value.profiles)
  )
    return []
  return value.profiles.filter(isProfile)
}

// shortcut: browser-local selections, move to server viewing data when cross-device sync is needed.
export const useBinge = create<BingeState>()(
  persist(
    (set) => ({
      profiles: [],
      toggle: ({ account, item }) => {
        if (item.type !== ITEM_TYPES.show || !Number.isSafeInteger(item.id) || item.id <= 0) return
        refreshBinge()
        set((state) => {
          const profile = state.profiles.find((entry) => entry.account === account)
          const ids = profile?.ids ?? EMPTY_IDS
          if (!ids.includes(item.id) && ids.length >= BINGE_LIMIT) return state
          const next = ids.includes(item.id)
            ? ids.filter((id) => id !== item.id)
            : [item.id, ...ids]
          return {
            profiles: [
              ...state.profiles.filter((entry) => entry.account !== account),
              { account, ids: next, hasSeenTip: true },
            ],
          }
        })
      },
      dismissTip: (account) => {
        refreshBinge()
        set((state) => {
          const profile = state.profiles.find((entry) => entry.account === account)
          return {
            profiles: [
              ...state.profiles.filter((entry) => entry.account !== account),
              { account, ids: profile?.ids ?? EMPTY_IDS, hasSeenTip: true },
            ],
          }
        })
      },
    }),
    {
      name: STORE_KEYS.binge,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ profiles }) => ({ profiles }),
      merge: (saved, current) => ({ ...current, profiles: profilesOf(saved) }),
    },
  ),
)

/** localStorage hydration is synchronous, so an edit starts from the latest tab's snapshot. */
const refreshBinge = (): void => {
  Promise.resolve(useBinge.persist.rehydrate()).catch(() => undefined)
}

export const followBinge = (): (() => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORE_KEYS.binge) return
    refreshBinge()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

export const useBingeProfile = () => {
  const account = useAuthSession((state) => state.session?.userId ?? LOCAL_VIEWER)
  const profile = useBinge((state) => state.profiles.find((entry) => entry.account === account))
  return { account, ids: profile?.ids ?? EMPTY_IDS, hasSeenTip: profile?.hasSeenTip ?? false }
}
