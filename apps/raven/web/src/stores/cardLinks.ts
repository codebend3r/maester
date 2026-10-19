import type { AppPath } from '@raven/core'
import { create } from 'zustand'

export type Follow = (link: { to: AppPath; state: unknown }) => void

type CardLinksState = {
  /** Opens a card link's address in the app; null until `CardLinks` mounts. */
  follow: Follow | null
}

/** How every card link in the app follows its address, set by the one `CardLinks` near the root. */
export const useCardLinks = create<CardLinksState>()(() => ({ follow: null }))
