import {
  type Infer,
  exactPartial,
  isLibraryView,
  isMediaGroupBy,
  isMediaSort,
  isRecord,
} from '@raven/core'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

/** The key the choices are stored under. */
export const LIBRARY_VIEWS_KEY = 'raven-library-views'

/** How a viewer left one library on this device: its sort, view and grouping, any of them. */
const isLibraryChoice = exactPartial({
  sort: isMediaSort,
  view: isLibraryView,
  groupBy: isMediaGroupBy,
})

export type LibraryChoice = Infer<typeof isLibraryChoice>

type Choices = Record<string, LibraryChoice>

type ChooseProps = { serverId: string; libraryId: number; change: LibraryChoice }

type LibraryViews = {
  choices: Choices
  choose: (args: ChooseProps) => void
}

type KeyOfProps = { serverId: string; libraryId: number }

const keyOf = ({ serverId, libraryId }: KeyOfProps): string => `${serverId}/${libraryId}`

/** Nothing chosen, the one value, so a selector reading it gives the same answer each time. */
const NO_CHOICE: LibraryChoice = {}

type LibraryChoiceOfProps = {
  choices: Choices
  serverId: string
  libraryId: number
}

/** The choice made for a library on a server, or nothing chosen. */
export const libraryChoiceOf = ({ choices, ...library }: LibraryChoiceOfProps): LibraryChoice =>
  choices[keyOf(library)] ?? NO_CHOICE

/** What was read back, kept only where it is a choice. */
const choicesOf = (saved: unknown): Choices => {
  if (!isRecord(saved) || !isRecord(saved.choices)) return {}
  return Object.fromEntries(
    Object.entries(saved.choices).filter((entry): entry is [string, LibraryChoice] =>
      isLibraryChoice(entry[1]),
    ),
  )
}

/** Holds the place of the storage until `configureLibraryViews`, as the player prefs do. */
const UNCONFIGURED: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

/**
 * How each library is sorted, laid out and grouped on this device. The web saves such a
 * change to the server (`PUT /api/libraries/:id/view`, `@ForViewers()`), for every viewer;
 * that write is not one of the spec's, so the app's allowlist leaves it out. So the app
 * keeps a per-device, per-library choice here, persisted to AsyncStorage, falls back to the
 * server's settings for anything not chosen, and passes the two through `coherentSettings`,
 * so a choice the library's type cannot show, or no longer can, gives way to its own.
 */
export const useLibraryViews = create<LibraryViews>()(
  persist(
    (set) => ({
      choices: {},
      choose: ({ change, ...library }) =>
        set(({ choices }) => ({
          choices: { ...choices, [keyOf(library)]: { ...choices[keyOf(library)], ...change } },
        })),
    }),
    {
      name: LIBRARY_VIEWS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED),
      skipHydration: true,
      partialize: ({ choices }) => ({ choices }),
      merge: (saved, current) => ({ ...current, choices: choicesOf(saved) }),
    },
  ),
)

type ConfigureLibraryViewsProps = { storage: StateStorage }

/** Gives the choices their storage, AsyncStorage in the app, and reads them back from it. */
export const configureLibraryViews = async ({ storage }: ConfigureLibraryViewsProps) => {
  useLibraryViews.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await useLibraryViews.persist.rehydrate()
}
