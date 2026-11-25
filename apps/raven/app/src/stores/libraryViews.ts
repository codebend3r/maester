import {
  type Infer,
  exactPartial,
  isLibraryView,
  isMediaGroupBy,
  isMediaSort,
  isMusicSort,
  isRecord,
  isShelfOrder,
  isSortDirection,
  otherShelfOrder,
  DEFAULT_SHELF_ORDER,
  type ShelfOrders,
  withoutView,
} from '@raven/core'
import { loadPersisted } from '@raven/native/headless'
import { UNCONFIGURED_STORAGE } from '@raven/ui/headless'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

/** The key the choices are stored under. */
export const LIBRARY_VIEWS_KEY = 'raven-library-views'

/**
 * How a viewer left one library on this device: its sort, view and grouping, any of them, for
 * a music library the albums' sort and its direction, and the order its shelf on Home is in.
 */
const isLibraryChoice = exactPartial({
  sort: isMediaSort,
  view: isLibraryView,
  groupBy: isMediaGroupBy,
  musicSort: isMusicSort,
  musicOrder: isSortDirection,
  shelfOrder: isShelfOrder,
})

export type LibraryChoice = Infer<typeof isLibraryChoice>

type Choices = Record<string, LibraryChoice>

type ChooseProps = { serverId: string; libraryId: number; change: LibraryChoice }

type KeyOfProps = { serverId: string; libraryId: number }

type LibraryViews = {
  choices: Choices
  choose: (args: ChooseProps) => void
  /** Turns a library's shelf on Home to its other order, read from the choices as they stand. */
  turnShelfOrder: (args: KeyOfProps) => void
}

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

type ShelfOrdersOnProps = { choices: Choices; serverId: string }

/** The order each library's shelf on Home is turned to on a server, by library id. */
export const shelfOrdersOn = ({ choices, serverId }: ShelfOrdersOnProps): ShelfOrders =>
  Object.entries(choices).reduce<ShelfOrders>((orders, [key, { shelfOrder }]) => {
    const [server, libraryId] = key.split('/')
    if (server !== serverId || shelfOrder === undefined) return orders
    return { ...orders, [Number(libraryId)]: shelfOrder }
  }, {})

/** What was read back, kept only where it is a choice. */
const choicesOf = (saved: unknown): Choices => {
  if (!isRecord(saved) || !isRecord(saved.choices)) return {}
  return Object.fromEntries(
    Object.entries(saved.choices).filter((entry): entry is [string, LibraryChoice] =>
      isLibraryChoice(entry[1]),
    ),
  )
}

/**
 * The choices as they are stored: a view picked holds while the app is open, and the
 * library opens on its type's own the next time it starts (`openingSettings`).
 */
const withoutViews = (choices: Choices): Choices =>
  Object.fromEntries(Object.entries(choices).map(([key, choice]) => [key, withoutView(choice)]))

/**
 * How each library is sorted, laid out and grouped on this device. The web saves such a
 * change to the server (`PUT /api/libraries/:id/view`, `@ForViewers()`), for every viewer;
 * that write is not one of the spec's, so the app's allowlist leaves it out. So the app
 * keeps a per-device, per-library choice here, persisted to AsyncStorage but for the view,
 * which holds only while the app is open (see `withoutViews`), falls back to the
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
      turnShelfOrder: (library) =>
        set(({ choices }) => {
          const choice = choices[keyOf(library)]
          const shelfOrder = otherShelfOrder(choice?.shelfOrder ?? DEFAULT_SHELF_ORDER)
          return { choices: { ...choices, [keyOf(library)]: { ...choice, shelfOrder } } }
        }),
    }),
    {
      name: LIBRARY_VIEWS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      partialize: ({ choices }) => ({ choices: withoutViews(choices) }),
      merge: (saved, current) => ({ ...current, choices: withoutViews(choicesOf(saved)) }),
    },
  ),
)

type ConfigureLibraryViewsProps = { storage: StateStorage }

/** Gives the choices their storage, AsyncStorage in the app, and reads them back from it. */
export const configureLibraryViews = async ({ storage }: ConfigureLibraryViewsProps) => {
  await loadPersisted({ store: useLibraryViews, storage })
}
