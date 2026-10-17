import type { WatchTarget } from '@raven/core'
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { type SelectionStore, createSelectionStore } from '@/stores/selection'
import {
  type SelectionScopeValue,
  type SelectionSource,
  openScope,
  useSelectionScopes,
} from '@/stores/selectionScope'

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
 * The scope goes in `useSelectionScopes` as this mounts, and the cards
 * inside draw once it is there, so none draws twice to find it.
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
    selectButton,
  }))
  useLayoutEffect(() => {
    useSelectionScopes.setState((state) => ({ scopes: [...state.scopes, scope] }))
    return () =>
      useSelectionScopes.setState((state) => ({
        scopes: state.scopes.filter((each) => each !== scope),
      }))
  }, [scope])
  const isOpen = useSelectionScopes((state) => state.scopes.includes(scope))
  return isOpen && children
}

/** The scope the card or button sits in, or null where nothing can be selected. */
export const useSelectionScope = (): SelectionScopeValue | null => useSelectionScopes(openScope)

/** A slice of the scope's selection; a card outside any scope reads an unused one. */
export const useSelection = <T,>(
  selector: (state: ReturnType<SelectionStore['getState']>) => T,
): T => useStore(useSelectionScopes(openScope)?.store ?? idle, selector)

/** Where the scope's Select button puts itself, for the bar to hand the focus back to. */
export const useSelectButtonRef = (): RefObject<HTMLButtonElement | null> | null =>
  useSelectionScopes((state) => openScope(state)?.selectButton ?? null)
