import type { WatchTarget } from '@raven/core'
import {
  type ReactNode,
  type RefObject,
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useStore } from 'zustand'
import { type SelectionStore, createSelectionStore } from '@/stores/selection'

/** What a section or page tells its scope about its cards. */
export type SelectionSource = {
  /** What marking the card named `key` marks. */
  resolve: (key: string) => readonly WatchTarget[]
  /** Every card's key, those folded away in a closed bucket too. */
  allKeys: () => readonly string[]
}

export type SelectionScopeValue = SelectionSource & {
  store: SelectionStore
}

const Selecting = createContext<SelectionScopeValue | null>(null)

/** The Select button, which gets the focus back when select mode ends. */
const SelectButtonRef = createContext<RefObject<HTMLButtonElement | null> | null>(null)

/** A card outside any scope reads from this one, which never starts selecting. */
const idle = createSelectionStore()

/** A `SelectionSource` from each card's key with what it marks. */
export const sourceOf = (
  entries: readonly (readonly [string, readonly WatchTarget[]])[],
): SelectionSource => {
  const targets = new Map(entries)
  return { resolve: (key) => targets.get(key) ?? [], allKeys: () => [...targets.keys()] }
}

/**
 * Select mode for the cards inside: one selection per mount, so a section
 * keyed by its tab, or a page left, ends it. The callbacks are read as they
 * stand when called, so a section drawn again does not redraw every card.
 */
export const SelectionScope = ({
  resolve,
  allKeys,
  children,
}: SelectionSource & { children: ReactNode }) => {
  const latest = useRef({ resolve, allKeys })
  useLayoutEffect(() => {
    latest.current = { resolve, allKeys }
  })
  const selectButton = useRef<HTMLButtonElement>(null)
  const [scope] = useState<SelectionScopeValue>(() => ({
    store: createSelectionStore(),
    resolve: (key) => latest.current.resolve(key),
    allKeys: () => latest.current.allKeys(),
  }))
  return (
    <Selecting value={scope}>
      <SelectButtonRef value={selectButton}>{children}</SelectButtonRef>
    </Selecting>
  )
}

/** The scope the card or button sits in, or null where nothing can be selected. */
export const useSelectionScope = (): SelectionScopeValue | null => useContext(Selecting)

/** A slice of the scope's selection; a card outside any scope reads an unused one. */
export const useSelection = <T,>(
  selector: (state: ReturnType<SelectionStore['getState']>) => T,
): T => useStore(useContext(Selecting)?.store ?? idle, selector)

/** Where the scope's Select button puts itself, for the bar to hand the focus back to. */
export const useSelectButtonRef = (): RefObject<HTMLButtonElement | null> | null =>
  useContext(SelectButtonRef)
