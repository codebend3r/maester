import type { PlaybackPolicy } from '@raven/core'
import { type ReactNode, createContext, useContext } from 'react'
import { usePlaybackPolicy } from '@/lib/usePlaybackPolicy'

/** Undefined outside `SharedPlaybackPolicy`, which no page is. */
const SharedPolicy = createContext<PlaybackPolicy | null | undefined>(undefined)

/**
 * Reads the server's playback policy once for everything inside, so a grid
 * of thousands of cards, each with its playback note, holds one subscription
 * to the settings rather than one per card. It wraps the whole app, so the
 * settings are asked for as the app opens and are on hand by the time a
 * listing is drawn, rather than asked for by its first card.
 */
export const SharedPlaybackPolicy = ({ children }: { children: ReactNode }) => {
  const policy = usePlaybackPolicy()
  return <SharedPolicy value={policy}>{children}</SharedPolicy>
}

/** The playback policy `SharedPlaybackPolicy` read: null until the settings answer. */
export const useSharedPlaybackPolicy = (): PlaybackPolicy | null => {
  const policy = useContext(SharedPolicy)
  if (policy === undefined) {
    throw new Error('useSharedPlaybackPolicy needs a SharedPlaybackPolicy around it')
  }
  return policy
}
