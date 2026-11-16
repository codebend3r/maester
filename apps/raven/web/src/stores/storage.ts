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
  pageBackdrop: 'raven-page-backdrop',
  seasonView: 'raven-season-view',
  upcomingFilter: 'raven-upcoming-filter',
  serverReach: 'raven-server-reach',
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
}

/** A store whose `keep` part outlives the visit in localStorage under `key`, and shows in devtools. */
export const keptInStorage = <S, P>({ key, name, state, keep }: KeptInStorageProps<S, P>) =>
  devtools(
    persist<S, [['zustand/devtools', never]], [], P>(state, {
      name: key,
      storage: createJSONStorage<P>(() => window.localStorage),
      partialize: keep,
    }),
    { name },
  )
