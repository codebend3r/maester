import { type Infer, isRecord, isString, matching, tagged, wholeNumberIn } from '@raven/core'
import { loadPersisted } from '@raven/native/headless'
import { UNCONFIGURED_STORAGE } from '@raven/ui/headless'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

/** The key the recent searches are stored under in AsyncStorage. */
export const RECENT_SEARCHES_KEY = 'wren.recentSearches'

/** How many recent searches Search keeps, the newest first. */
export const RECENT_SEARCHES_KEPT = 10

/** What a recent search was: words searched for, or an artist or an album a search opened. */
export const RECENT_KINDS = { query: 'query', artist: 'artist', album: 'album' } as const

/** A recent search as it is kept: words that are not blank, or an artist or an album by id. */
const isRecentSearch = tagged({
  tag: 'kind',
  variants: {
    [RECENT_KINDS.query]: { text: matching(/\S/) },
    [RECENT_KINDS.artist]: { id: wholeNumberIn({ min: 0 }), name: isString },
    [RECENT_KINDS.album]: { id: wholeNumberIn({ min: 0 }), title: isString, artists: isString },
  },
})

export type RecentSearch = Infer<typeof isRecentSearch>

/** A recent search's identity, so the same one searched again moves to the top rather than twice. */
export const recentKeyOf = (recent: RecentSearch): string => {
  switch (recent.kind) {
    case RECENT_KINDS.query:
      return `${recent.kind}:${recent.text.toLocaleLowerCase()}`
    case RECENT_KINDS.artist:
    case RECENT_KINDS.album:
      return `${recent.kind}:${recent.id}`
    default: {
      const unknownKind: never = recent
      return unknownKind
    }
  }
}

/** The recent searches kept, each once, newest first, at most `RECENT_SEARCHES_KEPT`. */
const keptOf = (recents: readonly RecentSearch[]): RecentSearch[] =>
  recents
    .filter(
      (recent, index) =>
        recents.findIndex((other) => recentKeyOf(other) === recentKeyOf(recent)) === index,
    )
    .slice(0, RECENT_SEARCHES_KEPT)

/** What was read back: every entry that is a recent search, the rest dropped. */
export const recentSearchesOf = (saved: unknown): RecentSearch[] => {
  const entries = isRecord(saved) && Array.isArray(saved.recents) ? saved.recents : []
  return keptOf(entries.filter(isRecentSearch))
}

type WithRecentProps = { recents: readonly RecentSearch[]; recent: RecentSearch }

/** The list with a search remembered at its top, an earlier copy of it dropped. */
export const withRecent = ({ recents, recent }: WithRecentProps): RecentSearch[] =>
  keptOf([recent, ...recents])

type RecentSearchesState = {
  recents: RecentSearch[]
  /** Remembers a search submitted, or the artist or album a search opened. */
  remember: (recent: RecentSearch) => void
  forget: (key: string) => void
  clear: () => void
}

/** Search's recent searches on this device, persisted to AsyncStorage and guarded when read. */
export const useRecentSearches = create<RecentSearchesState>()(
  persist(
    (set) => ({
      recents: [],
      remember: (recent) => {
        // A blank search is nothing to come back to.
        if (recent.kind === RECENT_KINDS.query && recent.text.trim() === '') return
        set(({ recents }) => ({ recents: withRecent({ recents, recent }) }))
      },
      forget: (key) =>
        set(({ recents }) => ({ recents: recents.filter((it) => recentKeyOf(it) !== key) })),
      clear: () => set({ recents: [] }),
    }),
    {
      name: RECENT_SEARCHES_KEY,
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      partialize: ({ recents }) => ({ recents }),
      // What was searched before the list was read stays on top of what was read.
      merge: (saved, current) => ({
        ...current,
        recents: keptOf([...current.recents, ...recentSearchesOf(saved)]),
      }),
    },
  ),
)

type ConfigureRecentSearchesProps = { storage: StateStorage }

/** Gives the recent searches their storage, AsyncStorage in the app, and reads them back from it. */
export const configureRecentSearches = async ({ storage }: ConfigureRecentSearchesProps) => {
  await loadPersisted({ store: useRecentSearches, storage })
}
