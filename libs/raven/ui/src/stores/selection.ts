import { devtools } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

type RangeProps = { to: string; ordered: readonly string[] }

type Selection = {
  selecting: boolean
  keys: ReadonlySet<string>
  /** The card last clicked, where a shift-click's range starts. */
  anchor: string | null
  /** Enters select mode, with `key` selected when a card started it. */
  start: (key?: string) => void
  toggle: (key: string) => void
  /** Selects every key of `ordered` from the anchor to `to`, whichever comes first. */
  range: (args: RangeProps) => void
  selectAll: (keys: readonly string[]) => void
  /** Empties the selection and stays in select mode. */
  clear: () => void
  end: () => void
}

/**
 * The cards selected in one section or page. Every change gives a new set,
 * so a card that watches its own key redraws only when that key flips.
 * It is not persisted: every scope would share one key, so each mount would
 * open in select mode with the last scope's cards.
 */
export const createSelectionStore = () =>
  createStore<Selection>()(
    devtools(
      (set) => ({
        selecting: false,
        keys: new Set<string>(),
        anchor: null,
        start: (key) =>
          set({
            selecting: true,
            keys: new Set(key === undefined ? [] : [key]),
            anchor: key ?? null,
          }),
        toggle: (key) =>
          set((current) => ({
            keys: current.keys.has(key)
              ? new Set([...current.keys].filter((each) => each !== key))
              : new Set([...current.keys, key]),
            anchor: key,
          })),
        range: ({ to, ordered }) =>
          set((current) => {
            const from = current.anchor === null ? -1 : ordered.indexOf(current.anchor)
            const end = ordered.indexOf(to)
            if (from === -1 || end === -1) {
              return { keys: new Set([...current.keys, to]), anchor: to }
            }
            const between = ordered.slice(Math.min(from, end), Math.max(from, end) + 1)
            return { keys: new Set([...current.keys, ...between]), anchor: to }
          }),
        selectAll: (keys) => set({ keys: new Set(keys) }),
        clear: () => set({ keys: new Set<string>(), anchor: null }),
        end: () => set({ selecting: false, keys: new Set<string>(), anchor: null }),
      }),
      { name: 'raven/selection' },
    ),
  )

export type SelectionStore = ReturnType<typeof createSelectionStore>

/** Closes the store's devtools connection, which zustand only opens when the extension is there. */
export const releaseSelectionStore = (store: SelectionStore): void => {
  if (Object.hasOwn(store, 'devtools')) store.devtools.cleanup()
}
