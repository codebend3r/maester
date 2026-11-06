import type { ComponentRef } from 'react'
import type { Pressable } from 'react-native'
import { create } from 'zustand'

type FocusedView = ComponentRef<typeof Pressable> | null

type LastFocus = {
  /** The control the remote was on last, among those that start music; null before any. */
  view: FocusedView
  note: (view: FocusedView) => void
}

/**
 * Where the remote was before the music strip took it, so Up from the strip goes back there:
 * a TV gives no way to ask which view has the focus, so the controls that can start music
 * (`PlateButton`, `ActionPlate`, `FocusRow`) say so as they take it.
 */
export const useLastFocus = create<LastFocus>()((set) => ({
  view: null,
  note: (view) => set({ view }),
}))
