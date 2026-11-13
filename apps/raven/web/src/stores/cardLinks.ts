import type { AppPath } from '@raven/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

type FollowProps = { to: AppPath; state: unknown }

export type Follow = (link: FollowProps) => void

type CardLinksState = {
  /** Opens a card link's address in the app; null until `CardLinks` mounts. */
  follow: Follow | null
}

/** How every card link in the app follows its address, set by the one `CardLinks` near the root. */
export const useCardLinks = create<CardLinksState>()(
  devtools((): CardLinksState => ({ follow: null }), { name: 'raven/cardLinks' }),
)
