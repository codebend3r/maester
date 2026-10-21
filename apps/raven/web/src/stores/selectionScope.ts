import type { WatchTarget } from '@raven/core'
import type { RefObject } from 'react'
import { create } from 'zustand'
import type { SelectionStore } from '@raven/ui/headless'

/** What a section or page tells its scope about its cards. */
export type SelectionSource = {
  /** What marking the card named `key` marks. */
  resolve: (key: string) => readonly WatchTarget[]
  /** Every card's key, those folded away in a closed bucket too. */
  allKeys: () => readonly string[]
}

export type SelectionScopeValue = SelectionSource & {
  store: SelectionStore
  /** The Select button, which gets the focus back when select mode ends. */
  selectButton: RefObject<HTMLButtonElement | null>
}

type SelectionScopes = {
  /**
   * The scopes mounted, the latest last, whose cards are the ones that can
   * be selected. One is mounted at a time, as each wraps a whole page or the
   * open library tab; should two overlap, the earlier keeps its cards and is
   * open again once the later goes.
   */
  scopes: readonly SelectionScopeValue[]
}

export const useSelectionScopes = create<SelectionScopes>()(() => ({ scopes: [] }))

/** The scope whose cards can be selected now, or null where none can. */
export const openScope = (state: SelectionScopes): SelectionScopeValue | null =>
  state.scopes.at(-1) ?? null
