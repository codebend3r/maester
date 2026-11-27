import type { StateCreator } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'

/** The localStorage keys the app's stores keep their state under. */
export const STORE_KEYS = {
  authSession: 'raven-auth-session',
  binge: 'raven-binge',
  bingeTip: 'raven-binge-tip-seen',
  browserDownloads: 'raven-browser-downloads',
  downloadAsk: 'raven-download-ask',
  downloadNotes: 'raven-download-notes',
  downloadsShow: 'raven-downloads-show',
  seasonView: 'raven-season-view',
  upcomingFilter: 'raven-upcoming-filter',
  serverReach: 'raven-server-reach',
  shelfOrders: 'raven-shelf-orders',
  sideMenu: 'raven-side-menu',
} as const

type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS]

/** A store's state, as `devtools` over `persist` hands it its `set` and `get`. */
type KeptState<S> = StateCreator<S, [['zustand/devtools', never], ['zustand/persist', unknown]]>

type KeptInStorageProps<S, P> = {
  key: StoreKey
  /** What devtools names the store. */
  name: string
  state: KeptState<S>
  /** The part of the state kept across visits. */
  keep: (state: S) => P
  /** What of the kept part to take back, checked, since anything may sit in localStorage; all of it when left out. */
  restore?: (saved: unknown) => Partial<NoInfer<S>>
}

/** A store whose `keep` part outlives the visit in localStorage under `key`, and shows in devtools. */
export const keptInStorage = <S, P>({
  key,
  name,
  state,
  keep,
  restore,
}: KeptInStorageProps<S, P>) =>
  devtools(
    persist<S, [['zustand/devtools', never]], [], P>(state, {
      name: key,
      storage: createJSONStorage<P>(() => window.localStorage),
      partialize: keep,
      ...(restore && {
        merge: (saved: unknown, current: S): S => ({ ...current, ...restore(saved) }),
      }),
    }),
    { name },
  )
